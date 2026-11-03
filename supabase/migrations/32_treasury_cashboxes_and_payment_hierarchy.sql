-- ============================================================================
-- 30_treasury_cashboxes_and_payment_hierarchy.sql
--
-- منظومة الخزينة وطرق الدفع الهرمية والربط المحاسبي المتكامل
--
-- الأهداف:
--   1. إنشاء جدول الصناديق والخزائن (cashboxes) مع ربط مباشر بحسابات الأصول النقدية.
--   2. إنشاء جدول الحسابات البنكية والمحافظ (company_bank_accounts) للمنشأة.
--   3. إنشاء جدول سجل الشيكات وأوراق القبض (cheques_register) مع دورة الصرف والارتداد.
--   4. ربط بنية الخزينة بحساب أوراق القبض التاريخي 1221، المزروع في بذرة دليل الحسابات.
--   5. توسيع جداول الفواتير والتحصيلات والمصروفات بحقول التوجيه المالي الدقيق.
--   6. توفير دالة التوجيه المالي (resolve_document_settlement_account).
--   7. ترقية دوال الترحيل (post_sales_invoice, record_customer_payment) لترحيل النقد
--      إلى الصندوق الفعلي، والمحافظ إلى حساباتها المخصصة، والشيكات إلى أوراق القبض،
--      ودعم تجزئة السداد المتعددة إلى حساباتها المتفرقة.
--   8. توفير دوال تحصيل الشيكات (clear_cheque) وارتدادها (bounce_cheque).
-- ============================================================================

BEGIN;

-- ── 1. جدول الصناديق والخزائن (cashboxes) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cashboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar text NOT NULL,
  name_en text,
  code varchar(30) UNIQUE NOT NULL,
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  is_default boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.cashboxes IS
  'صناديق وخزائن المنشأة ونقاط البيع، مع ربط كل صندوق بحسابه في الدليل المحاسبي.';

CREATE INDEX IF NOT EXISTS ix_cashboxes_active ON public.cashboxes(is_active, is_default);
CREATE INDEX IF NOT EXISTS ix_cashboxes_account ON public.cashboxes(account_id);
CREATE INDEX IF NOT EXISTS ix_cashboxes_warehouse ON public.cashboxes(warehouse_id);


-- ── 3. جدول الحسابات البنكية والمحافظ الإلكترونية للمنشأة ───────────────────
CREATE TABLE IF NOT EXISTS public.company_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar text NOT NULL,
  name_en text,
  kind text DEFAULT 'BANK' NOT NULL CHECK (kind IN ('BANK', 'WALLET', 'POS_TERMINAL')),
  bank_name text NOT NULL,
  account_number text,
  iban text,
  currency text DEFAULT 'YER' NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  is_default boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.company_bank_accounts IS
  'الحسابات البنكية والمحافظ الإلكترونية للمنشأة للتسوية والتحصيلات البنكية والإلكترونية.';

CREATE INDEX IF NOT EXISTS ix_company_bank_accounts_kind ON public.company_bank_accounts(kind, is_active, is_default);
CREATE INDEX IF NOT EXISTS ix_company_bank_accounts_account ON public.company_bank_accounts(account_id);


