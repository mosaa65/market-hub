
-- Sequence for invoice numbering
CREATE SEQUENCE IF NOT EXISTS public.sales_invoice_seq START 1;

CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prefix TEXT;
  n BIGINT;
BEGIN
  SELECT COALESCE(invoice_prefix, 'INV') INTO prefix FROM public.company_settings ORDER BY id LIMIT 1;
  IF prefix IS NULL THEN prefix := 'INV'; END IF;
  n := nextval('public.sales_invoice_seq');
  RETURN prefix || '-' || to_char(now(),'YYYYMM') || '-' || lpad(n::TEXT, 4, '0');
END $$;

-- Checkout RPC
CREATE OR REPLACE FUNCTION public.create_sale(
  _warehouse_id UUID,
  _customer_id UUID,
  _payment_method TEXT,
  _paid NUMERIC,
  _discount NUMERIC,
  _note TEXT,
  _items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id UUID;
  v_invoice_no TEXT;
  v_user UUID := auth.uid();
  v_item JSONB;
  v_subtotal NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_tax_rate NUMERIC;
  v_line_total NUMERIC;
  v_line_tax NUMERIC;
  v_product UUID;
  v_stock NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_staff(v_user) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _warehouse_id IS NULL THEN RAISE EXCEPTION 'Warehouse required'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Cart is empty'; END IF;

  -- Validate stock & compute totals
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_product := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::NUMERIC;
    v_price := (v_item->>'unit_price')::NUMERIC;
    v_tax_rate := COALESCE((v_item->>'tax_rate')::NUMERIC, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;

    SELECT quantity INTO v_stock FROM public.inventory
      WHERE product_id = v_product AND warehouse_id = _warehouse_id;
    IF v_stock IS NULL OR v_stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for product %', v_product;
    END IF;

    v_line_total := v_qty * v_price;
    v_line_tax := v_line_total * v_tax_rate / 100;
    v_subtotal := v_subtotal + v_line_total;
    v_tax_total := v_tax_total + v_line_tax;
  END LOOP;

  v_total := v_subtotal + v_tax_total - COALESCE(_discount,0);
  v_invoice_no := public.next_invoice_number();

  INSERT INTO public.sales_invoices(
    invoice_number, customer_id, warehouse_id, status, subtotal, discount, tax, total, paid, payment_method, note, created_by
  ) VALUES (
    v_invoice_no, _customer_id, _warehouse_id,
    CASE WHEN COALESCE(_paid,0) >= v_total THEN 'paid'::invoice_status ELSE 'partial'::invoice_status END,
    v_subtotal, COALESCE(_discount,0), v_tax_total, v_total, COALESCE(_paid,0),
    _payment_method::payment_method, _note, v_user
  ) RETURNING id INTO v_invoice_id;

  -- Insert items, decrement stock, log movements
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_product := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::NUMERIC;
    v_price := (v_item->>'unit_price')::NUMERIC;
    v_tax_rate := COALESCE((v_item->>'tax_rate')::NUMERIC, 0);
    v_line_total := v_qty * v_price;
    v_line_tax := v_line_total * v_tax_rate / 100;

    INSERT INTO public.sales_invoice_items(invoice_id, product_id, quantity, unit_price, discount, tax, total)
    VALUES (v_invoice_id, v_product, v_qty, v_price, 0, v_line_tax, v_line_total + v_line_tax);

    UPDATE public.inventory SET quantity = quantity - v_qty, updated_at = now()
      WHERE product_id = v_product AND warehouse_id = _warehouse_id;

    INSERT INTO public.stock_movements(product_id, warehouse_id, movement_type, quantity, unit_cost, reference_type, reference_id, note, created_by)
    VALUES (v_product, _warehouse_id, 'out', v_qty, v_price, 'sale', v_invoice_id, 'POS sale', v_user);
  END LOOP;

  RETURN v_invoice_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_sale(UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_invoice_number() TO authenticated;
