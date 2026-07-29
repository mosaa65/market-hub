-- Migration to fix create_sale function:
-- 1. Properly set status to 'unpaid' when paid is 0, 'paid' when paid >= total, else 'partial'
-- 2. Update customer balance with remaining unpaid balance when customer_id is provided

CREATE OR REPLACE FUNCTION public.create_sale(
  _warehouse_id uuid,
  _customer_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id UUID;
  v_invoice_no TEXT;
  v_user UUID := auth.uid();
  v_item JSONB;
  v_subtotal NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_paid NUMERIC := 0;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_tax_rate NUMERIC;
  v_line_total NUMERIC;
  v_line_tax NUMERIC;
  v_product UUID;
  v_stock NUMERIC;
  v_status invoice_status;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_staff(v_user) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _warehouse_id IS NULL THEN RAISE EXCEPTION 'Warehouse required'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Cart is empty'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_product := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::NUMERIC;
    v_price := (v_item->>'unit_price')::NUMERIC;
    v_tax_rate := COALESCE((v_item->>'tax_rate')::NUMERIC, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
    SELECT quantity INTO v_stock FROM public.inventory WHERE product_id = v_product AND warehouse_id = _warehouse_id;
    IF v_stock IS NULL OR v_stock < v_qty THEN RAISE EXCEPTION 'Insufficient stock for product %', v_product; END IF;
    v_line_total := v_qty * v_price;
    v_line_tax := v_line_total * v_tax_rate / 100;
    v_subtotal := v_subtotal + v_line_total;
    v_tax_total := v_tax_total + v_line_tax;
  END LOOP;

  v_total := v_subtotal + v_tax_total - COALESCE(_discount,0);
  
  IF _payment_method = 'credit' THEN
    v_paid := COALESCE(_paid, 0);
  ELSE
    v_paid := COALESCE(_paid, v_total);
  END IF;

  IF v_paid >= v_total THEN
    v_status := 'paid'::invoice_status;
  ELSIF v_paid = 0 THEN
    v_status := 'unpaid'::invoice_status;
  ELSE
    v_status := 'partial'::invoice_status;
  END IF;

  v_invoice_no := public.next_invoice_number();

  INSERT INTO public.sales_invoices(
    invoice_number, customer_id, warehouse_id, status, subtotal, discount, tax, total, paid, payment_method, note, created_by
  )
  VALUES (
    v_invoice_no, _customer_id, _warehouse_id, v_status, v_subtotal, COALESCE(_discount,0), v_tax_total, v_total, v_paid,
    _payment_method::payment_method, _note, v_user
  )
  RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_product := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::NUMERIC;
    v_price := (v_item->>'unit_price')::NUMERIC;
    v_tax_rate := COALESCE((v_item->>'tax_rate')::NUMERIC, 0);
    v_line_total := v_qty * v_price;
    v_line_tax := v_line_total * v_tax_rate / 100;
    INSERT INTO public.sales_invoice_items(invoice_id, product_id, quantity, unit_price, discount, tax, total)
    VALUES (v_invoice_id, v_product, v_qty, v_price, 0, v_line_tax, v_line_total + v_line_tax);
    UPDATE public.inventory SET quantity = quantity - v_qty, updated_at = now() WHERE product_id = v_product AND warehouse_id = _warehouse_id;
    INSERT INTO public.stock_movements(product_id, warehouse_id, movement_type, quantity, unit_cost, reference_type, reference_id, note, created_by)
    VALUES (v_product, _warehouse_id, 'sale'::movement_type, v_qty, v_price, 'sale', v_invoice_id, 'POS sale', v_user);
  END LOOP;

  IF _customer_id IS NOT NULL AND v_paid < v_total THEN
    UPDATE public.customers
    SET balance = balance + (v_total - v_paid), updated_at = now()
    WHERE id = _customer_id;
  END IF;

  RETURN v_invoice_id;
END $function$;
