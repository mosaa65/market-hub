-- ============================================================================
-- 21b_accounting_phase3_set_period_status.sql
--
-- تكميل المرحلة 3: دالة تغيير حالة الفترة المالية (فتح/قفل) من الشاشة.
-- تتيح للمحاسب/المدير قفل أو فتح فترة شهرية مع تسجيل سجل التدقيق.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_period_status(
  p_period_id uuid,
  p_status    text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_period record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may change fiscal period status';
  END IF;

  IF p_status NOT IN ('OPEN', 'CLOSED') THEN
    RAISE EXCEPTION 'Status must be OPEN or CLOSED';
  END IF;

  SELECT * INTO v_period FROM public.fiscal_periods WHERE id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fiscal period not found';
  END IF;

  UPDATE public.fiscal_periods
     SET status = p_status,
         closed_at = CASE WHEN p_status = 'CLOSED' THEN now() ELSE NULL END,
         closed_by = CASE WHEN p_status = 'CLOSED' THEN v_user ELSE NULL END
   WHERE id = p_period_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'fiscal_period.status_changed', 'fiscal_period', p_period_id,
          jsonb_build_object('code', v_period.code, 'old_status', v_period.status, 'new_status', p_status));

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.set_period_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_period_status(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.set_period_status(uuid, text) IS
  'T-19: تغيير حالة الفترة المالية بين OPEN و CLOSED مع فحص الصلاحيات وتسجيل التدقيق.';
