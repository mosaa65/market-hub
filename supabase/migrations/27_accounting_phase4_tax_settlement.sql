-- ============================================================================
-- 24_accounting_phase4_tax_settlement.sql
--
-- المرحلة 4 — المهمة T-23: التسوية الضريبية والإقرار الضريبي.
--
-- التحقق المحاسبي المعتمد:
--   1316 = ضريبة القيمة المضافة على المشتريات (مدخلات — أصل مدين قابل للاسترداد)
--   2311 = ضريبة القيمة المضافة المستحقة (مخرجات — التزام دائن محصل على المبيعات)
--   2321 = صافي الضريبة المستحقة الدفع (التزام تسوية — ناتج مقابلة 2311 و 1316)
--
-- قيد التسوية عند إقفال الفترة الضريبية:
--   Dr 2311  (تصفير ضريبة المخرجات المحصلة)
--   Cr 1316  (تصفير ضريبة المدخلات المدفوعة)
--   الفرق إلى 2321:
--     Cr 2321 إذا كانت المخرجات > المدخلات (مبلغ مستحق السداد للهيئة)
--     Dr 2321 إذا كانت المدخلات > المخرجات (رصيد دائن مسترد/مرحل)
-- ============================================================================

-- ── 1. جدول الفترات والتسويات الضريبية ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tax_settlement_periods (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_number            text NOT NULL UNIQUE,
  start_date               date NOT NULL,
  end_date                 date NOT NULL,
  total_taxable_sales      numeric(18,2) NOT NULL DEFAULT 0,
  output_tax_amount        numeric(18,2) NOT NULL DEFAULT 0, -- 2311
  total_taxable_purchases  numeric(18,2) NOT NULL DEFAULT 0,
  input_tax_amount         numeric(18,2) NOT NULL DEFAULT 0, -- 1316
  net_tax_payable          numeric(18,2) NOT NULL DEFAULT 0, -- output - input
  status                   text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SETTLED', 'PAID')),
  journal_entry_id         uuid REFERENCES public.journal_entries(id),
  settled_at               timestamptz,
  settled_by               uuid REFERENCES auth.users(id),
  paid_at                  timestamptz,
  payment_journal_entry_id uuid REFERENCES public.journal_entries(id),
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_tax_period_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS ix_tax_settlement_status ON public.tax_settlement_periods(status);
CREATE INDEX IF NOT EXISTS ix_tax_settlement_dates ON public.tax_settlement_periods(start_date, end_date);

COMMENT ON TABLE public.tax_settlement_periods IS
  'T-23: سجل الإقرارات والتسويات الضريبية الدورية وقيد التسوية 2311 مقابل 1316 وسداد 2321.';

-- ── 2. دالة توليد بيانات الإقرار الضريبي (تقرير استعلامي) ────────────────────
CREATE OR REPLACE FUNCTION public.generate_tax_declaration(
  p_start_date date,
  p_end_date   date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user          uuid := auth.uid();
  v_sales_taxable numeric(18,2) := 0;
  v_output_tax    numeric(18,2) := 0;
  v_purch_taxable numeric(18,2) := 0;
  v_input_tax     numeric(18,2) := 0;
  v_net_tax       numeric(18,2) := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- ⚠️ الكتالوج يدعوها من الواجهة بوسيطَين، ونمررهما NULL أحيانًا عند الاستعلام
  --    الحر. بلا هذا الفحص يرجع مجموعًا صفريًا صامتًا (مضلّل)، فيُرفض صراحةً.
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Tax declaration needs both start_date and end_date'
      USING ERRCODE = '22023';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Tax declaration end_date (%) is before start_date (%)', p_end_date, p_start_date
      USING ERRCODE = '22023';
  END IF;

  -- 1) ضريبة المخرجات من القيود المرحلة لحساب 2311 (رصيد دائن)
  SELECT coalesce(sum(jl.credit - jl.debit), 0)
    INTO v_output_tax
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.entry_id
    JOIN public.accounts a ON a.id = jl.account_id
   WHERE a.code = '2311'
     AND je.status = 'POSTED'
     AND je.source_type <> 'tax_settlement'
     AND je.entry_date BETWEEN p_start_date AND p_end_date;

  -- 2) ضريبة المدخلات من القيود المرحلة لحساب 1316 (رصيد مدين)
  SELECT coalesce(sum(jl.debit - jl.credit), 0)
    INTO v_input_tax
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.entry_id
    JOIN public.accounts a ON a.id = jl.account_id
   WHERE a.code = '1316'
     AND je.status = 'POSTED'
     AND je.source_type <> 'tax_settlement'
     AND je.entry_date BETWEEN p_start_date AND p_end_date;

  -- 3) إجمالي مبيعات الفترة الخاضعة للضريبة من الفواتير
  --
  -- ⚠️ الفاتورة لا تحمل عمود تاريخ مستقل: تاريخها التشغيلي هو created_at
  --    (الترحيل يعتمد عليه، وقوائم التقارير كذلك — راجع 12_reporting_views).
  --    أُصلح هنا بعد أن كان الاستعلام يقرأ invoice_date غير الموجود فيرمي
  --    42703 «column invoice_date does not exist» عند كل استدعاء للإقرار
  --    الضريبي وتسوية الفترة — أي أن الوحدة كانت معطّلة بالكامل.
  --    النطاق الزمني [start, end] شامل: نقارن نصف مفتوح (<= نهاية اليوم) حتى
  --    لا تسقط فواتير آخر يوم بعد منتصف الليل.
  SELECT coalesce(sum(subtotal), 0)
    INTO v_sales_taxable
    FROM public.sales_invoices
    WHERE status = 'confirmed'
      AND created_at >= p_start_date
      AND created_at <  p_end_date + 1;

  -- 4) إجمالي مشتريات الفترة من الفواتير
  SELECT coalesce(sum(subtotal), 0)
    INTO v_purch_taxable
    FROM public.purchase_invoices
    WHERE status = 'confirmed'
      AND created_at >= p_start_date
      AND created_at <  p_end_date + 1;

  v_net_tax := v_output_tax - v_input_tax;

  RETURN jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'taxable_sales', v_sales_taxable,
    'output_tax', v_output_tax,
    'taxable_purchases', v_purch_taxable,
    'input_tax', v_input_tax,
    'net_tax_payable', v_net_tax
  );
