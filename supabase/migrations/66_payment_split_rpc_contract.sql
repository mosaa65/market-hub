-- Add the payment split entry points to the existing RPC contract.
-- Keep the established allow-list intact and append only the new public RPCs.
BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_allowlist()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'create_sale', 'create_sales_return', 'create_purchase', 'create_purchase_return',
    'create_stock_transfer', 'post_sales_invoice', 'post_purchase_invoice',
    'post_stock_delta', 'post_stock_settlement', 'post_stock_adjustment', 'post_opening_stock',
    'receive_customer_owned_stock', 'release_customer_owned_stock', 'create_opening_balance',
    'post_opening_balance', 'reverse_opening_balance', 'search_products', 'item_line_type',
    'item_stock_effect', 'item_effective_policy', 'item_has_stock_history', 'resolve_unit_cost',
    'product_reference_counts', 'warehouse_reference_counts', 'save_item_policy',
    'approve_item_policy_change', 'clear_cheque', 'bounce_cheque',
    'reconcile_batches_with_inventory', 'save_product_batch', 'get_batch_kpis',
    'delete_product_batch', 'save_batch_settings', 'record_customer_payment',
    'record_customer_payment_splits', 'record_supplier_payment', 'get_supplier_statement',
    'adjust_loyalty', 'customer_credit_limit_allows', 'custody_intake', 'custody_milling',
    'custody_deliver', 'custody_adjust', 'custody_balances', 'custody_link_invoice',
    'create_milling_service_document', 'create_milling_service_document_multi',
    'smart_manufacture', 'consume_internal_supplies', 'milling_custody_intake',
    'milling_custody_issue_milling', 'milling_custody_deliver', 'milling_custody_adjust',
    'create_journal_entry', 'reverse_journal_entry', 'get_chart_of_accounts_tree',
    'activate_fixed_asset', 'dispose_fixed_asset', 'run_depreciation',
    'run_batch_depreciation', 'run_contract_amortization', 'run_batch_amortization',
    'close_fiscal_year', 'open_fiscal_year', 'set_period_status', 'generate_tax_declaration',
    'settle_tax_period', 'pay_tax_settlement', 'create_expense', 'update_expense',
    'submit_expense', 'decide_expense', 'post_expense', 'close_expense', 'cancel_expense',
    'reverse_expense', 'record_expense_payment', 'reverse_expense_payment', 'list_expenses',
    'expense_detail', 'expense_summary', 'expense_report', 'expense_lookups',
    'save_expense_category', 'delete_expense_category', 'create_tenant_payment_method',
    'update_payment_method_identity', 'remove_tenant_payment_method', 'is_system_customer',
    'is_system_supplier', 'fn_format_document_number', 'fn_resolve_document_numbering',
    'fn_set_document_numbering', 'fn_document_numbering_sequence_name', 'backup_export_all',
    'backup_restore_all', 'backup_schema_fingerprint', 'has_role', 'is_staff',
    'is_platform_admin', 'is_platform_superadmin', 'can_read_finance',
    'can_read_expense_entry', 'can_author_payment_methods', 'can_operate_milling',
    'can_view_milling', 'platform_admin_audit_self'
  ];
$$;

REVOKE ALL ON FUNCTION public.rpc_allowlist() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_customer_payment_splits(uuid, uuid, numeric, date, text, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.rpc_allowlist() IS
  'عقد RPC الواجهة، متضمّنًا نقطتي الدفع المجزأ للتحصيل والطحن.';

COMMIT;

-- Rollback: restore rpc_allowlist() from migration 45 and revoke execution on
-- record_customer_payment_splits(uuid, uuid, numeric, date, text, jsonb).
