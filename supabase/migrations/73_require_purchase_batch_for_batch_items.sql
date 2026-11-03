-- A batch-tracked item's receipt must create a product_batches row so that
-- stock received through purchases can later be selected and deducted in POS.

BEGIN;

CREATE OR REPLACE FUNCTION public.require_purchase_batch_for_batch_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.product_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.products p
       WHERE p.id = NEW.product_id
         AND p.tracking = 'BATCH'::public.item_tracking
     )
     AND nullif(btrim(coalesce(NEW.batch_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Batch-tracked purchase items require a batch number'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.require_purchase_batch_for_batch_items() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS purchase_items_require_batch_number
  ON public.purchase_invoice_items;
CREATE TRIGGER purchase_items_require_batch_number
  BEFORE INSERT OR UPDATE OF product_id, batch_number ON public.purchase_invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION public.require_purchase_batch_for_batch_items();

COMMENT ON FUNCTION public.require_purchase_batch_for_batch_items() IS
  'Requires a batch identifier on purchases of batch-tracked items to keep POS batch stock in sync.';

COMMIT;

-- Rollback: drop the trigger and function.
