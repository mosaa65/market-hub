-- ============================================================================
-- 45_rpc_allowlist_and_exposure_contract.sql
--
-- إغلاق تحذيرات Security Advisor 0028/0029 في مكانها الصحيح: مصدرها هو **منح
-- EXECUTE** على دوال public، لا تعريف الدوال. لهذا لا يُغيّر هذا الملف أي جسم
-- دالة، ولا يمس أي جدول أو أي صف، ولا بيانات افتراضية. يغيّر من يُنفّذ فقط.
--
-- لماذا الآن؟
--   36 و38 و43 منحت authenticated تنفيذ كل الدوال (بقائمة استثناء قصيرة أو
--   قائمة سماح لا تغطي ما أنشأته الهجرات 14/16/20–31)، فبقيت عشرات الدوال
--   SECURITY DEFINER مكشوفة للواجهة عبر /rest/v1/rpc — بعضها:
--     • ledger_account_code_for_payment_method — وهذا الأخطر: كانت **أيضًا**
--       قابلة للتنفيذ من anon (تحذير 0028 الوحيد).
--     • apply_cost_movement / محرّكات الترقيم — أدوات داخلية تكتب الدفاتر.
--     • has_role / is_staff / is_platform_superadmin — تقبل user_id عشوائيًا،
--       فيمكن لأي مستخدم مسجّل استنطاق صلاحيات أي عضو في المتجر.
--
-- القاعدة هنا — عكس الافتراضي:
--   • DEFAULT: لا EXECUTE لـ authenticated إلا ما في rpc_allowlist() أدناه.
--   • دوال تحتاجها سياسات RLS تُمنح لـ authenticated (policy_runtime_functions)،
--     لأن السياسة تُنفّذ بصلاحيات المستدعي؛ سحب EXECUTE يحوّل جدولًا سليمًا إلى
--     «لا صفوف» بصمت — أسوأ عطل لأنه يُشبه قاعدة فارغة.
--   • أي RPC واجهة جديد يُضاف إلى القائمة في نفس الهجرة التي ينشئه.
--   • لا شيء في public يُمنح لـ anon — لا RPC ولا دالة سياسة.
--
-- ⚠️ لماذا تُبنى الأسماء بـ quote_ident لا format('%s') ؟
--   بلا quote_ident كان format ينتج منحًا على دالة باسم مقصوص:
--     GRANT EXECUTE ON FUNCTION public."has_role(uuid,app_role)" ...
-- هذا الملف يتحقق في النهاية أن كل اسم في القائمة إما وُجد أو طُبع باسمه كتحذير.
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- (1) قائمة السماح: كل ما تستدعيه الواجهة عبر supabase.rpc()
-- ════════════════════════════════════════════════════════════════════════════
-- المجموعة مشتقة من src/ (كل نداء .rpc في الواجهة) + دوال الفحص التي تحتاجها
-- شاشات الصلاحيات. ما ليس هنا ليس RPC.
CREATE OR REPLACE FUNCTION public.rpc_allowlist()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    -- ── البيع والشراء والمخزون ──
    'create_sale', 'create_sales_return', 'create_purchase',
    'create_purchase_return', 'create_stock_transfer',
    'post_sales_invoice', 'post_purchase_invoice',
    'post_stock_delta',                    -- شاشتا التوريد والتسوية
    'post_stock_settlement',               -- معالج التسوية الجردية (46)
    'post_stock_adjustment',               -- تسويات المخزون مع قيود الأستاذ
    'post_opening_stock',                  -- رصيد افتتاحي للمخزون
    'receive_customer_owned_stock', 'release_customer_owned_stock',
    'create_opening_balance', 'post_opening_balance', 'reverse_opening_balance',
    'search_products',
    'item_line_type', 'item_stock_effect', 'item_effective_policy',
    'item_has_stock_history', 'resolve_unit_cost',
    'product_reference_counts', 'warehouse_reference_counts',
    'save_item_policy', 'approve_item_policy_change',
    -- ── الدفعات والشيكات والتشغيل المالي (فريق العمل) ──
    'clear_cheque', 'bounce_cheque',
    -- ── إدارة الدفعات / التشغيلات (فريق العمل - 31) ──
    'reconcile_batches_with_inventory', 'save_product_batch',
    'get_batch_kpis', 'delete_product_batch', 'save_batch_settings',
    -- ── الذمم والمدفوعات ──
    'record_customer_payment', 'record_supplier_payment', 'get_supplier_statement',
    'adjust_loyalty', 'customer_credit_limit_allows',
    -- ── أمانات المطحنة (واجهة الكاونتر) ──
    'custody_intake', 'custody_milling', 'custody_deliver', 'custody_adjust',
    'custody_balances', 'custody_link_invoice',
    'create_milling_service_document', 'smart_manufacture', 'consume_internal_supplies',
    'milling_custody_intake', 'milling_custody_issue_milling', 'milling_custody_deliver',
    'milling_custody_adjust',
    -- ── المحاسبة والأصول والضرائب ──
    'create_journal_entry', 'reverse_journal_entry', 'get_chart_of_accounts_tree',
    'activate_fixed_asset', 'dispose_fixed_asset',
    'run_depreciation', 'run_batch_depreciation',
    'run_contract_amortization', 'run_batch_amortization',
    'close_fiscal_year', 'open_fiscal_year', 'set_period_status',
    'generate_tax_declaration', 'settle_tax_period', 'pay_tax_settlement',
    -- ── المصروفات ──
    'create_expense', 'update_expense', 'submit_expense', 'decide_expense',
    'post_expense', 'close_expense', 'cancel_expense', 'reverse_expense',
    'record_expense_payment', 'reverse_expense_payment',
    'list_expenses', 'expense_detail', 'expense_summary', 'expense_report',
    'expense_lookups', 'save_expense_category', 'delete_expense_category',
    -- ── طرق الدفع والأطراف ──
    'create_tenant_payment_method', 'update_payment_method_identity',
    'remove_tenant_payment_method',
    'is_system_customer', 'is_system_supplier',
    -- ── الترقيم: قراءة الصيغة فقط (التخصيص يمر عبر fn_set_document_numbering) ──
    'fn_format_document_number', 'fn_resolve_document_numbering',
    'fn_set_document_numbering', 'fn_document_numbering_sequence_name',
    -- ── النسخ الاحتياطي ──
    'backup_export_all', 'backup_restore_all', 'backup_schema_fingerprint',
    -- ── مساعدات الفحص التي تستدعيها شاشات الصلاحيات والمنصة ──
    'has_role', 'is_staff', 'is_platform_admin', 'is_platform_superadmin',
    'can_read_finance', 'can_read_expense_entry', 'can_author_payment_methods',
    'can_operate_milling', 'can_view_milling',
    'platform_admin_audit_self'
  ];
