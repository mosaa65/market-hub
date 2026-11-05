-- The split row is a document STATE, not a collection method. The audit was
-- reporting it as "active method without a chart account", which put a permanent
-- false warning in Settings and in any release health check.
--
-- Fix: treat OTHER-family rows (the split marker) like credit — nothing is
-- collected, so there is nothing to link, and that is correct rather than a
-- defect. The flag becomes true for exactly the rows an operator can pick.

BEGIN;

CREATE OR REPLACE FUNCTION public.payment_method_account_linkage()
RETURNS TABLE (
  method_id            text,
  method_name          text,
  ledger_kind          text,
  is_active            boolean,
  account_code         text,
  account_name         text,
  account_exists       boolean,
  account_postable     boolean,
  is_healthy           boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id                        AS method_id,
    m.name_ar                   AS method_name,
    m.ledger_kind               AS ledger_kind,
    m.is_active                 AS is_active,
    coalesce(sa.code, l.account_code)                       AS account_code,
    coalesce(sa.name_ar, ga.name_ar)                        AS account_name,
    (coalesce(sa.id, ga.id) IS NOT NULL)                    AS account_exists,
    coalesce(sa.is_postable, ga.is_postable, false)         AS account_postable,
    CASE
      -- لا تحصيل نقدي بهاتين الحالتين: آجل دين، وsplit وصف مستند.
      WHEN m.ledger_kind IN ('CREDIT', 'OTHER') THEN true
      ELSE coalesce(
        coalesce(sa.id, ga.id) IS NOT NULL
        AND coalesce(sa.is_postable, ga.is_postable, false)
        AND coalesce(sa.is_active, ga.is_active, false),
        false)
    END                         AS is_healthy
  FROM public.payment_methods m
  CROSS JOIN LATERAL (
    SELECT public.payment_method_ledger_account(m.id) AS account_code
  ) AS l
  LEFT JOIN public.payment_method_settings s ON s.payment_method_id = m.id
  LEFT JOIN public.accounts sa ON sa.id = s.default_account_id
  LEFT JOIN public.accounts ga ON ga.code = l.account_code
  ORDER BY m.sort_order, m.id;
$$;

COMMENT ON FUNCTION public.payment_method_account_linkage() IS
  'لكل طريقة: الحساب الذي ربطته المنشأة أو العام لعائلتها، وسلامته. آجل وsplit سليمان بلا حساب لأنهما لا يحصّلان.';

REVOKE ALL ON FUNCTION public.payment_method_account_linkage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_method_account_linkage() TO authenticated, service_role;

COMMIT;
