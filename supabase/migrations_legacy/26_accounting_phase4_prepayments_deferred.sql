-- ============================================================================
-- 23_accounting_phase4_prepayments_deferred.sql
--
-- المرحلة 4 — المهمة T-22: المصاريف والإيرادات المقدمة أو المؤجلة وتوزيعها على الفترات.
--
-- تتضمن:
--   1. جدول العقود والمصاريف/الإيرادات المقدمة public.prepaid_and_deferred_contracts
--   2. جدول سجل الاستهلاك والتوزيع الزمني public.amortization_lines
--   3. دالة تفعيل العقد public.activate_prepaid_contract
--   4. دالة استهلاك/توزيع القسط الزمني public.run_contract_amortization:
--      - للمصروف المقدم: Dr 5xxx (حساب المصروف) / Cr 1511 (مصروفات مدفوعة مقدماً)
--      - للإيراد المؤجل: Dr 2231 (إيرادات مؤجلة) / Cr 4xxx (حساب الإيراد)
--   5. دالة الاستهلاك الجماعي لجميع العقود النشطة public.run_batch_amortization
--   6. سياسات RLS وسجلات التدقيق والصلاحيات
-- ============================================================================

-- ── 1. جدول عقود المصاريف والإيرادات المقدمة ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prepaid_and_deferred_contracts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number      text NOT NULL UNIQUE,
  contract_type        text NOT NULL CHECK (contract_type IN ('PREPAID_EXPENSE', 'DEFERRED_EXPENSE', 'DEFERRED_REVENUE')),
  title                text NOT NULL,
  total_amount         numeric(18,2) NOT NULL CHECK (total_amount > 0),
  start_date           date NOT NULL,
  end_date             date NOT NULL,
  total_periods        integer NOT NULL CHECK (total_periods > 0),
  balance_account_code text NOT NULL, -- 1511 للمصروف المقدم، 1512 للمؤجل، 2231 للإيراد المؤجل
  target_account_code  text NOT NULL, -- 5xxx للمصروف الفعلي، 4xxx للإيراد الفعلي
  status               text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  amortized_amount     numeric(18,2) NOT NULL DEFAULT 0 CHECK (amortized_amount >= 0),
  remaining_amount     numeric(18,2) NOT NULL,
  last_amortization_date date,
  notes                text,
  created_by           uuid REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_contract_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS ix_prepaid_status ON public.prepaid_and_deferred_contracts(status);
CREATE INDEX IF NOT EXISTS ix_prepaid_type ON public.prepaid_and_deferred_contracts(contract_type);

COMMENT ON TABLE public.prepaid_and_deferred_contracts IS
  'T-22: إدارة عقود المصروفات والإيرادات المقدمة والمؤجلة وتوزيعها على الفترات المحاسبية.';

-- ── 2. جدول سجل التوزيع والأقساط المحسوبة ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.amortization_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id         uuid NOT NULL REFERENCES public.prepaid_and_deferred_contracts(id) ON DELETE RESTRICT,
  period_date         date NOT NULL,
  amount              numeric(18,2) NOT NULL CHECK (amount > 0),
  remaining_after     numeric(18,2) NOT NULL,
  journal_entry_id    uuid REFERENCES public.journal_entries(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_contract_period_date UNIQUE (contract_id, period_date)
);

CREATE INDEX IF NOT EXISTS ix_amortization_contract ON public.amortization_lines(contract_id);
CREATE INDEX IF NOT EXISTS ix_amortization_date ON public.amortization_lines(period_date);

COMMENT ON TABLE public.amortization_lines IS
  'T-22: سجل قيود وأقساط التوزيع الزمني للمصروفات/الإيرادات المقدمة مع منع التكرار.';

