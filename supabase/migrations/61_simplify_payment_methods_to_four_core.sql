-- 58_simplify_payment_methods_to_four_core.sql
-- ============================================================================
-- توحيد وتبسيط طرق الدفع إلى 4 طرق فقط وحذف الطرق والحسابات القديمة نهائيًا
--
-- 1. طرق الدفع المعتمدة فقط:
--    - cash          (نقدًا)               -> 1101 (النقدية بالصندوق)
--    - credit        (آجل)                -> 1211 (ذمم العملاء) / 2111 (ذمم الموردين)
--    - bank_transfer (بنك)                -> 1111 (البنوك)
--    - mobile_money  (محفظة إلكترونية)     -> 1131 (المحافظ الإلكترونية)
--
-- 2. دليل الحسابات:
--    - إعادة تسمية الحساب 1111 إلى «البنوك» (Banks)
--    - إعادة تسمية الحساب 1131 إلى «المحافظ الإلكترونية» (E-Wallets)
--    - حذف الحسابات البنكية القديمة (1112, 1121) وحسابات المحافظ القديمة (1132, 1133, 1134, 1139)
--
-- 3. حذف كافة طرق الدفع القديمة والملغاة:
--    card, cheque, kuraimi_bank, yemen_kuwait_bank, jawali, jaib, floosak, one_cash, split.
-- ============================================================================

BEGIN;

-- ── 1. تحديث دليل الحسابات وحذف الحسابات القديمة ─────────────────────────────

-- تسمية الحساب 1111 إلى "البنوك"
UPDATE public.accounts
SET name_ar = 'البنوك',
    name_en = 'Banks',
    notes = 'حساب البنوك الموحد للعمليات البنكية والحوالات.'
WHERE code = '1111';

-- تسمية الحساب 1131 إلى "المحافظ الإلكترونية"
UPDATE public.accounts
SET name_ar = 'المحافظ الإلكترونية',
    name_en = 'E-Wallets',
    notes = 'حساب المحافظ الإلكترونية الموحد لكافة محافظ الدفع الإلكتروني.'
WHERE code = '1131';

-- التأكد من اسم الصندوق والآجل
UPDATE public.accounts
SET name_ar = 'النقدية بالصندوق',
    name_en = 'Cash on Hand'
WHERE code = '1101';

UPDATE public.accounts
SET name_ar = 'ذمم العملاء',
    name_en = 'Accounts Receivable'
WHERE code = '1211';

DO $$
DECLARE
  v_bank_main uuid;
  v_wallet_main uuid;
BEGIN
  SELECT id INTO v_bank_main FROM public.accounts WHERE code = '1111';
  SELECT id INTO v_wallet_main FROM public.accounts WHERE code = '1131';

  IF v_bank_main IS NOT NULL THEN
    -- تحويل أي أسطر قيود كانت على 1112 أو 1121 إلى 1111
    UPDATE public.journal_lines
    SET account_id = v_bank_main
    WHERE account_id IN (
      SELECT id FROM public.accounts WHERE code IN ('1112', '1121')
    );

    UPDATE public.company_bank_accounts
    SET account_id = v_bank_main
    WHERE account_id IN (
      SELECT id FROM public.accounts WHERE code IN ('1112', '1121')
    );

    -- حذف الحسابات البنكية الإضافية
    DELETE FROM public.accounts WHERE code IN ('1112', '1121');
  END IF;

  IF v_wallet_main IS NOT NULL THEN
    -- تحويل أي أسطر قيود للمحافظ القديمة إلى 1131
    UPDATE public.journal_lines
    SET account_id = v_wallet_main
    WHERE account_id IN (
      SELECT id FROM public.accounts WHERE code IN ('1132', '1133', '1134', '1139')
    );

    UPDATE public.company_bank_accounts
    SET account_id = v_wallet_main
    WHERE account_id IN (
      SELECT id FROM public.accounts WHERE code IN ('1132', '1133', '1134', '1139')
    );

    -- حذف حسابات المحافظ القديمة بالكامل
    DELETE FROM public.accounts WHERE code IN ('1132', '1133', '1134', '1139');
  END IF;
END $$;


-- ── 2. حذف الطرق القديمة وضبط الأربع طرق المعتمدة ───────────────────────────

-- حذف إعدادات المنشأة للطرق الملغاة
DELETE FROM public.payment_method_settings
WHERE payment_method_id NOT IN ('cash', 'credit', 'bank_transfer', 'mobile_money');

-- حذف الطرق القديمة بالكامل من الكتالوج
DELETE FROM public.payment_methods
WHERE id NOT IN ('cash', 'credit', 'bank_transfer', 'mobile_money');

