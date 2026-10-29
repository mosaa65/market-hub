-- ============================================================================
-- 9900_fix_credit_limit_check.sql
--
-- 修复: سقف الدين يرفض كل العمليات الآجلة حتى لو الرصيد صفر والمطلوب أقل بكثير من الحد.
-- Root cause: `customer_credit_limit_allows` used a CROSS JOIN with
-- `company_settings`. If the settings table has no row (fresh install), the
-- join produces zero rows and `EXISTS` returns FALSE for every customer,
-- blocking every deferred sale/purchase regardless of balance or limit.
--
-- Fix:
--   1. Guarantee a singleton settings row (id = 1) exists.
--   2. Rewrite the check with a LEFT JOIN + COALESCE so a missing settings
--      row defaults to "not enforced" instead of silently blocking.
-- ============================================================================

-- ── 1. الصف الافتراضي الوحيد للإعدادات ──────────────────────────────────────
INSERT INTO public.company_settings (id, name, currency, currency_symbol, enforce_customer_credit_limit)
VALUES (1, 'My Company', 'YER', 'ر.ي', FALSE)
ON CONFLICT (id) DO NOTHING;

-- ── 2. دالة التحقق المحصّنة ضد غياب الإعدادات ───────────────────────────────
CREATE OR REPLACE FUNCTION public.customer_credit_limit_allows(p_customer_id uuid, p_new_due numeric)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.customers AS c
    LEFT JOIN public.company_settings AS s ON s.id = 1
    WHERE c.id = p_customer_id
      AND (
        coalesce(s.enforce_customer_credit_limit, FALSE) IS NOT TRUE
        OR coalesce(c.credit_limit, 0) = 0
        OR coalesce(c.balance, 0) + greatest(coalesce(p_new_due, 0), 0) <= c.credit_limit
      )
  )
$function$;

-- ── 3. إعادة منح صلاحيات التنفيذ ────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.customer_credit_limit_allows(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_credit_limit_allows(uuid, numeric) TO service_role;
