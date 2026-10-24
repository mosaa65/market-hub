-- Return the mapped chart-of-accounts entry with every expense category so
-- operators can see where an ordinary expense will be posted.
CREATE OR REPLACE FUNCTION public.expense_lookups(p_include_archived boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id,
               'name', c.name,
               'name_ar', c.name_ar,
               'is_active', c.is_active,
               'sort_order', c.sort_order,
               'usage_count', (SELECT count(*) FROM public.expense_lines l WHERE l.category_id = c.id),
               'account_id', c.account_id,
               'account_code', a.code,
               'account_name_ar', a.name_ar
             ) ORDER BY c.sort_order, c.name)
      FROM public.expense_categories c
      LEFT JOIN public.accounts a ON a.id = c.account_id
      WHERE p_include_archived OR c.is_active
    ), '[]'::jsonb),
    'warehouses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', w.id, 'name', w.name, 'name_ar', w.name_ar, 'is_default', w.is_default
             ) ORDER BY w.name)
      FROM public.warehouses w
      WHERE w.is_active IS NOT FALSE
    ), '[]'::jsonb),
    'cost_centers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', cc.id, 'code', cc.code, 'name', cc.name, 'name_ar', cc.name_ar
             ) ORDER BY cc.name)
      FROM public.expense_cost_centers cc
      WHERE cc.is_active
    ), '[]'::jsonb),
    'projects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', pj.id, 'code', pj.code, 'name', pj.name, 'name_ar', pj.name_ar
             ) ORDER BY pj.name)
      FROM public.expense_projects pj
      WHERE pj.is_active
    ), '[]'::jsonb),
    'suppliers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
      FROM public.suppliers s
      WHERE s.is_active IS NOT FALSE
    ), '[]'::jsonb),
    'employees', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) ORDER BY p.full_name)
      FROM public.profiles p
      WHERE p.is_active IS NOT FALSE
        AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p.id)
        AND p.full_name NOT ILIKE '%سوبر%'
        AND p.full_name NOT ILIKE '%superadmin%'
    ), '[]'::jsonb),
    'financial_accounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', a.id, 'code', a.code, 'name_ar', a.name_ar,
               'account_type', a.account_type,
               'requires_reconciliation', a.requires_reconciliation
             ) ORDER BY a.code)
      FROM public.accounts a
      WHERE a.is_active IS NOT FALSE
        AND (a.requires_reconciliation IS TRUE OR a.code LIKE '11%')
    ), '[]'::jsonb)
  )
$function$;

GRANT EXECUTE ON FUNCTION public.expense_lookups(boolean) TO authenticated, service_role;