-- أ. النقد
INSERT INTO public.payment_methods (
  id, name_ar, name_en, icon_key, is_active, sort_order, allowed_contexts,
  ledger_kind, default_account_code, is_credit_term, requires_reference,
  legacy_ids, legacy_id, shipped_name_ar
) VALUES (
  'cash', 'نقدًا', 'Cash', 'cash', true, 10,
  ARRAY['pos','sales','purchases','expenses','customer_collection','sales_returns','purchase_returns'],
  'CASH', '1101', false, false,
  ARRAY['cash'], 'cash', 'نقدًا'
)
ON CONFLICT (id) DO UPDATE SET
  name_ar = 'نقدًا',
  name_en = 'Cash',
  icon_key = 'cash',
  is_active = true,
  sort_order = 10,
  allowed_contexts = ARRAY['pos','sales','purchases','expenses','customer_collection','sales_returns','purchase_returns'],
  ledger_kind = 'CASH',
  default_account_code = '1101',
  is_credit_term = false,
  requires_reference = false,
  shipped_name_ar = 'نقدًا';

-- ب. الآجل
INSERT INTO public.payment_methods (
  id, name_ar, name_en, icon_key, is_active, sort_order, allowed_contexts,
  ledger_kind, default_account_code, is_credit_term, requires_reference,
  legacy_ids, legacy_id, shipped_name_ar
) VALUES (
  'credit', 'آجل', 'Credit', 'credit', true, 20,
  ARRAY['pos','sales','purchases','sales_returns','purchase_returns'],
  'CREDIT', '1211', true, false,
  ARRAY['credit'], 'credit', 'آجل'
)
ON CONFLICT (id) DO UPDATE SET
  name_ar = 'آجل',
  name_en = 'Credit',
  icon_key = 'credit',
  is_active = true,
  sort_order = 20,
  allowed_contexts = ARRAY['pos','sales','purchases','sales_returns','purchase_returns'],
  ledger_kind = 'CREDIT',
  default_account_code = '1211',
  is_credit_term = true,
  requires_reference = false,
  shipped_name_ar = 'آجل';

-- ج. البنك
INSERT INTO public.payment_methods (
  id, name_ar, name_en, icon_key, is_active, sort_order, allowed_contexts,
  ledger_kind, default_account_code, is_credit_term, requires_reference,
  legacy_ids, legacy_id, shipped_name_ar
) VALUES (
  'bank_transfer', 'بنك', 'Bank', 'bank-transfer', true, 30,
  ARRAY['pos','sales','purchases','expenses','customer_collection','sales_returns','purchase_returns'],
  'BANK', '1111', false, false,
  ARRAY['bank_transfer'], 'bank_transfer', 'بنك'
)
ON CONFLICT (id) DO UPDATE SET
  name_ar = 'بنك',
  name_en = 'Bank',
  icon_key = 'bank-transfer',
  is_active = true,
  sort_order = 30,
  allowed_contexts = ARRAY['pos','sales','purchases','expenses','customer_collection','sales_returns','purchase_returns'],
  ledger_kind = 'BANK',
  default_account_code = '1111',
  is_credit_term = false,
  requires_reference = false,
  shipped_name_ar = 'بنك';

-- د. المحفظة الإلكترونية
INSERT INTO public.payment_methods (
  id, name_ar, name_en, icon_key, is_active, sort_order, allowed_contexts,
  ledger_kind, default_account_code, is_credit_term, requires_reference,
  legacy_ids, legacy_id, shipped_name_ar
) VALUES (
  'mobile_money', 'محفظة إلكترونية', 'E-Wallet', 'mobile-money', true, 40,
  ARRAY['pos','sales','purchases','expenses','customer_collection','sales_returns','purchase_returns'],
  'WALLET', '1131', false, false,
  ARRAY['mobile_money'], 'mobile_money', 'محفظة إلكترونية'
)
ON CONFLICT (id) DO UPDATE SET
  name_ar = 'محفظة إلكترونية',
  name_en = 'E-Wallet',
  icon_key = 'mobile-money',
  is_active = true,
  sort_order = 40,
  allowed_contexts = ARRAY['pos','sales','purchases','expenses','customer_collection','sales_returns','purchase_returns'],
  ledger_kind = 'WALLET',
  default_account_code = '1131',
  is_credit_term = false,
  requires_reference = false,
  shipped_name_ar = 'محفظة إلكترونية';

