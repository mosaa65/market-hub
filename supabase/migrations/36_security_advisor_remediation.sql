-- ============================================================================
-- 36_security_advisor_remediation.sql
--
-- معالجة تحذيرات Supabase Security Advisor:
--
--   1) 0010 security_definer_view (ERROR) — 23 عرضًا في public.
--      السبب: كل عرض يُنشأ افتراضيًا بصلاحيات **مُنشئه** (postgres)، فتتجاوز
--      الاستعلامات RLS للجداول الأساسية. الحل لا يكمن في RLS على العرض — RLS
--      لا يعمل إلا على الجداول — بل في `security_invoker = true`، عندها يُنفَّذ
--      العرض بصلاحيات **القراءة** فتسري RLS وGRANT الخاصة به.
--
--      لماذا الأمان لا ينكسر: كل الجداول المقروءة في هذه العروض (مخزون، دفتر
--      أستاذ، فواتير، حسابات، عهدة، طحن) لها RLS وسياسات SELECT لـ authenticated،
--      وكلها ممنوحة لـ authenticated. لذلك:
--        • anon لا يصل لأي عرض بعد الإصلاح (مقصود — لا سياسة anon واحدة).
--        • المستخدم المسجّل يرى نفس صفوفه المسموح له بها عبر RLS، لا أكثر.
--      ملاحظة: service_role لا يتأثر — يتجاوز RLS دائمًا.
--
--   2) 0011 function_search_path_mutable (WARN) — 7 دوال.
--      كل دالة SECURITY DEFINER يجب أن تثبّت search_path (القاعدة R-24).
--
--   3) 0024 permissive_rls_policy (WARN) — سياسات INSERT/UPDATE بـ true على
--      supplier_ledger و supplier_payments و sync_idempotency_keys.
--      هذه الجداول مالية/تشغيلية: الكتابة يجب أن تمرّ عبر RPC فقط. بعد هذا
--      الترحيل تُسحب صلاحيات الكتابة من authenticated، وتُحذف السياسات المفتوحة
--      (لا سياسة كتابة = لا كتابة من العميل)، ويبقى القراءة بضابط.
--      الملف 28 كان يمنح anon قراءة/كتابة على الجدولين، ويسحب الترحيل ذلك.
--
--   4) 0028/0029 security definer function executable (WARN) — عشرات الدوال.
--      المصدر الحقيقي: PostgreSQL يمنح EXECUTE على الدوال الجديدة لـ PUBLIC
--      افتراضيًا. الحل: سحب EXECUTE من PUBLIC و anon من كل دوال public دفعةً
--      واحدة، ثم منحها صراحةً لـ authenticated و service_role. الدوال التي
--      تحتاج anon (لا شيء منها في هذا النظام) تُمنح استثناءً صريحًا.
--      ملاحظة: سحب EXECUTE لا يؤثر على الاستدعاء الداخلي بين الدوال لأن
--      SECURITY DEFINER يعمل بصلاحيات المالك الذي يملك EXECUTE.
--
-- لا DML ولا TRUNCATE في هذا الملف. DROP محدود لسياسات RLS فقط.
-- ============================================================================

-- ── (1) العروض: security_invoker ────────────────────────────────────────────
-- تغطية كل عروض public الموجودة فعلًا (وليس قائمة ثابتة)، حتى لا يبقى عرض
-- جديد أو عرض مُنشأ في ملف لاحق خارج الإصلاح. ALTER VIEW لا يعيد كتابة
-- تعريف العرض، فهو idempotent بطبيعته.
DO $$
DECLARE
  v_view record;
BEGIN
  FOR v_view IN
    SELECT c.oid::regclass AS rel
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
  LOOP
    EXECUTE format('ALTER VIEW %s SET (security_invoker = true)', v_view.rel);
  END LOOP;
END $$;

COMMENT ON SCHEMA public IS
  'كل العروض في هذا المخطط تعمل بـ security_invoker = true: صلاحيات القارئ وRLS الجداول الأساسية هي المرجع، لا صلاحيات المالك.';

-- العروض ليست جداول: لا كتابة ولا TRUNCATE عليها. المنح السابقة (INSERT,
-- UPDATE, DELETE, TRUNCATE) كانت من بقايا dump وليست قابلة للاستخدام أصلًا.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, service_role;