$$;

COMMENT ON FUNCTION public.rpc_allowlist() IS
  'عقد RPC الواجهة: كل دالة هنا ممنوحة لـ authenticated، وكل ما ليس هنا لا يُنفَّذ من /rest/v1/rpc. لا شيء في public ممنوح لـ anon.';

REVOKE ALL ON FUNCTION public.rpc_allowlist() FROM PUBLIC, anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) دوال السياسات (RLS): تبقى ممنوحة — وإلا صارت كل سياسة «لا صفوف»
-- ════════════════════════════════════════════════════════════════════════════
-- هذه الدوال تُستدعى داخل USING/WITH CHECK بصلاحيات المستدعي (authenticated أو
-- anon على المسارات العامة). أمنها من الدالة نفسها: تتحقق من auth.uid()، ومعظمها
-- SECURITY DEFINER لقراءة user_roles رغم RLS. سحب EXECUTE يعطّل السياسة بصمت.
--
-- الاسم غير الموجود هنا ليس خطأ: تُطابق الأسماء الموجودة فعلًا فقط، وهذه هي
-- دوال التقييم التي تُشترط وجودها. بعضها (has_any_role / can_read_milling /
-- expense_can_read) قد لا يوجد في نسخة معينة، فلا يُعبأ بمنحة.
-- ⚠️ قائمة rpc_allowlist() عهد كتابة/تعريف فقط: لا تمنح أحدًا حق expect
--    (لا SELECT). لا تُضف إلى هذه المجموعة إلا دالة SECURITY INVOKER تحتاج
--    جدولًا داخليًا لا تصل إليه الواجهة. كل دوال الكتابة هنا SECURITY DEFINER
--    تتحقق من الاستدعاء بنفسها.
CREATE OR REPLACE FUNCTION public.policy_runtime_functions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'is_staff', 'has_role', 'has_any_role',
    'is_platform_admin', 'is_platform_superadmin',
    'can_read_finance', 'can_read_expense_entry', 'can_read_milling',
    'can_view_milling', 'can_operate_milling', 'can_author_payment_methods',
    'expense_role_rank', 'expense_actor',
    'expense_assert_capability', 'expense_can_write_document',
    'is_system_customer', 'is_system_supplier'
  ];
$$;