-- ── 4. جدول إدارة وسجل الشيكات (cheques_register) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.cheques_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cheque_number text NOT NULL,
  bank_name text NOT NULL,
  drawer_name text,
  due_date date NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  status text DEFAULT 'UNDER_COLLECTION' NOT NULL
    CHECK (status IN ('UNDER_COLLECTION', 'CLEARED', 'BOUNCED', 'RETURNED')),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.sales_invoices(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES public.customer_payments(id) ON DELETE SET NULL,
  clearing_bank_account_id uuid REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL,
  clearing_journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  cleared_at timestamptz,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.cheques_register IS
  'سجل الشيكات وأوراق القبض ومتابعة تواريخ الاستحقاق والتحصيل والارتداد.';

CREATE INDEX IF NOT EXISTS ix_cheques_status_date ON public.cheques_register(status, due_date);
CREATE INDEX IF NOT EXISTS ix_cheques_customer ON public.cheques_register(customer_id);
CREATE INDEX IF NOT EXISTS ix_cheques_invoice ON public.cheques_register(invoice_id);


-- ── 5. توسيع جداول المستندات بحقول التوجيه المالي الدقيق ───────────────────

-- 5.1 فواتير المبيعات
ALTER TABLE public.sales_invoices
  ADD COLUMN IF NOT EXISTS cashbox_id uuid REFERENCES public.cashboxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method_id text REFERENCES public.payment_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_reference text;

CREATE INDEX IF NOT EXISTS ix_sales_invoices_cashbox ON public.sales_invoices(cashbox_id);
CREATE INDEX IF NOT EXISTS ix_sales_invoices_bank_acc ON public.sales_invoices(bank_account_id);

-- 5.2 سندات تحصيل العملاء
ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS cashbox_id uuid REFERENCES public.cashboxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method_id text REFERENCES public.payment_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_reference text;

CREATE INDEX IF NOT EXISTS ix_customer_payments_cashbox ON public.customer_payments(cashbox_id);
CREATE INDEX IF NOT EXISTS ix_customer_payments_bank_acc ON public.customer_payments(bank_account_id);

-- 5.3 فواتير المشتريات
ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS cashbox_id uuid REFERENCES public.cashboxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method_id text REFERENCES public.payment_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_reference text;

-- 5.4 دفعات المصروفات
ALTER TABLE public.expense_payments
  ADD COLUMN IF NOT EXISTS cashbox_id uuid REFERENCES public.cashboxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method_id text REFERENCES public.payment_methods(id) ON DELETE SET NULL;

-- 5.5 تجزئة الدفعات
ALTER TABLE public.customer_payment_splits
  ADD COLUMN IF NOT EXISTS cashbox_id uuid REFERENCES public.cashboxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method_id text REFERENCES public.payment_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reference_no text;

-- 5.6 مرتجعات المبيعات
ALTER TABLE public.sales_returns
  ADD COLUMN IF NOT EXISTS cashbox_id uuid REFERENCES public.cashboxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method_id text REFERENCES public.payment_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_reference text;

-- 5.7 مرتجعات المشتريات
ALTER TABLE public.purchase_returns
  ADD COLUMN IF NOT EXISTS cashbox_id uuid REFERENCES public.cashboxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method_id text REFERENCES public.payment_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_reference text;


-- ── 6. دالة حل الحساب المحاسبي للتسوية والترحيل ─────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_document_settlement_account(
  p_payment_method text,
  p_cashbox_id uuid DEFAULT NULL,
  p_bank_account_id uuid DEFAULT NULL,
  p_payment_method_id text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_norm_method text := lower(btrim(coalesce(p_payment_method, '')));
  v_norm_catalog_id text := lower(btrim(coalesce(p_payment_method_id, '')));
BEGIN
  -- 0. إذا كان الدفع آجل، فلا يوجد حساب تسوية نقدية (NULL)
  IF v_norm_method = 'credit' OR v_norm_catalog_id = 'credit' THEN
    RETURN NULL;
  END IF;

  -- 1. الصناديق: إذا تم تمرير صندوق محدد ومفعل
  IF p_cashbox_id IS NOT NULL THEN
    SELECT a.code INTO v_code
    FROM public.cashboxes c
    JOIN public.accounts a ON a.id = c.account_id
    WHERE c.id = p_cashbox_id AND c.is_active = true;

    IF v_code IS NOT NULL THEN
      RETURN v_code;
    END IF;
  END IF;

  -- 2. البنوك والمحافظ: إذا تم تمرير حساب بنكي/محفظة محددة ومفعلة
  IF p_bank_account_id IS NOT NULL THEN
    SELECT a.code INTO v_code
    FROM public.company_bank_accounts b
    JOIN public.accounts a ON a.id = b.account_id
    WHERE b.id = p_bank_account_id AND b.is_active = true;

    IF v_code IS NOT NULL THEN
      RETURN v_code;
    END IF;
  END IF;

  -- 3. الشيكات: تُسوّى محاسبياً على حساب أوراق القبض برسم التحصيل (1221)
  IF v_norm_method = 'cheque' OR v_norm_catalog_id = 'cheque' THEN
    SELECT a.code INTO v_code FROM public.accounts a WHERE a.code = '1221';
    IF v_code IS NOT NULL THEN
      RETURN v_code;
    END IF;
  END IF;

  -- 4. فحص إعدادات المنشأة لطريقة الدفع (payment_method_settings.default_account_id)
  IF v_norm_catalog_id <> '' THEN
    SELECT a.code INTO v_code
    FROM public.payment_method_settings s
    JOIN public.accounts a ON a.id = s.default_account_id
    WHERE s.payment_method_id = v_norm_catalog_id;

    IF v_code IS NOT NULL THEN
      RETURN v_code;
    END IF;

    -- فحص كود الحساب الافتراضي بالكتالوج (default_account_code)
    SELECT m.default_account_code INTO v_code
    FROM public.payment_methods m
    WHERE m.id = v_norm_catalog_id;

    IF v_code IS NOT NULL THEN
      RETURN v_code;
    END IF;
  END IF;

  -- 5. البديل المتوافق مع كتالوج طرق الدفع التاريخي
  RETURN public.ledger_account_code_for_payment_method(coalesce(nullif(v_norm_method, ''), v_norm_catalog_id));
END;
$$;

COMMENT ON FUNCTION public.resolve_document_settlement_account(text, uuid, uuid, text) IS
  'يحل كود الحساب المحاسبي بدقة بحسب الصندوق المختار، أو البنك/المحفظة، أو أوراق القبض للشيكات، أو بديل الكتالوج.';


-- ── 8. تحديث دالة ترحيل فواتير المبيعات (post_sales_invoice) ────────────────
CREATE OR REPLACE FUNCTION public.post_sales_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_inv     record;
  v_existing uuid;
  v_entry   uuid;
  v_lines   jsonb := '[]'::jsonb;
  v_cash_acct text;
  v_collectable numeric := 0;
  r         record;
  s         record;
  v_split_count integer := 0;
  v_split_acct text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
          OR public.has_role(v_user,'accountant')
          OR public.has_role(v_user,'cashier')) THEN
    RAISE EXCEPTION 'Only an owner, manager, accountant or the cashier''s own sale may post a sales invoice';
  END IF;

  SELECT * INTO v_inv FROM public.sales_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_inv.status IN ('draft','cancelled') THEN
    RAISE EXCEPTION 'Invoice % is % - only confirmed, paid or partial invoices post',
      v_inv.invoice_number, v_inv.status;
  END IF;

  IF v_inv.paid < 0 THEN
    RAISE EXCEPTION 'Invoice % carries a negative payment (%). A refund is a credit note, not a negative payment.',
      v_inv.invoice_number, v_inv.paid;
  END IF;
  IF v_inv.paid > v_inv.total THEN
    RAISE EXCEPTION 'Invoice % was paid % against a total of %. Fix the invoice before posting - a payment cannot exceed the invoice.',
      v_inv.invoice_number, v_inv.paid, v_inv.total;
  END IF;
  IF v_inv.tax < 0 THEN
    RAISE EXCEPTION 'Invoice % carries a negative tax amount', v_inv.invoice_number;
  END IF;

  SELECT id INTO v_existing
    FROM public.journal_entries
   WHERE source_type = 'sales_invoice' AND source_id = p_invoice_id
     AND status <> 'REVERSED';
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice % has already been posted to the ledger', v_inv.invoice_number;
  END IF;

  v_collectable := greatest(v_inv.total - v_inv.paid, 0);

  -- ── الإيراد الصافي من ضريبة البند ──────────────────────────────────────────
  FOR r IN
    SELECT p.item_class,
           sum(it.total - coalesce(it.tax, 0)) AS net_amount
      FROM public.sales_invoice_items it
      JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
     GROUP BY p.item_class
    HAVING sum(it.total - coalesce(it.tax, 0)) <> 0
  LOOP
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.item_class
                        WHEN 'BY_PRODUCT' THEN '4211'
                        WHEN 'SERVICE'    THEN '4311'
                        ELSE '4111' END,
      'credit', round(r.net_amount, 2),
      'memo', 'إيراد ' || r.item_class);
  END LOOP;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Invoice % has no revenue lines', v_inv.invoice_number;
  END IF;

  -- ── أسطر التحصيل النقدية / البنكية / المحافظ / أوراق القبض ────────────────
  IF v_inv.paid > 0 THEN
    -- فحص إذا كان دفع مجزأ وله سجلات تجزئة
    IF v_inv.payment_method = 'split' THEN
      SELECT count(*) INTO v_split_count
      FROM public.customer_payment_splits
      WHERE invoice_id = p_invoice_id;
    END IF;

    IF v_inv.payment_method = 'split' AND v_split_count > 0 THEN
      -- ترحيل كل جزء إلى حسابه المالي المستقل
      FOR s IN
        SELECT method, amount, cashbox_id, bank_account_id, payment_method_id
        FROM public.customer_payment_splits
        WHERE invoice_id = p_invoice_id AND amount > 0
      LOOP
        v_split_acct := public.resolve_document_settlement_account(
          s.method::text, s.cashbox_id, s.bank_account_id, s.payment_method_id
        );
        IF v_split_acct IS NOT NULL THEN
          v_lines := v_lines || jsonb_build_object(
            'account_code', v_split_acct,
            'debit', round(s.amount, 2),
            'memo', 'تحصيل دفعة مجزأة (' || s.method::text || ')'
          );
        END IF;
      END LOOP;
    ELSE
      -- سداد بطريقة واحدة محددة
      v_cash_acct := public.resolve_document_settlement_account(
        v_inv.payment_method::text,
        v_inv.cashbox_id,
        v_inv.bank_account_id,
        v_inv.payment_method_id
      );

      IF v_cash_acct IS NOT NULL THEN
        v_lines := v_lines || jsonb_build_object(
          'account_code', v_cash_acct,
          'debit', round(v_inv.paid, 2),
          'memo', CASE
                    WHEN v_cash_acct = '1221' THEN 'أوراق قبض (شيك تحت التحصيل)'
                    WHEN v_cash_acct LIKE '1101%' THEN 'تحصيل نقدي بالصندوق'
                    WHEN v_cash_acct LIKE '113%' THEN 'تحصيل محفظة إلكترونية'
                    ELSE 'تحصيل بنكي' END
        );
      END IF;
    END IF;
  END IF;

  -- ── الذمم الآجلة المتبقية على العميل ──────────────────────────────────────
  IF v_collectable > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1211', 'debit', round(v_collectable, 2),
      'memo', 'ذمم العميل ' || coalesce(v_inv.invoice_number, ''));
  END IF;

  -- ── ضريبة القيمة المضافة ──────────────────────────────────────────────────
  IF v_inv.tax > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2311', 'credit', round(v_inv.tax, 2),
      'memo', 'ضريبة القيمة المضافة المستحقة');
  END IF;

  -- ── تكلفة البضاعة المباعة ومخزونها ───────────────────────────────────────
  FOR r IN
    SELECT p.item_class,
           sum(it.quantity * public.resolve_unit_cost(p.id, v_inv.warehouse_id)) AS cost
      FROM public.sales_invoice_items it
      JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
       AND it.stock_effect = 'STOCK_ISSUE'
     GROUP BY p.item_class
  LOOP
    IF r.cost IS NULL OR r.cost = 0 THEN
      CONTINUE;
    END IF;
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.item_class
                        WHEN 'RAW_MATERIAL' THEN '1311'
                        WHEN 'BY_PRODUCT'   THEN '1314'
                        ELSE '1313' END,
      'credit', round(r.cost, 2),
      'memo', 'تكلفة ' || r.item_class);
    v_lines := v_lines || jsonb_build_object(
      'account_code', '5111', 'debit', round(r.cost, 2),
      'memo', 'تكلفة البضاعة المباعة');
  END LOOP;

  v_entry := public.create_journal_entry(
    'فاتورة مبيعات ' || v_inv.invoice_number,
    v_inv.created_at::date,
    'sales_invoice', p_invoice_id, true, v_lines);

  RETURN v_entry;
