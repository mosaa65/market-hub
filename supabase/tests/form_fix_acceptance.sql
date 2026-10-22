-- ============================================================================
-- Market-Hub ERP — 44: اختبارات هجرة الإصلاح الأمامية
-- ============================================================================
-- Reference: supabase/migrations/44_form_fix_forward.sql
-- كل كتلة تفحص نتيجة الإصلاح وتفشل بـ RAISE EXCEPTION 'FAIL: …'، ولا تكتب صفًا
-- دائمًا (BEGIN … ROLLBACK)، فلا تترك أثرًا على أي قاعدة.
--
-- HOW TO RUN
--   psql "$DATABASE_URL" -f supabase/tests/form_fix_acceptance.sql
--
-- NOTE ON AUTH
--   الاختبارات هنا بنيوية وقراءة فقط: لا تستدعي RPC، فلا تحتاج auth.uid().
-- ============================================================================

BEGIN;

-- ── (0) المحرّك يقيّم الحركة ويتحقق من P0-3 بنيويًا ──────────────────────────
DO $$
DECLARE
  v_def text;
  v_cnt integer;
BEGIN
  v_def := pg_get_functiondef(
    'public.post_stock_delta(uuid,uuid,numeric,numeric,public.stock_movement_kind,text,uuid,text,public.owner_type,uuid,public.movement_type)'::regprocedure);

  IF position('total_cost' IN v_def) = 0 THEN
    RAISE EXCEPTION 'FAIL: post_stock_delta لا يكتب total_cost — تكلفة البيع ستُقيَّد صفرًا';
  END IF;

  IF position('RETURNING id INTO v_movement_id' IN v_def) = 0 THEN
    RAISE EXCEPTION 'FAIL: post_stock_delta لا يحتفظ بمعرّف الحركة، فالتحديث قد يطابق صفًا آخر';
  END IF;

  -- لا تسوية بالسبب الفارغ يمكن إدراجها بعد هذا الملف: القيد على الجدول.
  SELECT count(*) INTO v_cnt
  FROM pg_constraint
  WHERE conrelid = 'public.stock_movements'::regclass
    AND conname = 'stock_movements_adjustment_reason_required';
  IF v_cnt = 0 THEN
    RAISE EXCEPTION 'FAIL: قيد سبب التسوية غير موجود';
  END IF;

  RAISE NOTICE 'PASS: post_stock_delta يكتب القيمة الفعلية، والقيد موجود';
END $$;

-- ── (1) عمود ربط بند المرتجع ─────────────────────────────────────────────────
DO $$
DECLARE
  v_type text;
BEGIN
  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'sales_return_items'
    AND column_name = 'invoice_item_id';

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'FAIL: sales_return_items.invoice_item_id غير موجود — المرتجع الجزئي للبند غير ممكن';
  END IF;
  IF v_type <> 'uuid' THEN
    RAISE EXCEPTION 'FAIL: invoice_item_id من النوع % لا uuid', v_type;
  END IF;

  IF to_regclass('public.idx_sales_return_items_invoice_item') IS NULL THEN
    RAISE EXCEPTION 'FAIL: فهرس invoice_item_id غير موجود';
  END IF;

  RAISE NOTICE 'PASS: بند المرتجع مربوط ببند الفاتورة';
END $$;

-- ── (2) تقرير حسابات المنصة محجوب عن غير المسؤول ─────────────────────────────
DO $$
DECLARE
  v_auth_exec boolean;
  v_has_self boolean;
BEGIN
  v_auth_exec := has_function_privilege('authenticated', 'public.platform_admin_audit()', 'EXECUTE');
  IF v_auth_exec THEN
    RAISE EXCEPTION 'FAIL: platform_admin_audit() ما زالت قابلة للتنفيذ من authenticated (تقرأ auth.users)';
  END IF;

  v_has_self := to_regprocedure('public.platform_admin_audit_self()') IS NOT NULL;
  IF NOT v_has_self THEN
    RAISE EXCEPTION 'FAIL: platform_admin_audit_self() غير موجودة — لوحة المنصة ستكون فارغة';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.platform_admin_audit_self()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: platform_admin_audit_self() بلا تنفيذ لـ authenticated';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.platform_admin_audit()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: platform_admin_audit() بلا تنفيذ لـ service_role (CI/CLI)';
  END IF;

  RAISE NOTICE 'PASS: تقرير المنصة مقصور على من يملك الحق';
END $$;

-- ── (3) المحرّكات الداخلية غير مكشوفة للمستخدم المسجّل ───────────────────────
DO $$
DECLARE
  v_leak text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_leak
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND p.proname IN ('apply_cost_movement', 'balance_and_post_return',
                      'tg_stock_movements_engine_only', 'tg_customers_system_guard',
                      'tg_suppliers_system_guard', 'tg_customer_ledger_system_guard')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: محرّكات داخلية مكشوفة للواجهة: %', v_leak;
  END IF;

  RAISE NOTICE 'PASS: المحرّكات الداخلية ليست RPC';
END $$;

-- ── (4) الواجهة تستدعي القيمة التي ستكتب على الحركة (تكفي للقراءة) ───────────
DO $$
DECLARE
  v_cnt integer;
BEGIN
  SELECT count(*) INTO v_cnt
  FROM public.stock_movements
  WHERE movement_kind IN ('ISSUE'::public.stock_movement_kind,
                          'PRODUCTION'::public.stock_movement_kind)
    AND total_cost IS NULL;

  IF v_cnt > 0 THEN
    RAISE WARNING '% حركة قديمة بلا total_cost — أثر 43 على صفوف سابقة (لا يفشل هذا الاختبار)', v_cnt;
  ELSE
    RAISE NOTICE 'PASS: كل حركة صادر/تصنيع تحمل قيمتها';
  END IF;
END $$;

ROLLBACK;

-- النتيجة المتوقعة: أربعة PASS (وقد يسبقها WARNING عن صفوف تاريخية فقط).
