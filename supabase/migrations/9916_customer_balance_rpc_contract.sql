-- ============================================================================
-- 9916_customer_balance_rpc_contract.sql
--
-- يُدخل دوال أرصدة العملاء الجديدة في عقد RPC (45) في نفس الترحيل الذي
-- ينشئها — القاعدة: أي دالة تستدعيها الواجهة ولا تُضاف إلى rpc_allowlist()
-- تُرجع 401 من /rest/v1/rpc.
--
-- ويُسقط المنح عن الدوال الداخلية التي كُشفت عرضًا عند التعريف:
--   • customer_balance_lock          — أداة داخلية (تقفل صفًا).
--   • customer_balance_stamp_after_sale — نقطة داخلية للترحيل.
--   • tg_customer_ledger_sync_balance    — دالة مُشغّل.
--   • recalculate_customer_balance(uuid,text,text) — تُستدعى من الواجهة عبر
--     الغلاف بثلاث وسائط؛ تُترك ممنوحة لأن خادم PostgREST يحلّ النداء
--     بالوسائط المرسلة نفسها.
-- ============================================================================
BEGIN;

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
    'post_stock_delta',
    'post_stock_settlement',
    'post_stock_adjustment',
    'post_opening_stock',
    'receive_customer_owned_stock', 'release_customer_owned_stock',
    'create_opening_balance', 'post_opening_balance', 'reverse_opening_balance',
    'search_products',
    'item_line_type', 'item_stock_effect', 'item_effective_policy',
    'item_has_stock_history', 'resolve_unit_cost',
    'product_reference_counts', 'warehouse_reference_counts',
    'save_item_policy', 'approve_item_policy_change',
    -- ── الدفعات والشيكات والتشغيل المالي ──
    'clear_cheque', 'bounce_cheque',
    -- ── إدارة الدفعات / التشغيلات ──
    'reconcile_batches_with_inventory', 'save_product_batch',
    'get_batch_kpis', 'delete_product_batch', 'save_batch_settings',
    -- ── الذمم والمدفوعات ──
    'record_customer_payment', 'record_supplier_payment', 'get_supplier_statement',
    'adjust_loyalty', 'customer_credit_limit_allows',
    -- ── أرصدة العملاء: المصدر الوحيد هو الدفتر (9913/9914/9915) ──
    'recalculate_customer_balance',
    'recalculate_all_customer_balances',
    'customer_balance_reconciliation_report',
    -- ── أمانات المطحنة ──
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
    -- ── الترقيم ──
    'fn_format_document_number', 'fn_resolve_document_numbering',
    'fn_set_document_numbering', 'fn_document_numbering_sequence_name',
    -- ── النسخ الاحتياطي ──
    'backup_export_all', 'backup_restore_all', 'backup_schema_fingerprint',
    -- ── مساعدات الفحص ──
    'has_role', 'is_staff', 'is_platform_admin', 'is_platform_superadmin',
    'can_read_finance', 'can_read_expense_entry', 'can_author_payment_methods',
    'can_operate_milling', 'can_view_milling',
    'platform_admin_audit_self'
  ];
$$;

REVOKE ALL ON FUNCTION public.rpc_allowlist() FROM PUBLIC, anon, authenticated, service_role;

-- الأدوات الداخلية: لا تُنفَّذ من الواجهة
DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.customer_balance_lock(uuid)',
    'public.customer_balance_stamp_after_sale(uuid)',
    'public.tg_customer_ledger_sync_balance()'
  ]
  LOOP
    IF to_regprocedure(v_sig) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
    END IF;
  END LOOP;
END $$;

-- تحقق: كل دالة في القائمة موجودة فعلًا في هذه القاعدة
DO $$
DECLARE
  v_missed text;
BEGIN
  SELECT string_agg(a, ', ' ORDER BY a) INTO v_missed
  FROM unnest(public.rpc_allowlist()) AS a
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = a
  );
  IF v_missed IS NOT NULL THEN
    RAISE WARNING 'أسماء في عقد RPC لا تطابق أي دالة: %', v_missed;
  END IF;
END $$;

COMMIT;
