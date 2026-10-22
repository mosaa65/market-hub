-- ============================================================================
-- 22_accounting_phase4_fixed_assets.sql
--
-- المرحلة 4 — المهمة T-21: الأصول الثابتة ودورة حياتها وإهلاكها الدوري.
--
-- تتضمن:
--   1. جدول الأصول الثابتة public.fixed_assets
--   2. جدول سجل الإهلاك public.asset_depreciation_lines
--   3. دالة تفعيل الأصل public.activate_fixed_asset
--   4. دالة تشغيل الإهلاك الدوري public.run_depreciation بالقيد:
--        Dr 5611 (مصروف إهلاك الأصول الثابتة)
--        Cr 1491 (مجمع إهلاك الأصول الثابتة)
--   5. دالة الإهلاك الجماعي لجميع الأصول النشطة public.run_batch_depreciation
--   6. دالة استبعاد/شطب الأصل public.dispose_fixed_asset (Dr 1491, Cr الأصل, فوارق 4911/5811)
--   7. قواعد RLS وصلاحيات التنفيذ وسجلات التدقيق
-- ============================================================================

-- ── 1. جدول الأصول الثابتة ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fixed_assets (
  id                                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code                            text NOT NULL UNIQUE,
  name_ar                               text NOT NULL,
  name_en                               text,
  category                              text NOT NULL CHECK (category IN ('MACHINERY', 'VEHICLES', 'EQUIPMENT', 'BUILDINGS', 'OTHER')),
  purchase_date                         date NOT NULL,
  purchase_cost                         numeric(18,2) NOT NULL CHECK (purchase_cost > 0),
  salvage_value                         numeric(18,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0 AND salvage_value < purchase_cost),
  useful_life_months                    integer NOT NULL CHECK (useful_life_months > 0),
  depreciation_method                   text NOT NULL DEFAULT 'STRAIGHT_LINE' CHECK (depreciation_method IN ('STRAIGHT_LINE', 'DECLINING_BALANCE')),
  asset_account_code                    text NOT NULL DEFAULT '1411',
  accumulated_depreciation_account_code text NOT NULL DEFAULT '1491',
  depreciation_expense_account_code     text NOT NULL DEFAULT '5611',
  status                                text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED')),
  accumulated_depreciation              numeric(18,2) NOT NULL DEFAULT 0 CHECK (accumulated_depreciation >= 0),
  current_book_value                    numeric(18,2) NOT NULL,
  last_depreciation_date                date,
  disposal_date                         date,
  disposal_amount                       numeric(18,2),
  notes                                 text,
  created_by                            uuid REFERENCES auth.users(id),
  created_at                            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_fixed_assets_status ON public.fixed_assets(status);
CREATE INDEX IF NOT EXISTS ix_fixed_assets_code ON public.fixed_assets(asset_code);

COMMENT ON TABLE public.fixed_assets IS
  'T-21: الأصول الثابتة للمنشأة ومتابعة قيمتها الدفترية ومجمع إهلاكها ودورة حياتها.';

-- ── 2. جدول سجل الإهلاك الدوري ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.asset_depreciation_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id            uuid NOT NULL REFERENCES public.fixed_assets(id) ON DELETE RESTRICT,
  depreciation_date   date NOT NULL,
  depreciation_amount numeric(18,2) NOT NULL CHECK (depreciation_amount > 0),
  book_value_before   numeric(18,2) NOT NULL,
  book_value_after    numeric(18,2) NOT NULL,
  journal_entry_id    uuid REFERENCES public.journal_entries(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_asset_depreciation_date UNIQUE (asset_id, depreciation_date)
);

CREATE INDEX IF NOT EXISTS ix_asset_depr_asset ON public.asset_depreciation_lines(asset_id);
CREATE INDEX IF NOT EXISTS ix_asset_depr_date ON public.asset_depreciation_lines(depreciation_date);

COMMENT ON TABLE public.asset_depreciation_lines IS
  'T-21: سجل قيود وأقساط الإهلاك المحسوبة لكل أصل لمنع التكرار وحفظ الأثر المحاسبي.';

-- ── 3. دالة تفعيل الأصل ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activate_fixed_asset(p_asset_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_asset record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may activate fixed assets';
  END IF;

  SELECT * INTO v_asset FROM public.fixed_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fixed asset not found';
  END IF;

  IF v_asset.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Asset % is already in status %', v_asset.asset_code, v_asset.status;
  END IF;

  UPDATE public.fixed_assets
     SET status = 'ACTIVE'
   WHERE id = p_asset_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'fixed_asset.activated', 'fixed_asset', p_asset_id,
          jsonb_build_object('asset_code', v_asset.asset_code, 'purchase_cost', v_asset.purchase_cost));

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.activate_fixed_asset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_fixed_asset(uuid) TO authenticated, service_role;

-- ── 4. دالة تشغيل الإهلاك الدوري (T-21: Dr 5611 / Cr 1491) ───────────────────
CREATE OR REPLACE FUNCTION public.run_depreciation(
  p_asset_id uuid,
  p_date     date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_asset       record;
  v_monthly     numeric(18,2);
  v_depreciable numeric(18,2);
  v_remaining   numeric(18,2);
  v_amount      numeric(18,2);
  v_new_acc     numeric(18,2);
  v_new_book    numeric(18,2);
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
    RAISE EXCEPTION 'Only an owner, manager or accountant may run asset depreciation';
  END IF;

  -- فحص الفترة المالية
  PERFORM public.assert_period_open(p_date);

  SELECT * INTO v_asset FROM public.fixed_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fixed asset not found';
  END IF;

  IF v_asset.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Asset % is not active (status: %)', v_asset.asset_code, v_asset.status;
  END IF;

  -- منع تكرار الإهلاك في نفس التاريخ المحدد للأصل
  IF EXISTS (
    SELECT 1 FROM public.asset_depreciation_lines
     WHERE asset_id = p_asset_id AND depreciation_date = p_date
  ) THEN
    RAISE EXCEPTION 'Asset % has already been depreciated on %', v_asset.asset_code, p_date;
  END IF;

  -- حساب الإهلاك بالقسط الثابت: (التكلفة - قيمة الخردة) / العمر الإنتاجي
  v_depreciable := v_asset.purchase_cost - v_asset.salvage_value;
  v_monthly     := round(v_depreciable / v_asset.useful_life_months, 2);
  v_remaining   := v_depreciable - v_asset.accumulated_depreciation;

  IF v_remaining <= 0 THEN
    UPDATE public.fixed_assets
       SET status = 'FULLY_DEPRECIATED'
     WHERE id = p_asset_id;
    RETURN NULL;
  END IF;

  v_amount := least(v_monthly, v_remaining);
  IF v_amount <= 0 THEN
    RETURN NULL;
  END IF;

  v_new_acc  := v_asset.accumulated_depreciation + v_amount;
  v_new_book := v_asset.purchase_cost - v_new_acc;

  -- بناء القيد المحاسبي المتوازن: Dr 5611 / Cr 1491
  v_memo := 'إهلاك أصل ثابت ' || v_asset.asset_code || ' (' || v_asset.name_ar || ') بتاريخ ' || to_char(p_date, 'YYYY-MM-DD');
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_code', v_asset.depreciation_expense_account_code, -- 5611
      'debit', v_amount,
      'credit', 0,
      'memo', 'مصروف إهلاك — ' || v_asset.name_ar
    ),
    jsonb_build_object(
      'account_code', v_asset.accumulated_depreciation_account_code, -- 1491
      'debit', 0,
      'credit', v_amount,
      'memo', 'مجمع إهلاك — ' || v_asset.name_ar
    )
  );

  v_entry_id := public.create_journal_entry(
    v_memo,
    p_date,
    'fixed_asset_depreciation',
    p_asset_id,
    true, -- قيد نظامي
    v_lines,
    false
  );

  -- تسجيل في سجل الإهلاك
  INSERT INTO public.asset_depreciation_lines (
    asset_id, depreciation_date, depreciation_amount, book_value_before, book_value_after, journal_entry_id
  )
  VALUES (
    p_asset_id, p_date, v_amount, v_asset.current_book_value, v_new_book, v_entry_id
  );

  -- تحديث الأصل
  UPDATE public.fixed_assets
     SET accumulated_depreciation = v_new_acc,
         current_book_value       = v_new_book,
         last_depreciation_date   = p_date,
         status                   = CASE WHEN v_new_acc >= v_depreciable THEN 'FULLY_DEPRECIATED' ELSE 'ACTIVE' END
   WHERE id = p_asset_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'fixed_asset.depreciated', 'fixed_asset', p_asset_id,
          jsonb_build_object('asset_code', v_asset.asset_code, 'amount', v_amount,
                             'journal_entry_id', v_entry_id, 'new_book_value', v_new_book));

  RETURN v_entry_id;
