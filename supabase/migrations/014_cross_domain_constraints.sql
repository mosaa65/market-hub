-- ============================================================================
-- الترحيل 015_cross_domain_constraints.sql — مجال: cross_domain_constraints
-- جزء من خط الأساس الجديد: تعريف نهائي واحد لكل كائن، مبني من مخطط مرجعي
-- مستخرج من الترحيلات التاريخية الكاملة (راجع supabase/migrations/README.md).
-- ============================================================================

--
-- Name: accounts accounts_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.accounts(id) ON DELETE RESTRICT;

--
-- Name: ad_hoc_service_lines ad_hoc_service_lines_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.ad_hoc_service_lines
    ADD CONSTRAINT ad_hoc_service_lines_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.sales_invoices(id) ON DELETE CASCADE;

--
-- Name: ad_hoc_service_lines ad_hoc_service_lines_invoice_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.ad_hoc_service_lines
    ADD CONSTRAINT ad_hoc_service_lines_invoice_item_id_fkey FOREIGN KEY (invoice_item_id) REFERENCES public.sales_invoice_items(id) ON DELETE SET NULL;

--
-- Name: amortization_lines amortization_lines_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.amortization_lines
    ADD CONSTRAINT amortization_lines_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.prepaid_and_deferred_contracts(id) ON DELETE RESTRICT;

--
-- Name: amortization_lines amortization_lines_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.amortization_lines
    ADD CONSTRAINT amortization_lines_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id);

--
-- Name: asset_depreciation_lines asset_depreciation_lines_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.asset_depreciation_lines
    ADD CONSTRAINT asset_depreciation_lines_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.fixed_assets(id) ON DELETE RESTRICT;

--
-- Name: asset_depreciation_lines asset_depreciation_lines_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.asset_depreciation_lines
    ADD CONSTRAINT asset_depreciation_lines_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id);

--
-- Name: cashboxes cashboxes_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.cashboxes
    ADD CONSTRAINT cashboxes_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT;

--
-- Name: cashboxes cashboxes_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.cashboxes
    ADD CONSTRAINT cashboxes_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;

--
-- Name: categories categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE SET NULL;

--
-- Name: cheques_register cheques_register_clearing_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.cheques_register
    ADD CONSTRAINT cheques_register_clearing_bank_account_id_fkey FOREIGN KEY (clearing_bank_account_id) REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL;

--
-- Name: cheques_register cheques_register_clearing_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.cheques_register
    ADD CONSTRAINT cheques_register_clearing_journal_entry_id_fkey FOREIGN KEY (clearing_journal_entry_id) REFERENCES public.journal_entries(id) ON DELETE SET NULL;

--
-- Name: cheques_register cheques_register_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.cheques_register
    ADD CONSTRAINT cheques_register_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;

--
-- Name: cheques_register cheques_register_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.cheques_register
    ADD CONSTRAINT cheques_register_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.sales_invoices(id) ON DELETE SET NULL;

--
-- Name: cheques_register cheques_register_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.cheques_register
    ADD CONSTRAINT cheques_register_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.customer_payments(id) ON DELETE SET NULL;

--
-- Name: company_bank_accounts company_bank_accounts_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.company_bank_accounts
    ADD CONSTRAINT company_bank_accounts_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT;

--
-- Name: company_items company_items_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.company_items
    ADD CONSTRAINT company_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company_settings(id) ON DELETE CASCADE;

--
-- Name: company_items company_items_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.company_items
    ADD CONSTRAINT company_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.products(id) ON DELETE CASCADE;

--
-- Name: custody_ledger custody_ledger_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.custody_ledger
    ADD CONSTRAINT custody_ledger_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

--
-- Name: custody_ledger custody_ledger_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.custody_ledger
    ADD CONSTRAINT custody_ledger_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.products(id) ON DELETE RESTRICT;

--
-- Name: custody_ledger custody_ledger_milling_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.custody_ledger
    ADD CONSTRAINT custody_ledger_milling_document_id_fkey FOREIGN KEY (milling_document_id) REFERENCES public.milling_service_documents(id) ON DELETE RESTRICT;

