-- Keep the financial valuation source limited to rows backed by company
-- inventory, while giving the low-stock alert report zero-balance rows for
-- explicitly configured, active goods before their first stock movement.
CREATE OR REPLACE VIEW public.inventory_low_stock
WITH (security_invoker = true) AS
 SELECT v.item_id,
    v.item_name,
    v.item_name_ar,
    v.sku,
    v.warehouse_id,
    v.warehouse_name,
    v.warehouse_name_ar,
    v.quantity,
    v.costing_method,
    v.reference_unit_cost,
    v.reference_valuation,
    v.valuation_is_reference_based,
    v.base_uom_id,
    v.base_uom_name,
    v.base_uom_name_ar,
    v.min_stock
   FROM public.inventory_valuation v
UNION ALL
 SELECT product.id AS item_id,
    product.name AS item_name,
    product.name_ar AS item_name_ar,
    product.sku,
    warehouse.id AS warehouse_id,
    warehouse.name AS warehouse_name,
    warehouse.name_ar AS warehouse_name_ar,
    0::numeric AS quantity,
    product.costing_method,
    COALESCE(company_item.default_cost, product.cost_price, 0::numeric) AS reference_unit_cost,
    0::numeric AS reference_valuation,
    (product.costing_method <> 'STANDARD'::public.costing_method) AS valuation_is_reference_based,
    COALESCE(product.base_uom_id, product.unit_id) AS base_uom_id,
    base_unit.name AS base_uom_name,
    COALESCE(base_unit.name_ar, base_unit.name) AS base_uom_name_ar,
    product.min_stock
   FROM public.products product
   JOIN public.warehouses warehouse ON warehouse.is_active
   LEFT JOIN public.company_items company_item
     ON company_item.item_id = product.id
    AND company_item.company_id = 1
    AND company_item.is_active
   LEFT JOIN public.units base_unit
     ON base_unit.id = COALESCE(product.base_uom_id, product.unit_id)
  WHERE product.is_active
    AND product.status = 'ACTIVE'::public.item_status
    AND product.item_nature = 'GOOD'::public.item_nature
    AND NOT product.is_service
    AND product.item_class IS DISTINCT FROM 'SERVICE'::public.item_class
    AND (product.is_sellable OR product.is_purchasable)
    AND COALESCE(company_item.inventory_policy, product.inventory_policy) = 'TRACKED'::public.inventory_policy
    AND product.min_stock > 0
    AND NOT EXISTS (
      SELECT 1
        FROM public.company_stock_positions existing_position
       WHERE existing_position.item_id = product.id
         AND existing_position.warehouse_id = warehouse.id
    );

COMMENT ON VIEW public.inventory_low_stock IS
  'Company stock rows plus zero rows for active tracked goods with a positive alert threshold and no company position in an active warehouse. Not a financial valuation source.';

REVOKE ALL ON public.inventory_low_stock FROM anon;
GRANT SELECT ON public.inventory_low_stock TO authenticated, service_role;

-- Rollback (manual): DROP VIEW public.inventory_low_stock;