END $$;

REVOKE ALL ON FUNCTION public.generate_tax_declaration(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_tax_declaration(date, date) TO authenticated, service_role;

-- ── 3. دالة التسوية الضريبية وإقفال الفترة (Dr 2311 / Cr 1316 / الفرق 2321) ──
CREATE OR REPLACE FUNCTION public.settle_tax_period(
  p_start_date      date,
  p_end_date        date,
  p_period_number   text,
  p_settlement_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user          uuid := auth.uid();
  v_decl          jsonb;
  v_output_tax    numeric(18,2);
  v_input_tax     numeric(18,2);
  v_net_tax       numeric(18,2);
  v_sales         numeric(18,2);
  v_purch         numeric(18,2);
  v_lines         jsonb := '[]'::jsonb;
  v_entry_id      uuid;
  v_settle_id     uuid;
  v_memo          text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- ⚠️ لا تسوية بلا نطاق وسياق: رفض صريح بدل قيد تسوية صفري كاذب.
  IF p_start_date IS NULL OR p_end_date IS NULL
     OR nullif(btrim(coalesce(p_period_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Tax settlement requires start_date, end_date and period_number'
      USING ERRCODE = '22023';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Tax settlement end_date (%) is before start_date (%)', p_end_date, p_start_date
      USING ERRCODE = '22023';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may settle taxes';
  END IF;

  PERFORM public.assert_period_open(p_settlement_date);

  IF EXISTS (
    SELECT 1 FROM public.tax_settlement_periods
     WHERE period_number = p_period_number
  ) THEN
    RAISE EXCEPTION 'Tax period % already exists or settled', p_period_number;
  END IF;

  -- قراءة أرقام الإقرار
  v_decl := public.generate_tax_declaration(p_start_date, p_end_date);
  v_sales      := (v_decl->>'taxable_sales')::numeric;
  v_output_tax := (v_decl->>'output_tax')::numeric;
  v_purch      := (v_decl->>'taxable_purchases')::numeric;
  v_input_tax  := (v_decl->>'input_tax')::numeric;
  v_net_tax    := (v_decl->>'net_tax_payable')::numeric;

  IF v_output_tax = 0 AND v_input_tax = 0 THEN
    RAISE EXCEPTION 'لا توجد حركات ضريبية مرحّلة للفترة المحددة لتسويتها';
  END IF;

  -- بناء قيد التسوية المتوازن:
  -- 1) تصفير ضريبة المخرجات: Dr 2311 بمقدار رصيدها
  IF v_output_tax > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '2311',
        'debit', v_output_tax,
        'credit', 0,
        'memo', 'تسوية ضريبة المخرجات للفترة ' || p_period_number
      )
    );
  END IF;

  -- 2) تصفير ضريبة المدخلات: Cr 1316 بمقدار رصيدها
  IF v_input_tax > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '1316',
        'debit', 0,
        'credit', v_input_tax,
        'memo', 'تسوية ضريبة المدخلات للفترة ' || p_period_number
      )
    );
  END IF;

  -- 3) حساب صافي الضريبة المستحقة (2321):
  IF v_net_tax > 0 THEN
    -- التزام مستحق الدفع للهيئة: Cr 2321
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '2321',
        'debit', 0,
        'credit', v_net_tax,
        'memo', 'صافي ضريبة القيمة المضافة المستحقة للدفع — ' || p_period_number
      )
    );
  ELSIF v_net_tax < 0 THEN
    -- رصيد دائن مسترد للمنشأة: Dr 2321
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '2321',
        'debit', -v_net_tax,
        'credit', 0,
        'memo', 'رصيد ضريبة مدخلات فائض مسترد/مرحل — ' || p_period_number
      )
    );
  END IF;

  v_memo := 'قيد التسوية والإقرار الضريبي للفترة ' || p_period_number ||
            ' (' || to_char(p_start_date, 'YYYY-MM-DD') || ' إلى ' || to_char(p_end_date, 'YYYY-MM-DD') || ')';

  v_entry_id := public.create_journal_entry(
    v_memo,
    p_settlement_date,
    'tax_settlement',
    NULL,
    true,
    v_lines,
    false
  );

  INSERT INTO public.tax_settlement_periods (
    period_number, start_date, end_date, total_taxable_sales,
    output_tax_amount, total_taxable_purchases, input_tax_amount,
    net_tax_payable, status, journal_entry_id, settled_at, settled_by
  )
  VALUES (
    p_period_number, p_start_date, p_end_date, v_sales,
    v_output_tax, v_purch, v_input_tax,
    v_net_tax, 'SETTLED', v_entry_id, now(), v_user
  )
  RETURNING id INTO v_settle_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'tax.settled', 'tax_settlement', v_settle_id,
          jsonb_build_object('period_number', p_period_number, 'net_tax', v_net_tax, 'entry_id', v_entry_id));

  RETURN v_settle_id;