END;
$$;


-- ── 9. تحديث دالة تسجيل سندات تحصيل العملاء ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_customer_payment(
  _customer_id uuid,
  _invoice_id uuid,
  _amount numeric,
  _method text,
  _payment_date date,
  _note text,
  _cashbox_id uuid DEFAULT NULL,
  _bank_account_id uuid DEFAULT NULL,
  _payment_method_id text DEFAULT NULL,
  _cheque_number text DEFAULT NULL,
  _cheque_bank text DEFAULT NULL,
  _cheque_due_date date DEFAULT NULL,
  _cheque_drawer text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_user uuid := auth.uid();
  v_invoice record;
  v_customer_balance numeric;
  v_remaining numeric := round(coalesce(_amount, 0), 2);
  v_stored_method text;
  v_cash_acct text;
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
  v_final_method_id text;
  v_ref_no text;
  v_inv_cur record;
  v_allocation numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'accountant')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to record customer payments';
  END IF;

  IF _customer_id IS NULL OR v_remaining <= 0 THEN
    RAISE EXCEPTION 'A customer and a positive amount are required';
  END IF;

  v_final_method_id := coalesce(_payment_method_id, _method);
  v_stored_method := public.resolve_writable_payment_method(
    v_final_method_id, 'customer_collection', true
  );

  SELECT balance INTO v_customer_balance
  FROM public.customers
  WHERE id = _customer_id AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer is unavailable';
  END IF;

  -- حل الحساب المحاسبي بدقة
  v_cash_acct := public.resolve_document_settlement_account(
    v_stored_method, _cashbox_id, _bank_account_id, v_final_method_id
  );

  -- 1. تخصيص لفاتورة محددة
  IF _invoice_id IS NOT NULL THEN
    SELECT id, total, paid, customer_id
      INTO v_invoice
    FROM public.sales_invoices
    WHERE id = _invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;

    IF v_invoice.customer_id IS DISTINCT FROM _customer_id THEN
      RAISE EXCEPTION 'Invoice does not belong to this customer';
    END IF;

    IF v_invoice.total - v_invoice.paid <= 0 THEN
      RAISE EXCEPTION 'Invoice has no outstanding balance';
    END IF;

    IF v_remaining > (v_invoice.total - v_invoice.paid + 0.01) THEN
      RAISE EXCEPTION 'Payment exceeds the invoice outstanding balance';
    END IF;

    INSERT INTO public.customer_payments (
      customer_id, invoice_id, amount, payment_method, payment_date, note, created_by,
      cashbox_id, bank_account_id, payment_method_id, payment_reference
    )
    VALUES (
      _customer_id, _invoice_id, v_remaining, v_stored_method::public.payment_method,
      coalesce(_payment_date, current_date), nullif(trim(_note), ''), v_user,
      _cashbox_id, _bank_account_id, v_final_method_id, _cheque_number
    )
    RETURNING id INTO v_id;

    -- إذا كان شيكاً: تسجيله في جدول الشيكات
    IF (v_stored_method = 'cheque' OR v_final_method_id = 'cheque') AND _cheque_number IS NOT NULL THEN
      INSERT INTO public.cheques_register (
        cheque_number, bank_name, drawer_name, due_date, amount, status,
        customer_id, invoice_id, payment_id, notes, created_by
      )
      VALUES (
        _cheque_number, coalesce(_cheque_bank, 'شيك مصرفي'), _cheque_drawer,
        coalesce(_cheque_due_date, CURRENT_DATE), v_remaining, 'UNDER_COLLECTION',
        _customer_id, _invoice_id, v_id, _note, v_user
      );
    END IF;

    INSERT INTO public.customer_ledger(customer_id, entry_type, credit, reference_id, reference_type, occurred_at, created_by, source_key, note)
    VALUES (_customer_id, 'payment', v_remaining, v_id, 'customer_payment', coalesce(_payment_date, current_date)::timestamptz, v_user, 'payment:' || v_id, coalesce(nullif(trim(_note), ''), 'دفعة عميل'))
    ON CONFLICT (source_key) DO NOTHING;

    UPDATE public.sales_invoices
    SET paid = paid + v_remaining,
        status = 'confirmed'::public.invoice_status,
        payment_status = public.derive_payment_status(paid + v_remaining, total),
        updated_at = now()
    WHERE id = _invoice_id;

    -- قيد التحصيل اليومي
    IF v_cash_acct IS NOT NULL THEN
      v_lines := v_lines
        || jsonb_build_object('account_code', v_cash_acct, 'debit', v_remaining,
                              'memo', CASE WHEN v_cash_acct = '1221' THEN 'أوراق قبض (شيك برسم التحصيل)' ELSE 'تحصيل من عميل' END)
        || jsonb_build_object('account_code', '1211', 'credit', v_remaining,
                              'memo', 'تحصيل ذمة عميل');
      v_journal := public.create_journal_entry(
        'تحصيل من عميل — ' || coalesce(nullif(trim(_note), ''), ''),
        COALESCE(_payment_date, CURRENT_DATE),
        'customer_payment', v_id, true, v_lines);
    END IF;

  ELSE
    -- 2. توزيع تلقائي على الفواتير المفتوحة الأقدم أولاً
    INSERT INTO public.customer_payments (
      customer_id, invoice_id, amount, payment_method, payment_date, note, created_by,
      cashbox_id, bank_account_id, payment_method_id, payment_reference
    )
    VALUES (
      _customer_id, NULL, v_remaining, v_stored_method::public.payment_method,
      coalesce(_payment_date, current_date), nullif(trim(_note), ''), v_user,
      _cashbox_id, _bank_account_id, v_final_method_id, _cheque_number
    )
    RETURNING id INTO v_id;

    IF (v_stored_method = 'cheque' OR v_final_method_id = 'cheque') AND _cheque_number IS NOT NULL THEN
      INSERT INTO public.cheques_register (
        cheque_number, bank_name, drawer_name, due_date, amount, status,
        customer_id, invoice_id, payment_id, notes, created_by
      )
      VALUES (
        _cheque_number, coalesce(_cheque_bank, 'شيك مصرفي'), _cheque_drawer,
        coalesce(_cheque_due_date, CURRENT_DATE), v_remaining, 'UNDER_COLLECTION',
        _customer_id, NULL, v_id, _note, v_user
      );
    END IF;

    FOR v_inv_cur IN
      SELECT id, total, paid
      FROM public.sales_invoices
      WHERE customer_id = _customer_id
        AND total > paid
        AND status NOT IN ('cancelled'::public.invoice_status, 'returned'::public.invoice_status)
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_allocation := least(v_remaining, v_inv_cur.total - v_inv_cur.paid);

      UPDATE public.sales_invoices
      SET paid = paid + v_allocation,
          status = 'confirmed'::public.invoice_status,
          payment_status = public.derive_payment_status(paid + v_allocation, total),
          updated_at = now()
      WHERE id = v_inv_cur.id;

      v_remaining := v_remaining - v_allocation;
    END LOOP;

    INSERT INTO public.customer_ledger(customer_id, entry_type, credit, reference_id, reference_type, occurred_at, created_by, source_key, note)
    VALUES (_customer_id, 'payment', _amount, v_id, 'customer_payment', coalesce(_payment_date, current_date)::timestamptz, v_user, 'payment:' || v_id, coalesce(nullif(trim(_note), ''), 'دفعة عميل بتوزيع تلقائي'))
    ON CONFLICT (source_key) DO NOTHING;

    IF v_cash_acct IS NOT NULL THEN
      v_lines := v_lines
        || jsonb_build_object('account_code', v_cash_acct, 'debit', _amount,
                              'memo', CASE WHEN v_cash_acct = '1221' THEN 'أوراق قبض (شيك برسم التحصيل)' ELSE 'تحصيل من عميل' END)
        || jsonb_build_object('account_code', '1211', 'credit', _amount,
                              'memo', 'تحصيل ذمة عميل');
      v_journal := public.create_journal_entry(
        'تحصيل من عميل — ' || coalesce(nullif(trim(_note), ''), ''),
        COALESCE(_payment_date, CURRENT_DATE),
        'customer_payment', v_id, true, v_lines);
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- الحفاظ على التوقيع القديم بستة وسائط للتوافق العكسي
CREATE OR REPLACE FUNCTION public.record_customer_payment(
  _customer_id uuid,
  _invoice_id uuid,
  _amount numeric,
  _method text,
  _payment_date date,
  _note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.record_customer_payment(
    _customer_id, _invoice_id, _amount, _method, _payment_date, _note,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL
  );
END;
$$;


-- ── 10. دالتا تحصيل الشيك وصرفه بالبنك أو ارتداده ───────────────────────────

-- 10.1 تحصيل الشيك وإيداعه بالبنك
CREATE OR REPLACE FUNCTION public.clear_cheque(
  p_cheque_id uuid,
  p_clearing_bank_account_id uuid,
  p_cleared_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_cheque record;
  v_bank_code text;
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'accountant')
  ) THEN
    RAISE EXCEPTION 'Only accountant, manager or owner may clear cheques';
  END IF;

  SELECT * INTO v_cheque
  FROM public.cheques_register
  WHERE id = p_cheque_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cheque not found';
  END IF;

  IF v_cheque.status <> 'UNDER_COLLECTION' THEN
    RAISE EXCEPTION 'Cheque % is already %', v_cheque.cheque_number, v_cheque.status;
  END IF;

  -- كود الحساب البنكي المودع فيه
  SELECT a.code INTO v_bank_code
  FROM public.company_bank_accounts b
  JOIN public.accounts a ON a.id = b.account_id
  WHERE b.id = p_clearing_bank_account_id;

  IF v_bank_code IS NULL THEN
    RAISE EXCEPTION 'Selected clearing bank account has no valid ledger account';
  END IF;

  -- قيد التحصيل: من حـ/ البنك إلى حـ/ أوراق قبض
  v_lines := v_lines
    || jsonb_build_object(
      'account_code', v_bank_code,
      'debit', v_cheque.amount,
      'memo', 'تحصيل وإيداع شيك رقم ' || v_cheque.cheque_number
    )
    || jsonb_build_object(
      'account_code', '1221',
      'credit', v_cheque.amount,
      'memo', 'إقفال أوراق قبض — شيك رقم ' || v_cheque.cheque_number
    );

  v_journal := public.create_journal_entry(
    'تحصيل شيك مصرفي رقم ' || v_cheque.cheque_number || ' — ' || coalesce(p_notes, ''),
    coalesce(p_cleared_date, CURRENT_DATE),
    'cheque_clearing',
    v_cheque.id,
    true,
    v_lines
  );

  UPDATE public.cheques_register
  SET status = 'CLEARED',
      clearing_bank_account_id = p_clearing_bank_account_id,
      clearing_journal_entry_id = v_journal,
      cleared_at = coalesce(p_cleared_date, CURRENT_DATE)::timestamptz,
      notes = coalesce(notes || ' | ', '') || coalesce(p_notes, 'تم التحصيل بالبنك'),
      updated_at = now()
  WHERE id = p_cheque_id;

  RETURN jsonb_build_object(
    'cheque_id', p_cheque_id,
    'cheque_number', v_cheque.cheque_number,
    'status', 'CLEARED',
    'journal_id', v_journal
  );