--
-- Name: custody_ledger custody_ledger_service_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.custody_ledger
    ADD CONSTRAINT custody_ledger_service_invoice_id_fkey FOREIGN KEY (service_invoice_id) REFERENCES public.sales_invoices(id) ON DELETE SET NULL;

--
-- Name: custody_ledger custody_ledger_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.custody_ledger
    ADD CONSTRAINT custody_ledger_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT;

--
-- Name: customer_balance_adjustments customer_balance_adjustments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_balance_adjustments
    ADD CONSTRAINT customer_balance_adjustments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

--
-- Name: customer_ledger customer_ledger_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_ledger
    ADD CONSTRAINT customer_ledger_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

--
-- Name: customer_payment_splits customer_payment_splits_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_payment_splits
    ADD CONSTRAINT customer_payment_splits_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL;

--
-- Name: customer_payment_splits customer_payment_splits_cashbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_payment_splits
    ADD CONSTRAINT customer_payment_splits_cashbox_id_fkey FOREIGN KEY (cashbox_id) REFERENCES public.cashboxes(id) ON DELETE SET NULL;

--
-- Name: customer_payment_splits customer_payment_splits_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_payment_splits
    ADD CONSTRAINT customer_payment_splits_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

--
-- Name: customer_payment_splits customer_payment_splits_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_payment_splits
    ADD CONSTRAINT customer_payment_splits_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.sales_invoices(id) ON DELETE CASCADE;

--
-- Name: customer_payment_splits customer_payment_splits_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_payment_splits
    ADD CONSTRAINT customer_payment_splits_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.customer_payments(id) ON DELETE CASCADE;

--
-- Name: customer_payment_splits customer_payment_splits_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_payment_splits
    ADD CONSTRAINT customer_payment_splits_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON DELETE SET NULL;

--
-- Name: customer_payments customer_payments_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_payments
    ADD CONSTRAINT customer_payments_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL;

--
-- Name: customer_payments customer_payments_cashbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_payments
    ADD CONSTRAINT customer_payments_cashbox_id_fkey FOREIGN KEY (cashbox_id) REFERENCES public.cashboxes(id) ON DELETE SET NULL;

--
-- Name: customer_payments customer_payments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_payments
    ADD CONSTRAINT customer_payments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

--
-- Name: customer_payments customer_payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_payments
    ADD CONSTRAINT customer_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.sales_invoices(id) ON DELETE SET NULL;

--
-- Name: customer_payments customer_payments_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.customer_payments
    ADD CONSTRAINT customer_payments_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON DELETE SET NULL;

