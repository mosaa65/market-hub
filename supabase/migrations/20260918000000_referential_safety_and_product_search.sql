-- ============================================================================
-- Market Hub — Referential-Safety Guard for Product Deletion
-- ============================================================================
--
-- WHY THIS EXISTS
--   The generated schema has `ON DELETE CASCADE` from public.products and
--   public.warehouses to public.inventory and public.stock_movements:
--
--     inventory        .product_id  REFERENCES products(id) ON DELETE CASCADE
--     stock_movements  .product_id  REFERENCES products(id) ON DELETE CASCADE
--     product_compatibilities .product_id REFERENCES products(id) ON DELETE CASCADE
--
--   ...while the invoice/return/transfer line tables use the default NO ACTION:
--
--     sales_invoice_items     .product_id REFERENCES products(id)
--     purchase_invoice_items  .product_id REFERENCES products(id)
--     sales_return_items      .product_id REFERENCES products(id)
--     purchase_return_items   .product_id REFERENCES products(id)
--     stock_transfer_items    .product_id REFERENCES products(id)
--
--   Result: deleting a product that appears on an invoice is already blocked by
--   Postgres (good, but it surfaces as a raw FK error to the user), while deleting
--   a product that only has inventory/stock history SILENTLY DESTROYS that history.
--
-- THIS MIGRATION
--   Adds two read-only reporting functions and one guarded delete function.
--   It changes NO table, NO column, NO constraint, and NO existing row.
--   It is purely additive and safe to run against the production database.
--
--   The application calls these through `src/lib/safety.ts`. If they are absent
--   (migration not applied), the UI falls back to counting references with normal
--   SELECT queries, so the app works either way.
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.product_delete_guard(uuid);
--   DROP FUNCTION IF EXISTS public.product_reference_counts(uuid);
--   DROP FUNCTION IF EXISTS public.warehouse_reference_counts(uuid);
--   (No data is affected by dropping these.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. product_reference_counts — how many live records point at this product?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_reference_counts(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sales_items      bigint := 0;
  v_purchase_items   bigint := 0;
  v_sales_returns    bigint := 0;
  v_purchase_returns bigint := 0;
  v_transfers        bigint := 0;
  v_stock_movements  bigint := 0;
  v_inventory_rows   bigint := 0;
  v_compatibilities  bigint := 0;
  v_blocking         bigint := 0;
BEGIN
  -- Historical / financial documents: these MUST block deletion.
  SELECT count(*) INTO v_sales_items
    FROM public.sales_invoice_items WHERE product_id = p_product_id;

  SELECT count(*) INTO v_purchase_items
    FROM public.purchase_invoice_items WHERE product_id = p_product_id;

  -- Returns and transfers are guarded dynamically: some deployments have these
  -- tables, older ones do not. Missing tables count as zero.
  BEGIN
    SELECT count(*) INTO v_sales_returns
      FROM public.sales_return_items WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_sales_returns := 0;
  END;

  BEGIN
    SELECT count(*) INTO v_purchase_returns
      FROM public.purchase_return_items WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_purchase_returns := 0;
  END;

  BEGIN
    SELECT count(*) INTO v_transfers
      FROM public.stock_transfer_items WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_transfers := 0;
  END;

  -- Audit trail: destroying this loses the product's stock history.
  SELECT count(*) INTO v_stock_movements
    FROM public.stock_movements WHERE product_id = p_product_id;

  SELECT count(*) INTO v_inventory_rows
    FROM public.inventory WHERE product_id = p_product_id;

  BEGIN
    SELECT count(*) INTO v_compatibilities
      FROM public.product_compatibilities WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_compatibilities := 0;
  END;

  v_blocking := v_sales_items + v_purchase_items + v_sales_returns
              + v_purchase_returns + v_transfers + v_stock_movements;

  RETURN jsonb_build_object(
    'product_id',          p_product_id,
    'sales_items',         v_sales_items,
    'purchase_items',      v_purchase_items,
    'sales_returns',       v_sales_returns,
    'purchase_returns',    v_purchase_returns,
    'transfers',           v_transfers,
    'stock_movements',     v_stock_movements,
    'inventory_rows',      v_inventory_rows,
    'compatibilities',     v_compatibilities,
    'blocking_total',      v_blocking,
    'can_delete',          v_blocking = 0,
    'has_history',         v_stock_movements > 0 OR v_inventory_rows > 0
  );
END;
$$;

COMMENT ON FUNCTION public.product_reference_counts(uuid) IS
  'Read-only. Reports how many documents/movements reference a product, so the UI can offer deactivate-instead-of-delete. Does not modify anything.';

-- ---------------------------------------------------------------------------
-- 2. product_delete_guard — deletes ONLY when nothing references the product
-- ---------------------------------------------------------------------------
-- Returns jsonb: { deleted: bool, reason: text, counts: jsonb }
-- Raises nothing on the "blocked" path — the caller decides what to show.
CREATE OR REPLACE FUNCTION public.product_delete_guard(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts jsonb;
  v_blocking bigint;
BEGIN
  -- Permission check: only owner/manager may hard-delete a product.
  IF NOT (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'manager')
    OR public.is_platform_admin(auth.uid())
  ) THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'forbidden');
  END IF;

  v_counts   := public.product_reference_counts(p_product_id);
  v_blocking := COALESCE((v_counts ->> 'blocking_total')::bigint, 0);

  IF v_blocking > 0 THEN
    -- Referenced by history -> never delete. The UI offers deactivation instead.
    RETURN jsonb_build_object(
      'deleted', false,
      'reason',  'referenced',
      'counts',  v_counts
    );
  END IF;

  -- Not referenced by any document or movement: safe to remove.
  -- Clean the pure-catalog satellites that carry no financial meaning.
  BEGIN
    DELETE FROM public.product_compatibilities WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  DELETE FROM public.inventory WHERE product_id = p_product_id;

  DELETE FROM public.products WHERE id = p_product_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'deleted', true,
    'reason',  'deleted',
    'counts',  v_counts
  );