-- ── 3. دالة تفعيل العقد ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activate_prepaid_contract(p_contract_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_rec  record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may activate prepaid contracts';
  END IF;

  SELECT * INTO v_rec FROM public.prepaid_and_deferred_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract not found';
  END IF;

  IF v_rec.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Contract % is already in status %', v_rec.contract_number, v_rec.status;
  END IF;

  UPDATE public.prepaid_and_deferred_contracts
     SET status = 'ACTIVE'
   WHERE id = p_contract_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'prepaid_contract.activated', 'prepaid_contract', p_contract_id,
          jsonb_build_object('contract_number', v_rec.contract_number, 'total_amount', v_rec.total_amount));

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.activate_prepaid_contract(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_prepaid_contract(uuid) TO authenticated, service_role;

-- ── 4. دالة استهلاك/توزيع القسط الدوري للمصروف/الإيراد المقدم ────────────────
CREATE OR REPLACE FUNCTION public.run_contract_amortization(
  p_contract_id uuid,
  p_date        date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_rec         record;
  v_period_amt  numeric(18,2);
  v_amount      numeric(18,2);
  v_new_amort   numeric(18,2);
  v_new_rem     numeric(18,2);
  v_entry_id    uuid;
  v_memo        text;
  v_lines       jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may amortize prepaid contracts';
  END IF;

  -- فحص الفترة المالية
  PERFORM public.assert_period_open(p_date);

  SELECT * INTO v_rec FROM public.prepaid_and_deferred_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract not found';
  END IF;

  IF v_rec.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Contract % is not active (status: %)', v_rec.contract_number, v_rec.status;
  END IF;

  -- منع تكرار الاستهلاك لنفس العقد في نفس التاريخ
  IF EXISTS (
    SELECT 1 FROM public.amortization_lines
     WHERE contract_id = p_contract_id AND period_date = p_date
  ) THEN
    RAISE EXCEPTION 'Contract % has already been amortized on %', v_rec.contract_number, p_date;
  END IF;

  IF v_rec.remaining_amount <= 0 THEN
    UPDATE public.prepaid_and_deferred_contracts
       SET status = 'COMPLETED'
     WHERE id = p_contract_id;
    RETURN NULL;
  END IF;

  v_period_amt := round(v_rec.total_amount / v_rec.total_periods, 2);
  v_amount     := least(v_period_amt, v_rec.remaining_amount);

  IF v_amount <= 0 THEN
    RETURN NULL;
  END IF;

  v_new_amort := v_rec.amortized_amount + v_amount;
  v_new_rem   := v_rec.total_amount - v_new_amort;

  -- بناء القيد المحاسبي المتوازن حسب نوع العقد
  IF v_rec.contract_type IN ('PREPAID_EXPENSE', 'DEFERRED_EXPENSE') THEN
    -- استهلاك مصروف مقدم: Dr حساب المصروف الفعلي / Cr حساب المصروف المقدم (1511/1512)
    v_memo := 'استهلاك قسط مصروف مقدم — ' || v_rec.title || ' (' || v_rec.contract_number || ')';
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', v_rec.target_account_code,
        'debit', v_amount,
        'credit', 0,
        'memo', 'تحميل مصروف الفترة — ' || v_rec.title
      ),
      jsonb_build_object(
        'account_code', v_rec.balance_account_code,
        'debit', 0,
        'credit', v_amount,
        'memo', 'تخفيض المصروف المقدم — ' || v_rec.title
      )
    );
  ELSE
    -- تحقق إيراد مؤجل: Dr حساب الإيراد المؤجل (2231) / Cr حساب الإيراد الفعلي (4xxx)
    v_memo := 'اعتراف بقسط إيراد مؤجل — ' || v_rec.title || ' (' || v_rec.contract_number || ')';
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', v_rec.balance_account_code,
        'debit', v_amount,
        'credit', 0,
        'memo', 'تخفيض التزام الإيراد المؤجل — ' || v_rec.title
      ),
      jsonb_build_object(
        'account_code', v_rec.target_account_code,
        'debit', 0,
        'credit', v_amount,
        'memo', 'تحقق إيراد الفترة — ' || v_rec.title
      )
    );
  END IF;

  v_entry_id := public.create_journal_entry(
    v_memo,
    p_date,
    'prepaid_amortization',
    p_contract_id,
    true,
    v_lines,
    false
  );

  -- تسجيل في سجل الاستهلاك
  INSERT INTO public.amortization_lines (
    contract_id, period_date, amount, remaining_after, journal_entry_id
  )
  VALUES (
    p_contract_id, p_date, v_amount, v_new_rem, v_entry_id
  );

  -- تحديث العقد
  UPDATE public.prepaid_and_deferred_contracts
     SET amortized_amount       = v_new_amort,
         remaining_amount       = v_new_rem,
         last_amortization_date = p_date,
         status                 = CASE WHEN v_new_rem <= 0 THEN 'COMPLETED' ELSE 'ACTIVE' END
   WHERE id = p_contract_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'prepaid_contract.amortized', 'prepaid_contract', p_contract_id,
          jsonb_build_object('contract_number', v_rec.contract_number, 'amount', v_amount,
                             'journal_entry_id', v_entry_id, 'remaining', v_new_rem));

  RETURN v_entry_id;
END $$;

REVOKE ALL ON FUNCTION public.run_contract_amortization(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_contract_amortization(uuid, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.run_contract_amortization(uuid, date) IS
  'T-22: توزيع واستهلاك قسط المصروف أو الإيراد المقدم بقيد مزدوج متوازن مع منع التكرار وتحديث الأرصدة.';

-- ── 5. دالة الاستهلاك الجماعي ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_batch_amortization(p_date date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  r         record;
  v_entry   uuid;
  v_count   integer := 0;
  v_skipped integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may run batch amortization';
  END IF;

  FOR r IN
    SELECT id, contract_number FROM public.prepaid_and_deferred_contracts
     WHERE status = 'ACTIVE'
     ORDER BY start_date ASC
  LOOP
    BEGIN
      v_entry := public.run_contract_amortization(r.id, p_date);
      IF v_entry IS NOT NULL THEN
        v_count := v_count + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION WHEN others THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'date', p_date,
    'amortized_count', v_count,
    'skipped_count', v_skipped
  );
END $$;

REVOKE ALL ON FUNCTION public.run_batch_amortization(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_batch_amortization(date) TO authenticated, service_role;

-- ── 6. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.prepaid_and_deferred_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amortization_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prepaid_contracts_read ON public.prepaid_and_deferred_contracts;
CREATE POLICY prepaid_contracts_read ON public.prepaid_and_deferred_contracts
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS prepaid_contracts_write ON public.prepaid_and_deferred_contracts;
CREATE POLICY prepaid_contracts_write ON public.prepaid_and_deferred_contracts
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'accountant')
  );

DROP POLICY IF EXISTS amortization_lines_read ON public.amortization_lines;
CREATE POLICY amortization_lines_read ON public.amortization_lines
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

GRANT SELECT, INSERT, UPDATE ON public.prepaid_and_deferred_contracts TO authenticated, service_role;
GRANT SELECT ON public.amortization_lines TO authenticated, service_role;
