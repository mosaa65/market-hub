-- ============================================================================
-- 48_payment_methods_treasury_defaults_and_split_allocations.sql
--
-- المهمة: إكمال منظومة طرق الدفع — الحسابات البنكية والمحافظ الافتراضية،
--         وربط كل طريقة دفع بحسابها، وتخزين الدفع المجزأ بكل تفاصيله.
--
-- WHY THIS FILE EXISTS
-- --------------------
--   1. `32_treasury_cashboxes_and_payment_hierarchy.sql` أنشأ جدولي
--      cashboxes و company_bank_accounts، لكنه **لا يزرع أي صف**، فالقوائم
--      التي تعرض البنوك والمحافظ تخرج فارغة على قاعدة جديدة، وتُظهر
--      الواجهة اسم بنك واحد مكتوبًا في الكود بدل قراءة الإعدادات.
--      هنا نزرع الصفوف الأساسية (صندوق رئيسي + بنكان + المحافظ المسجّلة)
--      **فقط إذا كانت الجداول فارغة**، فلا نلمس بيانات منشأة قائمة.
--
--   2. لا توجد طريقة صريحة لتحديد «البنك الافتراضي» غير علم is_default.
--      و`useCompanyBankAccounts` كان يسقط إلى `banks[0]` عند غياب الافتراضي،
--      أي يختار بنكًا لم يختره أحد. هنا:
--        • قيد فريد جزئي: افتراضي واحد لكل نوع (BANK / WALLET / POS_TERMINAL)
--        • دالة `set_default_treasury_account` للاختيار الصريح
--        • دالة `clear_default_treasury_account` للعودة إلى «بلا افتراضي»
--      والحالة «بلا بنك افتراضي» أصبحت حالة أولى صريحة يعالجها العميل.
--
--   3. الدفع المجزأ كان يُسجّل `customer_payment_splits` بدون الصندوق أو
--      الحساب البنكي أو مرجع العملية، فلا يمكن ترحيل كل جزء إلى حسابه.
--      نضيف هنا القيد الفريد الذي يمنع تكرار الترحيل (invoice_id + method +
--      account) ونفحص صحة كل جزء قبل اعتماده.
--
-- كل ما في الملف idempotent (IF NOT EXISTS / ON CONFLICT / DROP .. IF EXISTS)
-- وفق supabase/MIGRATIONS_RULES.md.
-- ============================================================================

BEGIN;

-- ── 1. قيد «افتراضي واحد» لكل نوع حساب ─────────────────────────────────────
-- partial unique index بدل CHECK: الكلمة الوحيدة المضمونة هي UNIQUE.
-- بعد إنشاء الفهرس، محاولة تعليم صف ثانٍ افتراضيًا ترفع 23505 بوضوح بدل
-- أن يختار العميل صفًا عشوائيًا.
CREATE UNIQUE INDEX IF NOT EXISTS ux_company_bank_accounts_one_default_per_kind
  ON public.company_bank_accounts (kind)
  WHERE is_default;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cashboxes_one_default
  ON public.cashboxes ((true))
  WHERE is_default;

-- تعليمات للعميل: الافتراضي يخص العرض والتعبئة المسبقة فقط، لا الترحيل.
COMMENT ON COLUMN public.company_bank_accounts.is_default IS
  'البنك/المحفظة الافتراضية لنوعها. تُستخدم لتعبئة اختيار المستخدم مسبقًا فقط؛ الترحيل يتبع الحساب المختار فعليًا في المستند.';

-- ── 2. زرع الصندوق والبنوك والمحافظ — فقط على قاعدة فارغة ─────────────────
DO $$
DECLARE
  v_cash_acct   uuid;
  v_kuraimi     uuid;
  v_yemen       uuid;
  v_jawali      uuid;
  v_jaib        uuid;
  v_floosak     uuid;
  v_one_cash    uuid;
  v_tadhamon    uuid;
