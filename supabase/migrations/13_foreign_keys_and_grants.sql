-- ============================================================================
-- 14_foreign_keys_and_grants.sql
--
-- الصلاحيات (GRANT/REVOKE) والتحقق النهائي.
--
-- مُستخرج من الحالة النهائية الحقيقية لقاعدة البيانات، لا من تاريخ الملفات.
-- لا يحتوي أي بيانات أعمال أو تجارية. راجع supabase/MIGRATIONS_RULES.md
-- ============================================================================

-- ── FOREIGN KEYS ───────────────────────────────────────────────────────
-- Every reference, added after all tables exist. See the note in the
-- domain files: the schema has mutual references across modules, so no
-- table order lets all of these resolve in one pass.

ALTER TABLE public.accounts ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES accounts(id) ON DELETE RESTRICT;
ALTER TABLE public.ad_hoc_service_lines ADD CONSTRAINT "ad_hoc_service_lines_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.ad_hoc_service_lines ADD CONSTRAINT "ad_hoc_service_lines_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE;
ALTER TABLE public.ad_hoc_service_lines ADD CONSTRAINT "ad_hoc_service_lines_invoice_item_id_fkey" FOREIGN KEY (invoice_item_id) REFERENCES sales_invoice_items(id) ON DELETE SET NULL;
ALTER TABLE public.audit_logs ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id);
ALTER TABLE public.backup_logs ADD CONSTRAINT "backup_logs_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.categories ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE public.company_costing_settings ADD CONSTRAINT "company_costing_settings_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public.company_items ADD CONSTRAINT "company_items_company_id_fkey" FOREIGN KEY (company_id) REFERENCES company_settings(id) ON DELETE CASCADE;
ALTER TABLE public.company_items ADD CONSTRAINT "company_items_item_id_fkey" FOREIGN KEY (item_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.costing_policy_history ADD CONSTRAINT "costing_policy_history_changed_by_fkey" FOREIGN KEY (changed_by) REFERENCES auth.users(id);
ALTER TABLE public.customer_ledger ADD CONSTRAINT "customer_ledger_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.customer_ledger ADD CONSTRAINT "customer_ledger_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
ALTER TABLE public.customer_payment_splits ADD CONSTRAINT "customer_payment_splits_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
ALTER TABLE public.customer_payment_splits ADD CONSTRAINT "customer_payment_splits_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE;
ALTER TABLE public.customer_payment_splits ADD CONSTRAINT "customer_payment_splits_payment_id_fkey" FOREIGN KEY (payment_id) REFERENCES customer_payments(id) ON DELETE CASCADE;
ALTER TABLE public.customer_payments ADD CONSTRAINT "customer_payments_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.customer_payments ADD CONSTRAINT "customer_payments_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
ALTER TABLE public.customer_payments ADD CONSTRAINT "customer_payments_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE SET NULL;
ALTER TABLE public.device_registrations ADD CONSTRAINT "device_registrations_assigned_warehouse_id_fkey" FOREIGN KEY (assigned_warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE public.expense_approvals ADD CONSTRAINT "expense_approvals_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.expense_approvals ADD CONSTRAINT "expense_approvals_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES expense_entries(id) ON DELETE CASCADE;
ALTER TABLE public.expense_attachments ADD CONSTRAINT "expense_attachments_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES expense_entries(id) ON DELETE CASCADE;
ALTER TABLE public.expense_attachments ADD CONSTRAINT "expense_attachments_line_id_fkey" FOREIGN KEY (line_id) REFERENCES expense_lines(id) ON DELETE CASCADE;
ALTER TABLE public.expense_attachments ADD CONSTRAINT "expense_attachments_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.expense_categories ADD CONSTRAINT "expense_categories_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
-- الحساب المحاسبي للتصنيف. ON DELETE SET NULL لا CASCADE: حذف حساب لا يجوز
-- أن يحذف التصنيف — يُفرغ رابطه فقط، فيقع على الحساب الافتراضي.
ALTER TABLE public.expense_categories ADD CONSTRAINT "expense_categories_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE public.expense_cost_centers ADD CONSTRAINT "expense_cost_centers_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.expense_entries ADD CONSTRAINT "expense_entries_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.expense_entries ADD CONSTRAINT "expense_entries_cancelled_by_fkey" FOREIGN KEY (cancelled_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.expense_entries ADD CONSTRAINT "expense_entries_cost_center_id_fkey" FOREIGN KEY (cost_center_id) REFERENCES expense_cost_centers(id) ON DELETE SET NULL;
ALTER TABLE public.expense_entries ADD CONSTRAINT "expense_entries_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.expense_entries ADD CONSTRAINT "expense_entries_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.expense_entries ADD CONSTRAINT "expense_entries_posted_by_fkey" FOREIGN KEY (posted_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.expense_entries ADD CONSTRAINT "expense_entries_project_id_fkey" FOREIGN KEY (project_id) REFERENCES expense_projects(id) ON DELETE SET NULL;
ALTER TABLE public.expense_entries ADD CONSTRAINT "expense_entries_rejected_by_fkey" FOREIGN KEY (rejected_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.expense_entries ADD CONSTRAINT "expense_entries_reversal_of_fkey" FOREIGN KEY (reversal_of) REFERENCES expense_entries(id) ON DELETE SET NULL;
ALTER TABLE public.expense_entries ADD CONSTRAINT "expense_entries_reversed_by_id_fkey" FOREIGN KEY (reversed_by_id) REFERENCES expense_entries(id) ON DELETE SET NULL;
ALTER TABLE public.expense_entries ADD CONSTRAINT "expense_entries_submitted_by_fkey" FOREIGN KEY (submitted_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.expense_entries ADD CONSTRAINT "expense_entries_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.expense_entries ADD CONSTRAINT "expense_entries_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE public.expense_lines ADD CONSTRAINT "expense_lines_category_id_fkey" FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE SET NULL;
ALTER TABLE public.expense_lines ADD CONSTRAINT "expense_lines_cost_center_id_fkey" FOREIGN KEY (cost_center_id) REFERENCES expense_cost_centers(id) ON DELETE SET NULL;
ALTER TABLE public.expense_lines ADD CONSTRAINT "expense_lines_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES expense_entries(id) ON DELETE CASCADE;
ALTER TABLE public.expense_lines ADD CONSTRAINT "expense_lines_project_id_fkey" FOREIGN KEY (project_id) REFERENCES expense_projects(id) ON DELETE SET NULL;
ALTER TABLE public.expense_payments ADD CONSTRAINT "expense_payments_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE public.expense_payments ADD CONSTRAINT "expense_payments_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.expense_payments ADD CONSTRAINT "expense_payments_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES expense_entries(id) ON DELETE RESTRICT;
ALTER TABLE public.expense_payments ADD CONSTRAINT "expense_payments_reversal_of_fkey" FOREIGN KEY (reversal_of) REFERENCES expense_payments(id) ON DELETE SET NULL;
ALTER TABLE public.expense_payments ADD CONSTRAINT "expense_payments_reversed_by_fkey" FOREIGN KEY (reversed_by) REFERENCES expense_payments(id) ON DELETE SET NULL;
ALTER TABLE public.expense_projects ADD CONSTRAINT "expense_projects_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.expenses ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE SET NULL;
ALTER TABLE public.expenses ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.inventory ADD CONSTRAINT "inventory_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.inventory ADD CONSTRAINT "inventory_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;
ALTER TABLE public.item_cost_layers ADD CONSTRAINT "item_cost_layers_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.item_cost_layers ADD CONSTRAINT "item_cost_layers_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;
ALTER TABLE public.item_cost_transactions ADD CONSTRAINT "item_cost_transactions_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.item_cost_transactions ADD CONSTRAINT "item_cost_transactions_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;
ALTER TABLE public.item_policy_review_queue ADD CONSTRAINT "item_policy_review_queue_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.item_policy_review_queue ADD CONSTRAINT "item_policy_review_queue_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.journal_entries ADD CONSTRAINT "journal_entries_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.journal_entries ADD CONSTRAINT "journal_entries_posted_by_fkey" FOREIGN KEY (posted_by) REFERENCES auth.users(id);
ALTER TABLE public.journal_entries ADD CONSTRAINT "journal_entries_reverses_id_fkey" FOREIGN KEY (reverses_id) REFERENCES journal_entries(id) ON DELETE RESTRICT;
ALTER TABLE public.journal_lines ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;
ALTER TABLE public.journal_lines ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE;
ALTER TABLE public.loyalty_transactions ADD CONSTRAINT "loyalty_transactions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.loyalty_transactions ADD CONSTRAINT "loyalty_transactions_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
ALTER TABLE public.opening_balance_documents ADD CONSTRAINT "opening_balance_documents_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.opening_balance_documents ADD CONSTRAINT "opening_balance_documents_posted_by_fkey" FOREIGN KEY (posted_by) REFERENCES auth.users(id);
ALTER TABLE public.opening_balance_documents ADD CONSTRAINT "opening_balance_documents_reverses_document_id_fkey" FOREIGN KEY (reverses_document_id) REFERENCES opening_balance_documents(id);
ALTER TABLE public.opening_balance_lines ADD CONSTRAINT "opening_balance_lines_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE public.opening_balance_lines ADD CONSTRAINT "opening_balance_lines_document_id_fkey" FOREIGN KEY (document_id) REFERENCES opening_balance_documents(id) ON DELETE CASCADE;
ALTER TABLE public.opening_balance_lines ADD CONSTRAINT "opening_balance_lines_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE public.opening_balance_lines ADD CONSTRAINT "opening_balance_lines_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT;
ALTER TABLE public.opening_balance_lines ADD CONSTRAINT "opening_balance_lines_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT;
ALTER TABLE public.platform_admins ADD CONSTRAINT "platform_admins_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.platform_audit_logs ADD CONSTRAINT "platform_audit_logs_admin_id_fkey" FOREIGN KEY (admin_id) REFERENCES platform_admins(id) ON DELETE SET NULL;
ALTER TABLE public.platform_audit_logs ADD CONSTRAINT "platform_audit_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.product_batches ADD CONSTRAINT "product_batches_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.product_batches ADD CONSTRAINT "product_batches_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.product_batches ADD CONSTRAINT "product_batches_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;
ALTER TABLE public.product_compatibilities ADD CONSTRAINT "product_compatibilities_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.product_compatibilities ADD CONSTRAINT "product_compatibilities_vehicle_model_id_fkey" FOREIGN KEY (vehicle_model_id) REFERENCES vehicle_models(id) ON DELETE CASCADE;
ALTER TABLE public.products ADD CONSTRAINT "products_base_uom_id_fkey" FOREIGN KEY (base_uom_id) REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD CONSTRAINT "products_origin_id_fkey" FOREIGN KEY (origin_id) REFERENCES countries_of_origin(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD CONSTRAINT "products_package_type_id_fkey" FOREIGN KEY (package_type_id) REFERENCES packaging_types(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD CONSTRAINT "products_purchase_uom_id_fkey" FOREIGN KEY (purchase_uom_id) REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD CONSTRAINT "products_quality_grade_id_fkey" FOREIGN KEY (quality_grade_id) REFERENCES quality_grades(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD CONSTRAINT "products_sales_uom_id_fkey" FOREIGN KEY (sales_uom_id) REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD CONSTRAINT "products_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.purchase_invoice_items ADD CONSTRAINT "purchase_invoice_items_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE;
ALTER TABLE public.purchase_invoice_items ADD CONSTRAINT "purchase_invoice_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.purchase_invoices ADD CONSTRAINT "purchase_invoices_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_invoices ADD CONSTRAINT "purchase_invoices_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_invoices ADD CONSTRAINT "purchase_invoices_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_return_items ADD CONSTRAINT "purchase_return_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.purchase_return_items ADD CONSTRAINT "purchase_return_items_return_id_fkey" FOREIGN KEY (return_id) REFERENCES purchase_returns(id) ON DELETE CASCADE;
ALTER TABLE public.purchase_returns ADD CONSTRAINT "purchase_returns_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_returns ADD CONSTRAINT "purchase_returns_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES purchase_invoices(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_returns ADD CONSTRAINT "purchase_returns_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_returns ADD CONSTRAINT "purchase_returns_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
ALTER TABLE public.sales_invoice_items ADD CONSTRAINT "sales_invoice_items_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE;
ALTER TABLE public.sales_invoice_items ADD CONSTRAINT "sales_invoice_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.sales_invoice_items ADD CONSTRAINT "sales_invoice_items_uom_id_fkey" FOREIGN KEY (uom_id) REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE public.sales_invoices ADD CONSTRAINT "sales_invoices_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.sales_invoices ADD CONSTRAINT "sales_invoices_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public.sales_invoices ADD CONSTRAINT "sales_invoices_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE public.sales_return_items ADD CONSTRAINT "sales_return_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.sales_return_items ADD CONSTRAINT "sales_return_items_return_id_fkey" FOREIGN KEY (return_id) REFERENCES sales_returns(id) ON DELETE CASCADE;
ALTER TABLE public.sales_returns ADD CONSTRAINT "sales_returns_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.sales_returns ADD CONSTRAINT "sales_returns_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public.sales_returns ADD CONSTRAINT "sales_returns_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE SET NULL;
ALTER TABLE public.sales_returns ADD CONSTRAINT "sales_returns_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
ALTER TABLE public.stock_adjustment_items ADD CONSTRAINT "stock_adjustment_items_adjustment_id_fkey" FOREIGN KEY (adjustment_id) REFERENCES stock_adjustments(id) ON DELETE CASCADE;
ALTER TABLE public.stock_adjustment_items ADD CONSTRAINT "stock_adjustment_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.stock_adjustments ADD CONSTRAINT "stock_adjustments_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.stock_adjustments ADD CONSTRAINT "stock_adjustments_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
ALTER TABLE public.stock_movements ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.stock_movements ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.stock_movements ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;
ALTER TABLE public.stock_opening_items ADD CONSTRAINT "stock_opening_items_opening_id_fkey" FOREIGN KEY (opening_id) REFERENCES stock_openings(id) ON DELETE CASCADE;
ALTER TABLE public.stock_opening_items ADD CONSTRAINT "stock_opening_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.stock_openings ADD CONSTRAINT "stock_openings_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.stock_openings ADD CONSTRAINT "stock_openings_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
ALTER TABLE public.stock_transfer_items ADD CONSTRAINT "stock_transfer_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.stock_transfer_items ADD CONSTRAINT "stock_transfer_items_transfer_id_fkey" FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE;
ALTER TABLE public.stock_transfers ADD CONSTRAINT "stock_transfers_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.stock_transfers ADD CONSTRAINT "stock_transfers_from_warehouse_id_fkey" FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id);
ALTER TABLE public.stock_transfers ADD CONSTRAINT "stock_transfers_to_warehouse_id_fkey" FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id);
ALTER TABLE public.tenant_subscriptions ADD CONSTRAINT "tenant_subscriptions_plan_id_fkey" FOREIGN KEY (plan_id) REFERENCES platform_plans(id) ON UPDATE CASCADE;
ALTER TABLE public.user_roles ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.vehicle_models ADD CONSTRAINT "vehicle_models_make_id_fkey" FOREIGN KEY (make_id) REFERENCES vehicle_makes(id) ON DELETE CASCADE;

-- ── TRIGGERS ───────────────────────────────────────────────────────────
CREATE TRIGGER company_items_updated BEFORE UPDATE ON public.company_items FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER trg_customer_payments_updated BEFORE UPDATE ON public.customer_payments FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER customers_updated BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER tg_expense_cost_centers_updated BEFORE UPDATE ON public.expense_cost_centers FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER tg_expense_entries_guard BEFORE UPDATE ON public.expense_entries FOR EACH ROW EXECUTE FUNCTION tg_expense_entries_guard();
CREATE TRIGGER tg_expense_entries_updated BEFORE UPDATE ON public.expense_entries FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER tg_expense_lines_sync_total AFTER INSERT OR DELETE OR UPDATE ON public.expense_lines FOR EACH ROW EXECUTE FUNCTION tg_expense_lines_sync_total();
CREATE TRIGGER tg_expense_lines_updated BEFORE UPDATE ON public.expense_lines FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER tg_expense_payments_sync_entry AFTER INSERT OR DELETE OR UPDATE ON public.expense_payments FOR EACH ROW EXECUTE FUNCTION tg_expense_payments_sync_entry();
CREATE TRIGGER tg_expense_payments_updated BEFORE UPDATE ON public.expense_payments FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER tg_expense_projects_updated BEFORE UPDATE ON public.expense_projects FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER tg_expenses_updated BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER set_batches_updated_at BEFORE UPDATE ON public.product_batches FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER products_guard_policy_change BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION tg_guard_item_policy_change();
CREATE TRIGGER products_updated BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER tg_sync_item_class BEFORE INSERT OR UPDATE OF item_nature, inventory_policy ON public.products FOR EACH ROW EXECUTE FUNCTION sync_item_class_from_policy();
CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER purchases_updated BEFORE UPDATE ON public.purchase_invoices FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER sales_updated BEFORE UPDATE ON public.sales_invoices FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER suppliers_updated BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER warehouses_updated BEFORE UPDATE ON public.warehouses FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ── ROW LEVEL SECURITY ─────────────────────────────────────────────────
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ad_hoc_service_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.backup_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.company_costing_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.company_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.costing_policy_history ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.countries_of_origin ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.customer_ledger ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.customer_payment_splits ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.device_registrations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.expense_approvals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.expense_attachments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.expense_cost_centers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.expense_entries ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.expense_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.expense_payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.expense_projects ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.item_cost_layers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.item_cost_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.item_policy_review_queue ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;









ALTER TABLE public.opening_balance_documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.opening_balance_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.packaging_types ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.platform_modules ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.platform_plans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.product_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.product_compatibilities ENABLE ROW LEVEL SECURITY;







ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.purchase_invoice_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.purchase_return_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.quality_grades ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sales_invoice_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sales_return_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sales_returns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_adjustment_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_opening_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_openings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sync_idempotency_keys ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vehicle_makes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vehicle_models ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounts_read" ON public.accounts
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "ad_hoc_service_lines_read" ON public.ad_hoc_service_lines
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "Owners/managers read audit" ON public.audit_logs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "Staff insert audit" ON public.audit_logs
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_staff(auth.uid()));

CREATE POLICY "Users can insert backup logs for their tenant" ON public.backup_logs
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Users can view backup logs for their tenant" ON public.backup_logs
  AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() IS NOT NULL));

CREATE POLICY "brand_manage" ON public.brands
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "brand_view" ON public.brands
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "cat_manage" ON public.categories
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "cat_view" ON public.categories
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "costing_settings_read" ON public.company_costing_settings
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "company_items_manage" ON public.company_items
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "company_items_staff_read" ON public.company_items
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "company insert" ON public.company_settings
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "company_update" ON public.company_settings
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "company_view" ON public.company_settings
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "costing_history_read" ON public.costing_policy_history
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "origin_staff" ON public.countries_of_origin
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_staff(auth.uid()))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "customer_ledger_view" ON public.customer_ledger
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "customer_payment_splits staff read" ON public.customer_payment_splits
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "customer_payment_splits staff write" ON public.customer_payment_splits
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_staff(auth.uid()));

CREATE POLICY "staff_view_customer_payments" ON public.customer_payments
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "cust_manage" ON public.customers
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'accountant'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'accountant'::app_role)));

