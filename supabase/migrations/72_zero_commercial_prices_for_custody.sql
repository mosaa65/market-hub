-- Customer-owned milling items are outside commercial pricing and valuation.
-- Keep legacy rows readable, while requiring new and edited custody rows to
-- carry zero sale price, catalogue cost, and tax rate.

BEGIN;

ALTER TABLE public.products
  ADD CONSTRAINT products_custody_items_have_no_commercial_prices
  CHECK (
    inventory_policy <> 'CUSTOMER_OWNED'::public.inventory_policy
    OR (sale_price = 0 AND cost_price = 0 AND tax_rate = 0)
  ) NOT VALID;

COMMENT ON CONSTRAINT products_custody_items_have_no_commercial_prices ON public.products IS
  'Customer-owned milling goods have no commercial sale price, catalogue cost, or tax.';

COMMIT;

-- Rollback: ALTER TABLE public.products DROP CONSTRAINT
--   products_custody_items_have_no_commercial_prices;