COMMENT ON FUNCTION public.policy_runtime_functions() IS
  'دوال تُستدعى داخل سياسات RLS أو مشغّلاتها، فتجب أن تبقى قابلة للتنفيذ من مستخدم السياسة. لا تُعاد تسمية دون مراجعة كل سياسة.';

REVOKE ALL ON FUNCTION public.policy_runtime_functions() FROM PUBLIC, anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) العقد: سحب شامل ثم منح صريح — بأسماء صحيحة (quote_ident)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ عمليات DDL (GRANT/REVOKE/ALTER) لا تُنفَّذ داخل دالة SQL (STABLE/INMUTABLE):
--    لهذا يبقى المنطق في DO (PL/pgSQL) كما هو أعلاه — القائمتان تُقرآن منه
--    فقط، ولا تُنفَّذ أي ALTER داخل تعريفهما.
DO $$
DECLARE
  v_fn record;
  v_allowed text[] := public.rpc_allowlist();
  v_policy  text[] := public.policy_runtime_functions();
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS sig,
           p.proname,
           n.nspname,
           pg_get_function_identity_arguments(p.oid) AS argtypes
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    -- 3-أ) لا شيء لأي أحد: يمنع تراكم صلاحيات PUBLIC الافتراضية.
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated, service_role',
                   v_fn.nspname, v_fn.proname, v_fn.argtypes);

    -- 3-ب) خدمة الخلفية: كل الدوال (CI، المهام، صيانة).
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
                   v_fn.nspname, v_fn.proname, v_fn.argtypes);

    -- 3-ج) الدوال الداخلية: service_role فقط — لا تمر، فلا شيء بعد هذا السطر.
    IF v_fn.proname IN ('apply_cost_movement', 'fn_next_document_number',
                        'next_journal_number', 'next_invoice_number') THEN
      CONTINUE;
    END IF;

    -- 3-د) RPC الواجهة أو دالة سياسة → authenticated.
    IF v_fn.proname = ANY(v_allowed) OR v_fn.proname = ANY(v_policy) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated',
                     v_fn.nspname, v_fn.proname, v_fn.argtypes);
    END IF;

    -- 3-هـ) ⚠️ لا منح anon هنا إطلاقًا. التحذير 0028 الوحيد كان دالة
    --      SECURITY DEFINER ممنوحة لـ anon، وهو بالضبط ما يغلقه هذا السطر
    --      بإغفاله: السياسات التي تعمل تحت anon تستخدم سياسات TO anon
    --      وتقارن auth.uid()، لا تنادي دوال مساعدة.
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) تحقق: لا SECURITY DEFINER مكشوف لـ anon، ولا اسم مفقود في القائمة
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_leak   text;
  v_missed text;
BEGIN
  -- 4-أ) تحذير 0028 الوحيد كان ledger_account_code_for_payment_method؛ يجب
  --      ألا يبقى أي SECURITY DEFINER قابلًا للتنفيذ من anon.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_leak
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND p.prosecdef
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER مكشوف لـ anon بعد 45: %', v_leak;
  END IF;

  -- 4-ب) كل اسم في قائمة السماح يجب أن يطابق دالة واحدة على الأقل. اسم لا
  --      يطابق شيئًا = RPC مكسور في الواجهة (وهذا ما كشفه فحص quote_ident).
  --      النقص لا يوقف النشر (قد يكون RPC لم يُنشأ في هذا الفرع بعد) لكنه
  --      يُطبع تحذيرًا واضحًا يُرى في ناتج db push، فلا يمر صامتًا.
  SELECT string_agg(a, ', ' ORDER BY a) INTO v_missed
  FROM unnest(public.rpc_allowlist()) AS a
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = a
  );

  IF v_missed IS NOT NULL THEN
    RAISE WARNING 'أسماء في عقد RPC لا تطابق أي دالة في هذه القاعدة: %', v_missed;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- التحقق بعد التطبيق:
--
--   -- صفر: لا دالة SECURITY DEFINER قابلة لتنفيذ anon
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
--      AND has_function_privilege('anon', p.oid, 'EXECUTE');
--
--   -- عقد الواجهة كما يُنفَّذ فعليًا
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prokind = 'f'
--      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
--    ORDER BY 1;
--
--   -- تحذيرات 0029 المتبقية في Advisor يجب أن تكون دوال سياسة أو RPC متعمّد،
--   -- وكلها تتحقق من auth.uid() ودور المستدعي في أول جسمها.
--
-- ROLLBACK: لا شيء — هذا الملف يغيّر المنح فقط. للإرجاع: أعد تطبيق 43.
-- ============================================================================