END;
$$;

-- 10.2 إثبات ارتداد الشيك
CREATE OR REPLACE FUNCTION public.bounce_cheque(
  p_cheque_id uuid,
  p_reason text DEFAULT 'عدم كفاية الرصيد'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_cheque record;
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'accountant')
  ) THEN
    RAISE EXCEPTION 'Only accountant, manager or owner may mark cheques as bounced';
  END IF;

  SELECT * INTO v_cheque
  FROM public.cheques_register
  WHERE id = p_cheque_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cheque not found';
  END IF;

  IF v_cheque.status <> 'UNDER_COLLECTION' THEN
    RAISE EXCEPTION 'Cannot bounce cheque in status %', v_cheque.status;
  END IF;

  -- قيد الارتداد: إعادة المديونية للعميل وإلغاء ورقة القبض
  -- Dr 1211 (ذمم العملاء) / Cr 1221 (أوراق قبض)
  IF v_cheque.customer_id IS NOT NULL THEN
    v_lines := v_lines
      || jsonb_build_object(
        'account_code', '1211',
        'debit', v_cheque.amount,
        'memo', 'ارتداد شيك رقم ' || v_cheque.cheque_number || ' — ' || coalesce(p_reason, '')
      )
      || jsonb_build_object(
        'account_code', '1221',
        'credit', v_cheque.amount,
        'memo', 'إلغاء ورقة قبض لشيك مرتد رقم ' || v_cheque.cheque_number
      );

    v_journal := public.create_journal_entry(
      'ارتداد شيك رقم ' || v_cheque.cheque_number || ' — ' || coalesce(p_reason, ''),
      CURRENT_DATE,
      'cheque_bounce',
      v_cheque.id,
      true,
      v_lines
    );

    -- تسجيل حركة مدينة في كشف حساب العميل
    INSERT INTO public.customer_ledger(
      customer_id, entry_type, debit, reference_id, reference_type, occurred_at, created_by, source_key, note
    )
    VALUES (
      v_cheque.customer_id, 'adjustment', v_cheque.amount, v_cheque.id, 'cheque_bounce',
      now(), v_user, 'cheque_bounce:' || v_cheque.id, 'ارتداد شيك رقم ' || v_cheque.cheque_number
    )
    ON CONFLICT (source_key) DO NOTHING;
  END IF;

  UPDATE public.cheques_register
  SET status = 'BOUNCED',
      notes = coalesce(notes || ' | ', '') || 'مرتد: ' || coalesce(p_reason, ''),
      updated_at = now()
  WHERE id = p_cheque_id;

  RETURN jsonb_build_object(
    'cheque_id', p_cheque_id,
    'cheque_number', v_cheque.cheque_number,
    'status', 'BOUNCED',
    'journal_id', v_journal
  );
