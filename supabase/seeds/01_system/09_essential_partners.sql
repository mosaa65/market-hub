-- ============================================================================
-- 09_essential_partners.sql — البيانات التهيئية الجوهرية للشركاء
-- ============================================================================
--
-- ─ ما هذا الملف؟ ───────────
--   شركاء لا يعمل النظام بدونهم من اللحظة الأولى، ولا يجب على أي عميل جديد
--   أن ينشئهم يدوياً قبل أول فاتورة:
--
--     1. «المخزن الرئيسي»  — مستودع افتراضي (is_default) تذهب إليه كل الحركات
--        حتى ينشئ صاحب المنشأة مستودعاته الخاصة.
--     2. «عميل نقدي»       — تُسجَّل عليه المبيعات الفورية بلا ذمة، ويعتمد عليه
--        محرك نقطة البيع وشاشات المطحنة.
--     3. «مورد نقدي»       — للمشتريات الفورية المدفوعة حالاً.
--
-- ─ لماذا هنا (01_system) لا في migrations أو 03_samples؟ ───────────
--   هذا هو التعريف الصحيح للـ Essential Reference (R-08/القسم 1):
--   «هل يستطيع أي عميل جديد تشغيل النظام بدون هذا السطر؟» — لا يستطيع.
--   فالرصيد الافتتاحي يحتاج مخزناً، والبيع النقدي يحتاج عميلاً نقدياً.
--   البيانات الخاصة بنشاط معيّن (أصناف المطحنة مثلاً) تبقى في 03_samples.
--
-- ─ الاسم عربي في العمودين ──────────
--   جدول customers/suppliers عمود الاسم الوحيد فيه هو `name` (لا يوجد name_ar
--   فيهما — الدرس الموثق 13.3)، فالقيمة العربية تُكتب فيه مباشرة.
--   warehouses يملك name و name_ar معاً فتُكتب القيمة العربية فيهما.
--
-- ─ الثبات (Idempotent) ─────────────
--   warehouses له مفتاح وحيد على code فنستخدم ON CONFLICT.
--   customers/suppliers لا مفتاح وحيد على الاسم، فالتياق يُحقق بـ
--   WHERE NOT EXISTS — نفس الضمان (R-19): لا تكرار مهما أُعيد التشغيل.
--
-- المرجع: supabase/docs/2026-10-12_guide_migrations-rules.md
-- ============================================================================

BEGIN;

-- ─ 1. المستودع الرئيسي ───────────
INSERT INTO public.warehouses (name, name_ar, code, is_default, is_active)
VALUES
  ('المخزن الرئيسي', 'المخزن الرئيسي', 'MAIN', true, true)
ON CONFLICT (code) DO UPDATE
  SET name_ar  = 'المخزن الرئيسي',
      is_default = true,
      is_active  = true;

-- ─ 2. العميل النقدي ─────────────
INSERT INTO public.customers (name, phone, credit_limit, balance, is_active, is_system, system_key)
SELECT 'عميل نقدي', NULL, 0, 0, true, true, 'CASH_CUSTOMER'
WHERE NOT EXISTS (
  SELECT 1 FROM public.customers WHERE system_key = 'CASH_CUSTOMER' OR name = 'عميل نقدي'
)
ON CONFLICT (system_key) DO NOTHING;

-- ─ 3. المورد النقدي ─────────────
INSERT INTO public.suppliers (name, phone, balance, is_active, is_system, system_key)
SELECT 'مورد نقدي', NULL, 0, true, true, 'CASH_SUPPLIER'
WHERE NOT EXISTS (
  SELECT 1 FROM public.suppliers WHERE system_key = 'CASH_SUPPLIER' OR name = 'مورد نقدي'
)
ON CONFLICT (system_key) DO NOTHING;

-- صندوق نقدي عام فقط. الحسابات البنكية والمحافظ المسماة إعدادات خاصة بالمنشأة
-- ولا تُنشأ افتراضيًا من أي بنك أو محفظة محلية بعينها.
INSERT INTO public.cashboxes (name_ar, name_en, code, account_id, is_default, is_active)
SELECT 'الصندوق الرئيسي', 'Main Cashbox', 'CASH-MAIN', a.id, true, true
FROM public.accounts a
WHERE a.code = '1101'
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- ============================================================================
-- التحقق بعد التشغيل:
--   SELECT name FROM public.warehouses WHERE code = 'MAIN';
--   SELECT name FROM public.customers  WHERE name = 'عميل نقدي';
--   SELECT name FROM public.suppliers  WHERE name = 'مورد نقدي';
-- المتوقع: صفاً واحداً لكل استعلام.
-- ============================================================================
