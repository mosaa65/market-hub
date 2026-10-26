-- ============================================================================
-- 08_payment_methods.sql — كتالوج طرق الدفع المعتمدة (4 طرق فقط)
-- ============================================================================

BEGIN;

-- حذف أي طرق دفع قديمة غير الأربع المعتمدة
DELETE FROM public.payment_method_settings
WHERE payment_method_id NOT IN ('cash', 'credit', 'bank_transfer', 'mobile_money');

DELETE FROM public.payment_methods
WHERE id NOT IN ('cash', 'credit', 'bank_transfer', 'mobile_money');

INSERT INTO public.payment_methods (
  id, name_ar, name_en, icon_key, is_active, sort_order, allowed_contexts,
  ledger_kind, default_account_code, is_credit_term, requires_reference,
  legacy_ids, legacy_id, notes, shipped_name_ar
) VALUES
  -- ─── 1. النقد ─────────────────────────────────────────────────────────────
  ('cash', 'نقدًا', 'Cash', 'cash', true, 10,
   ARRAY['pos','sales','purchases','expenses','customer_collection','sales_returns','purchase_returns'],
   'CASH', '1101', false, false, ARRAY['cash'], 'cash',
   'الصندوق والنقدية.', 'نقدًا'),

  -- ─── 2. الآجل ─────────────────────────────────────────────────────────────
  ('credit', 'آجل', 'Credit', 'credit', true, 20,
   ARRAY['pos','sales','purchases','sales_returns','purchase_returns'],
   'CREDIT', '1211', true, false, ARRAY['credit'], 'credit',
   'ذمم العملاء والموردين.', 'آجل'),

  -- ─── 3. البنك ─────────────────────────────────────────────────────────────
  ('bank_transfer', 'بنك', 'Bank', 'bank-transfer', true, 30,
   ARRAY['pos','sales','purchases','expenses','customer_collection','sales_returns','purchase_returns'],
   'BANK', '1111', false, false, ARRAY['bank_transfer'], 'bank_transfer',
   'الحسابات البنكية الموحدة والحوالات.', 'بنك'),

  -- ─── 4. المحفظة الإلكترونية ──────────────────────────────────────────────
  ('mobile_money', 'محفظة إلكترونية', 'E-Wallet', 'mobile-money', true, 40,
   ARRAY['pos','sales','purchases','expenses','customer_collection','sales_returns','purchase_returns'],
   'WALLET', '1131', false, false, ARRAY['mobile_money'], 'mobile_money',
   'المحافظ الإلكترونية الموحدة.', 'محفظة إلكترونية')
ON CONFLICT (id) DO UPDATE SET
  name_ar              = EXCLUDED.name_ar,
  name_en              = EXCLUDED.name_en,
  icon_key             = EXCLUDED.icon_key,
  is_active            = EXCLUDED.is_active,
  sort_order           = EXCLUDED.sort_order,
  allowed_contexts     = EXCLUDED.allowed_contexts,
  ledger_kind          = EXCLUDED.ledger_kind,
  default_account_code = EXCLUDED.default_account_code,
  is_credit_term       = EXCLUDED.is_credit_term,
  requires_reference   = EXCLUDED.requires_reference,
  legacy_ids           = EXCLUDED.legacy_ids,
  legacy_id            = EXCLUDED.legacy_id,
  notes                = EXCLUDED.notes,
  shipped_name_ar      = EXCLUDED.shipped_name_ar,
  updated_at           = now();

-- إعداد المنشأة الافتراضي للطرق الأربع
INSERT INTO public.payment_method_settings (
  payment_method_id, enabled, sort_order, enabled_contexts
)
SELECT m.id, true, m.sort_order, m.allowed_contexts
FROM public.payment_methods m
WHERE m.id IN ('cash','credit','bank_transfer','mobile_money')
ON CONFLICT (payment_method_id) DO UPDATE SET
  enabled = true,
  sort_order = EXCLUDED.sort_order,
  enabled_contexts = EXCLUDED.enabled_contexts;

COMMIT;