-- ضمان وجود إعدادات الطرق الأربع
INSERT INTO public.payment_method_settings (payment_method_id, enabled, sort_order, enabled_contexts)
VALUES
  ('cash', true, 10, ARRAY['pos','sales','purchases','expenses','customer_collection','sales_returns','purchase_returns']),
  ('credit', true, 20, ARRAY['pos','sales','purchases','sales_returns','purchase_returns']),
  ('bank_transfer', true, 30, ARRAY['pos','sales','purchases','expenses','customer_collection','sales_returns','purchase_returns']),
  ('mobile_money', true, 40, ARRAY['pos','sales','purchases','expenses','customer_collection','sales_returns','purchase_returns'])
ON CONFLICT (payment_method_id) DO UPDATE SET
  enabled = true,
  sort_order = EXCLUDED.sort_order,
  enabled_contexts = EXCLUDED.enabled_contexts;


-- ── 3. تحديث دالة حل الحساب المحاسبي ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.payment_method_ledger_account(p_stored text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    -- 1. الآجل
    WHEN p_stored IN ('credit', 'CREDIT') THEN NULL
    -- 2. البنك والحوالات والبطاقات القديمة تصب في حساب البنوك 1111
    WHEN p_stored IN ('bank_transfer', 'bank', 'kuraimi_bank', 'yemen_kuwait_bank', 'card', 'cheque') THEN '1111'
    -- 3. المحافظ الإلكترونية تصب في حساب المحافظ الإلكترونية 1131
    WHEN p_stored IN ('mobile_money', 'wallet', 'jawali', 'jaib', 'floosak', 'one_cash') THEN '1131'
    -- 4. النقد والصندوق يصب في 1101
    WHEN p_stored IN ('cash', 'CASH') THEN '1101'
    -- 5. البديل من الكتالوج
    WHEN m.ledger_kind = 'CREDIT' THEN NULL
    WHEN m.default_account_code IS NOT NULL THEN m.default_account_code
    WHEN m.ledger_kind = 'BANK' THEN '1111'
    WHEN m.ledger_kind = 'WALLET' THEN '1131'
    ELSE '1101'
  END
  FROM (SELECT 1) _dummy
  LEFT JOIN public.payment_methods m ON m.id = public.payment_method_resolve_id(p_stored);
$$;

COMMENT ON FUNCTION public.payment_method_ledger_account(text) IS
  'يحل كود الحساب المحاسبي للطرق الأربع: نقد 1101، بنك 1111، محفظة 1131، آجل NULL.';

GRANT EXECUTE ON FUNCTION public.payment_method_ledger_account(text) TO authenticated, service_role;


-- ── 4. تحديث دالة تسوية المستندات ───────────────────────────────────────────

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
  v_norm_method text := coalesce(trim(p_payment_method), '');
  v_norm_catalog_id text := coalesce(trim(p_payment_method_id), '');
  v_code text;
BEGIN
  IF v_norm_method = 'credit' OR v_norm_catalog_id = 'credit' THEN
    RETURN NULL;
  END IF;

  -- 1. فحص حساب الصندوق المختار إن وُجد
  IF p_cashbox_id IS NOT NULL THEN
    SELECT a.code INTO v_code
    FROM public.cashboxes c
    JOIN public.accounts a ON a.id = c.account_id
    WHERE c.id = p_cashbox_id AND c.is_active;

    IF v_code IS NOT NULL THEN
      RETURN v_code;
    END IF;
  END IF;

  -- 2. فحص حساب البنك/المحفظة المختار إن وُجد
  IF p_bank_account_id IS NOT NULL THEN
    SELECT a.code INTO v_code
    FROM public.company_bank_accounts b
    JOIN public.accounts a ON a.id = b.account_id
    WHERE b.id = p_bank_account_id AND b.is_active;

    IF v_code IS NOT NULL THEN
      RETURN v_code;
    END IF;
  END IF;

  -- 3. الربط المباشر المضمون للطرق الأربع
  IF v_norm_method IN ('bank_transfer', 'bank') OR v_norm_catalog_id = 'bank_transfer' THEN
    RETURN '1111';
  ELSIF v_norm_method IN ('mobile_money', 'wallet') OR v_norm_catalog_id = 'mobile_money' THEN
    RETURN '1131';
  ELSIF v_norm_method = 'cash' OR v_norm_catalog_id = 'cash' THEN
    RETURN '1101';
  END IF;

  RETURN public.payment_method_ledger_account(coalesce(nullif(v_norm_method, ''), v_norm_catalog_id));
END;
$$;

COMMENT ON FUNCTION public.resolve_document_settlement_account(text, uuid, uuid, text) IS
  'دالة التوجيه المالي الموحدة: تعيد بدقة كود الحساب المحاسبي (1101 للصندوق، 1111 للبنوك، 1131 للمحافظ، NULL للآجل).';

GRANT EXECUTE ON FUNCTION public.resolve_document_settlement_account(text, uuid, uuid, text) TO authenticated, service_role;


-- ── 5. تحديث دالة ترحيل فواتير المبيعات post_sales_invoice ───────────────────

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
  v_service_total numeric := 0;
  v_cost    record;
  r         record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
          OR public.has_role(v_user,'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may post an invoice';
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

  -- حل حساب التسوية بدقة (الصندوق 1101، البنوك 1111، المحافظ 1131)
  v_cash_acct := public.resolve_document_settlement_account(
    v_inv.payment_method::text,
    v_inv.cashbox_id,
    v_inv.bank_account_id,
    v_inv.payment_method_id
  );
  v_collectable := greatest(v_inv.total - v_inv.paid, 0);

  -- ── الإيراد دائن: بند مُصنَّف حسب item_class ──
  FOR r IN
    SELECT coalesce(p.item_class::text, 'UNCLASSIFIED') AS bucket, sum(it.total) AS amount
      FROM public.sales_invoice_items it
      LEFT JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
       AND it.product_id IS NOT NULL
     GROUP BY coalesce(p.item_class::text, 'UNCLASSIFIED')
    HAVING sum(it.total) <> 0
  LOOP
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.bucket
                        WHEN 'BY_PRODUCT' THEN '4211'
                        WHEN 'SERVICE'    THEN '4311'
                        ELSE '4111' END,
      'credit', round(r.amount, 2),
      'memo', 'إيراد ' || r.bucket);
  END LOOP;

  -- ── الإيراد دائن: الخدمة الحرة ──
  SELECT coalesce(sum(l.total), 0) INTO v_service_total
    FROM public.ad_hoc_service_lines l
   WHERE l.invoice_id = p_invoice_id;
  IF v_service_total <> 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '4311',
      'credit', round(v_service_total, 2),
      'memo', 'إيراد خدمة حرة (AD_HOC_SERVICE)');
  END IF;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Invoice % has no revenue lines', v_inv.invoice_number;
  END IF;

  -- سطر التحصيل (مدين)
  IF v_inv.paid > 0 AND v_cash_acct IS NOT NULL THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_cash_acct,
      'debit', round(v_inv.paid, 2),
      'memo', CASE
                WHEN v_cash_acct = '1111' THEN 'تحصيل عبر البنك'
                WHEN v_cash_acct = '1131' THEN 'تحصيل عبر المحفظة الإلكترونية'
                ELSE 'تحصيل نقدي بالصندوق'
              END);
  END IF;

  -- سطر الآجل (مدين - ذمم العملاء 1211)
  IF v_collectable > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1211',
      'debit', round(v_collectable, 2),
      'partner_type', 'customer',
      'partner_id', v_inv.customer_id,
      'memo', 'ذمم العميل ' || coalesce(v_inv.invoice_number, ''));
  END IF;

  -- سطر الضريبة
  IF v_inv.tax > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2311',
      'credit', round(v_inv.tax, 2),
      'memo', 'ضريبة مخرجات مستحقة');
  END IF;

  -- إنشاء وترحيل قيد اليومية
  v_entry := public.post_journal_entry(
    p_entry_date := v_inv.created_at::date,
    p_memo := 'ترحيل فاتورة مبيعات ' || v_inv.invoice_number,
    p_lines := v_lines,
    p_source_type := 'sales_invoice',
    p_source_id := p_invoice_id,
    p_entry_number := 'JE-SI-' || v_inv.invoice_number
  );

  -- ── ترحيل تكلفة البضاعة المباعة (COGS) ──
  SELECT coalesce(sum(sm.total_cost), 0) AS total_cogs
    INTO v_cost
    FROM public.stock_movements sm
   WHERE sm.source_type = 'sales_invoice'
     AND sm.source_id = p_invoice_id
     AND sm.movement_type = 'OUT';

  IF v_cost.total_cogs > 0 THEN
    PERFORM public.post_journal_entry(
      p_entry_date := v_inv.created_at::date,
      p_memo := 'تكلفة البضاعة المباعة - فاتورة ' || v_inv.invoice_number,
      p_lines := jsonb_build_array(
        jsonb_build_object('account_code', '5111', 'debit', round(v_cost.total_cogs, 2), 'memo', 'تكلفة المبيعات'),
        jsonb_build_object('account_code', '1313', 'credit', round(v_cost.total_cogs, 2), 'memo', 'صرف مخزون تام')
      ),
      p_source_type := 'sales_invoice_cogs',
      p_source_id := p_invoice_id,
      p_entry_number := 'JE-COGS-' || v_inv.invoice_number
    );
  END IF;

  RETURN v_entry;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_sales_invoice(uuid) TO authenticated, service_role;

COMMIT;