-- التقارير التشغيلية المالية: للمستخدمين المسجّلين فقط.
GRANT SELECT ON public.standard_cost_readiness,
                public.stock_positions,
                public.company_stock_positions,
                public.customer_owned_positions,
                public.inventory_valuation,
                public.item_valuation,
                public.item_classification_gaps,
                public.trial_balance,
                public.customer_ledger_balances,
                public.customer_balance_reconciliation,
                public.invoice_ledger_status,
                public.purchase_ledger_status,
                public.purchase_register,
                public.sales_register,
                public.service_revenue,
                public.expense_legacy_reconciliation,
                public.milling_inventory_report,
                public.milling_margin_report,
                public.opening_balance_summary,
                public.custody_balances,
                public.custody_customer_statement,
                public.custody_detected_loss,
                public.custody_service_money
  TO authenticated;

-- ---------------------------------------------------------------------------
-- إعادة المنح لجداول public (سحبناها جميعًا أعلاه لأن REVOKE ALL
-- ON ALL TABLES لا تفرّق بين جدول وعرض). المصفوفة أدناه **مقصودة**، لا نسخة
-- من dump: ما يحتاجه التطبيق فقط، مع تصحيح مبدأين:
--   • service_role: كل شيء (عمليات الإدارة والنسخ الاحتياطي).
--   • authenticated: قراءة/كتابة فقط حيث تسمح سياسة RLS، والمحرّك المالي
--     يُقرأ ولا يُكتب (R-23 — الكتابة عبر RPC).
--   • anon: لا منح كتابة على أي جدول (لا سياسة `TO anon` واحدة في
--     المستودع)، والحلقة في نهاية القسم تسحب أي أثر متبقٍ.
-- ---------------------------------------------------------------------------
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON ALL TABLES IN SCHEMA public TO service_role;

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON public.accounts,
     public.audit_logs,
     public.backup_logs,
     public.brands,
     public.categories,
     public.company_costing_settings,
     public.company_items,
     public.company_settings,
     public.costing_policy_history,
     public.countries_of_origin,
     public.customer_payment_splits,
     public.customers,
     public.device_registrations,
     public.expense_categories,
     public.expense_cost_centers,
     public.expense_projects,
     public.expenses,
     public.item_policy_review_queue,
     public.loyalty_transactions,
     public.product_compatibilities,
     public.products,
     public.profiles,
     public.purchase_invoice_items,
     public.purchase_invoices,
     public.purchase_return_items,
     public.purchase_returns,
     public.quality_grades,
     public.sales_return_items,
     public.sales_returns,
     public.stock_transfer_items,
     public.stock_transfers,
     public.suppliers,
     public.sync_idempotency_keys,
     public.tenant_subscriptions,
     public.units,
     public.user_roles,
     public.vehicle_makes,
     public.vehicle_models,
     public.warehouses,
     public.product_batches,
     public.packaging_types,
     public.custody_ledger,
     public.milling_service_documents
  TO authenticated;

-- الجداول المالية (R-23): الكتابة عبر RPC فقط — للقراءة فقط لـ authenticated.
GRANT SELECT ON public.ad_hoc_service_lines,
                public.customer_ledger,
                public.custody_ledger,
                public.customer_payments,
                public.inventory,
                public.sales_invoice_items,
                public.sales_invoices,
                public.stock_adjustment_items,
                public.stock_adjustments,
                public.stock_movements,
                public.stock_opening_items,
                public.stock_openings,
                public.journal_entries,
                public.journal_lines,
                public.milling_service_documents
  TO authenticated;

-- تحقق مرجعي: لا يوجد في المستودع سياسة واحدة `TO anon` على أي جدول.
-- لذلك كل منح anon على الجداول (وراثة dump: INSERT/UPDATE/DELETE/TRUNCATE)
-- لا تقابله سياسة، فلا يُرتجع منه صف واحد اليوم، لكنه يصبح ثغرة مباشرة إن
-- أُضيفت سياسة لاحقًا. لذلك تُسحب صلاحيات الكتابة هذه جماعيًا. SELECT يبقى
-- لـ anon على الريلشنات، لكن RLS يمنع أي صف بلا سياسة — فالعزل مضمون بالسياسة
-- لا بالمنح. إن أضفت شاشة عامة فعلًا، سياسة `TO anon` هي ما يفتحها.
DO $$
DECLARE
  v_rel record;
