-- ============================================================================
-- 01_core_enums_and_helpers.sql
--
-- الأساس: أنواع ENUM + الدوال المساعدة التي تعتمد عليها كل السياسات (is_staff, has_role, is_platform_admin, tg_set_updated_at).
-- لا جداول هنا — كل شيء لاحق يعتمد على هذا الملف.
--
-- مُستخرج من الحالة النهائية الحقيقية لقاعدة البيانات، لا من تاريخ الملفات.
-- لا يحتوي أي بيانات أعمال أو تجارية. راجع supabase/MIGRATIONS_RULES.md
-- ============================================================================

-- ── ENUMS ──────────────────────────────────────────────────────────────
-- كل نوع هنا يمثّل **مفهومًا واحدًا فقط**. لا تُخلط حالتان في نوع واحد، لأن
-- العمود الواحد لا يحمل قيمتين — فتضيع إحداهما بلا أثر.

-- نوع الحساب في محاسبة القيد المزدوج.
CREATE TYPE public.account_type AS ENUM (
  'ASSET',       -- أصول
  'LIABILITY',   -- خصوم
  'EQUITY',      -- حقوق ملكية
  'REVENUE',     -- إيرادات
  'EXPENSE'      -- مصروفات
);

-- أدوار النظام. الترتيب هنا لا يحدّد الصلاحية — الرتبة في expense_role_rank().
CREATE TYPE public.app_role AS ENUM (
  'owner',       -- المالك: كل الصلاحيات
  'manager',     -- مدير: التشغيل والاعتماد
  'accountant',  -- محاسب: القيود والتقارير المالية
  'cashier',     -- كاشير: البيع والتحصيل
  'warehouse'    -- أمين مخزن: الاستلام والصرف والجرد
);

-- طريقة تقييم المخزون.
-- NONE ليست طريقة تكلفة بل غيابها، وهي مقصودة للخدمات: الصنف نوعه SERVICE
-- لا يُكلَّف أصلًا. كتابة NONE أوضح للمحاسب من NULL في تقرير التكلفة.
CREATE TYPE public.costing_method AS ENUM (
  'MOVING_AVERAGE',  -- المتوسط المتحرك المرجّح (الافتراضي)
  'FIFO',            -- الوارد أولًا صادر أولًا
  'STANDARD',        -- التكلفة المعيارية
  'NONE'             -- بلا تكلفة — للخدمات
);

CREATE TYPE public.expense_entry_type AS ENUM (
  'DIRECT',
  'EMPLOYEE',
  'SUPPLIER',
  'RECURRING',
  'ADVANCE'
);

CREATE TYPE public.expense_payee_type AS ENUM (
  'NONE',
  'SUPPLIER',
  'EMPLOYEE',
  'OTHER'
);

CREATE TYPE public.expense_source_kind AS ENUM (
  'MANUAL',
  'LEGACY',
  'RECURRING',
  'IMPORT'
);

CREATE TYPE public.expense_status AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'POSTED',
  'PARTIALLY_PAID',
  'PAID',
  'CLOSED',
  'CANCELLED',
  'REVERSED'
);

CREATE TYPE public.expense_tax_mode AS ENUM (
  'NONE',
  'INCLUSIVE',
  'EXCLUSIVE'
);

CREATE TYPE public.inventory_policy AS ENUM (
  'TRACKED',        -- يُتابَع رصيده
  'UNTRACKED',      -- يُباع ولا يُتابَع
  'CUSTOMER_OWNED'  -- ملك عميل (أمانة)
);

