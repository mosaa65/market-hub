-- Allow an active platform superadmin to operate milling custody, and accept a
-- single tender row only when it exactly mirrors the document's scalar method.
BEGIN;

CREATE OR REPLACE FUNCTION public.can_operate_milling()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.is_platform_superadmin(auth.uid())
      OR (
        public.is_staff(auth.uid())
        AND EXISTS (
          SELECT 1
          FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role IN ('owner', 'manager', 'warehouse', 'cashier')
        )
      );
$function$;

CREATE OR REPLACE FUNCTION public.assert_split_payment_document_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_document_id uuid := (to_jsonb(NEW) ->> 'id')::uuid;
  v_method text := to_jsonb(NEW) ->> 'payment_method';
  v_paid numeric := round(coalesce((to_jsonb(NEW) ->> 'paid')::numeric, 0), 2);
  v_count integer;
  v_split_total numeric;
  v_single_method text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(OLD) ->> 'payment_method') IS NOT DISTINCT FROM v_method THEN
    RETURN NEW;
  END IF;

  IF TG_ARGV[0] = 'sales' THEN
    SELECT count(*), round(coalesce(sum(amount), 0), 2), min(method::text)
      INTO v_count, v_split_total, v_single_method
      FROM public.customer_payment_splits
     WHERE invoice_id = v_document_id;
  ELSIF TG_ARGV[0] = 'purchases' THEN
    SELECT count(*), round(coalesce(sum(amount), 0), 2), min(method::text)
      INTO v_count, v_split_total, v_single_method
      FROM public.payment_splits
     WHERE document_type = 'purchase_invoice'
       AND document_id = v_document_id;
  ELSE
    RAISE EXCEPTION 'Unknown split payment document type: %', TG_ARGV[0]
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_method = 'split' AND v_count < 2 THEN
    RAISE EXCEPTION 'A split payment document requires at least two tender rows'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_method = 'split' AND v_split_total <> v_paid THEN
    RAISE EXCEPTION 'Split tender total (%) must equal document paid amount (%)',
      v_split_total, v_paid
      USING ERRCODE = 'check_violation';
  END IF;
  -- Older clients may mirror a single scalar payment as one tender row. It is
  -- safe only when method and total both exactly match the document fields.
  IF v_method IS DISTINCT FROM 'split' AND v_count = 1
     AND v_split_total = v_paid AND v_single_method = v_method THEN
    RETURN NEW;
  END IF;
  IF v_method IS DISTINCT FROM 'split' AND v_count > 0 THEN
    RAISE EXCEPTION 'Tender rows require the document payment method to be split'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.assert_split_payment_document_balance()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
