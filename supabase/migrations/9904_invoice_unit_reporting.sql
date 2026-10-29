-- Expose document-unit values and base-stock UoM in invoice/inventory reports.
-- This is needed because a report that shows only `quantity`/`unit_cost` is
-- ambiguous once one item can be purchased or sold in several units.
BEGIN;

CREATE OR REPLACE VIEW public.purchase_register
WITH (security_invoker = true) AS
 SELECT i.id AS purchase_item_id,
    i.invoice_id,
    s.invoice_number,
    s.created_at,
    s.supplier_id,
    s.status,
    i.product_id,
    p.name AS item_name,
    p.name_ar AS item_name_ar,
    p.sku,
    i.quantity,
    i.unit_cost,
    i.discount,
    i.tax,
    i.total,
    COALESCE(i.line_type,
        CASE
            WHEN (i.product_id IS NULL) THEN 'AD_HOC_SERVICE'::text
            ELSE item_line_type(i.product_id, false)
        END) AS line_type,
    COALESCE(i.stock_effect, 'NONE'::text) AS stock_effect,
    (COALESCE(i.stock_effect, 'NONE'::text) = 'STOCK_RECEIPT'::text) AS increases_inventory,
    COALESCE(i.uom_id, p.base_uom_id, p.unit_id) AS uom_id,
    COALESCE(i.entered_quantity, i.quantity) AS entered_quantity,
    COALESCE(i.entered_unit_cost, i.unit_cost) AS entered_unit_cost,
    COALESCE(i.uom_conversion_factor, 1::numeric) AS uom_conversion_factor,
    u.name AS uom_name,
    COALESCE(u.name_ar, u.name) AS uom_name_ar,
    COALESCE(p.base_uom_id, p.unit_id) AS base_uom_id,
    base_u.name AS base_uom_name,
    COALESCE(base_u.name_ar, base_u.name) AS base_uom_name_ar
   FROM purchase_invoice_items i
     JOIN purchase_invoices s ON s.id = i.invoice_id
     LEFT JOIN products p ON p.id = i.product_id
     LEFT JOIN units u ON u.id = COALESCE(i.uom_id, p.base_uom_id, p.unit_id)
     LEFT JOIN units base_u ON base_u.id = COALESCE(p.base_uom_id, p.unit_id);

CREATE OR REPLACE VIEW public.sales_register
WITH (security_invoker = true) AS
 SELECT i.id AS invoice_item_id,
    i.invoice_id,
    s.invoice_number,
    s.created_at,
    s.customer_id,
    s.status,
    s.payment_method,
    i.product_id,
    i.description,
    p.name AS item_name,
    p.name_ar AS item_name_ar,
    p.sku,
    i.quantity,
    i.unit_price,
    i.discount,
    i.tax,
    i.total,
    COALESCE(i.line_type,
        CASE
            WHEN (i.product_id IS NULL) THEN 'AD_HOC_SERVICE'::text
            ELSE item_line_type(i.product_id, false)
        END) AS line_type,
    COALESCE(i.stock_effect, 'NONE'::text) AS stock_effect,
    i.uom_id,
    sales_line_cost(i.product_id, i.invoice_id, i.quantity, i.line_type) AS line_cost,
    COALESCE(i.entered_quantity, i.quantity) AS entered_quantity,
    COALESCE(i.entered_unit_price, i.unit_price) AS entered_unit_price,
    COALESCE(i.uom_conversion_factor, 1::numeric) AS uom_conversion_factor,
    u.name AS uom_name,
    COALESCE(u.name_ar, u.name) AS uom_name_ar,
    COALESCE(p.base_uom_id, p.unit_id) AS base_uom_id,
    base_u.name AS base_uom_name,
    COALESCE(base_u.name_ar, base_u.name) AS base_uom_name_ar
   FROM sales_invoice_items i
     JOIN sales_invoices s ON s.id = i.invoice_id
     LEFT JOIN products p ON p.id = i.product_id
     LEFT JOIN units u ON u.id = COALESCE(i.uom_id, p.base_uom_id, p.unit_id)
     LEFT JOIN units base_u ON base_u.id = COALESCE(p.base_uom_id, p.unit_id);

COMMENT ON VIEW public.purchase_register IS
  'Invoice register: quantity/unit_cost remain base-stock values; entered_quantity/entered_unit_cost and UoM labels preserve the document unit.';
COMMENT ON VIEW public.sales_register IS
  'Invoice register: quantity/unit_price remain base-stock values; entered_quantity/entered_unit_price and UoM labels preserve the document unit.';

-- Inventory exception reports display one row per item and warehouse. Include
-- the stock base UoM so a quantity is never presented without its measure.
CREATE OR REPLACE VIEW public.inventory_valuation
WITH (security_invoker = true) AS
 SELECT p.item_id,
    p.item_name,
    p.item_name_ar,
    p.sku,
    p.warehouse_id,
    p.warehouse_name,
    p.warehouse_name_ar,
    p.quantity,
    p.costing_method,
    p.reference_unit_cost,
    p.reference_valuation,
    (p.costing_method <> 'STANDARD'::public.costing_method) AS valuation_is_reference_based,
    COALESCE(product.base_uom_id, product.unit_id) AS base_uom_id,
    base_unit.name AS base_uom_name,
    COALESCE(base_unit.name_ar, base_unit.name) AS base_uom_name_ar,
    product.min_stock
   FROM public.company_stock_positions p
     LEFT JOIN public.products product ON product.id = p.item_id
     LEFT JOIN public.units base_unit
       ON base_unit.id = COALESCE(product.base_uom_id, product.unit_id);

COMMENT ON VIEW public.inventory_valuation IS
  'Company inventory by item and warehouse, with the base stock unit and minimum alert level exposed beside each quantity.';

COMMIT;

-- Rollback (manual): restore the sales_register, purchase_register, and
-- inventory_valuation definitions from 12_reporting_views.sql while retaining
-- their current security_invoker settings and grants. No rows are modified.
