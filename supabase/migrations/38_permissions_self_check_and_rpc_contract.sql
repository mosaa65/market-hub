-- ============================================================================
-- 38_permissions_self_check_and_rpc_contract.sql
--
-- الغاية: أن يحمل **المستودع نفسه** ضمانة أن أي بناء جديد (db reset / مشروع
-- سحابي جديد / استعادة نسخة) يخرج بصلاحيات صحيحة ودوال قابلة للاستدعاء من
-- الواجهة — لا أن تُكتشف الأخطاء يدويًا بعد كل نشر.
--
-- ما عولج في هذا الملف (كل بند كان عطلًا فعليًا في السحابة):
--
--   1) RPC الواجهة بلا EXECUTE:
--      الملف 36 سحب EXECUTE من PUBLIC و anon ثم منحه لـ authenticated في حلقة،
--      ثم سحبه مرة أخرى عن مجموعة أسماء داخلية — ومنها عائلة expense_*
--      العامة (expense_detail / expense_lookups / list_expenses / expense_summary
--      / expense_report). النتيجة: كل شاشات المصروفات ترجع 42501 «permission
--      denied for function …» رغم أن RLS يسمح، لأن المنح يسبق RLS في القرار.
--      القاعدة هنا: الدوال التي تستدعيها الواجهة تُنصّ صراحةً بقائمة عقد
--      (CONTRACT) تُمنح بعد كل عملية سحب، فلا يمحوها ملف لاحق.
--
--   2) is_platform_admin بلا EXECUTE لـ authenticated:
--      سُحبت في 36 ثم لم تُعد. أي واجهة تحتاج «هل أنا مسؤول منصة؟» تفشل.
--
--   3) الدوال التي أعاد الملفان 24–35 تعريفها (CREATE OR REPLACE) بعد المنح
--      كانت ستُرث PUBLIC مرة أخرى لو لم تكن 36 قد سحبته. الآن خط الدفاع محلي:
--      كل دوال public تُسحب من PUBLIC و anon، والمنح الصريح يُعاد تطبيقه.
--
--   4) حارس الأعمدة المعروف: generate_tax_declaration كان يقرأ invoice_date
--      غير الموجود — أُصلح في 27؛ وهنا فحص بنيوي يفشل البناء إن عاد.
--
--   5) تحقق ذاتي شامل في نهاية الملف: أي نقص يوقف الهجرة (RAISE) بدل الصمت.
--
-- المرجع: supabase/MIGRATIONS_RULES.md — R-19 (idempotent) و R-24 (search_path).
-- لا DML ولا TRUNCATE هنا.
-- ============================================================================

BEGIN;

-- ── (1) الأساس: لا PUBLIC ولا anon على أي دالة في public ─────────────────────
-- فحص DC2 في الملف 36 كان يُطبق على مثيل البناء حينها؛ إعادته هنا تجعله
-- آخر كلمة في سلسلة الهجرات، فلا يستطيع ملف لاحق أن يفتحها بصمت.
DO $$
DECLARE
  v_fn record;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn.sig);
  END LOOP;
END $$;

-- ── (2) دوال الخدمة (service_role): كل الدوال ────────────────────────────────
DO $$
DECLARE
  v_fn record;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn.sig);
  END LOOP;
END $$;