END $$;

REVOKE ALL ON FUNCTION public.run_depreciation(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_depreciation(uuid, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.run_depreciation(uuid, date) IS
  'T-21: ترحيل قسط الإهلاك الدوري للأصل الثابت بالقيد المتوازن Dr 5611 / Cr 1491 مع تحديث القيمة الدفترية ومنع التكرار.';

-- ── 5. دالة الإهلاك الجماعي للأصول النشطة ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_batch_depreciation(p_date date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user      uuid := auth.uid();
  r           record;
  v_entry     uuid;
  v_count     integer := 0;
  v_total     numeric(18,2) := 0;
  v_skipped   integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may run batch depreciation';
  END IF;

  FOR r IN
    SELECT id, asset_code FROM public.fixed_assets
     WHERE status = 'ACTIVE'
     ORDER BY purchase_date ASC
  LOOP
    BEGIN
      v_entry := public.run_depreciation(r.id, p_date);
      IF v_entry IS NOT NULL THEN
        v_count := v_count + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION WHEN others THEN
      -- تخطي ما تم إهلاكه سابقاً في نفس اليوم
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'date', p_date,
    'depreciated_count', v_count,
    'skipped_count', v_skipped
  );
END $$;

REVOKE ALL ON FUNCTION public.run_batch_depreciation(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_batch_depreciation(date) TO authenticated, service_role;

-- ── 6. دالة استبعاد الأصل الثابت (Disposal) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.dispose_fixed_asset(
  p_asset_id           uuid,
  p_disposal_date      date,
  p_proceeds           numeric(18,2) DEFAULT 0,
  p_proceeds_account   text DEFAULT '1101'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_asset       record;
  v_lines       jsonb := '[]'::jsonb;
  v_entry_id    uuid;
  v_gain_loss   numeric(18,2);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may dispose fixed assets';
  END IF;

  PERFORM public.assert_period_open(p_disposal_date);

  SELECT * INTO v_asset FROM public.fixed_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fixed asset not found';
  END IF;

  IF v_asset.status NOT IN ('ACTIVE', 'FULLY_DEPRECIATED') THEN
    RAISE EXCEPTION 'Asset % cannot be disposed (current status: %)', v_asset.asset_code, v_asset.status;
  END IF;

  -- حساب الأرباح أو الخسائر الرأسمالية: الحصيلة - القيمة الدفترية
  v_gain_loss := coalesce(p_proceeds, 0) - v_asset.current_book_value;

  -- 1) إقفال مجمع الإهلاك (مدين 1491)
  IF v_asset.accumulated_depreciation > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', v_asset.accumulated_depreciation_account_code, -- 1491
        'debit', v_asset.accumulated_depreciation,
        'credit', 0,
        'memo', 'إقفال مجمع إهلاك الأصل المستبعد — ' || v_asset.name_ar
      )
    );
  END IF;

  -- 2) إثبات حصيلة البيع إن وجدت (مدين نقدية/بنك)
  IF coalesce(p_proceeds, 0) > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', coalesce(p_proceeds_account, '1101'),
        'debit', p_proceeds,
        'credit', 0,
        'memo', 'حصيلة بيع الأصل — ' || v_asset.name_ar
      )
    );
  END IF;

  -- 3) إثبات الخسارة الرأسمالية إن وجدت (مدين 5811 خسائر شطب أصول)
  IF v_gain_loss < 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '5811',
        'debit', -v_gain_loss,
        'credit', 0,
        'memo', 'خسائر بيع/شطب أصل — ' || v_asset.name_ar
      )
    );
  END IF;

  -- 4) إقفال التكلفة التاريخية للأصل (دائن 14xx)
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object(
      'account_code', v_asset.asset_account_code,
      'debit', 0,
      'credit', v_asset.purchase_cost,
      'memo', 'استبعاد تكلفة الأصل — ' || v_asset.name_ar
    )
  );

  -- 5) إثبات الأرباح الرأسمالية إن وجدت (دائن 4911 إيرادات أخرى)
  IF v_gain_loss > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '4911',
        'debit', 0,
        'credit', v_gain_loss,
        'memo', 'أرباح بيع أصل رأسمالي — ' || v_asset.name_ar
      )
    );
  END IF;

  v_entry_id := public.create_journal_entry(
    'استبعاد وشطب الأصل الثابت ' || v_asset.asset_code || ' — ' || v_asset.name_ar,
    p_disposal_date,
    'fixed_asset_disposal',
    p_asset_id,
    true,
    v_lines,
    false
  );

  UPDATE public.fixed_assets
     SET status = 'DISPOSED',
         disposal_date = p_disposal_date,
         disposal_amount = coalesce(p_proceeds, 0)
   WHERE id = p_asset_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'fixed_asset.disposed', 'fixed_asset', p_asset_id,
          jsonb_build_object('asset_code', v_asset.asset_code, 'proceeds', p_proceeds,
                             'gain_loss', v_gain_loss, 'entry_id', v_entry_id));

  RETURN v_entry_id;
END $$;

REVOKE ALL ON FUNCTION public.dispose_fixed_asset(uuid, date, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispose_fixed_asset(uuid, date, numeric, text) TO authenticated, service_role;

-- ── 7. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_depreciation_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fixed_assets_read ON public.fixed_assets;
CREATE POLICY fixed_assets_read ON public.fixed_assets
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS fixed_assets_insert ON public.fixed_assets;
CREATE POLICY fixed_assets_insert ON public.fixed_assets
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'accountant')
  );

DROP POLICY IF EXISTS fixed_assets_update ON public.fixed_assets;
CREATE POLICY fixed_assets_update ON public.fixed_assets
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'accountant')
  );

DROP POLICY IF EXISTS asset_depreciation_lines_read ON public.asset_depreciation_lines;
CREATE POLICY asset_depreciation_lines_read ON public.asset_depreciation_lines
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

GRANT SELECT, INSERT, UPDATE ON public.fixed_assets TO authenticated, service_role;
GRANT SELECT ON public.asset_depreciation_lines TO authenticated, service_role;