--
-- Name: device_registrations device_registrations_assigned_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.device_registrations
    ADD CONSTRAINT device_registrations_assigned_warehouse_id_fkey FOREIGN KEY (assigned_warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;

--
-- Name: expense_approvals expense_approvals_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_approvals
    ADD CONSTRAINT expense_approvals_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.expense_entries(id) ON DELETE CASCADE;

--
-- Name: expense_attachments expense_attachments_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_attachments
    ADD CONSTRAINT expense_attachments_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.expense_entries(id) ON DELETE CASCADE;

--
-- Name: expense_attachments expense_attachments_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_attachments
    ADD CONSTRAINT expense_attachments_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.expense_lines(id) ON DELETE CASCADE;

--
-- Name: expense_categories expense_categories_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

--
-- Name: expense_entries expense_entries_cost_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_entries
    ADD CONSTRAINT expense_entries_cost_center_id_fkey FOREIGN KEY (cost_center_id) REFERENCES public.expense_cost_centers(id) ON DELETE SET NULL;

--
-- Name: expense_entries expense_entries_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_entries
    ADD CONSTRAINT expense_entries_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.expense_projects(id) ON DELETE SET NULL;

--
-- Name: expense_entries expense_entries_reversal_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_entries
    ADD CONSTRAINT expense_entries_reversal_of_fkey FOREIGN KEY (reversal_of) REFERENCES public.expense_entries(id) ON DELETE SET NULL;

--
-- Name: expense_entries expense_entries_reversed_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_entries
    ADD CONSTRAINT expense_entries_reversed_by_id_fkey FOREIGN KEY (reversed_by_id) REFERENCES public.expense_entries(id) ON DELETE SET NULL;

--
-- Name: expense_entries expense_entries_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_entries
    ADD CONSTRAINT expense_entries_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;

--
-- Name: expense_entries expense_entries_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_entries
    ADD CONSTRAINT expense_entries_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;

--
-- Name: expense_ledger_account_mappings expense_ledger_account_mappings_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_ledger_account_mappings
    ADD CONSTRAINT expense_ledger_account_mappings_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT;

--
-- Name: expense_lines expense_lines_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_lines
    ADD CONSTRAINT expense_lines_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.expense_categories(id) ON DELETE SET NULL;

--
-- Name: expense_lines expense_lines_cost_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_lines
    ADD CONSTRAINT expense_lines_cost_center_id_fkey FOREIGN KEY (cost_center_id) REFERENCES public.expense_cost_centers(id) ON DELETE SET NULL;

--
-- Name: expense_lines expense_lines_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_lines
    ADD CONSTRAINT expense_lines_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.expense_entries(id) ON DELETE CASCADE;

--
-- Name: expense_lines expense_lines_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_lines
    ADD CONSTRAINT expense_lines_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.expense_projects(id) ON DELETE SET NULL;

--
-- Name: expense_payments expense_payments_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_payments
    ADD CONSTRAINT expense_payments_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

--
-- Name: expense_payments expense_payments_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_payments
    ADD CONSTRAINT expense_payments_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL;

--
-- Name: expense_payments expense_payments_cashbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_payments
    ADD CONSTRAINT expense_payments_cashbox_id_fkey FOREIGN KEY (cashbox_id) REFERENCES public.cashboxes(id) ON DELETE SET NULL;

--
-- Name: expense_payments expense_payments_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_payments
    ADD CONSTRAINT expense_payments_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.expense_entries(id) ON DELETE RESTRICT;

--
-- Name: expense_payments expense_payments_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_payments
    ADD CONSTRAINT expense_payments_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON DELETE SET NULL;

--
-- Name: expense_payments expense_payments_reversal_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_payments
    ADD CONSTRAINT expense_payments_reversal_of_fkey FOREIGN KEY (reversal_of) REFERENCES public.expense_payments(id) ON DELETE SET NULL;

--
-- Name: expense_payments expense_payments_reversed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_payments
    ADD CONSTRAINT expense_payments_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES public.expense_payments(id) ON DELETE SET NULL;

--
-- Name: expenses expenses_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.expense_categories(id) ON DELETE SET NULL;

--
-- Name: grain_types grain_types_representative_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.grain_types
    ADD CONSTRAINT grain_types_representative_product_id_fkey FOREIGN KEY (representative_product_id) REFERENCES public.products(id) ON DELETE SET NULL;

--
-- Name: inventory inventory_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

--
-- Name: inventory inventory_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE;

--
-- Name: item_cost_layers item_cost_layers_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.item_cost_layers
    ADD CONSTRAINT item_cost_layers_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

--
-- Name: item_cost_layers item_cost_layers_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.item_cost_layers
    ADD CONSTRAINT item_cost_layers_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE;

--
-- Name: item_cost_transactions item_cost_transactions_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.item_cost_transactions
    ADD CONSTRAINT item_cost_transactions_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

--
-- Name: item_cost_transactions item_cost_transactions_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.item_cost_transactions
    ADD CONSTRAINT item_cost_transactions_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE;

--
-- Name: item_policy_review_queue item_policy_review_queue_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.item_policy_review_queue
    ADD CONSTRAINT item_policy_review_queue_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

--
-- Name: journal_entries journal_entries_reverses_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_reverses_id_fkey FOREIGN KEY (reverses_id) REFERENCES public.journal_entries(id) ON DELETE RESTRICT;

--
-- Name: journal_lines journal_lines_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT;

--
-- Name: journal_lines journal_lines_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;

--
-- Name: loyalty_transactions loyalty_transactions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

--
-- Name: milling_service_documents milling_service_documents_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.milling_service_documents
    ADD CONSTRAINT milling_service_documents_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

--
-- Name: milling_service_documents milling_service_documents_sales_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.milling_service_documents
    ADD CONSTRAINT milling_service_documents_sales_invoice_id_fkey FOREIGN KEY (sales_invoice_id) REFERENCES public.sales_invoices(id) ON DELETE RESTRICT;

--
-- Name: milling_service_documents milling_service_documents_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.milling_service_documents
    ADD CONSTRAINT milling_service_documents_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT;

--
-- Name: opening_balance_documents opening_balance_documents_reverses_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.opening_balance_documents
    ADD CONSTRAINT opening_balance_documents_reverses_document_id_fkey FOREIGN KEY (reverses_document_id) REFERENCES public.opening_balance_documents(id);

--
-- Name: opening_balance_lines opening_balance_lines_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.opening_balance_lines
    ADD CONSTRAINT opening_balance_lines_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

--
-- Name: opening_balance_lines opening_balance_lines_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.opening_balance_lines
    ADD CONSTRAINT opening_balance_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.opening_balance_documents(id) ON DELETE CASCADE;

--
-- Name: opening_balance_lines opening_balance_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.opening_balance_lines
    ADD CONSTRAINT opening_balance_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;

--
-- Name: opening_balance_lines opening_balance_lines_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.opening_balance_lines
    ADD CONSTRAINT opening_balance_lines_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;

--
-- Name: opening_balance_lines opening_balance_lines_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.opening_balance_lines
    ADD CONSTRAINT opening_balance_lines_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT;

--
-- Name: payment_method_settings payment_method_settings_default_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.payment_method_settings
    ADD CONSTRAINT payment_method_settings_default_account_id_fkey FOREIGN KEY (default_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

--
-- Name: payment_method_settings payment_method_settings_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.payment_method_settings
    ADD CONSTRAINT payment_method_settings_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON DELETE CASCADE;

--
-- Name: payment_splits payment_splits_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.payment_splits
    ADD CONSTRAINT payment_splits_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL;

--
-- Name: payment_splits payment_splits_cashbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.payment_splits
    ADD CONSTRAINT payment_splits_cashbox_id_fkey FOREIGN KEY (cashbox_id) REFERENCES public.cashboxes(id) ON DELETE SET NULL;

--
-- Name: payment_splits payment_splits_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.payment_splits
    ADD CONSTRAINT payment_splits_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON DELETE SET NULL;

--
-- Name: platform_audit_logs platform_audit_logs_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.platform_audit_logs
    ADD CONSTRAINT platform_audit_logs_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.platform_admins(id) ON DELETE SET NULL;

--
-- Name: product_batches product_batches_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_batches
    ADD CONSTRAINT product_batches_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

--
-- Name: product_batches product_batches_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_batches
    ADD CONSTRAINT product_batches_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE;

--
-- Name: product_compatibilities product_compatibilities_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_compatibilities
    ADD CONSTRAINT product_compatibilities_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

--
-- Name: product_compatibilities product_compatibilities_vehicle_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_compatibilities
    ADD CONSTRAINT product_compatibilities_vehicle_model_id_fkey FOREIGN KEY (vehicle_model_id) REFERENCES public.vehicle_models(id) ON DELETE CASCADE;

--
-- Name: product_uom_barcodes product_uom_barcodes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_uom_barcodes
    ADD CONSTRAINT product_uom_barcodes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company_settings(id) ON DELETE CASCADE;

--
-- Name: product_uom_barcodes product_uom_barcodes_product_uom_fk; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_uom_barcodes
    ADD CONSTRAINT product_uom_barcodes_product_uom_fk FOREIGN KEY (product_uom_id, product_id) REFERENCES public.product_uoms(id, product_id) ON DELETE CASCADE;

--
-- Name: product_uom_prices product_uom_prices_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_uom_prices
    ADD CONSTRAINT product_uom_prices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company_settings(id) ON DELETE CASCADE;

--
-- Name: product_uom_prices product_uom_prices_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_uom_prices
    ADD CONSTRAINT product_uom_prices_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

--
-- Name: product_uom_prices product_uom_prices_product_uom_fk; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_uom_prices
    ADD CONSTRAINT product_uom_prices_product_uom_fk FOREIGN KEY (product_uom_id, product_id) REFERENCES public.product_uoms(id, product_id) ON DELETE CASCADE;

--
-- Name: product_uoms product_uoms_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_uoms
    ADD CONSTRAINT product_uoms_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

--
-- Name: product_uoms product_uoms_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_uoms
    ADD CONSTRAINT product_uoms_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE RESTRICT;

--
-- Name: production_order_batch_allocations production_order_batch_allocations_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_batch_allocations
    ADD CONSTRAINT production_order_batch_allocations_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.product_batches(id) ON DELETE RESTRICT;

--
-- Name: production_order_batch_allocations production_order_batch_allocations_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_batch_allocations
    ADD CONSTRAINT production_order_batch_allocations_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.production_order_materials(id) ON DELETE CASCADE;

--
-- Name: production_order_cost_allocations production_order_cost_allocations_cost_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_cost_allocations
    ADD CONSTRAINT production_order_cost_allocations_cost_center_id_fkey FOREIGN KEY (cost_center_id) REFERENCES public.expense_cost_centers(id) ON DELETE RESTRICT;

--
-- Name: production_order_cost_allocations production_order_cost_allocations_expense_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_cost_allocations
    ADD CONSTRAINT production_order_cost_allocations_expense_entry_id_fkey FOREIGN KEY (expense_entry_id) REFERENCES public.expense_entries(id) ON DELETE RESTRICT;

--
-- Name: production_order_cost_allocations production_order_cost_allocations_expense_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_cost_allocations
    ADD CONSTRAINT production_order_cost_allocations_expense_line_id_fkey FOREIGN KEY (expense_line_id) REFERENCES public.expense_lines(id) ON DELETE RESTRICT;

--
-- Name: production_order_cost_allocations production_order_cost_allocations_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_cost_allocations
    ADD CONSTRAINT production_order_cost_allocations_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON DELETE RESTRICT;

--
-- Name: production_order_cost_allocations production_order_cost_allocations_production_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_cost_allocations
    ADD CONSTRAINT production_order_cost_allocations_production_order_id_fkey FOREIGN KEY (production_order_id) REFERENCES public.production_orders(id) ON DELETE CASCADE;

--
-- Name: production_order_losses production_order_losses_production_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_losses
    ADD CONSTRAINT production_order_losses_production_order_id_fkey FOREIGN KEY (production_order_id) REFERENCES public.production_orders(id) ON DELETE CASCADE;

--
-- Name: production_order_losses production_order_losses_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_losses
    ADD CONSTRAINT production_order_losses_uom_id_fkey FOREIGN KEY (uom_id) REFERENCES public.units(id) ON DELETE RESTRICT;

--
-- Name: production_order_materials production_order_materials_base_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_materials
    ADD CONSTRAINT production_order_materials_base_uom_id_fkey FOREIGN KEY (base_uom_id) REFERENCES public.units(id) ON DELETE RESTRICT;

--
-- Name: production_order_materials production_order_materials_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_materials
    ADD CONSTRAINT production_order_materials_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;

--
-- Name: production_order_materials production_order_materials_production_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_materials
    ADD CONSTRAINT production_order_materials_production_order_id_fkey FOREIGN KEY (production_order_id) REFERENCES public.production_orders(id) ON DELETE CASCADE;

--
-- Name: production_order_materials production_order_materials_stock_movement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_materials
    ADD CONSTRAINT production_order_materials_stock_movement_id_fkey FOREIGN KEY (stock_movement_id) REFERENCES public.stock_movements(id) ON DELETE RESTRICT;

--
-- Name: production_order_materials production_order_materials_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_materials
    ADD CONSTRAINT production_order_materials_uom_id_fkey FOREIGN KEY (uom_id) REFERENCES public.units(id) ON DELETE RESTRICT;

--
-- Name: production_order_outputs production_order_outputs_base_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_outputs
    ADD CONSTRAINT production_order_outputs_base_uom_id_fkey FOREIGN KEY (base_uom_id) REFERENCES public.units(id) ON DELETE RESTRICT;

--
-- Name: production_order_outputs production_order_outputs_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_outputs
    ADD CONSTRAINT production_order_outputs_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.product_batches(id) ON DELETE RESTRICT;

--
-- Name: production_order_outputs production_order_outputs_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_outputs
    ADD CONSTRAINT production_order_outputs_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;

--
-- Name: production_order_outputs production_order_outputs_production_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_outputs
    ADD CONSTRAINT production_order_outputs_production_order_id_fkey FOREIGN KEY (production_order_id) REFERENCES public.production_orders(id) ON DELETE CASCADE;

--
-- Name: production_order_outputs production_order_outputs_stock_movement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_outputs
    ADD CONSTRAINT production_order_outputs_stock_movement_id_fkey FOREIGN KEY (stock_movement_id) REFERENCES public.stock_movements(id) ON DELETE RESTRICT;

--
-- Name: production_order_outputs production_order_outputs_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_outputs
    ADD CONSTRAINT production_order_outputs_uom_id_fkey FOREIGN KEY (uom_id) REFERENCES public.units(id) ON DELETE RESTRICT;

--
-- Name: production_orders production_orders_cost_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_cost_center_id_fkey FOREIGN KEY (cost_center_id) REFERENCES public.expense_cost_centers(id) ON DELETE RESTRICT;

--
-- Name: production_orders production_orders_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT;

--
-- Name: products products_base_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_base_uom_id_fkey FOREIGN KEY (base_uom_id) REFERENCES public.units(id) ON DELETE SET NULL;

--
-- Name: products products_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;

--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;

--
-- Name: products products_origin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_origin_id_fkey FOREIGN KEY (origin_id) REFERENCES public.countries_of_origin(id) ON DELETE SET NULL;

--
-- Name: products products_package_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_package_type_id_fkey FOREIGN KEY (package_type_id) REFERENCES public.packaging_types(id) ON DELETE SET NULL;

--
-- Name: products products_purchase_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_purchase_uom_id_fkey FOREIGN KEY (purchase_uom_id) REFERENCES public.units(id) ON DELETE SET NULL;

--
-- Name: products products_quality_grade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_quality_grade_id_fkey FOREIGN KEY (quality_grade_id) REFERENCES public.quality_grades(id) ON DELETE SET NULL;

--
-- Name: products products_sales_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sales_uom_id_fkey FOREIGN KEY (sales_uom_id) REFERENCES public.units(id) ON DELETE SET NULL;

--
-- Name: products products_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE SET NULL;

--
-- Name: purchase_invoice_items purchase_invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_invoice_items
    ADD CONSTRAINT purchase_invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.purchase_invoices(id) ON DELETE CASCADE;

--
-- Name: purchase_invoice_items purchase_invoice_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_invoice_items
    ADD CONSTRAINT purchase_invoice_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);

--
-- Name: purchase_invoice_items purchase_invoice_items_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_invoice_items
    ADD CONSTRAINT purchase_invoice_items_uom_id_fkey FOREIGN KEY (uom_id) REFERENCES public.units(id) ON DELETE SET NULL;

--
-- Name: purchase_invoices purchase_invoices_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL;

--
-- Name: purchase_invoices purchase_invoices_cashbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_cashbox_id_fkey FOREIGN KEY (cashbox_id) REFERENCES public.cashboxes(id) ON DELETE SET NULL;

--
-- Name: purchase_invoices purchase_invoices_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON DELETE SET NULL;

--
-- Name: purchase_invoices purchase_invoices_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;

--
-- Name: purchase_invoices purchase_invoices_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;

--
-- Name: purchase_return_item_batch_allocations purchase_return_item_batch_alloca_purchase_invoice_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_return_item_batch_allocations
    ADD CONSTRAINT purchase_return_item_batch_alloca_purchase_invoice_item_id_fkey FOREIGN KEY (purchase_invoice_item_id) REFERENCES public.purchase_invoice_items(id) ON DELETE RESTRICT;

--
-- Name: purchase_return_item_batch_allocations purchase_return_item_batch_allocat_purchase_return_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_return_item_batch_allocations
    ADD CONSTRAINT purchase_return_item_batch_allocat_purchase_return_item_id_fkey FOREIGN KEY (purchase_return_item_id) REFERENCES public.purchase_return_items(id) ON DELETE CASCADE;

--
-- Name: purchase_return_item_batch_allocations purchase_return_item_batch_allocations_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_return_item_batch_allocations
    ADD CONSTRAINT purchase_return_item_batch_allocations_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.product_batches(id) ON DELETE RESTRICT;

--
-- Name: purchase_return_items purchase_return_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_return_items
    ADD CONSTRAINT purchase_return_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);