END;
$$;


-- ── 11. المشتريات وسندات صرف الموردين (Purchases & Supplier Payments) ───────────

-- 11.1 ربط سندات صرف الموردين بالصناديق والحسابات البنكية
ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS cashbox_id uuid REFERENCES public.cashboxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_supplier_payments_cashbox ON public.supplier_payments(cashbox_id);
CREATE INDEX IF NOT EXISTS ix_supplier_payments_bank_acc ON public.supplier_payments(bank_account_id);

-- 11.2 تحديث دالة ترحيل فواتير المشتريات (post_purchase_invoice)
CREATE OR REPLACE FUNCTION public.post_purchase_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_inv     record;
  v_existing uuid;
  v_entry   uuid;
  v_lines   jsonb := '[]'::jsonb;
  v_cash_acct text;
  v_owed     numeric := 0;
  r         record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
          OR public.has_role(v_user,'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may post a purchase invoice';
  END IF;

  SELECT * INTO v_inv FROM public.purchase_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase invoice not found';
  END IF;

  IF v_inv.status IN ('draft','cancelled') THEN
    RAISE EXCEPTION 'Purchase % is % - only confirmed, paid or partial invoices post',
      v_inv.invoice_number, v_inv.status;
  END IF;

  IF v_inv.paid < 0 THEN
    RAISE EXCEPTION 'Purchase % carries a negative payment (%). A supplier return is a return document, not a negative payment.',
      v_inv.invoice_number, v_inv.paid;
  END IF;
  IF v_inv.paid > v_inv.total THEN
    RAISE EXCEPTION 'Purchase % was paid % against a total of %. Fix the invoice before posting - a payment cannot exceed the invoice.',
      v_inv.invoice_number, v_inv.paid, v_inv.total;
  END IF;

  SELECT id INTO v_existing
    FROM public.journal_entries
   WHERE source_type = 'purchase_invoice' AND source_id = p_invoice_id
     AND status <> 'REVERSED';
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase % has already been posted to the ledger', v_inv.invoice_number;
  END IF;

  -- ── الحساب الدائن من الصندوق أو البنك أو الكتالوج بدقة ───────────────────
  v_cash_acct := public.resolve_document_settlement_account(
    v_inv.payment_method::text,
    v_inv.cashbox_id,
    v_inv.bank_account_id,
    v_inv.payment_method_id
  );

  v_owed := greatest(v_inv.total - v_inv.paid, 0);

  -- ── البضاعة المستلمة والمصروفات ──
  FOR r IN
    SELECT p.item_class,
           coalesce(it.stock_effect, 'NONE') AS effect,
           sum(it.total)                     AS amount,
           sum(it.tax)                       AS line_tax
      FROM public.purchase_invoice_items it
      JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
     GROUP BY p.item_class, coalesce(it.stock_effect, 'NONE')
    HAVING sum(it.total) <> 0 OR sum(it.tax) <> 0
  LOOP
    IF r.amount <> 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', CASE
          WHEN r.effect <> 'STOCK_RECEIPT' THEN '5911'
          ELSE CASE r.item_class
                 WHEN 'RAW_MATERIAL' THEN '1311'
                 WHEN 'BY_PRODUCT'   THEN '1314'
                 WHEN 'FINISHED_GOOD' THEN '1313'
                 ELSE '1315' END END,
        'debit', round(r.amount, 2),
        'memo', CASE WHEN r.effect <> 'STOCK_RECEIPT'
                     THEN 'مصروف مشتريات ' || r.item_class
                     ELSE 'شراء ' || r.item_class END);
    END IF;

    IF r.line_tax <> 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', '1316', 'debit', round(r.line_tax, 2),
        'memo', 'ضريبة مدخلات قابلة للاسترداد');
    END IF;
  END LOOP;

  IF v_inv.tax <> 0 AND NOT EXISTS (
       SELECT 1 FROM public.purchase_invoice_items it
        WHERE it.invoice_id = p_invoice_id AND it.tax <> 0) THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1316', 'debit', round(v_inv.tax, 2),
      'memo', 'ضريبة مدخلات قابلة للاسترداد');
  END IF;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Purchase % has nothing to post - its lines are empty or zero',
      v_inv.invoice_number;
  END IF;

  -- ── ذمة المورد المتبقية (الدائن) ──
  IF v_owed > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2111', 'credit', round(v_owed, 2),
      'memo', 'مستحق للمورد',
      'partner_type', 'supplier',
      'partner_id', v_inv.supplier_id);
  END IF;

  -- ── السداد المسدد للمورد من الصندوق أو البنك ──
  IF v_inv.paid > 0 AND v_cash_acct IS NOT NULL THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_cash_acct, 'credit', round(v_inv.paid, 2),
      'memo', CASE
                WHEN v_cash_acct LIKE '1101%' THEN 'سداد نقدي للمورد من الصندوق'
                WHEN v_cash_acct LIKE '113%' THEN 'سداد للمورد عبر محفظة إلكترونية'
                WHEN v_cash_acct = '1221' THEN 'أوراق دفع / شيك للمورد'
                ELSE 'سداد بنكي / حوالة للمورد' END);
  END IF;

  v_entry := public.create_journal_entry(
    'فاتورة مشتريات ' || v_inv.invoice_number,
    v_inv.created_at::date,
    'purchase_invoice', p_invoice_id, true, v_lines);

  RETURN v_entry;
