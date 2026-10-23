-- A credit tender records no collection at invoice creation.
-- Partial payment is represented by the actual collected tender plus a receivable,
-- not by payment_method='credit' with a positive paid amount. Later customer
-- collections update paid on the existing invoice and remain allowed.

BEGIN;

CREATE OR REPLACE FUNCTION public.reject_paid_credit_sale_creation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.payment_method = 'credit'::public.payment_method
     AND coalesce(NEW.paid, 0) > 0 THEN
    RAISE EXCEPTION 'Credit payment method requires zero paid amount; record the actual tender method for partial payment'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_paid_credit_sale_creation() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.reject_paid_credit_sale_creation() IS
  'R-56: A credit sale cannot carry an initial payment without a recorded settlement method.';

DROP TRIGGER IF EXISTS sales_invoices_reject_paid_credit_insert ON public.sales_invoices;
CREATE TRIGGER sales_invoices_reject_paid_credit_insert
  BEFORE INSERT ON public.sales_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_paid_credit_sale_creation();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.sales_invoices
    WHERE payment_method = 'credit'::public.payment_method
      AND coalesce(paid, 0) > 0
  ) THEN
    RAISE EXCEPTION 'Existing credit invoices with paid amounts need a recorded settlement method before this migration';
  END IF;
END $$;

COMMIT;

-- Verification: the INSERT trigger rejects credit + paid > 0. It intentionally
-- does not guard UPDATE, because later customer collections update paid.
-- Rollback: DROP TRIGGER IF EXISTS sales_invoices_reject_paid_credit_insert ON public.sales_invoices;