--
-- Name: purchase_return_items purchase_return_items_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_return_items
    ADD CONSTRAINT purchase_return_items_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.purchase_returns(id) ON DELETE CASCADE;

--
-- Name: purchase_return_items purchase_return_items_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_return_items
    ADD CONSTRAINT purchase_return_items_uom_id_fkey FOREIGN KEY (uom_id) REFERENCES public.units(id) ON DELETE SET NULL;

--
-- Name: purchase_returns purchase_returns_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL;

--
-- Name: purchase_returns purchase_returns_cashbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_cashbox_id_fkey FOREIGN KEY (cashbox_id) REFERENCES public.cashboxes(id) ON DELETE SET NULL;

--
-- Name: purchase_returns purchase_returns_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.purchase_invoices(id) ON DELETE SET NULL;

--
-- Name: purchase_returns purchase_returns_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON DELETE SET NULL;

--
-- Name: purchase_returns purchase_returns_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;

--
-- Name: purchase_returns purchase_returns_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id);

--
-- Name: sales_invoice_item_batch_allocations sales_invoice_item_batch_allocations_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_invoice_item_batch_allocations
    ADD CONSTRAINT sales_invoice_item_batch_allocations_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.product_batches(id) ON DELETE RESTRICT;

--
-- Name: sales_invoice_item_batch_allocations sales_invoice_item_batch_allocations_sales_invoice_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_invoice_item_batch_allocations
    ADD CONSTRAINT sales_invoice_item_batch_allocations_sales_invoice_item_id_fkey FOREIGN KEY (sales_invoice_item_id) REFERENCES public.sales_invoice_items(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

--
-- Name: sales_invoice_items sales_invoice_items_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_invoice_items
    ADD CONSTRAINT sales_invoice_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.product_batches(id) ON DELETE SET NULL;

--
-- Name: sales_invoice_items sales_invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_invoice_items
    ADD CONSTRAINT sales_invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.sales_invoices(id) ON DELETE CASCADE;

--
-- Name: sales_invoice_items sales_invoice_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_invoice_items
    ADD CONSTRAINT sales_invoice_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);