END;
$$;

-- 11.3 تحديث دالة إنشاء المشتريات التلقائية (create_purchase) لدعم الصناديق والمحافظ
CREATE OR REPLACE FUNCTION public.create_purchase(
  _warehouse_id uuid,
  _supplier_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb,
  _cashbox_id uuid DEFAULT NULL,
  _bank_account_id uuid DEFAULT NULL,
  _payment_reference text DEFAULT NULL,
  _payment_method_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id     uuid;
  v_invoice_no     text;
  v_user           uuid := auth.uid();
  v_item           jsonb;
  v_subtotal       numeric := 0;
  v_tax_total      numeric := 0;
  v_total          numeric := 0;
  v_qty            numeric;
  v_cost           numeric;
  v_tax_rate       numeric;
  v_line_total     numeric;
  v_line_tax       numeric;
  v_product        uuid;
  v_effect         text;
  v_type           text;
  v_purchasable    boolean;
  v_resolved_cashbox uuid := _cashbox_id;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse required';
  END IF;
  IF _supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier required';
  END IF;
  IF coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty      := (v_item ->> 'quantity')::numeric;
    v_cost     := (v_item ->> 'unit_cost')::numeric;
    v_tax_rate := coalesce((v_item ->> 'tax_rate')::numeric, 0);

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity';
    END IF;
    IF v_cost IS NULL OR v_cost < 0 THEN
      RAISE EXCEPTION 'Invalid unit cost';
    END IF;
    IF v_tax_rate < 0 OR v_tax_rate > 100 THEN
      RAISE EXCEPTION 'Invalid tax rate';
    END IF;
    IF (v_item ->> 'product_id') IS NOT NULL THEN
      SELECT p.is_purchasable INTO v_purchasable
      FROM public.products p WHERE p.id = (v_item ->> 'product_id')::uuid;

      IF v_purchasable IS NOT TRUE THEN
        RAISE EXCEPTION 'Item % is not marked as purchasable', v_item ->> 'product_id';
      END IF;
    END IF;

    v_line_total := v_qty * v_cost;
    v_line_tax   := v_line_total * v_tax_rate / 100;
    v_subtotal   := v_subtotal + v_line_total;
    v_tax_total  := v_tax_total + v_line_tax;
  END LOOP;

  v_total := v_subtotal + v_tax_total - coalesce(_discount, 0);
  v_invoice_no := public.next_purchase_number();

  -- الصندوق الافتراضي للدفع النقدي إذا لم يُحدد
  IF _payment_method = 'cash' AND v_resolved_cashbox IS NULL THEN
    SELECT id INTO v_resolved_cashbox
    FROM public.cashboxes
    WHERE is_active = true AND is_default = true
    LIMIT 1;
    IF v_resolved_cashbox IS NULL THEN
      SELECT id INTO v_resolved_cashbox
      FROM public.cashboxes
      WHERE is_active = true
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;
  END IF;

  INSERT INTO public.purchase_invoices (
    invoice_number, supplier_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by,
    cashbox_id, bank_account_id, payment_reference, payment_method_id
  )
  VALUES (
    v_invoice_no, _supplier_id, _warehouse_id,
    'confirmed'::public.invoice_status,
    public.derive_payment_status(coalesce(_paid, 0), v_total),
    v_subtotal, coalesce(_discount, 0), v_tax_total, v_total, coalesce(_paid, 0),
    _payment_method::public.payment_method, nullif(btrim(_note), ''), v_user,
    v_resolved_cashbox, _bank_account_id, nullif(btrim(_payment_reference), ''), _payment_method_id
  )
  RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_product  := (v_item ->> 'product_id')::uuid;
    v_qty      := (v_item ->> 'quantity')::numeric;
    v_cost     := (v_item ->> 'unit_cost')::numeric;
    v_tax_rate := coalesce((v_item ->> 'tax_rate')::numeric, 0);

    v_line_total := v_qty * v_cost;
    v_line_tax   := v_line_total * v_tax_rate / 100;

    SELECT r.o_line_type, r.o_stock_effect
      INTO v_type, v_effect
    FROM public.resolve_purchase_line(v_item) AS r;

    INSERT INTO public.purchase_invoice_items (
      invoice_id, product_id, quantity, unit_cost, discount, tax, total,
      line_type, stock_effect
    )
    VALUES (
      v_invoice_id, v_product, v_qty, v_cost, 0, v_line_tax, v_line_total + v_line_tax,
      v_type, v_effect
    );

    IF v_effect = 'STOCK_RECEIPT' AND v_product IS NOT NULL THEN
      PERFORM public.post_stock_delta(
        v_product,
        _warehouse_id,
        v_qty,
        v_cost,
        'RECEIPT'::public.stock_movement_kind,
        'purchase_invoice',
        v_invoice_id,
        'Purchase receipt',
        'COMPANY'::public.owner_type,
        NULL,
        'purchase'::public.movement_type
      );
    END IF;
  END LOOP;

  IF coalesce(_paid, 0) < v_total THEN
    UPDATE public.suppliers
    SET balance = balance + (v_total - coalesce(_paid, 0)), updated_at = now()
    WHERE id = _supplier_id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'purchase.posted', 'purchase_invoice', v_invoice_id,
    jsonb_build_object(
      'invoice_number', v_invoice_no,
      'supplier_id', _supplier_id,
      'warehouse_id', _warehouse_id,
      'total', v_total,
      'paid', coalesce(_paid, 0),
      'line_count', jsonb_array_length(_items),
      'cashbox_id', v_resolved_cashbox,
      'bank_account_id', _bank_account_id
    ));

  PERFORM public.post_purchase_invoice(v_invoice_id);

  RETURN v_invoice_id;