CREATE POLICY "cust_view" ON public.customers
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "Authenticated users can read device registrations" ON public.device_registrations
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "expense_approvals_read" ON public.expense_approvals
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_read_expense_entry(entry_id, auth.uid()));

CREATE POLICY "expense_attachments_delete" ON public.expense_attachments
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (((expense_role_rank(auth.uid()) >= 30) AND (EXISTS ( SELECT 1
   FROM expense_entries e
  WHERE ((e.id = expense_attachments.entry_id) AND (e.status = ANY (ARRAY['DRAFT'::expense_status, 'REJECTED'::expense_status])))))));

CREATE POLICY "expense_attachments_insert" ON public.expense_attachments
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_staff(auth.uid()) AND (uploaded_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM expense_entries e
  WHERE ((e.id = expense_attachments.entry_id) AND (e.status = ANY (ARRAY['DRAFT'::expense_status, 'REJECTED'::expense_status])))))));

CREATE POLICY "expense_attachments_read" ON public.expense_attachments
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_read_expense_entry(entry_id, auth.uid()));

CREATE POLICY "staff read expense cats" ON public.expense_categories
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "staff write expense cats" ON public.expense_categories
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_staff(auth.uid()))
  WITH CHECK (is_staff(auth.uid()));

CREATE POLICY "expense_cost_centers_manage" ON public.expense_cost_centers
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "expense_cost_centers_read" ON public.expense_cost_centers
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "expense_entries_read" ON public.expense_entries
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((can_read_finance(auth.uid()) OR (is_staff(auth.uid()) AND (created_by = auth.uid()))));