--
-- Name: sales_invoice_items sales_invoice_items_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_invoice_items
    ADD CONSTRAINT sales_invoice_items_uom_id_fkey FOREIGN KEY (uom_id) REFERENCES public.units(id) ON DELETE SET NULL;

--
-- Name: sales_invoices sales_invoices_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL;

--
-- Name: sales_invoices sales_invoices_cashbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_cashbox_id_fkey FOREIGN KEY (cashbox_id) REFERENCES public.cashboxes(id) ON DELETE SET NULL;

--
-- Name: sales_invoices sales_invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;

--
-- Name: sales_invoices sales_invoices_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON DELETE SET NULL;

--
-- Name: sales_invoices sales_invoices_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;

--
-- Name: sales_return_item_batch_allocations sales_return_item_batch_allocations_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_return_item_batch_allocations
    ADD CONSTRAINT sales_return_item_batch_allocations_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.product_batches(id) ON DELETE RESTRICT;

--
-- Name: sales_return_item_batch_allocations sales_return_item_batch_allocations_sales_invoice_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_return_item_batch_allocations
    ADD CONSTRAINT sales_return_item_batch_allocations_sales_invoice_item_id_fkey FOREIGN KEY (sales_invoice_item_id) REFERENCES public.sales_invoice_items(id) ON DELETE RESTRICT;