END $function$;

-- 11.4 تحديث دالة سداد الموردين لتسجيل الصندوق والبنك المحاسبي
CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_supplier_id uuid,
  p_amount numeric,
  p_payment_method text DEFAULT 'CASH',
  p_account_code text DEFAULT NULL,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_cashbox_id uuid DEFAULT NULL,
  p_bank_account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_supplier_name text;
  v_payment_id uuid;
  v_voucher_no text;
  v_account text;
  v_journal_id uuid;
  v_lines jsonb;
  v_new_balance numeric;
BEGIN
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier ID is required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero, got %', p_amount;
  END IF;

  SELECT name INTO v_supplier_name
  FROM public.suppliers
  WHERE id = p_supplier_id;

  IF v_supplier_name IS NULL THEN
    RAISE EXCEPTION 'Supplier with ID % not found', p_supplier_id;
  END IF;

  -- تحديد الحساب المالي (من الصندوق أو البنك أو الحساب المدخل)
  IF p_account_code IS NOT NULL AND btrim(p_account_code) <> '' THEN
    v_account := btrim(p_account_code);
  ELSIF p_cashbox_id IS NOT NULL THEN
    SELECT a.code INTO v_account
    FROM public.cashboxes c
    JOIN public.accounts a ON a.id = c.account_id
    WHERE c.id = p_cashbox_id;
  ELSIF p_bank_account_id IS NOT NULL THEN
    SELECT a.code INTO v_account
    FROM public.company_bank_accounts b
    JOIN public.accounts a ON a.id = b.account_id
    WHERE b.id = p_bank_account_id;
  END IF;

  IF v_account IS NULL THEN
    IF upper(coalesce(p_payment_method, 'CASH')) IN ('BANK', 'TRANSFER', 'CHEQUE', 'CARD') THEN
      v_account := '1111';
    ELSIF upper(coalesce(p_payment_method, 'CASH')) = 'WALLET' THEN
      v_account := '1131';
    ELSE
      v_account := '1101';
    END IF;
  END IF;

  v_voucher_no := public.next_supplier_voucher_number();

  INSERT INTO public.supplier_payments (
    voucher_number,
    supplier_id,
    amount,
    payment_method,
    account_code,
    payment_date,
    notes,
    created_by,
    cashbox_id,
    bank_account_id
  ) VALUES (
    v_voucher_no,
    p_supplier_id,
    round(p_amount, 2),
    upper(coalesce(p_payment_method, 'CASH')),
    v_account,
    coalesce(p_payment_date, CURRENT_DATE),
    p_notes,
    v_user,
    p_cashbox_id,
    p_bank_account_id
  ) RETURNING id INTO v_payment_id;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_code', '2111',
      'debit', round(p_amount, 2),
      'credit', 0,
      'memo', 'سداد ذمة للمورد ' || v_supplier_name,
      'partner_type', 'supplier',
      'partner_id', p_supplier_id
    ),
    jsonb_build_object(
      'account_code', v_account,
      'debit', 0,
      'credit', round(p_amount, 2),
      'memo', 'سند صرف رقم ' || v_voucher_no || ' للمورد ' || v_supplier_name
    )
  );

  v_journal_id := public.create_journal_entry(
    'سند صرف للمورد ' || v_supplier_name || ' (' || v_voucher_no || ')',
    coalesce(p_payment_date, CURRENT_DATE),
    'supplier_payment',
    v_payment_id,
    true,
    v_lines
  );

  UPDATE public.supplier_payments
  SET journal_entry_id = v_journal_id
  WHERE id = v_payment_id;

  UPDATE public.suppliers
  SET balance = balance - round(p_amount, 2),
      updated_at = now()
  WHERE id = p_supplier_id
  RETURNING balance INTO v_new_balance;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'supplier_payment.recorded', 'supplier_payment', v_payment_id,
    jsonb_build_object(
      'voucher_number', v_voucher_no,
      'supplier_id', p_supplier_id,
      'amount', round(p_amount, 2),
      'account_code', v_account,
      'payment_method', p_payment_method,
      'cashbox_id', p_cashbox_id,
      'bank_account_id', p_bank_account_id,
      'new_balance', v_new_balance
    ));

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'voucher_number', v_voucher_no,
    'journal_entry_id', v_journal_id,
    'new_balance', v_new_balance
  );
