-- ════════════════════════════════════════════════════════════════════════════
-- 71_isolate_mill_custody_items.sql
--
-- Mill custody items belong to customers. They are listed and moved only by
-- custody RPCs; they must never enter commercial sales, purchases or stock.
-- NOT VALID keeps legacy rows readable while enforcing the invariant for all
-- new rows and every subsequent update. The local rebuild seed creates rows
-- in the canonical state; older deployments can repair a row through the
-- milling product form before editing it.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- NONE means no company valuation. Customer-owned items are outside company
-- inventory just like untracked goods, so both may use it.
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_none_costing_requires_untracked;

ALTER TABLE public.products
  ADD CONSTRAINT products_none_costing_requires_noncompany_stock
  CHECK (
    costing_method <> 'NONE'::public.costing_method
    OR inventory_policy IN (
      'UNTRACKED'::public.inventory_policy,
      'CUSTOMER_OWNED'::public.inventory_policy
    )
  ) NOT VALID;

ALTER TABLE public.products
  ADD CONSTRAINT products_customer_owned_items_are_custody
  CHECK (
    inventory_policy <> 'CUSTOMER_OWNED'::public.inventory_policy
    OR (
      item_nature = 'GOOD'::public.item_nature
      AND tracking = 'NONE'::public.item_tracking
      AND costing_method = 'NONE'::public.costing_method
      AND is_custody_item
      AND NOT is_sellable
      AND NOT is_purchasable
      AND item_class IN ('RAW_MATERIAL', 'FINISHED_GOOD', 'BY_PRODUCT')
    )
  ) NOT VALID;

ALTER TABLE public.products
  ADD CONSTRAINT products_custody_items_are_customer_owned
  CHECK (
    NOT is_custody_item
    OR inventory_policy = 'CUSTOMER_OWNED'::public.inventory_policy
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.reject_custody_items_in_commercial_documents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.product_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = NEW.product_id
      AND p.is_custody_item
  ) THEN
    RAISE EXCEPTION 'Mill custody item % cannot be used in a commercial invoice', NEW.product_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_custody_items_in_commercial_documents() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sales_invoice_items_reject_custody_products
  ON public.sales_invoice_items;
CREATE TRIGGER sales_invoice_items_reject_custody_products
  BEFORE INSERT OR UPDATE OF product_id ON public.sales_invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_custody_items_in_commercial_documents();

DROP TRIGGER IF EXISTS purchase_invoice_items_reject_custody_products
  ON public.purchase_invoice_items;
CREATE TRIGGER purchase_invoice_items_reject_custody_products
  BEFORE INSERT OR UPDATE OF product_id ON public.purchase_invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_custody_items_in_commercial_documents();

COMMENT ON CONSTRAINT products_customer_owned_items_are_custody ON public.products IS
  'Customer-owned milling goods have no company valuation or commercial sale/purchase path.';
COMMENT ON FUNCTION public.reject_custody_items_in_commercial_documents() IS
  'Defense in depth: prevents a mill custody item from entering a sales or purchase invoice.';

COMMIT;

-- Rollback: drop the two invoice-item triggers and function, drop the three
-- policy constraints, then restore products_none_costing_requires_untracked.