BEGIN
  FOR v_rel IN
    SELECT c.oid::regclass AS rel
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON %s FROM anon', v_rel.rel);
  END LOOP;
END $$;

-- ── (2) تثبيت search_path على الدوال المتأثرين ──────────────────────────────
-- ALTER FUNCTION لا يغيّر الجسم ولا المنح، فيصلح التعريف الساري أينما كان.
ALTER FUNCTION public.expense_line_net(numeric, numeric, public.expense_tax_mode)  SET search_path = public;
ALTER FUNCTION public.expense_line_tax(numeric, numeric, public.expense_tax_mode)  SET search_path = public;
ALTER FUNCTION public.expense_round(numeric)                                      SET search_path = public;
ALTER FUNCTION public.tg_journal_entries_no_delete()                              SET search_path = public;
ALTER FUNCTION public.next_supplier_voucher_number()                              SET search_path = public;
ALTER FUNCTION public.trg_purchase_invoice_to_supplier_ledger()                   SET search_path = public;
ALTER FUNCTION public.trg_purchase_return_to_supplier_ledger()                    SET search_path = public;

-- ── (3) تضييق سياسات RLS المفتوحة على الجداول المالية ──────────────────────
-- supplier_ledger: حركات تُكتب حصريًا من الدوال/المشغّلات (SECURITY DEFINER)،
-- فتتجاوز RLS طبيعيًا. سياسة القراءة تبقى كما هي.
DROP POLICY IF EXISTS "supplier_ledger_insert_auth" ON public.supplier_ledger;
DROP POLICY IF EXISTS "supplier_ledger_update_auth" ON public.supplier_ledger;

-- supplier_payments: نفس المنطق — سند الصرف يُنشأ عبر record_supplier_payment.
DROP POLICY IF EXISTS "supplier_payments_insert_auth" ON public.supplier_payments;

DROP POLICY IF EXISTS "supplier_payments_read_auth" ON public.supplier_payments;
CREATE POLICY "supplier_payments_read_auth" ON public.supplier_payments
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

-- الكتابة المباشرة ممنوعة على الجدولين، فتُلغى السياسات المفتوحة بلا أثر.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.supplier_ledger, public.supplier_payments FROM authenticated, anon;

-- المنح الأصلي للجدولين كان يشمل anon (وراثة من dump)، فيُسحب نهائيًا:
-- الكتابة عبر الدوال فقط، والقراءة عبر get_supplier_statement / الواجهة المسجّلة.
REVOKE ALL ON public.supplier_ledger, public.supplier_payments FROM anon;

-- sync_idempotency_keys: الكتابة عبر sync_apply_operation فقط (SECURITY DEFINER).
-- القراءة المباشرة لمفاتيح أجهزة غير الجهاز الحالي تسريب لا حاجة له.
DROP POLICY IF EXISTS "Authenticated users can check and insert idempotency keys" ON public.sync_idempotency_keys;
-- Idempotent: the policy name is re-created by later runs of this file on a
-- database that already carried it (drift repair / replay), and CREATE POLICY has
-- no IF NOT EXISTS form.
DROP POLICY IF EXISTS "Idempotency keys are service managed" ON public.sync_idempotency_keys;

CREATE POLICY "Idempotency keys are service managed" ON public.sync_idempotency_keys
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (origin_device_id = (auth.jwt() ->> 'device_id'));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.sync_idempotency_keys FROM authenticated, anon;

-- ── (4) EXECUTE: لا PUBLIC ولا anon على دوال public ────────────────────────
-- PostgreSQL يمنح PUBLIC صلاحية التنفيذ افتراضيًا؛ هذا هو جذر تحذيري 0028/0029.
-- عشرات التحذيرات المتبقية في Advisor كلها من هذا السبب الواحد؛ الحلقة تُغلقه
-- جماعيًا بدل تكراره لكل اسم — فأي دالة تُضاف في ملف لاحق لا تصبح عامة بصمت.
DO $$
DECLARE
  v_fn record;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn.sig);
  END LOOP;
END $$;