END $$;

REVOKE ALL ON FUNCTION public.settle_tax_period(date, date, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_tax_period(date, date, text, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.settle_tax_period(date, date, text, date) IS
  'T-23: تسوية الفترة الضريبية بالقيد المتوازن Dr 2311 / Cr 1316 وإثبات الفرق في 2321.';

-- ── 4. دالة سداد الضريبة لهيئة الضرائب (Dr 2321 / Cr نقدية/بنك) ──────────────
CREATE OR REPLACE FUNCTION public.pay_tax_settlement(
  p_settlement_id    uuid,
  p_payment_date     date DEFAULT CURRENT_DATE,
  p_payment_account  text DEFAULT '1101'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_settle   record;
  v_lines    jsonb;
  v_entry_id uuid;
  v_memo     text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may pay tax settlements';
  END IF;

  PERFORM public.assert_period_open(p_payment_date);

  SELECT * INTO v_settle FROM public.tax_settlement_periods WHERE id = p_settlement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tax settlement not found';
  END IF;

  IF v_settle.status <> 'SETTLED' THEN
    RAISE EXCEPTION 'Settlement % is not in SETTLED status (current: %)', v_settle.period_number, v_settle.status;
  END IF;

  IF v_settle.net_tax_payable <= 0 THEN
    RAISE EXCEPTION 'لا يوجد التزام ضريبي واجب السداد (الصافي %)', v_settle.net_tax_payable;
  END IF;

  v_memo := 'سداد ضريبة القيمة المضافة لهيئة الضرائب عن الفترة ' || v_settle.period_number;
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_code', '2321', -- تصفير الالتزام
      'debit', v_settle.net_tax_payable,
      'credit', 0,
      'memo', 'سداد الالتزام الضريبي — ' || v_settle.period_number
    ),
    jsonb_build_object(
      'account_code', coalesce(p_payment_account, '1101'), -- دفع من الصندوق أو البنك
      'debit', 0,
      'credit', v_settle.net_tax_payable,
      'memo', 'دفع الضريبة المستحقة'
    )
  );

  v_entry_id := public.create_journal_entry(
    v_memo,
    p_payment_date,
    'tax_payment',
    p_settlement_id,
    true,
    v_lines,
    false
  );

  UPDATE public.tax_settlement_periods
     SET status = 'PAID',
         paid_at = now(),
         payment_journal_entry_id = v_entry_id
   WHERE id = p_settlement_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'tax.paid', 'tax_settlement', p_settlement_id,
          jsonb_build_object('period_number', v_settle.period_number, 'amount', v_settle.net_tax_payable, 'entry_id', v_entry_id));

  RETURN v_entry_id;
END $$;

REVOKE ALL ON FUNCTION public.pay_tax_settlement(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_tax_settlement(uuid, date, text) TO authenticated, service_role;

-- ── 5. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.tax_settlement_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tax_settlements_read ON public.tax_settlement_periods;
CREATE POLICY tax_settlements_read ON public.tax_settlement_periods
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS tax_settlements_write ON public.tax_settlement_periods;
CREATE POLICY tax_settlements_write ON public.tax_settlement_periods
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'accountant')
  );

GRANT SELECT, INSERT, UPDATE ON public.tax_settlement_periods TO authenticated, service_role;
