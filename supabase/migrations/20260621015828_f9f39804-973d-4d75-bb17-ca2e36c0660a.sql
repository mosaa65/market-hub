
CREATE SEQUENCE IF NOT EXISTS public.purchase_invoice_seq START 1;

CREATE OR REPLACE FUNCTION public.next_purchase_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('public.purchase_invoice_seq');
  RETURN 'PO-' || to_char(now(),'YYYYMM') || '-' || lpad(n::TEXT, 4, '0');
END $$;

CREATE OR REPLACE FUNCTION public.create_purchase(
  _warehouse_id UUID,
  _supplier_id UUID,
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
  v_cost NUMERIC;
  v_tax_rate NUMERIC;
  v_line_total NUMERIC;
  v_line_tax NUMERIC;
  v_product UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_staff(v_user) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _warehouse_id IS NULL THEN RAISE EXCEPTION 'Warehouse required'; END IF;
  IF _supplier_id IS NULL THEN RAISE EXCEPTION 'Supplier required'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'No items'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := (v_item->>'quantity')::NUMERIC;
    v_cost := (v_item->>'unit_cost')::NUMERIC;
    v_tax_rate := COALESCE((v_item->>'tax_rate')::NUMERIC, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
    v_line_total := v_qty * v_cost;
    v_line_tax := v_line_total * v_tax_rate / 100;
    v_subtotal := v_subtotal + v_line_total;
    v_tax_total := v_tax_total + v_line_tax;
  END LOOP;

  v_total := v_subtotal + v_tax_total - COALESCE(_discount,0);
  v_invoice_no := public.next_purchase_number();

  INSERT INTO public.purchase_invoices(
    invoice_number, supplier_id, warehouse_id, status, subtotal, discount, tax, total, paid, payment_method, note, created_by
  ) VALUES (
    v_invoice_no, _supplier_id, _warehouse_id,
    CASE WHEN COALESCE(_paid,0) >= v_total THEN 'paid'::invoice_status ELSE 'partial'::invoice_status END,
    v_subtotal, COALESCE(_discount,0), v_tax_total, v_total, COALESCE(_paid,0),
    _payment_method::payment_method, _note, v_user
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_product := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::NUMERIC;
    v_cost := (v_item->>'unit_cost')::NUMERIC;
    v_tax_rate := COALESCE((v_item->>'tax_rate')::NUMERIC, 0);
    v_line_total := v_qty * v_cost;
    v_line_tax := v_line_total * v_tax_rate / 100;

    INSERT INTO public.purchase_invoice_items(invoice_id, product_id, quantity, unit_cost, discount, tax, total)
    VALUES (v_invoice_id, v_product, v_qty, v_cost, 0, v_line_tax, v_line_total + v_line_tax);

    INSERT INTO public.inventory(product_id, warehouse_id, quantity)
    VALUES (v_product, _warehouse_id, v_qty)
    ON CONFLICT (product_id, warehouse_id) DO UPDATE
      SET quantity = public.inventory.quantity + EXCLUDED.quantity, updated_at = now();

    INSERT INTO public.stock_movements(product_id, warehouse_id, movement_type, quantity, unit_cost, reference_type, reference_id, note, created_by)
    VALUES (v_product, _warehouse_id, 'in', v_qty, v_cost, 'purchase', v_invoice_id, 'Purchase receipt', v_user);
  END LOOP;

  -- Update supplier balance for unpaid portion
  IF COALESCE(_paid,0) < v_total THEN
    UPDATE public.suppliers SET balance = balance + (v_total - COALESCE(_paid,0)), updated_at = now()
      WHERE id = _supplier_id;
  END IF;

  RETURN v_invoice_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_purchase(UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_purchase_number() TO authenticated;
