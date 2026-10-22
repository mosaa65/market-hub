-- Fix: create_sale(date) overload updated stock_movements.created_at while
-- tg_stock_movements_engine_only was armed OFF, so every product sale raised
-- "Stock movements must be posted through post_stock_delta". Arm the engine
-- flag around the timestamp adjustment (config is transaction-scoped, so the
-- trigger sees 'on' for these UPDATEs only).
CREATE OR REPLACE FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id uuid;
  v_posted_at  timestamptz;
BEGIN
  IF _sale_date IS NULL THEN
    RAISE EXCEPTION 'Sale date is required';
  END IF;

  IF coalesce(jsonb_typeof(_items), '') <> 'array'
     OR coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  v_invoice_id := public.create_sale(
    _warehouse_id, _customer_id, _payment_method, _paid, _discount, _note, _items
  );

  v_posted_at := _sale_date::timestamp + localtime;

  UPDATE public.sales_invoices
  SET created_at = v_posted_at, updated_at = now()
  WHERE id = v_invoice_id;

  PERFORM set_config('app.stock_engine', 'on', true);

  UPDATE public.stock_movements
  SET created_at = v_posted_at
  WHERE source_type = 'sales_invoice' AND source_id = v_invoice_id;

  PERFORM set_config('app.stock_engine', 'off', true);

  RETURN v_invoice_id;
END $function$;