--
-- Name: sales_return_item_batch_allocations sales_return_item_batch_allocations_sales_return_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_return_item_batch_allocations
    ADD CONSTRAINT sales_return_item_batch_allocations_sales_return_item_id_fkey FOREIGN KEY (sales_return_item_id) REFERENCES public.sales_return_items(id) ON DELETE CASCADE;

--
-- Name: sales_return_items sales_return_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_return_items
    ADD CONSTRAINT sales_return_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);

--
-- Name: sales_return_items sales_return_items_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_return_items
    ADD CONSTRAINT sales_return_items_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.sales_returns(id) ON DELETE CASCADE;

--
-- Name: sales_return_items sales_return_items_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_return_items
    ADD CONSTRAINT sales_return_items_uom_id_fkey FOREIGN KEY (uom_id) REFERENCES public.units(id) ON DELETE SET NULL;

--
-- Name: sales_returns sales_returns_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_returns
    ADD CONSTRAINT sales_returns_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL;

--
-- Name: sales_returns sales_returns_cashbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_returns
    ADD CONSTRAINT sales_returns_cashbox_id_fkey FOREIGN KEY (cashbox_id) REFERENCES public.cashboxes(id) ON DELETE SET NULL;

--
-- Name: sales_returns sales_returns_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_returns
    ADD CONSTRAINT sales_returns_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;