CREATE POLICY "expense_lines_read" ON public.expense_lines
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_read_expense_entry(entry_id, auth.uid()));

CREATE POLICY "expense_payments_read" ON public.expense_payments
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_read_expense_entry(entry_id, auth.uid()));

CREATE POLICY "expense_projects_manage" ON public.expense_projects
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "expense_projects_read" ON public.expense_projects
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "finance read expenses" ON public.expenses
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_read_finance(auth.uid()));

CREATE POLICY "finance write expenses" ON public.expenses
  AS PERMISSIVE FOR ALL TO authenticated
  USING (can_read_finance(auth.uid()))
  WITH CHECK (can_read_finance(auth.uid()));

CREATE POLICY "inv_read_only_staff" ON public.inventory
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "inv_view" ON public.inventory
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "cost_layers_read" ON public.item_cost_layers
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_staff(auth.uid()) AND ((owner_type = 'COMPANY'::owner_type) OR (owner_id = auth.uid()))));

CREATE POLICY "cost_tx_read" ON public.item_cost_transactions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_staff(auth.uid()) AND ((owner_type = 'COMPANY'::owner_type) OR (owner_id = auth.uid()))));

CREATE POLICY "item_policy_review_manage" ON public.item_policy_review_queue
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "item_policy_review_staff_read" ON public.item_policy_review_queue
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "journal_read" ON public.journal_entries
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "journal_lines_read" ON public.journal_lines
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "Staff read loyalty" ON public.loyalty_transactions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "Staff write loyalty" ON public.loyalty_transactions
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_staff(auth.uid()));