-- ── دورة حياة المستند — وحدها ──────────────────────────────────────────────
-- هذا النوع يصف **أين المستند** في دورة حياته، لا كم دُفع منه.
--
-- كان سابقًا يخلط أربعة مفاهيم في نوع واحد: حالة المستند، وحالة السداد،
-- وحالة الإرجاع، ودورة الشراء. والنتيجة أن العمود الواحد لا يحمل قيمتين:
-- فاتورة «مؤكدة» و«مدفوعة جزئيًا» في وقت واحد كان يستحيل تمثيلها، فتضيع
-- إحدى الحالتين. وحالة المستند كانت تُكتب من مبلغ السداد، فتُمحى «مؤكدة».
--
-- اليوم: حالة الدورة هنا، وحالة السداد في payment_status.
CREATE TYPE public.invoice_status AS ENUM (
  'draft',      -- مسودة: قابلة للتعديل، بلا أثر مالي
  'confirmed',  -- مؤكدة: أُصدرت وأصبحت دليلًا
  'cancelled',  -- ملغاة: لم تحدث
  'returned'    -- مُرجَعة: أُعيدت بالكامل
);

-- ── حالة السداد — منفصلة ───────────────────────────────────────────────────
-- تُشتقّ من مبلغ المدفوع مقابل الإجمالي، ولا تُكتب يدويًا.
CREATE TYPE public.payment_status AS ENUM (
  'unpaid',    -- لم يُدفع منه شيء
  'partial',   -- دُفع جزء
  'paid',      -- سُدّد بالكامل
  'overpaid'   -- دُفع أكثر من المستحق (دفعة مقدمة أو إفراط)
);

CREATE TYPE public.item_class AS ENUM (
  'RAW_MATERIAL',
  'FINISHED_GOOD',
  'BY_PRODUCT',
  'SERVICE',
  'NON_STOCK_ITEM',
  'PACKAGING'
);

CREATE TYPE public.item_nature AS ENUM (
  'GOOD',
  'SERVICE'
);

CREATE TYPE public.item_status AS ENUM (
  'ACTIVE',
  'INACTIVE',
  'ARCHIVED'
);

CREATE TYPE public.item_tracking AS ENUM (
  'NONE',
  'BATCH',
  'SERIAL'
);

-- ── نوع حركة المخزون — بلا تكرار ───────────────────────────────────────────
-- كان سابقًا عشرة قيم فيها تكرار فعلي: return_in ≡ sale_return،
-- و return_out ≡ purchase_return. فأي تقرير للمرتجعات كان يجب أن يبحث عن
-- أربع قيم لنفس المفهومين، وإن نسي إحداها نقصت الأرقام بلا رسالة خطأ.
-- اليوم: قيمة واحدة لكل حدث.
CREATE TYPE public.movement_type AS ENUM (
  'purchase',         -- شراء يُدخل بضاعة
  'sale',             -- بيع يُخرج بضاعة
  'adjustment',       -- تسوية جرد
  'transfer_in',      -- وارد تحويل بين مستودعين
  'transfer_out',     -- صادر تحويل
  'sale_return',      -- مرتجع بيع يُدخل البضاعة
  'purchase_return',  -- مرتجع شراء يُخرج البضاعة
  'opening',          -- رصيد أول المدة
  'production_in',    -- ناتج إنتاج يدخل المخزون
  'production_out'    -- مواد تُصرف للإنتاج
);

CREATE TYPE public.owner_type AS ENUM (
  'COMPANY',
  'CUSTOMER',
  'SUPPLIER',
  'OTHER'
);

-- ── طرق الدفع ──────────────────────────────────────────────────────────────
-- cheque أُضيفت لأن الواجهة كانت تترجمها بلا وجود لها في النوع، فكان الشيك
-- يُقيَّد في «النقدية بالصندوق» لأن دالة الترحيل لا تجد له قيمة، فتفترض النقدية.
-- والأثر خطير: شيك بمليون ريال يُظهر صندوقًا فيه مليون غير موجود، ويُفقد
-- البنك حوالة واردة. وميزان المراجعة يبقى متوازنًا لأن الخطأ في أي حساب
-- استُخدم لا في الحساب الرياضي — فلا يُكتشف أبدًا.
CREATE TYPE public.payment_method AS ENUM (
  'cash',           -- نقدًا: يُقيَّد في 1101 الصندوق
  'card',           -- شبكة/بطاقة: تُقيَّد في 1111 البنك
  'bank_transfer',  -- حوالة بنكية: تُقيَّد في 1111 البنك
  'mobile_money',   -- محفظة إلكترونية: تُقيَّد في 1111 البنك
  'cheque',         -- شيك مصرفي: يُقيَّد في 1111 البنك
  'credit',         -- آجل: ذمم، لا نقدية
  'split'           -- مجزّأ: أكثر من وسيلة في سند واحد
);