--
-- Name: sales_returns sales_returns_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_returns
    ADD CONSTRAINT sales_returns_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.sales_invoices(id) ON DELETE SET NULL;

--
-- Name: sales_returns sales_returns_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_returns
    ADD CONSTRAINT sales_returns_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON DELETE SET NULL;

--
-- Name: sales_returns sales_returns_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_returns
    ADD CONSTRAINT sales_returns_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id);

--
-- Name: stock_adjustment_items stock_adjustment_items_adjustment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_adjustment_items
    ADD CONSTRAINT stock_adjustment_items_adjustment_id_fkey FOREIGN KEY (adjustment_id) REFERENCES public.stock_adjustments(id) ON DELETE CASCADE;

--
-- Name: stock_adjustment_items stock_adjustment_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_adjustment_items
    ADD CONSTRAINT stock_adjustment_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);

--
-- Name: stock_adjustments stock_adjustments_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_adjustments
    ADD CONSTRAINT stock_adjustments_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id);

--
-- Name: stock_movements stock_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

--
-- Name: stock_movements stock_movements_production_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_production_order_id_fkey FOREIGN KEY (production_order_id) REFERENCES public.production_orders(id) ON DELETE RESTRICT;

--
-- Name: stock_movements stock_movements_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE;

--
-- Name: stock_opening_items stock_opening_items_opening_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_opening_items
    ADD CONSTRAINT stock_opening_items_opening_id_fkey FOREIGN KEY (opening_id) REFERENCES public.stock_openings(id) ON DELETE CASCADE;