-- ── (3) دوال المستخدم المسجّل: كل شيء إلا المحرّكات الداخلية ─────────────────
-- المنطق: أي دالة في public يجب أن تكون قابلة للاستدعاء من authenticated
-- **إلا** ما هو أداة داخلية لا يجوز أن تصلها الواجهة (محرّكات الترقيم
-- التاريخية، مساعدات الحساب، حُرّاس الحذف). الخيار الافتراضي في هذه النسخة
-- هو «مسموح» لأن المجموعة الضيقة في 36 سحبت من الواجهة دوالًا عامة بالخطأ،
-- ولأن RLS داخل كل SECURITY DEFINER هو خط الحماية الحقيقي لا المنح.
--
-- ⚠️ مراجعة أمنية: ما يمنع المستخدم من فعل شيء ليس منح EXECUTE بل:
--   • auth.uid() داخل كل دالة (كل هذه الدوال تتحقق من المستدعي ودوره)،
--   • وفحص has_role / is_platform_superadmin قبل أي كتابة.
-- أي دالة داخلية جديدة لا تتحقق من المستدعي يجب ألّا تبقى مكشوفة؛ أضف اسمها
-- إلى القائمة أدناه في نفس الهجرة التي تنشئها.
DO $$
DECLARE
  v_fn record;
  v_internal text[] := ARRAY[
    -- محرّكات ترقيم تاريخية تُستدعى من دوال أخرى فقط
    'next_expense_reference', 'next_invoice_number', 'next_purchase_number',
    'next_purchase_return_number', 'next_sales_return_number',
    'next_stock_adjustment_number', 'next_stock_opening_number',
    'next_supplier_voucher_number', 'next_transfer_number',
    'fn_document_numbering_sequence_name',
    -- حُرّاس الحذف — تُستدعى من مشغّلات، ورسائلها للمطوّر لا للمستخدم.
    -- (product_reference_counts / warehouse_reference_counts ليست هنا: الواجهة
    --  تستدعيها لعرض سبب منع الحذف قبل المحاولة.)
    'product_delete_guard',
    -- مساعدات حسابية داخلية
    'expense_actor', 'expense_assert_capability',
    'expense_can_write_document', 'expense_log_action',
    'payment_method_seed_is_identity_owned',
    'audit_item_policy_snapshot'
  ];
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    IF v_fn.proname = ANY(v_internal) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', v_fn.sig);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn.sig);
    END IF;
  END LOOP;
END $$;

-- ── (4) عقد RPC الواجهة (CONTRACT) ───────────────────────────────────────────
-- هذه أسماء يستدعيها src/ عبر supabase.rpc(). تُمنح هنا مرة أخيرة صريحة حتى
-- يبقى العقد مقروءًا بلا قراءة الكود، ولتصحيح أي سحب سابق.
DO $$
DECLARE
  v_name text;
  v_contract text[] := ARRAY[
    -- المصروفات (كل شاشات expense_*)
    'create_expense', 'update_expense', 'submit_expense', 'decide_expense',
    'post_expense', 'close_expense', 'cancel_expense', 'reverse_expense',
    'record_expense_payment', 'reverse_expense_payment',
    'list_expenses', 'expense_detail', 'expense_summary', 'expense_report',
    'expense_lookups', 'save_expense_category', 'delete_expense_category',
    -- البيع والشراء والمخزون
    'create_sale', 'create_sales_return', 'create_purchase',
    'create_purchase_return', 'create_stock_transfer',
    'post_sales_invoice', 'post_purchase_invoice',
    'record_supplier_payment', 'get_supplier_statement',
    'record_customer_payment', 'adjust_loyalty',
    -- المحاسبة والأصول والضرائب
    'create_journal_entry', 'reverse_journal_entry',
    'activate_fixed_asset', 'dispose_fixed_asset',
    'run_depreciation', 'run_batch_depreciation',
    'run_contract_amortization', 'run_batch_amortization',
    'close_fiscal_year', 'open_fiscal_year', 'set_period_status',
    'generate_tax_declaration', 'settle_tax_period', 'pay_tax_settlement',
    'get_chart_of_accounts_tree',
    -- طرق الدفع (كتالوج المستأجر)
    'create_tenant_payment_method', 'update_payment_method_identity',
    'remove_tenant_payment_method',
    -- البحث والنسخ الاحتياطي والترقيم
    'search_products', 'backup_export_all', 'backup_restore_all',
    'backup_schema_fingerprint',
    'fn_next_document_number', 'fn_format_document_number',
    'fn_resolve_document_numbering', 'fn_set_document_numbering',
    -- مساعدات التخويل التي تستدعيها الواجهة مباشرة
    'has_role', 'is_staff', 'is_platform_admin', 'is_platform_superadmin',
    'can_author_payment_methods', 'can_read_finance',
    'can_read_expense_entry', 'can_operate_milling', 'can_view_milling'
  ];
  v_fn record;
BEGIN
  FOREACH v_name IN ARRAY v_contract LOOP
    FOR v_fn IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = v_name
    LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn.sig);
    END LOOP;
  END LOOP;
END $$;