END;
$$;

COMMENT ON FUNCTION public.product_delete_guard(uuid) IS
  'Hard-deletes a product ONLY when no invoice, return, transfer or stock movement references it. Otherwise returns reason=referenced so the caller can offer deactivation.';

-- ---------------------------------------------------------------------------
-- 3. warehouse_reference_counts — same idea for warehouses
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.warehouse_reference_counts(p_warehouse_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inventory  bigint := 0;
  v_movements  bigint := 0;
  v_sales      bigint := 0;
  v_purchases  bigint := 0;
  v_transfers  bigint := 0;
  v_blocking   bigint := 0;
BEGIN
  SELECT count(*) INTO v_inventory FROM public.inventory WHERE warehouse_id = p_warehouse_id;
  SELECT count(*) INTO v_movements FROM public.stock_movements WHERE warehouse_id = p_warehouse_id;

  BEGIN
    SELECT count(*) INTO v_sales FROM public.sales_invoices WHERE warehouse_id = p_warehouse_id;
  EXCEPTION WHEN undefined_column THEN v_sales := 0;
  END;

  BEGIN
    SELECT count(*) INTO v_purchases FROM public.purchase_invoices WHERE warehouse_id = p_warehouse_id;
  EXCEPTION WHEN undefined_column THEN v_purchases := 0;
  END;

  BEGIN
    SELECT count(*) INTO v_transfers FROM public.stock_transfers
      WHERE from_warehouse_id = p_warehouse_id OR to_warehouse_id = p_warehouse_id;
  EXCEPTION WHEN undefined_table THEN v_transfers := 0;
       WHEN undefined_column THEN v_transfers := 0;
  END;

  v_blocking := v_inventory + v_movements + v_sales + v_purchases + v_transfers;

  RETURN jsonb_build_object(
    'warehouse_id',   p_warehouse_id,
    'inventory_rows', v_inventory,
    'stock_movements',v_movements,
    'sales_invoices', v_sales,
    'purchase_invoices', v_purchases,
    'transfers',      v_transfers,
    'blocking_total', v_blocking,
    'can_delete',     v_blocking = 0
  );
END;
$$;

COMMENT ON FUNCTION public.warehouse_reference_counts(uuid) IS
  'Read-only. Reports whether a warehouse is referenced by stock, movements or documents.';

-- ---------------------------------------------------------------------------
-- 4. Indexes to make the reference checks fast (non-destructive, additive)
-- ---------------------------------------------------------------------------
-- CREATE INDEX IF NOT EXISTS touches no rows and no columns; it only builds a
-- lookup structure. Safe on a live database.
CREATE INDEX IF NOT EXISTS idx_sales_invoice_items_product    ON public.sales_invoice_items(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_product ON public.purchase_invoice_items(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product        ON public.stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse      ON public.stock_movements(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product              ON public.inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_warehouse            ON public.inventory(warehouse_id);

DO $$
BEGIN
  IF to_regclass('public.sales_return_items') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_sales_return_items_product ON public.sales_return_items(product_id);
  END IF;
  IF to_regclass('public.purchase_return_items') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_purchase_return_items_product ON public.purchase_return_items(product_id);
  END IF;
  IF to_regclass('public.stock_transfer_items') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_product ON public.stock_transfer_items(product_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Server-side product search (performance)
-- ---------------------------------------------------------------------------
-- Searching 500+ products by fetching them all and filtering in the browser is
-- slow and silently truncates. This function does the search, filter, sort and
-- pagination in Postgres and returns ONE page at a time.
--
-- Read-only: SELECT only. It never writes.
CREATE OR REPLACE FUNCTION public.search_products(
  p_query       text    DEFAULT NULL,
  p_category_id uuid    DEFAULT NULL,
  p_brand_id    uuid    DEFAULT NULL,
  p_unit_id     uuid    DEFAULT NULL,
  p_origin_id   uuid    DEFAULT NULL,
  p_active      boolean DEFAULT NULL,
  p_low_stock   boolean DEFAULT NULL,
  p_sort_key    text    DEFAULT 'created_at',
  p_sort_dir    text    DEFAULT 'desc',
  p_limit       integer DEFAULT 50,
  p_offset      integer DEFAULT 0
)
RETURNS TABLE (
  id               uuid,
  name             text,
  name_ar          text,
  sku              text,
  barcode          text,
  sale_price       numeric,
  cost_price       numeric,
  tax_rate         numeric,
  min_stock        numeric,
  shelf_location   text,
  origin_id        uuid,
  quality_grade_id uuid,
  is_active        boolean,
  category_id      uuid,
  brand_id         uuid,
  unit_id          uuid,
  created_at       timestamptz,
  category_name    text,
  category_name_ar text,
  brand_name       text,
  brand_name_ar    text,
  unit_short_name  text,
  unit_name_ar     text,
  stock_qty        numeric,
  total_count      bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      p.id, p.name, p.name_ar, p.sku, p.barcode,
      p.sale_price, p.cost_price, p.tax_rate, p.min_stock, p.shelf_location,
      p.origin_id, p.quality_grade_id, p.is_active,
      p.category_id, p.brand_id, p.unit_id, p.created_at,
      c.name    AS category_name,
      c.name_ar AS category_name_ar,
      b.name    AS brand_name,
      b.name_ar AS brand_name_ar,
      u.short_name AS unit_short_name,
      u.name_ar    AS unit_name_ar,
      COALESCE((
        SELECT sum(i.quantity) FROM public.inventory i WHERE i.product_id = p.id
      ), 0) AS stock_qty
    FROM public.products p
    LEFT JOIN public.categories c ON c.id = p.category_id
    LEFT JOIN public.brands     b ON b.id = p.brand_id
    LEFT JOIN public.units      u ON u.id = p.unit_id
    WHERE
      -- Fuzzy-ish text search: case-insensitive substring across the identity
      -- fields. Uses simple LIKE so it works on any Postgres without extensions.
      (
        p_query IS NULL
        OR btrim(p_query) = ''
        OR p.name        ILIKE '%' || btrim(p_query) || '%'
        OR p.name_ar     ILIKE '%' || btrim(p_query) || '%'
        OR p.sku         ILIKE '%' || btrim(p_query) || '%'
        OR p.barcode     ILIKE '%' || btrim(p_query) || '%'
        OR p.shelf_location ILIKE '%' || btrim(p_query) || '%'
      )
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
      AND (p_brand_id    IS NULL OR p.brand_id    = p_brand_id)
      AND (p_unit_id     IS NULL OR p.unit_id     = p_unit_id)
      AND (p_origin_id   IS NULL OR p.origin_id   = p_origin_id)
      AND (p_active      IS NULL OR p.is_active   = p_active)
  ),
  counted AS (
    SELECT *, count(*) OVER () AS total_count FROM filtered
  )
  SELECT
    id, name, name_ar, sku, barcode,
    sale_price, cost_price, tax_rate, min_stock, shelf_location,
    origin_id, quality_grade_id, is_active,
    category_id, brand_id, unit_id, created_at,
    category_name, category_name_ar, brand_name, brand_name_ar,
    unit_short_name, unit_name_ar,
    stock_qty, total_count
  FROM counted
  WHERE
    p_low_stock IS NULL
    OR (p_low_stock = true  AND stock_qty <= min_stock)
    OR (p_low_stock = false AND stock_qty >  min_stock)
  ORDER BY
    CASE WHEN p_sort_key = 'name'       AND p_sort_dir = 'asc'  THEN COALESCE(name_ar, name) END ASC NULLS LAST,
    CASE WHEN p_sort_key = 'name'       AND p_sort_dir = 'desc' THEN COALESCE(name_ar, name) END DESC NULLS LAST,
    CASE WHEN p_sort_key = 'sku'        AND p_sort_dir = 'asc'  THEN sku END ASC NULLS LAST,
    CASE WHEN p_sort_key = 'sku'        AND p_sort_dir = 'desc' THEN sku END DESC NULLS LAST,
    CASE WHEN p_sort_key = 'sale_price' AND p_sort_dir = 'asc'  THEN sale_price END ASC NULLS LAST,
    CASE WHEN p_sort_key = 'sale_price' AND p_sort_dir = 'desc' THEN sale_price END DESC NULLS LAST,
    CASE WHEN p_sort_key = 'cost_price' AND p_sort_dir = 'asc'  THEN cost_price END ASC NULLS LAST,
    CASE WHEN p_sort_key = 'cost_price' AND p_sort_dir = 'desc' THEN cost_price END DESC NULLS LAST,
    CASE WHEN p_sort_key = 'stock'      AND p_sort_dir = 'asc'  THEN stock_qty END ASC NULLS LAST,
    CASE WHEN p_sort_key = 'stock'      AND p_sort_dir = 'desc' THEN stock_qty END DESC NULLS LAST,
    CASE WHEN p_sort_key = 'created_at' AND p_sort_dir = 'asc'  THEN created_at END ASC NULLS LAST,
    CASE WHEN p_sort_key = 'created_at' AND p_sort_dir = 'desc' THEN created_at END DESC NULLS LAST,
    created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
$$;

COMMENT ON FUNCTION public.search_products IS
  'Read-only server-side search/filter/sort/pagination for the products list. Returns one page plus total_count. SELECT only — never writes.';

-- Grants: authenticated staff may execute; the functions enforce their own role
-- checks where they mutate anything.
GRANT EXECUTE ON FUNCTION public.product_reference_counts(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_delete_guard(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.warehouse_reference_counts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_products TO authenticated;