--
-- Name: stock_opening_items stock_opening_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_opening_items
    ADD CONSTRAINT stock_opening_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);

--
-- Name: stock_openings stock_openings_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_openings
    ADD CONSTRAINT stock_openings_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id);

--
-- Name: stock_transfer_items stock_transfer_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);

--
-- Name: stock_transfer_items stock_transfer_items_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.stock_transfers(id) ON DELETE CASCADE;

--
-- Name: stock_transfers stock_transfers_from_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_from_warehouse_id_fkey FOREIGN KEY (from_warehouse_id) REFERENCES public.warehouses(id);

--
-- Name: stock_transfers stock_transfers_to_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_to_warehouse_id_fkey FOREIGN KEY (to_warehouse_id) REFERENCES public.warehouses(id);

--
-- Name: supplier_ledger supplier_ledger_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.supplier_ledger
    ADD CONSTRAINT supplier_ledger_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;

--
-- Name: supplier_payments supplier_payments_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL;

--
-- Name: supplier_payments supplier_payments_cashbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_cashbox_id_fkey FOREIGN KEY (cashbox_id) REFERENCES public.cashboxes(id) ON DELETE SET NULL;

--
-- Name: supplier_payments supplier_payments_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON DELETE SET NULL;

--
-- Name: supplier_payments supplier_payments_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;

--
-- Name: tax_settlement_periods tax_settlement_periods_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.tax_settlement_periods
    ADD CONSTRAINT tax_settlement_periods_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id);

--
-- Name: tax_settlement_periods tax_settlement_periods_payment_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.tax_settlement_periods
    ADD CONSTRAINT tax_settlement_periods_payment_journal_entry_id_fkey FOREIGN KEY (payment_journal_entry_id) REFERENCES public.journal_entries(id);

--
-- Name: tenant_subscriptions tenant_subscriptions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.tenant_subscriptions
    ADD CONSTRAINT tenant_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.platform_plans(id) ON UPDATE CASCADE;

--
-- Name: vehicle_models vehicle_models_make_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.vehicle_models
    ADD CONSTRAINT vehicle_models_make_id_fkey FOREIGN KEY (make_id) REFERENCES public.vehicle_makes(id) ON DELETE CASCADE;