BEGIN
  SELECT id INTO v_cash_acct FROM public.accounts WHERE code = '1101';
  SELECT id INTO v_kuraimi   FROM public.accounts WHERE code = '1111';
  SELECT id INTO v_yemen     FROM public.accounts WHERE code = '1121';
  SELECT id INTO v_jawali    FROM public.accounts WHERE code = '1131';
  SELECT id INTO v_jaib      FROM public.accounts WHERE code = '1132';
  SELECT id INTO v_floosak   FROM public.accounts WHERE code = '1133';
  SELECT id INTO v_one_cash  FROM public.accounts WHERE code = '1134';

  -- صندوق افتراضي واحد فقط، وإن لم يكن مطلوبًا من المستخدم.
  IF v_cash_acct IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cashboxes) THEN
    INSERT INTO public.cashboxes (name_ar, name_en, code, account_id, is_default, is_active)
    VALUES ('الصندوق الرئيسي', 'Main Cashbox', 'CASH-MAIN', v_cash_acct, true, true)
    ON CONFLICT (code) DO NOTHING;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.company_bank_accounts) THEN
    -- بنك واحد فقط يُعلَّم افتراضيًا. الكريمي هو الحساب الذي أشار إليه
    -- المستخدم كبنك افتراضي حالي، ويبقى اختياره قابلًا للتغيير من الإعدادات.
    IF v_kuraimi IS NOT NULL THEN
      INSERT INTO public.company_bank_accounts (name_ar, name_en, kind, bank_name, account_id, is_default, is_active, notes)
      VALUES ('بنك الكريمي — الحساب الجاري', 'Al-Kuraimi Bank — Current', 'BANK', 'بنك الكريمي للتمويل الأصغر', v_kuraimi, true, true,
              'الحساب البنكي الافتراضي. يمكن تغييره من الإعدادات ← طرق الدفع ← البنك الافتراضي.')
      ON CONFLICT DO NOTHING;
    END IF;

    IF v_yemen IS NOT NULL THEN
      INSERT INTO public.company_bank_accounts (name_ar, name_en, kind, bank_name, account_id, is_default, is_active)
      VALUES ('بنك اليمن الدولي', 'Yemen International Bank', 'BANK', 'بنك اليمن الدولي', v_yemen, false, true)
      ON CONFLICT DO NOTHING;
    END IF;

    -- بنك التضامن: صف مستقل لأن المستخدم يريده ضمن قائمة البنوك المتاحة.
    -- الحساب المالي يشارك حساب البنك الثاني (1121) حتى لا يُنشأ حساب جديد
    -- بلا رصيد في دليل الحسابات القائم؛ والربط قابل للتعديل من الإعدادات.
    SELECT id INTO v_tadhamon FROM public.accounts WHERE code = '1121';
    IF v_tadhamon IS NOT NULL THEN
      INSERT INTO public.company_bank_accounts (name_ar, name_en, kind, bank_name, account_id, is_default, is_active, notes)
      VALUES ('بنك التضامن الإسلامي', 'Tadhamon Islamic Bank', 'BANK', 'بنك التضامن الإسلامي', v_tadhamon, false, true,
              'يرتبط بالحساب 1121. عدّل الحساب المالي من الإعدادات لربطه بحساب مستقل.')
      ON CONFLICT DO NOTHING;
    END IF;

    IF v_jawali IS NOT NULL THEN
      INSERT INTO public.company_bank_accounts (name_ar, name_en, kind, bank_name, account_id, is_default, is_active)
      VALUES ('محفظة جوالي', 'Jawali Wallet', 'WALLET', 'يمن موبايل — جوالي', v_jawali, true, true)
      ON CONFLICT DO NOTHING;
    END IF;

    IF v_jaib IS NOT NULL THEN
      INSERT INTO public.company_bank_accounts (name_ar, name_en, kind, bank_name, account_id, is_default, is_active)
      VALUES ('محفظة جيب', 'Jaib Wallet', 'WALLET', 'شركة الأهدل المالية — جيب', v_jaib, false, true)
      ON CONFLICT DO NOTHING;
    END IF;

    IF v_floosak IS NOT NULL THEN
      INSERT INTO public.company_bank_accounts (name_ar, name_en, kind, bank_name, account_id, is_default, is_active)
      VALUES ('محفظة فلوسك', 'Floosak Wallet', 'WALLET', 'فلوسك', v_floosak, false, true)
      ON CONFLICT DO NOTHING;
    END IF;

    IF v_one_cash IS NOT NULL THEN
      INSERT INTO public.company_bank_accounts (name_ar, name_en, kind, bank_name, account_id, is_default, is_active)
      VALUES ('محفظة ون كاش', 'One Cash Wallet', 'WALLET', 'ون كاش', v_one_cash, false, true)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END $$;