CREATE POLICY "opening_bal_read" ON public.opening_balance_documents
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "opening_bal_lines_read" ON public.opening_balance_lines
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "packaging_types_read" ON public.packaging_types
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "packaging_types_write" ON public.packaging_types
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "platform_admins_manage" ON public.platform_admins
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_platform_superadmin(auth.uid()))
  WITH CHECK (is_platform_superadmin(auth.uid()));

CREATE POLICY "platform_admins_select" ON public.platform_admins
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_platform_admin(auth.uid()));

CREATE POLICY "platform_admins_self_read" ON public.platform_admins
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));

CREATE POLICY "platform_audit_logs_insert" ON public.platform_audit_logs
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin(auth.uid()) OR (auth.uid() IS NOT NULL)));

CREATE POLICY "platform_audit_logs_select" ON public.platform_audit_logs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_platform_admin(auth.uid()));

CREATE POLICY "platform_modules_read" ON public.platform_modules
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "platform_plans_read" ON public.platform_plans
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Staff read batches" ON public.product_batches
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "Staff write batches" ON public.product_batches
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_staff(auth.uid()))
  WITH CHECK (is_staff(auth.uid()));

CREATE POLICY "fitment_staff" ON public.product_compatibilities
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_staff(auth.uid()))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));







CREATE POLICY "prod_manage" ON public.products
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role)));

CREATE POLICY "prod_view" ON public.products
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "profiles read" ON public.profiles
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((id = auth.uid()) OR has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "profiles_admin_toggle_active" ON public.profiles
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR is_platform_superadmin(auth.uid())))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR is_platform_superadmin(auth.uid())));

CREATE POLICY "profiles_self_insert" ON public.profiles
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((id = auth.uid()));

CREATE POLICY "profiles_self_update" ON public.profiles
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((id = auth.uid()));

CREATE POLICY "pur_item_manage" ON public.purchase_invoice_items
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role)));

CREATE POLICY "pur_item_view" ON public.purchase_invoice_items
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "pur_manage" ON public.purchase_invoices
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role)));

CREATE POLICY "pur_view" ON public.purchase_invoices
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "staff read pret_i" ON public.purchase_return_items
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "staff write pret_i" ON public.purchase_return_items
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_staff(auth.uid()))
  WITH CHECK (is_staff(auth.uid()));

CREATE POLICY "staff read pret" ON public.purchase_returns
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "staff write pret" ON public.purchase_returns
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_staff(auth.uid()))
  WITH CHECK (is_staff(auth.uid()));

CREATE POLICY "quality_staff" ON public.quality_grades
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_staff(auth.uid()))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "sale_item_view" ON public.sales_invoice_items
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "sale_view" ON public.sales_invoices
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "staff read sret_i" ON public.sales_return_items
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "staff write sret_i" ON public.sales_return_items
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_staff(auth.uid()))
  WITH CHECK (is_staff(auth.uid()));

CREATE POLICY "staff read sret" ON public.sales_returns
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "staff write sret" ON public.sales_returns
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_staff(auth.uid()))
  WITH CHECK (is_staff(auth.uid()));

