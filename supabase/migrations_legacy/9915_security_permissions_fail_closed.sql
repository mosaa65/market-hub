-- 9915_security_permissions_fail_closed.sql
-- Restore the reviewed table/function grants after migration 77's former
-- blanket grants. This migration does not alter data.
BEGIN;

-- Authenticated users must not gain direct write or DDL-like table privileges
-- simply because a relation exists. Regrant only the application's reviewed
-- direct-write set; financial ledgers and derived logs remain RPC/read only.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.accounts,
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
  public.tenant_subscriptions,
  public.units,
  public.user_roles,
  public.vehicle_makes,
  public.vehicle_models,
  public.warehouses,
  public.product_batches,
  public.packaging_types
TO authenticated;

-- Platform administration uses separate RLS policies: only an active
-- superadmin may manage platform admins or append platform audit entries.
GRANT INSERT, UPDATE, DELETE ON public.platform_admins TO authenticated;
GRANT INSERT ON public.platform_audit_logs TO authenticated;

-- Profile identity fields remain editable under RLS, but active status is
-- changed only through the checked RPC below, never through self-update.
REVOKE UPDATE ON public.profiles FROM authenticated;
REVOKE INSERT, DELETE ON public.profiles FROM authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, phone, language) ON public.profiles TO authenticated;
DROP POLICY IF EXISTS profiles_self_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_toggle_active ON public.profiles;
DROP POLICY IF EXISTS profiles_owner_edit_profile ON public.profiles;
CREATE POLICY profiles_owner_edit_profile ON public.profiles
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'owner'::public.app_role)
    OR public.is_platform_superadmin(auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'owner'::public.app_role)
    OR public.is_platform_superadmin(auth.uid())
  );

-- The support platform role is read-only. Only the active superadmin may
-- change subscription entitlements or append platform audit events.
DROP POLICY IF EXISTS tenant_subscriptions_insert ON public.tenant_subscriptions;
CREATE POLICY tenant_subscriptions_insert ON public.tenant_subscriptions
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_superadmin(auth.uid()));
DROP POLICY IF EXISTS tenant_subscriptions_update ON public.tenant_subscriptions;
CREATE POLICY tenant_subscriptions_update ON public.tenant_subscriptions
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_platform_superadmin(auth.uid()))
  WITH CHECK (public.is_platform_superadmin(auth.uid()));

DROP POLICY IF EXISTS platform_audit_logs_insert ON public.platform_audit_logs;
CREATE POLICY platform_audit_logs_insert ON public.platform_audit_logs
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_superadmin(auth.uid()));

-- Backup metadata can contain filenames and operational errors; only store
-- owners/managers may read or append these records.
DROP POLICY IF EXISTS "Users can insert backup logs for their tenant" ON public.backup_logs;
DROP POLICY IF EXISTS "Users can view backup logs for their tenant" ON public.backup_logs;
CREATE POLICY backup_logs_owner_manager_insert ON public.backup_logs
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );
CREATE POLICY backup_logs_owner_manager_read ON public.backup_logs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

-- Do not let an owner accidentally remove or demote the last active store
-- owner. A deferred constraint permits replacing the owner in one transaction.
CREATE OR REPLACE FUNCTION public.prevent_last_active_store_owner_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.role = 'owner'::public.app_role THEN
    PERFORM pg_advisory_xact_lock(9915, hashtext('active-owner-status'));
    IF COALESCE((SELECT p.is_active FROM public.profiles p WHERE p.id = OLD.user_id), false)
       AND NOT EXISTS (
         SELECT 1
         FROM public.user_roles ur
         JOIN public.profiles p ON p.id = ur.user_id
         WHERE ur.role = 'owner'::public.app_role
           AND p.is_active
       ) THEN
      RAISE EXCEPTION 'The last active store owner cannot be removed or demoted'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_keep_active_store_owner ON public.user_roles;
CREATE CONSTRAINT TRIGGER user_roles_keep_active_store_owner
AFTER UPDATE OR DELETE ON public.user_roles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.prevent_last_active_store_owner_removal();