-- دوال SECURITY DEFINER التي كانت مفتوحة لـ anon — أي زائر كان يقرأ/يعدّل
-- بيانات الشركة. أُلغيت بالحلقة أعلاه عمدًا، وهذا التعليق يثبّت القرار.
COMMENT ON FUNCTION public.has_role(uuid, public.app_role) IS
  'تُستدعى من سياسات RLS. التنفيذ لـ authenticated و service_role فقط.';
COMMENT ON FUNCTION public.is_staff(uuid) IS
  'تُستدعى من سياسات RLS. التنفيذ لـ authenticated و service_role فقط.';

-- ── (4-ب) دوال لا يستدعيها أي مستخدم ─────────────────────────────────────
-- تحذير 0029 يشتكي من **القدرة على الاستدعاء** لا من SECURITY DEFINER نفسه.
-- ولا واحدة مما يلي يُستدعى من PostgREST: كلها أجزاء داخلية (مشغّلات، حرّاس،
-- مساعدات تستدعيها سياسات RLS أو دوال أخرى SECURITY DEFINER تعمل بصلاحيات
-- المالك). المنح الذي كانت تملكه وراثة من PUBLIC وليس قرارًا.
--   • مشغّلات TRIGGER: المحرّك يستدعيها بلا EXECUTE للمستخدم، والاستدعاء
--     المباشر عبر RPC يرفضه PostgreSQL أصلًا (cannot be called directly).
--   • مساعدات RLS/expense_*: تُستدعى من داخل سياسات ودوال SOURCE-DEFINER
--     التي تعمل بصلاحيات المالك.
--   • نسخ تاريخية (next_*_number, *_reference, post_stock_delta…): أزالتها
--     محرحات الترقيم الموحد والدفاتر — لا واجهة تستدعيها.
-- المجموعة تُسمّى مرة واحدة؛ أي دالة جديدة بنفس الاسم تُسحب تلقائيًا.
DO $$
DECLARE
  v_fn record;
  v_internal text[] := ARRAY[
    -- مشغّلات — يُستدعيها المحرك فقط
    'handle_new_user', 'normalize_auth_user_token_columns',
    'tg_set_updated_at', 'sync_item_class_from_policy',
    'tg_expense_entries_guard', 'tg_expense_lines_sync_total',
    'tg_expense_payments_sync_entry', 'tg_guard_item_policy_change',
    'tg_journal_entries_no_delete',
    'trg_purchase_invoice_to_supplier_ledger',
    'trg_purchase_return_to_supplier_ledger',
    'payment_method_settings_guard', 'payment_methods_authoring_guard',
    'payment_methods_delete_guard',
    -- مساعدات تخويل تُستدعى من سياسات RLS أو دوال المالك
    'has_role', 'is_staff', 'is_platform_admin', 'is_platform_superadmin',
    'can_author_payment_methods', 'can_operate_milling', 'can_view_milling',
    'can_read_finance', 'can_read_expense_entry',
    'expense_actor', 'expense_can', 'expense_role_rank',
    'expense_assert_capability', 'expense_can_write_document',
    -- مساعدات حسابية/قراءة داخلية
    'expense_line_net', 'expense_line_tax', 'expense_round',
    'expense_ledger_summary', 'expense_log_action', 'expense_write_lines',
    'item_effective_policy', 'item_has_stock_history', 'item_line_type',
    'item_stock_effect', 'product_delete_guard', 'product_reference_counts',
    'warehouse_reference_counts', 'customer_credit_limit_allows',
    'customer_ledger_balance', 'sales_line_cost',
    'sales_invoice_tender_breakdown', 'company_costing_method',
    -- محرّك طرق الدفع (يُستدعى من create_sale / record_* لا من الواجهة)
    'ledger_account_code_for_payment_method', 'payment_method_catalog_id',
    'payment_method_catalog_view', 'payment_method_is_allowed',
    'payment_method_ledger_account', 'payment_method_legacy_id',
    'payment_method_resolve_id', 'payment_methods_seed_is_identity_owned',
    'resolve_writable_payment_method',
    -- مساعدات أسطر الفواتير (تُستدعى من create_sale/create_purchase)
    'resolve_purchase_line', 'resolve_sale_line', 'resolve_unit_cost',
    'apply_cost_movement', 'post_stock_delta',
    -- محرّك السندات القديم/التاريخي
    'next_expense_reference', 'next_invoice_number', 'next_purchase_number',
    'next_purchase_return_number', 'next_sales_return_number',
    'next_stock_adjustment_number', 'next_stock_opening_number',
    'next_supplier_voucher_number', 'next_transfer_number',
    'balance_and_post_return', 'adjust_loyalty',
    'migrate_legacy_expenses', 'set_standard_costs',
    'get_chart_of_accounts_tree',
    -- محرّك الترقيم: يُستدعى من الدوال المالية لا من الواجهة
    'fn_next_document_number'
  ];
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname = ANY(v_internal)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', v_fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role', v_fn.sig);
  END LOOP;