CREATE POLICY "stock_adjustment_items_read" ON public.stock_adjustment_items
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "stock_adjustments_read" ON public.stock_adjustments
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "mv_view" ON public.stock_movements
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "stock_opening_items_read" ON public.stock_opening_items
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "stock_openings_read" ON public.stock_openings
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "staff read xfer_i" ON public.stock_transfer_items
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "staff write xfer_i" ON public.stock_transfer_items
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_staff(auth.uid()))
  WITH CHECK (is_staff(auth.uid()));

CREATE POLICY "staff read xfer" ON public.stock_transfers
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "staff write xfer" ON public.stock_transfers
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_staff(auth.uid()))
  WITH CHECK (is_staff(auth.uid()));

CREATE POLICY "supp_manage" ON public.suppliers
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'accountant'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'accountant'::app_role)));

CREATE POLICY "supp_view" ON public.suppliers
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "Authenticated users can check and insert idempotency keys" ON public.sync_idempotency_keys
  AS PERMISSIVE FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "tenant_subscriptions_insert" ON public.tenant_subscriptions
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin(auth.uid()));

CREATE POLICY "tenant_subscriptions_read" ON public.tenant_subscriptions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "tenant_subscriptions_select" ON public.tenant_subscriptions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "tenant_subscriptions_update" ON public.tenant_subscriptions
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_platform_admin(auth.uid()))
  WITH CHECK (is_platform_admin(auth.uid()));

CREATE POLICY "unit_manage" ON public.units
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "unit_view" ON public.units
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "owner manage roles del" ON public.user_roles
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'owner'::app_role));

CREATE POLICY "owner manage roles ins" ON public.user_roles
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'owner'::app_role));

CREATE POLICY "owner manage roles upd" ON public.user_roles
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'owner'::app_role))
  WITH CHECK (has_role(auth.uid(), 'owner'::app_role));

CREATE POLICY "roles_self_view" ON public.user_roles
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "make_staff" ON public.vehicle_makes
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_staff(auth.uid()))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "model_staff" ON public.vehicle_models
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_staff(auth.uid()))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "wh_manage" ON public.warehouses
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));

CREATE POLICY "wh_view" ON public.warehouses
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

-- ── GRANTS ──────────────────────────────────────────────────────────────
-- Table privileges, as granted in the reference database.
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.accounts TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.accounts TO service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.ad_hoc_service_lines TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.ad_hoc_service_lines TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ad_hoc_service_lines TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.audit_logs TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.audit_logs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.audit_logs TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.backup_logs TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.backup_logs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.backup_logs TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.brands TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.brands TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.brands TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.categories TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.categories TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.categories TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.company_costing_settings TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.company_costing_settings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.company_costing_settings TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.company_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.company_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.company_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.company_settings TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.company_settings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.company_settings TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.company_stock_positions TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.company_stock_positions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.company_stock_positions TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.costing_policy_history TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.costing_policy_history TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.costing_policy_history TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.countries_of_origin TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.countries_of_origin TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.countries_of_origin TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_balance_reconciliation TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_balance_reconciliation TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_balance_reconciliation TO service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.customer_ledger TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.customer_ledger TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_ledger TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_ledger_balances TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_ledger_balances TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_ledger_balances TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_owned_positions TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_owned_positions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_owned_positions TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_payment_splits TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_payment_splits TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_payment_splits TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_payments TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.customer_payments TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_payments TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customers TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customers TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customers TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.device_registrations TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.device_registrations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.device_registrations TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_approvals TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_approvals TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_attachments TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_attachments TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_categories TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_categories TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_categories TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_cost_centers TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_cost_centers TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_cost_centers TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_entries TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_entries TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_legacy_reconciliation TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_legacy_reconciliation TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_legacy_reconciliation TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_lines TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_lines TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_payments TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_payments TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_projects TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_projects TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expense_projects TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expenses TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expenses TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expenses TO service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.inventory TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventory TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventory_valuation TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventory_valuation TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventory_valuation TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.invoice_ledger_status TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.invoice_ledger_status TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.item_classification_gaps TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.item_classification_gaps TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.item_cost_layers TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.item_cost_layers TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.item_cost_transactions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.item_cost_transactions TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.item_policy_review_queue TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.item_policy_review_queue TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.item_policy_review_queue TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.item_valuation TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.item_valuation TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.journal_entries TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.journal_entries TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.journal_lines TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.journal_lines TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.loyalty_transactions TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.loyalty_transactions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.loyalty_transactions TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.milling_inventory_report TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.milling_inventory_report TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.milling_margin_report TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.milling_margin_report TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.opening_balance_documents TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.opening_balance_documents TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.opening_balance_lines TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.opening_balance_lines TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.opening_balance_summary TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.opening_balance_summary TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.packaging_types TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.packaging_types TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.packaging_types TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_admins TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_admins TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_admins TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_audit_logs TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_audit_logs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_audit_logs TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_modules TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_modules TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_modules TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_plans TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_plans TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_plans TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.product_batches TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.product_batches TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.product_batches TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.product_compatibilities TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.product_compatibilities TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.product_compatibilities TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.products TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.products TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.products TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.profiles TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.profiles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.profiles TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_invoice_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_invoice_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_invoice_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_invoices TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_invoices TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_invoices TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_ledger_status TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_ledger_status TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_register TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_register TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_register TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_return_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_return_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_return_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_returns TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_returns TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_returns TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.quality_grades TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.quality_grades TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.quality_grades TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales_invoice_items TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.sales_invoice_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales_invoice_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales_invoices TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.sales_invoices TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales_invoices TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales_register TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales_register TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales_register TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales_return_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales_return_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales_return_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales_returns TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales_returns TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales_returns TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.service_revenue TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.service_revenue TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.service_revenue TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.standard_cost_readiness TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.standard_cost_readiness TO service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.stock_adjustment_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_adjustment_items TO service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.stock_adjustments TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_adjustments TO service_role;
GRANT DELETE, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_movements TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_movements TO service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.stock_opening_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_opening_items TO service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.stock_openings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_openings TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_positions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_positions TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_transfer_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_transfer_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_transfers TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_transfers TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.suppliers TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.suppliers TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.suppliers TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sync_idempotency_keys TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sync_idempotency_keys TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sync_idempotency_keys TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tenant_subscriptions TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tenant_subscriptions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tenant_subscriptions TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.trial_balance TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.trial_balance TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.units TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.units TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.units TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_roles TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_roles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_roles TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vehicle_makes TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vehicle_makes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vehicle_makes TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vehicle_models TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vehicle_models TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.vehicle_models TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.warehouses TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.warehouses TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.warehouses TO service_role;