-- ── (5) مساعدات تُستدعى من سياسات RLS ────────────────────────────────────────
-- سياسة RLS تُنفَّذ بصلاحيات المستدعي، لذلك الدالة المستخدمة داخل USING يجب
-- أن تكون قابلة للتنفيذ له — ولهذا has_role/is_staff تحمل SECURITY DEFINER
-- لتقرأ user_roles رغم RLS. نؤكد المنح هنا لأن سحبه يعطّل السياسة بصمت
-- (ترجع 42501 بدل صفوف) — وهو أسوأ أنواع الأعطال لأنه يشبه «لا بيانات».
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_superadmin(uuid) TO authenticated;

-- ── (6) فحص بنيوي: لا دالة SECURITY DEFINER بلا search_path ─────────────────
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND p.prosecdef
    AND (p.proconfig IS NULL
         OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'));

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER بلا search_path ثابت: %', v_bad;
  END IF;
END $$;

-- ── (7) فحص بنيوي: الأعمدة التي تقرأها دوال الإقرار الضريبي موجودة ──────────
-- يمنع تكرار عطل invoice_date إن أُعيد تعريف الدالة لاحقًا من نسخة قديمة.
-- ⚠️ نفحص **جسم الدالة** لا تعريفها الكامل: التعليق التوثيقي في 27 يذكر
--    الكلمة invoice_date شرحًا للعطل، ففحص النص كاملًا يُنتج إيجابية كاذبة
--    توقف الهجرة الصحيحة. نقتطع ما بعد AS $...$ ونتجاهل أسطر التعليق.
DO $$
DECLARE
  v_body text;
BEGIN
  IF to_regprocedure('public.generate_tax_declaration(date,date)') IS NULL THEN
    RETURN;
  END IF;

  SELECT substring(pg_get_functiondef('public.generate_tax_declaration(date,date)'::regprocedure)
                   FROM 'AS \$[a-z]*\$(.*)\$[a-z]*\$\s*$')
    INTO v_body;

  v_body := regexp_replace(coalesce(v_body, ''), '--[^\n]*', '', 'g');   -- أسطر التعليق
  v_body := regexp_replace(v_body, '/\*.*?\*/', '', 'gs');               -- تعليقات كتلية

  IF position('invoice_date' IN v_body) > 0
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'invoice_date'
     ) THEN
    RAISE EXCEPTION
      'generate_tax_declaration يقرأ invoice_date غير الموجود — أصلح تعريف الدالة (راجع 27)';
  END IF;
END $$;

-- ── (8) تحقق ذاتي نهائي ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing text;
  v_anon text;
BEGIN
  -- 8-أ) كل دوال public قابلة للتنفيذ من authenticated إلا الداخلية
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_missing
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND p.proname NOT IN (
      'next_expense_reference', 'next_invoice_number', 'next_purchase_number',
      'next_purchase_return_number', 'next_sales_return_number',
      'next_stock_adjustment_number', 'next_stock_opening_number',
      'next_supplier_voucher_number', 'next_transfer_number',
      'fn_document_numbering_sequence_name',
      'product_delete_guard',
      'expense_actor', 'expense_assert_capability',
      'expense_can_write_document', 'expense_log_action',
      'payment_method_seed_is_identity_owned',
      'audit_item_policy_snapshot'
    );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'دوال غير قابلة للتنفيذ من authenticated: %', v_missing;
  END IF;

  -- 8-ب) لا دالة واحدة قابلة للتنفيذ من anon
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_anon
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_anon IS NOT NULL THEN
    RAISE EXCEPTION 'دوال قابلة للتنفيذ من anon (يجب أن يكون صفرًا): %', v_anon;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- التحقق اليدوي بعد التطبيق (كلها يجب أن ترجع صفر صفوف):
--
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.prokind='f'
--      AND has_function_privilege('anon', p.oid,'EXECUTE');
--
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.prokind='f'
--      AND NOT has_function_privilege('authenticated', p.oid,'EXECUTE')
--      AND p.proname NOT LIKE 'next\_%';
--
-- ROLLBACK: لا شيء يُعكس تلقائيًا — أعد تشغيل الهجرات السابقة، لكن ذلك يعيد
--           الأعطال التي أُصلحت. لا تستخدمه إلا في بيئة تطوير.
-- ============================================================================