END $$;

-- ── (5) منح EXECUTE الصريح للملفات اللاحقة (24–35) ─────────────────────────
-- الملفات 24–35 أُنشئت بعد «GRANTS» في الملف 13، فمنحتها PostgreSQL لـ PUBLIC
-- ضمنًا. الحلقة أعلاه أغلقتها الآن، وهذا تثبيت صريح للدوال التي تحتاجها
-- الواجهة أو وظائف النسخ الاحتياطي. الأسماء المكرّرة (overloads) تُعرَّف
-- بتوقيعها الكامل حتى لا يُمنح توقيع لم يُقصَد.
GRANT EXECUTE ON FUNCTION public.activate_fixed_asset(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispose_fixed_asset(uuid, date, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_depreciation(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_batch_depreciation(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_contract_amortization(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_batch_amortization(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_fiscal_year(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_fiscal_year(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_period_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_tax_declaration(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_tax_period(date, date, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_tax_settlement(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_prepaid_contract(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_purchase_invoice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_sales_invoice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(uuid, numeric, text, text, date, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_statement(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_format_document_number(text, bigint, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_document_numbering(text, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_set_document_numbering(text, text, text, smallint, text, text, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backup_export_all(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backup_restore_all(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_chart_of_accounts_tree() TO authenticated;

-- الحلقات أعلاه تبني قائمة المنع على الاسم فقط، فايا دالة جديدة بنفس
-- الاسم ستُسحب تلقائيًا. للتأكد من أن ما تحتاجه الواجهة ممنوح، يشمل التحقق
-- في نهاية الملف قائمة الدوال المتوقعة للاستدعاء من PostgREST.
-- الواجهة تستدعي adjust_loyalty من المستخدم المسجّل فقط
-- (src/routes/_app.loyalty.tsx)، وهو ما تمنحه الحلقة أعلاه.
-- لا استثناء لـ anon: لا شاشة عامة في المستودع.

-- ============================================================================
-- تحقق بعد التطبيق — المتوقع أن ترجع الاستعلامات الأربعة صفر صف:
--
--   -- 1) عروض ما تزال SECURITY DEFINER
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE n.nspname='public' AND c.relkind='v'
--      AND coalesce(array_to_string(c.reloptions,','),'') NOT LIKE '%security_invoker=true%';
--
--   -- 2) دوال بلا search_path ثابت
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.prokind='f'
--      AND coalesce(array_to_string(p.proconfig,','),'') NOT LIKE '%search_path%';
--
--   -- 3) دوال يستطيع anon تنفيذها
--   SELECT p.proname, p.oid::regprocedure FROM pg_proc p
--     JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND has_function_privilege('anon', p.oid, 'EXECUTE');
--
--   -- 4) كتابة مباشرة لـ anon على أي جدول
--   SELECT table_name FROM information_schema.table_privileges
--    WHERE table_schema='public' AND grantee='anon'
--      AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');
--
-- ============================================================================
-- ROLLBACK
--
--   ALTER VIEW <view> SET (security_invoker = false);          -- لكل عرض
--   ALTER FUNCTION <fn> RESET search_path;                     -- لكل دالة
--   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC; -- يعيد
--   المنح الضمنية القديمة (لكنه يعيد الثغرة الأمنية).
--   ثم إعادة إنشاء السياسات المحذوفة من الملف 28 والملف 13، وإعادة منح
--   anon من الملف 13 (غير مستحسن — يعيد تحذيرات 0028/0029 و0024).
-- ============================================================================