-- Function execution privileges.
GRANT EXECUTE ON FUNCTION public.adjust_loyalty(_customer uuid, _points numeric, _kind text, _note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_loyalty(_customer uuid, _points numeric, _kind text, _note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_cost_movement(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_incoming_cost numeric, p_source_type text, p_source_id uuid, p_note text, p_owner_type owner_type, p_owner_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_cost_movement(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_incoming_cost numeric, p_source_type text, p_source_id uuid, p_note text, p_owner_type owner_type, p_owner_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_item_policy_change(_item_id uuid, _new_nature item_nature, _new_policy inventory_policy, _new_costing costing_method, _new_tracking item_tracking, _reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_item_policy_change(_item_id uuid, _new_nature item_nature, _new_policy inventory_policy, _new_costing costing_method, _new_tracking item_tracking, _reason text) TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_item_policy_snapshot(p_item_id uuid, p_action text, p_before jsonb, p_after jsonb, p_source text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_item_policy_snapshot(p_item_id uuid, p_action text, p_before jsonb, p_after jsonb, p_source text) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_operate_milling() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_operate_milling() TO service_role;
GRANT EXECUTE ON FUNCTION public.can_read_expense_entry(p_entry_id uuid, p_user uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_expense_entry(p_entry_id uuid, p_user uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_read_finance(p_user uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_finance(p_user uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_view_milling() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_milling() TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_expense(p_entry_id uuid, p_reason text, p_expected_version integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_expense(p_entry_id uuid, p_reason text, p_expected_version integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_expense(p_entry_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_expense(p_entry_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.company_costing_method() TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_costing_method() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_expense(p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type expense_entry_type, p_payee_type expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode expense_tax_mode, p_reference text, p_submit boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_expense(p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type expense_entry_type, p_payee_type expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode expense_tax_mode, p_reference text, p_submit boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_journal_entry(p_memo text, p_entry_date date, p_source_type text, p_source_id uuid, p_is_system boolean, p_lines jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_journal_entry(p_memo text, p_entry_date date, p_source_type text, p_source_id uuid, p_is_system boolean, p_lines jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_opening_balance(_effective_date date, _lines jsonb, _notes text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_opening_balance(_effective_date date, _lines jsonb, _notes text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_purchase_return(_invoice_id uuid, _warehouse_id uuid, _supplier_id uuid, _refund_method text, _note text, _items jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase_return(_invoice_id uuid, _warehouse_id uuid, _supplier_id uuid, _refund_method text, _note text, _items jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date, _payment_splits jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date, _payment_splits jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_sales_return(_invoice_id uuid, _warehouse_id uuid, _customer_id uuid, _refund_method text, _note text, _items jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sales_return(_invoice_id uuid, _warehouse_id uuid, _customer_id uuid, _refund_method text, _note text, _items jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_stock_transfer(_from uuid, _to uuid, _note text, _items jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_stock_transfer(_from uuid, _to uuid, _note text, _items jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_credit_limit_allows(p_customer_id uuid, p_new_due numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_credit_limit_allows(p_customer_id uuid, p_new_due numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_ledger_balance(p_customer_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_ledger_balance(p_customer_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_expense(p_entry_id uuid, p_approve boolean, p_reason text, p_expected_version integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_expense(p_entry_id uuid, p_approve boolean, p_reason text, p_expected_version integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_expense_category(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_expense_category(p_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_actor() TO anon;
GRANT EXECUTE ON FUNCTION public.expense_actor() TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_actor() TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_assert_capability(p_user uuid, p_capability text) TO anon;
GRANT EXECUTE ON FUNCTION public.expense_assert_capability(p_user uuid, p_capability text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_assert_capability(p_user uuid, p_capability text) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_can(p_user uuid, p_capability text) TO anon;
GRANT EXECUTE ON FUNCTION public.expense_can(p_user uuid, p_capability text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_can(p_user uuid, p_capability text) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_can_write_document(p_entry_id uuid, p_user uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.expense_can_write_document(p_entry_id uuid, p_user uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_can_write_document(p_entry_id uuid, p_user uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_detail(p_entry_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_detail(p_entry_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_line_net(p_gross numeric, p_tax_rate numeric, p_mode expense_tax_mode) TO anon;
GRANT EXECUTE ON FUNCTION public.expense_line_net(p_gross numeric, p_tax_rate numeric, p_mode expense_tax_mode) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_line_net(p_gross numeric, p_tax_rate numeric, p_mode expense_tax_mode) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_line_tax(p_gross numeric, p_tax_rate numeric, p_mode expense_tax_mode) TO anon;
GRANT EXECUTE ON FUNCTION public.expense_line_tax(p_gross numeric, p_tax_rate numeric, p_mode expense_tax_mode) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_line_tax(p_gross numeric, p_tax_rate numeric, p_mode expense_tax_mode) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_log_action(p_entry_id uuid, p_action text, p_from expense_status, p_to expense_status, p_reason text, p_actor uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_lookups(p_include_archived boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_lookups(p_include_archived boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_report(p_group_by text, p_date_from date, p_date_to date, p_status expense_status[], p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_report(p_group_by text, p_date_from date, p_date_to date, p_status expense_status[], p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_limit integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_role_rank(p_user uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_role_rank(p_user uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_round(p_value numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.expense_round(p_value numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_round(p_value numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_settlement_status(p_current expense_status, p_paid numeric, p_total numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.expense_settlement_status(p_current expense_status, p_paid numeric, p_total numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_settlement_status(p_current expense_status, p_paid numeric, p_total numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_summary(p_date_from date, p_date_to date, p_warehouse_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_summary(p_date_from date, p_date_to date, p_warehouse_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_write_lines(p_entry_id uuid, p_lines jsonb, p_tax_mode expense_tax_mode, OUT o_total numeric, OUT o_count integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(_user_id uuid, _role app_role) TO anon;
GRANT EXECUTE ON FUNCTION public.has_role(_user_id uuid, _role app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(_user_id uuid, _role app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(p_user_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_platform_superadmin(p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_superadmin(p_user_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_staff(_user_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_staff(_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(_user_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.item_effective_policy(p_item_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.item_effective_policy(p_item_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.item_has_stock_history(p_item_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.item_has_stock_history(p_item_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.item_line_type(p_item_id uuid, p_is_ad_hoc boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.item_line_type(p_item_id uuid, p_is_ad_hoc boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.item_stock_effect(p_item_id uuid, p_direction text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.item_stock_effect(p_item_id uuid, p_direction text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_expenses(p_search text, p_status expense_status[], p_category_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_supplier_id uuid, p_employee_id uuid, p_payment_state text, p_date_from date, p_date_to date, p_amount_min numeric, p_amount_max numeric, p_category_ids uuid[], p_limit integer, p_cursor_date date, p_cursor_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_expenses(p_search text, p_status expense_status[], p_category_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_supplier_id uuid, p_employee_id uuid, p_payment_state text, p_date_from date, p_date_to date, p_amount_min numeric, p_amount_max numeric, p_category_ids uuid[], p_limit integer, p_cursor_date date, p_cursor_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.migrate_legacy_expenses(p_mode text, p_from date, p_to date, p_batch_size integer, p_dry_run boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_legacy_expenses(p_mode text, p_from date, p_to date, p_batch_size integer, p_dry_run boolean) TO service_role;
-- ⚠️ لا يُمنح لـ anon: دالة SECURITY DEFINER تُخصّص من تسلسل حقيقي، ومنحها
-- لزائر غير مسجَّل يسمح له بإحراق أرقام المستندات بلا مصادقة. وكانت هي الوحيدة
-- بين كل دوال next_* الممنوحة لـ anon — بقية الدوال تقتصر على authenticated
-- و service_role، وهذا الشكل الصحيح.
GRANT EXECUTE ON FUNCTION public.next_expense_reference() TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_expense_reference() TO service_role;
-- NOTE: next_invoice_number / next_purchase_number / next_sales_return_number /
-- next_purchase_return_number / next_transfer_number are NOT granted here. Their
-- definition moved to 14_document_numbering_engine.sql, so they do not exist yet
-- at this point; the GRANTs live beside the definitions in 14. Granting a function
-- that does not exist is a hard error.
GRANT EXECUTE ON FUNCTION public.next_journal_number(p_date date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_journal_number(p_date date) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_stock_adjustment_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_stock_adjustment_number() TO service_role;
GRANT EXECUTE ON FUNCTION public.next_stock_opening_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_stock_opening_number() TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_auth_user_token_columns() TO anon;
GRANT EXECUTE ON FUNCTION public.normalize_auth_user_token_columns() TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_auth_user_token_columns() TO service_role;
GRANT EXECUTE ON FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method payment_method, p_account_label text, p_payment_date date, p_idempotency_key text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method payment_method, p_account_label text, p_payment_date date, p_idempotency_key text, p_account_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method payment_method, p_account_label text, p_payment_date date, p_idempotency_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer, p_pay_now boolean, p_payment_method payment_method, p_account_label text, p_payment_date date, p_idempotency_key text, p_account_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_opening_balance(_document_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_opening_balance(_document_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_opening_stock(_warehouse_id uuid, _effective_date date, _note text, _items jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_opening_stock(_warehouse_id uuid, _effective_date date, _note text, _items jsonb) TO service_role;
-- NOTE: post_purchase_invoice and post_sales_invoice are NOT granted here.
-- Their definition moved to 16_payment_methods.sql (their payment-account branch
-- needs the payment_methods catalogue), so they do not exist yet at this point.
-- The GRANTs live beside the definitions in 16. Granting a function that does not
-- exist is a hard error, which is exactly the trap this note prevents.
GRANT EXECUTE ON FUNCTION public.post_stock_adjustment(_warehouse_id uuid, _reason text, _note text, _effective_date date, _items jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_stock_adjustment(_warehouse_id uuid, _reason text, _note text, _effective_date date, _items jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_stock_delta(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_unit_cost numeric, p_movement_kind stock_movement_kind, p_source_type text, p_source_id uuid, p_note text, p_owner_type owner_type, p_owner_id uuid, p_movement_type_legacy movement_type) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_stock_delta(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_unit_cost numeric, p_movement_kind stock_movement_kind, p_source_type text, p_source_id uuid, p_note text, p_owner_type owner_type, p_owner_id uuid, p_movement_type_legacy movement_type) TO service_role;
GRANT EXECUTE ON FUNCTION public.product_delete_guard(p_product_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_delete_guard(p_product_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.product_reference_counts(p_product_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_reference_counts(p_product_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.receive_customer_owned_stock(_customer_id uuid, _product_id uuid, _warehouse_id uuid, _quantity numeric, _unit_cost numeric, _note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_customer_owned_stock(_customer_id uuid, _product_id uuid, _warehouse_id uuid, _quantity numeric, _unit_cost numeric, _note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(_customer_id uuid, _invoice_id uuid, _amount numeric, _method text, _payment_date date, _note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(_customer_id uuid, _invoice_id uuid, _amount numeric, _method text, _payment_date date, _note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_customer_advance_payment(_customer_id uuid, _amount numeric, _method text, _payment_date date, _note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_advance_payment(_customer_id uuid, _amount numeric, _method text, _payment_date date, _note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text, p_account_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text, p_account_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date, p_payment_method payment_method, p_account_label text, p_reference_no text, p_note text, p_idempotency_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_customer_owned_stock(_customer_id uuid, _product_id uuid, _warehouse_id uuid, _quantity numeric, _note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_customer_owned_stock(_customer_id uuid, _product_id uuid, _warehouse_id uuid, _quantity numeric, _note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_purchase_line(p_line jsonb, OUT o_product_id uuid, OUT o_quantity numeric, OUT o_line_type text, OUT o_stock_effect text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_purchase_line(p_line jsonb, OUT o_product_id uuid, OUT o_quantity numeric, OUT o_line_type text, OUT o_stock_effect text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_sale_line(p_line jsonb, OUT o_product_id uuid, OUT o_quantity numeric, OUT o_line_type text, OUT o_stock_effect text, OUT o_service_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_sale_line(p_line jsonb, OUT o_product_id uuid, OUT o_quantity numeric, OUT o_line_type text, OUT o_stock_effect text, OUT o_service_name text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_unit_cost(p_product_id uuid, p_warehouse_id uuid, p_as_of timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_unit_cost(p_product_id uuid, p_warehouse_id uuid, p_as_of timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_expense(p_entry_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_expense(p_entry_id uuid, p_reason text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_expense_payment(p_payment_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_expense_payment(p_payment_id uuid, p_reason text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(p_entry_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(p_entry_id uuid, p_reason text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_opening_balance(_document_id uuid, _reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_opening_balance(_document_id uuid, _reason text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_invoice_tender_breakdown(_invoice_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_invoice_tender_breakdown(_invoice_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_line_cost(p_item_id uuid, p_invoice_id uuid, p_quantity numeric, p_line_type text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_line_cost(p_item_id uuid, p_invoice_id uuid, p_quantity numeric, p_line_type text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_expense_category(p_id uuid, p_name text, p_name_ar text, p_sort_order integer, p_notes text, p_is_active boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_expense_category(p_id uuid, p_name text, p_name_ar text, p_sort_order integer, p_notes text, p_is_active boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_expense_dimension(p_kind text, p_id uuid, p_code text, p_name text, p_name_ar text, p_is_active boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_expense_dimension(p_kind text, p_id uuid, p_code text, p_name text, p_name_ar text, p_is_active boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_item_policy(_item_id uuid, _item_nature item_nature, _inventory_policy inventory_policy, _costing_method costing_method, _tracking item_tracking, _is_sellable boolean, _is_purchasable boolean, _base_uom_id uuid, _sales_uom_id uuid, _purchase_uom_id uuid, _uom_conversions jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_item_policy(_item_id uuid, _item_nature item_nature, _inventory_policy inventory_policy, _costing_method costing_method, _tracking item_tracking, _is_sellable boolean, _is_purchasable boolean, _base_uom_id uuid, _sales_uom_id uuid, _purchase_uom_id uuid, _uom_conversions jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_products(p_query text, p_category_id uuid, p_brand_id uuid, p_unit_id uuid, p_origin_id uuid, p_active boolean, p_low_stock boolean, p_sort_key text, p_sort_dir text, p_limit integer, p_offset integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_products(p_query text, p_category_id uuid, p_brand_id uuid, p_unit_id uuid, p_origin_id uuid, p_active boolean, p_low_stock boolean, p_sort_key text, p_sort_dir text, p_limit integer, p_offset integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_company_costing_method(_method text, _source text, _notes text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_company_costing_method(_method text, _source text, _notes text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_company_item_policy(_item_id uuid, _inventory_policy inventory_policy, _costing_method costing_method, _default_cost numeric, _default_sale_price numeric, _tax_rate numeric, _is_active boolean, _company_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_company_item_policy(_item_id uuid, _inventory_policy inventory_policy, _costing_method costing_method, _default_cost numeric, _default_sale_price numeric, _tax_rate numeric, _is_active boolean, _company_id integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_standard_costs(_costs jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_standard_costs(_costs jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_expense(p_entry_id uuid, p_expected_version integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_expense(p_entry_id uuid, p_expected_version integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_apply_operation(p_idempotency_key text, p_entity_name text, p_operation_type text, p_origin_device_id text, p_payload jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.sync_apply_operation(p_idempotency_key text, p_entity_name text, p_operation_type text, p_origin_device_id text, p_payload jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_apply_operation(p_idempotency_key text, p_entity_name text, p_operation_type text, p_origin_device_id text, p_payload jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_item_class_from_policy() TO anon;
GRANT EXECUTE ON FUNCTION public.sync_item_class_from_policy() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_item_class_from_policy() TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_expense_entries_guard() TO anon;
GRANT EXECUTE ON FUNCTION public.tg_expense_entries_guard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tg_expense_entries_guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_expense_lines_sync_total() TO anon;
GRANT EXECUTE ON FUNCTION public.tg_expense_lines_sync_total() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tg_expense_lines_sync_total() TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_expense_payments_sync_entry() TO anon;
GRANT EXECUTE ON FUNCTION public.tg_expense_payments_sync_entry() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tg_expense_payments_sync_entry() TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_guard_item_policy_change() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tg_guard_item_policy_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_set_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_expense(p_entry_id uuid, p_expected_version integer, p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type expense_entry_type, p_payee_type expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode expense_tax_mode) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_expense(p_entry_id uuid, p_expected_version integer, p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type expense_entry_type, p_payee_type expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode expense_tax_mode) TO service_role;
GRANT EXECUTE ON FUNCTION public.warehouse_reference_counts(p_warehouse_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.warehouse_reference_counts(p_warehouse_id uuid) TO service_role;

-- ══════════════════
-- custody_ledger — طبقة الأمانات المبسطة (10_milling_custody.sql)
-- ══════════════════

ALTER TABLE public.custody_ledger ADD CONSTRAINT "custody_ledger_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE public.custody_ledger ADD CONSTRAINT "custody_ledger_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT;
ALTER TABLE public.custody_ledger ADD CONSTRAINT "custody_ledger_item_id_fkey" FOREIGN KEY (item_id) REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE public.custody_ledger ADD CONSTRAINT "custody_ledger_milling_document_id_fkey" FOREIGN KEY (milling_document_id) REFERENCES milling_service_documents(id) ON DELETE RESTRICT;
ALTER TABLE public.custody_ledger ADD CONSTRAINT "custody_ledger_service_invoice_id_fkey" FOREIGN KEY (service_invoice_id) REFERENCES sales_invoices(id) ON DELETE SET NULL;
ALTER TABLE public.custody_ledger ADD CONSTRAINT "custody_ledger_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.milling_service_documents ADD CONSTRAINT "milling_service_documents_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE public.milling_service_documents ADD CONSTRAINT "milling_service_documents_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT;
ALTER TABLE public.milling_service_documents ADD CONSTRAINT "milling_service_documents_sales_invoice_id_fkey" FOREIGN KEY (sales_invoice_id) REFERENCES sales_invoices(id) ON DELETE RESTRICT;
ALTER TABLE public.milling_service_documents ADD CONSTRAINT "milling_service_documents_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.custody_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milling_service_documents ENABLE ROW LEVEL SECURITY;

GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.custody_ledger TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.custody_ledger TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.custody_ledger TO service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.milling_service_documents TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.milling_service_documents TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.milling_service_documents TO service_role;
GRANT SELECT ON public.custody_customer_statement TO anon;
GRANT SELECT ON public.custody_customer_statement TO authenticated;
GRANT SELECT ON public.custody_customer_statement TO service_role;
GRANT SELECT ON public.custody_service_money TO anon;
GRANT SELECT ON public.custody_service_money TO authenticated;
GRANT SELECT ON public.custody_service_money TO service_role;
GRANT SELECT ON public.custody_detected_loss TO anon;
GRANT SELECT ON public.custody_detected_loss TO authenticated;
GRANT SELECT ON public.custody_detected_loss TO service_role;