CREATE OR REPLACE FUNCTION public.set_profile_active(p_user_id uuid, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'User and active status are required' USING ERRCODE = '22023';
  END IF;
  IF NOT (
    public.has_role(v_actor, 'owner'::public.app_role)
    OR public.is_platform_superadmin(v_actor)
  ) THEN
    RAISE EXCEPTION 'Only a store owner or platform superadmin may change account status'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id = v_actor AND NOT p_is_active THEN
    RAISE EXCEPTION 'You cannot deactivate your own account' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'Manage platform access through the platform admin registry' USING ERRCODE = '42501';
  END IF;

  -- Serialize deactivation checks so two concurrent requests cannot each
  -- observe the other active owner and deactivate the last two accounts.
  PERFORM pg_advisory_xact_lock(9915, hashtext('active-owner-status'));
  IF NOT p_is_active
     AND EXISTS (
       SELECT 1 FROM public.user_roles
       WHERE user_id = p_user_id AND role = 'owner'::public.app_role
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.user_roles ur
       JOIN public.profiles p ON p.id = ur.user_id
       WHERE ur.role = 'owner'::public.app_role
         AND p.is_active
         AND ur.user_id <> p_user_id
     ) THEN
    RAISE EXCEPTION 'The last active store owner cannot be deactivated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles SET is_active = p_is_active WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_profile_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_profile_active(uuid, boolean) TO authenticated, service_role;

-- Make the active profile flag part of every tenant-role decision. A disabled
-- owner/manager must lose RLS access and SECURITY DEFINER RPC authority too.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF public.is_platform_superadmin(_user_id) THEN RETURN true; END IF;
  IF NOT COALESCE((SELECT p.is_active FROM public.profiles p WHERE p.id = _user_id), false) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND (
        ur.role = _role
        OR ur.role = 'owner'::public.app_role
        OR (ur.role = 'manager'::public.app_role AND _role IN ('cashier', 'warehouse'))
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF public.is_platform_superadmin(_user_id) THEN RETURN true; END IF;
  IF NOT COALESCE((SELECT p.is_active FROM public.profiles p WHERE p.id = _user_id), false) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND (
        ur.role = ANY(_roles)
        OR ur.role = 'owner'::public.app_role
        OR (ur.role = 'manager'::public.app_role
            AND ('cashier'::public.app_role = ANY(_roles)
                 OR 'warehouse'::public.app_role = ANY(_roles)))
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.is_platform_superadmin(_user_id)
    OR (
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
      AND COALESCE((SELECT is_active FROM public.profiles WHERE id = _user_id), false)
    );
$$;
COMMENT ON FUNCTION public.is_staff(uuid) IS
  'يتحقق أن المستخدم عضو نشط في طاقم المتجر أو سوبر أدمن منصة نشط؛ دعم المنصة لا يرث وصول المتجر.';

-- Keep default privileges closed for objects created by the migration role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Preserve least privilege for RPCs. Existing explicit authenticated grants
-- are intentionally left intact; do not broaden access to every public
-- function. This keeps service-only functions service-only while removing
-- PostgreSQL's implicit PUBLIC/anon execution path.
DO $$
DECLARE
  v_fn record;
  v_internal text[] := ARRAY[
    'next_expense_reference', 'next_invoice_number', 'next_purchase_number',
    'next_purchase_return_number', 'next_sales_return_number',
    'next_stock_adjustment_number', 'next_stock_opening_number',
    'next_supplier_voucher_number', 'next_transfer_number',
    'fn_document_numbering_sequence_name',
    'expense_actor', 'expense_assert_capability',
    'expense_can_write_document', 'expense_log_action',
    'payment_method_seed_is_identity_owned', 'audit_item_policy_snapshot',
    'prevent_last_active_store_owner_removal'
  ];
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn.sig);
    IF v_fn.proname = ANY(v_internal) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', v_fn.sig);
    END IF;
  END LOOP;
END $$;

COMMIT;
