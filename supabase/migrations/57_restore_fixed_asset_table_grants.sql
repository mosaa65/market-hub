-- Restore the authenticated table privileges removed by migration 36's
-- allowlist. Row visibility and writes remain constrained by the existing RLS
-- policies from migration 25.
GRANT SELECT, INSERT, UPDATE ON public.fixed_assets TO authenticated;
GRANT SELECT ON public.asset_depreciation_lines TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.fixed_assets TO service_role;
GRANT SELECT ON public.asset_depreciation_lines TO service_role;