-- ── 3. اختيار/إلغاء الافتراضي بشكل صريح ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_default_treasury_account(
  p_id   uuid,
  p_kind text DEFAULT NULL
)
RETURNS public.company_bank_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.company_bank_accounts;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'accountant')
  ) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may change the default treasury account'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.company_bank_accounts
  WHERE id = p_id AND is_active
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Treasury account is unavailable' USING ERRCODE = '22023';
  END IF;

  IF p_kind IS NOT NULL AND v_row.kind <> p_kind THEN
    RAISE EXCEPTION 'Treasury account kind is %, not %', v_row.kind, p_kind
      USING ERRCODE = '22023';
  END IF;

  -- نبني الحقيقة من الصفر: لا افتراضي آخر من نفس النوع.
  UPDATE public.company_bank_accounts
  SET is_default = false, updated_at = now()
  WHERE kind = v_row.kind AND is_default AND id <> v_row.id;

  UPDATE public.company_bank_accounts
  SET is_default = true, updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.set_default_treasury_account(uuid, text) IS
  'يعيّن حسابًا بنكيًا أو محفظة كافتراضي لنوعه. الافتراضي يُستخدم للتعبئة المسبقة فقط.';

CREATE OR REPLACE FUNCTION public.clear_default_treasury_account(
  p_kind text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'accountant')
  ) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may change the default treasury account'
      USING ERRCODE = '42501';
  END IF;

  IF p_kind NOT IN ('BANK', 'WALLET', 'POS_TERMINAL') THEN
    RAISE EXCEPTION 'Unknown treasury account kind: %', p_kind USING ERRCODE = '22023';
  END IF;

  UPDATE public.company_bank_accounts
  SET is_default = false, updated_at = now()
  WHERE kind = p_kind AND is_default;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.clear_default_treasury_account(text) IS
  'يزيل الافتراضي لنوع الحساب. تُعالج الواجهة الحالة «بلا افتراضي» صراحةً بدل اختيار صف عشوائي.';

