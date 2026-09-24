-- ==========================================================
-- 20260918000200_enforce_is_active_in_is_staff.sql
-- Makes a disabled account (profiles.is_active = false) actually fail RLS.
--
-- WHY: public.is_staff(uuid) was the single predicate gating the SELECT/ALL
-- policies of every tenant table (products, inventory, sales_invoices,
-- purchase_invoices, customers, suppliers, warehouses, categories, brands,
-- units, expenses, returns, transfers, stock_movements, ...). It only checked
-- that a row existed in user_roles and completely ignored user status.
-- Therefore setting profiles.is_active = false would have been COSMETIC: the
-- disabled user could still read and write all tenant data through the API.
--
-- CHANGE: is_staff now additionally requires the caller to be an active
-- profile. A user with is_active = false fails every policy that depends on
-- is_staff, so the block is enforced by the database, not by the UI.
--
-- SAFETY / SCOPE:
--   * Only this one function body is replaced. No row is modified or deleted.
--   * No CASCADE. No table, column, policy or data is touched.
--   * Fully reversible: re-enabling the account restores access immediately
--     because the check reads the live profiles row.
--   * Platform Super Admins are NOT affected: they authenticate through the
--     separate public.platform_admins table and are managed by
--     is_platform_admin()/is_platform_superadmin(), which do not call
--     is_staff(). An owner who is also a platform admin keeps platform access
--     even if their tenant profile is deactivated.
--   * The COALESCE(..., true) fallback keeps behaviour unchanged for any user
--     id that has no profiles row (should not happen, but must not silently
--     deny access during rollout).
-- ==========================================================

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
    AND COALESCE((SELECT is_active FROM public.profiles WHERE id = _user_id), true)
$$;

-- Re-assert the hardened execute grants from 20260621011959 so the function
-- ends in a known, non-widened state.
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon, authenticated;