CREATE TYPE public.stock_movement_kind AS ENUM (
  'RECEIPT',
  'ISSUE',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'ADJUSTMENT',
  'OPENING',
  'PRODUCTION'
);

-- ── PURE HELPERS ───────────────────────────────────────────────────
-- دوال حسابية بلا جداول ولا اعتماديات. تُعرَّف هنا لتكون متاحة لكل ملف لاحق.

-- اشتقاق حالة السداد من المدفوع مقابل الإجمالي.
-- المصدر الوحيد للحقيقة: استخدامها في كل دالة تكتب مدفوعة يمنع حالة سداد
-- وُكتبت يدويًا ثم خالفت المبالغ الفعلية.
--
-- الحدود: 0 مدفوع ⇒ unpaid، مساوٍ للإجمالي ⇒ paid، أكثر منه ⇒ overpaid،
-- وما بينهما ⇒ partial. واستخدمت 0.005 كهامش لأن العمليات المالية تُدوَّر
-- إلى منزلتين، وبقايا الهللة يجب ألّا تُبقي فاتورة «جزئية» للأبد.
CREATE OR REPLACE FUNCTION public.derive_payment_status(p_paid numeric, p_total numeric)
RETURNS public.payment_status
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT CASE
    WHEN coalesce(p_total, 0) <= 0            THEN 'unpaid'::public.payment_status
    WHEN coalesce(p_paid, 0) <= 0             THEN 'unpaid'::public.payment_status
    WHEN p_paid >= p_total - 0.005            THEN 'paid'::public.payment_status
    ELSE 'partial'::public.payment_status
  END
$function$;

COMMENT ON FUNCTION public.derive_payment_status(numeric, numeric) IS
  'يشتقّ حالة السداد من (المدفوع مقابل الإجمالي). نقطة الحقيقة الواحدة — لا تُكتب الحالة يدويًا.';

-- التقريب المعياري: منزلتان عشريتان، بنوع numeric لا float لتفادي انزلاق
-- الفاصلة العائمة عبر ملايين الصفوف.
CREATE OR REPLACE FUNCTION public.expense_round(p_value numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- numeric لا float: الـ 0.005 يجب أن تُدوَّر كما يتوقّع المحاسب، ومجموع مليون
  -- صف لا يجب أن يراكم انزلاق الفاصلة العائمة.
  SELECT round(coalesce(p_value, 0)::numeric, 2)
$function$;

CREATE OR REPLACE FUNCTION public.expense_line_net(p_gross numeric, p_tax_rate numeric, p_mode expense_tax_mode)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_gross IS NULL THEN NULL
    WHEN p_tax_rate IS NULL OR p_tax_rate <= 0 THEN public.expense_round(p_gross)
    WHEN p_mode = 'EXCLUSIVE' THEN public.expense_round(p_gross)
    ELSE public.expense_round(p_gross / (1 + (p_tax_rate / 100)))
  END
$function$;

CREATE OR REPLACE FUNCTION public.expense_line_tax(p_gross numeric, p_tax_rate numeric, p_mode expense_tax_mode)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_gross IS NULL THEN NULL
    WHEN p_tax_rate IS NULL OR p_tax_rate <= 0 THEN 0::numeric
    ELSE public.expense_round(p_gross - public.expense_line_net(p_gross, p_tax_rate, p_mode))
  END
$function$;