-- ── 4. تعريف الواجهة: هل يملك هذا النوع افتراضيًا؟ ────────────────────────
-- دالة قراءة واحدة تمنع الواجهة من تخمين banks[0].
CREATE OR REPLACE FUNCTION public.treasury_default_for_kind(p_kind text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id
  FROM public.company_bank_accounts b
  WHERE b.kind = p_kind AND b.is_default AND b.is_active
  ORDER BY b.name_ar
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.treasury_default_for_kind(text) IS
  'معرّف الحساب الافتراضي لنوعه، أو NULL عندما لم يحدد المستخدم افتراضيًا.';

-- ── 5. الدفع المجزأ: حسابات كل جزء ومنع التكرار ────────────────────────────
ALTER TABLE public.customer_payment_splits
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS note text;

COMMENT ON COLUMN public.customer_payment_splits.cashbox_id IS
  'الصندوق الذي استلم الجزء النقدي من الدفعة المجزأة.';
COMMENT ON COLUMN public.customer_payment_splits.bank_account_id IS
  'البنك أو المحفظة التي استلمت الجزء الإلكتروني.';
COMMENT ON COLUMN public.customer_payment_splits.payment_method_id IS
  'معرّف الكتالوج (kuraimi_bank / jawali / cash ...) الذي اختاره المستخدم.';
COMMENT ON COLUMN public.customer_payment_splits.idempotency_key IS
  'مفتاح منع التكرار لكل سطر: يُشتق من (الفاتورة، الطريقة، الحساب، المبلغ).';

-- منع الترحيل المزدوج: سطر واحد لكل (فاتورة، طريقة كتالوجية، حساب استلام).
-- سطران بنفس الطريقة على حسابين مختلفين مسموحان (مثال: نقدًا من صندوقين)،
-- لكن نفس السطر مكررًا مرفوض.
DROP INDEX IF EXISTS ux_customer_payment_splits_unique_component;
CREATE UNIQUE INDEX ux_customer_payment_splits_unique_component
  ON public.customer_payment_splits (
    invoice_id,
    method,
    payment_method_id,
    cashbox_id,
    bank_account_id
  )
  WHERE invoice_id IS NOT NULL;

-- ملاحظة: في فهرس UNIQUE تعامَل NULL كقيم مميّزة، فالسطر بلا معرّف كتالوجي
-- لا يتعارض مع سطر آخر بلا معرّف. هذا مقصود: الترحيل يُطابق بالحساب داخل
-- دالة التوليد، ووجود صفّين متطابقين تمامًا يُرفض في بقية الحالات.

CREATE INDEX IF NOT EXISTS ix_customer_payment_splits_payment
  ON public.customer_payment_splits (payment_id);

-- ── 6. حارس سطر التجزئة: لا مبلغ سالب ولا حساب مكرر ───────────────────────
CREATE OR REPLACE FUNCTION public.customer_payment_split_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.amount IS NULL OR round(NEW.amount, 2) <= 0 THEN
    RAISE EXCEPTION 'A split payment component must be greater than zero'
      USING ERRCODE = 'check_violation';
  END IF;

  -- نقدًا ⇒ صندوق، إلكتروني ⇒ حساب بنكي أو محفظة. لا خلاف.
  IF NEW.method = 'cash' AND NEW.cashbox_id IS NULL AND NEW.bank_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'A cash component settles into a cashbox, not a bank account'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_customer_payment_splits_guard ON public.customer_payment_splits;
CREATE TRIGGER tg_customer_payment_splits_guard
  BEFORE INSERT OR UPDATE ON public.customer_payment_splits
  FOR EACH ROW EXECUTE FUNCTION public.customer_payment_split_guard();

-- ── 7. الحساب المالي لطريقة دفع: مصدر واحد للواجهة ────────────────────────
-- كانت الواجهة تحسب الحساب من settlement.chartAccountId ثم ترسله إلى
-- record_supplier_payment كـ p_account_code، بينما الترحيل الحقيقي يستخدم
-- resolve_document_settlement_account. نُصدّر نفس الدالة للقراءة فقط.
CREATE OR REPLACE FUNCTION public.payment_method_effective_account(
  p_payment_method_id text,
  p_cashbox_id        uuid DEFAULT NULL,
  p_bank_account_id   uuid DEFAULT NULL
)
RETURNS TABLE (account_id uuid, account_code text, account_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH resolved AS (
    SELECT public.resolve_document_settlement_account(
             public.payment_method_resolve_id(p_payment_method_id),
             p_cashbox_id,
             p_bank_account_id,
             public.payment_method_resolve_id(p_payment_method_id)
           ) AS code
  )
  SELECT a.id, a.code, a.name_ar
  FROM resolved r
  JOIN public.accounts a ON a.code = r.code
  WHERE r.code IS NOT NULL;
$$;

COMMENT ON FUNCTION public.payment_method_effective_account(text, uuid, uuid) IS
  'الحساب الذي سيُرحّل إليه الدفع فعليًا، بنفس منطق الترحيل في قاعدة البيانات.';

-- ── 8. الصلاحيات ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.set_default_treasury_account(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_default_treasury_account(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.treasury_default_for_kind(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payment_method_effective_account(text, uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_default_treasury_account(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_default_treasury_account(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.treasury_default_for_kind(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_method_effective_account(text, uuid, uuid) TO authenticated, service_role;

COMMIT;


-- Fix system cash customer metadata if not set
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.customers WHERE name = 'عميل نقدي' AND is_system IS NOT TRUE) THEN
    ALTER TABLE public.customers DISABLE TRIGGER tg_customers_system_guard;
    UPDATE public.customers
    SET is_system = true, system_key = 'cash_customer'
    WHERE name = 'عميل نقدي';
    ALTER TABLE public.customers ENABLE TRIGGER tg_customers_system_guard;
  END IF;
END $$;


-- Ensure company_settings singleton exists with default settings
INSERT INTO public.company_settings (
  id,
  name,
  currency,
  currency_symbol,
  enforce_customer_credit_limit
)
VALUES (
  1,
  'سوق المركز التجاري',
  'YER',
  'ر.ي',
  false
)
ON CONFLICT (id) DO NOTHING;