END;
$$;


-- ── 12. الصلاحيات والأمان (RLS & Grants) ───────────────────────────────────

ALTER TABLE public.cashboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cheques_register ENABLE ROW LEVEL SECURITY;

-- cashboxes: القراءة للجميع، والإدارة للمالك والمدير والمحاسب
DROP POLICY IF EXISTS cashboxes_select ON public.cashboxes;
CREATE POLICY cashboxes_select ON public.cashboxes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cashboxes_admin ON public.cashboxes;
CREATE POLICY cashboxes_admin ON public.cashboxes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'accountant'))
  WITH CHECK (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'accountant'));

-- company_bank_accounts: القراءة للجميع، والإدارة للمالك والمدير والمحاسب
DROP POLICY IF EXISTS company_bank_accounts_select ON public.company_bank_accounts;
CREATE POLICY company_bank_accounts_select ON public.company_bank_accounts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS company_bank_accounts_admin ON public.company_bank_accounts;
CREATE POLICY company_bank_accounts_admin ON public.company_bank_accounts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'accountant'))
  WITH CHECK (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'accountant'));

-- cheques_register: القراءة للجميع، والإضافة للكاشير والمحاسب والمدير والمالك
DROP POLICY IF EXISTS cheques_register_select ON public.cheques_register;
CREATE POLICY cheques_register_select ON public.cheques_register
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cheques_register_insert ON public.cheques_register;
CREATE POLICY cheques_register_insert ON public.cheques_register
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS cheques_register_admin ON public.cheques_register;
CREATE POLICY cheques_register_admin ON public.cheques_register
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'accountant'))
  WITH CHECK (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'accountant'));

GRANT ALL ON public.cashboxes TO authenticated, service_role;
GRANT ALL ON public.company_bank_accounts TO authenticated, service_role;
GRANT ALL ON public.cheques_register TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.resolve_document_settlement_account(text, uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_sales_invoice(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_purchase_invoice(uuid) TO authenticated, service_role;
-- التوقيع القديم ذو السبعة وسائط (معرّف في 20_accounting_phase1_close_the_loop): يبقى قابلاً للتنفيذ للتوافق العكسي
GRANT EXECUTE ON FUNCTION public.create_purchase(uuid, uuid, text, numeric, numeric, text, jsonb) TO authenticated, service_role;
-- التوقيع الجديد بأحد عشر وسيطًا (البند 11.3 أعلاه) مع الصناديق والحسابات البنكية
GRANT EXECUTE ON FUNCTION public.create_purchase(uuid, uuid, text, numeric, numeric, text, jsonb, uuid, uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(uuid, uuid, numeric, text, date, text, uuid, uuid, text, text, text, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(uuid, uuid, numeric, text, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(uuid, numeric, text, text, date, text, date, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_cheque(uuid, uuid, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bounce_cheque(uuid, text) TO authenticated, service_role;

COMMIT;

