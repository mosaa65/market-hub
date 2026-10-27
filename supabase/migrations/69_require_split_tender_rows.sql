-- A document cannot claim `split` unless its ledger-ready tender rows exist
-- and reconcile exactly to `paid`. The constraint is deferred because trusted
-- RPCs insert the document header before inserting the split lines.

BEGIN;

CREATE OR REPLACE FUNCTION public.assert_split_payment_document_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_document_id uuid := (to_jsonb(NEW) ->> 'id')::uuid;
  v_method text := to_jsonb(NEW) ->> 'payment_method';
  v_paid numeric := round(coalesce((to_jsonb(NEW) ->> 'paid')::numeric, 0), 2);
  v_count integer;
  v_split_total numeric;
BEGIN
  -- Later customer/supplier receipts update `paid` while keeping the original
  -- document method. Their rows live in the receipt ledgers, so only validate
  -- when a document is first inserted or its method is changed.
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(OLD) ->> 'payment_method') IS NOT DISTINCT FROM v_method THEN
    RETURN NEW;
  END IF;

  IF TG_ARGV[0] = 'sales' THEN
    SELECT count(*), round(coalesce(sum(amount), 0), 2)
      INTO v_count, v_split_total
      FROM public.customer_payment_splits
     WHERE invoice_id = v_document_id;
  ELSIF TG_ARGV[0] = 'purchases' THEN
    SELECT count(*), round(coalesce(sum(amount), 0), 2)
      INTO v_count, v_split_total
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
  IF v_method IS DISTINCT FROM 'split' AND v_count > 0 THEN
    RAISE EXCEPTION 'Tender rows require the document payment method to be split'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sales_invoice_split_balance ON public.sales_invoices;
CREATE CONSTRAINT TRIGGER trg_sales_invoice_split_balance
  AFTER INSERT OR UPDATE ON public.sales_invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_split_payment_document_balance('sales');

DROP TRIGGER IF EXISTS trg_purchase_invoice_split_balance ON public.purchase_invoices;
CREATE CONSTRAINT TRIGGER trg_purchase_invoice_split_balance
  AFTER INSERT OR UPDATE ON public.purchase_invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_split_payment_document_balance('purchases');

REVOKE ALL ON FUNCTION public.assert_split_payment_document_balance() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

-- Rollback: drop both constraint triggers and this assertion function.
