
CREATE OR REPLACE FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id UUID; v_invoice_no TEXT; v_user UUID := auth.uid();
  v_item JSONB; v_subtotal NUMERIC := 0; v_tax_total NUMERIC := 0; v_total NUMERIC := 0;
  v_qty NUMERIC; v_price NUMERIC; v_tax_rate NUMERIC; v_line_total NUMERIC; v_line_tax NUMERIC;
  v_product UUID; v_stock NUMERIC;
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
  v_invoice_no := public.next_invoice_number();

  INSERT INTO public.sales_invoices(invoice_number, customer_id, warehouse_id, status, subtotal, discount, tax, total, paid, payment_method, note, created_by)
  VALUES (v_invoice_no, _customer_id, _warehouse_id,
    CASE WHEN COALESCE(_paid,0) >= v_total THEN 'paid'::invoice_status ELSE 'partial'::invoice_status END,
    v_subtotal, COALESCE(_discount,0), v_tax_total, v_total, COALESCE(_paid,0),
    _payment_method::payment_method, _note, v_user)
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

  RETURN v_invoice_id;
END $function$;

CREATE OR REPLACE FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id UUID; v_invoice_no TEXT; v_user UUID := auth.uid();
  v_item JSONB; v_subtotal NUMERIC := 0; v_tax_total NUMERIC := 0; v_total NUMERIC := 0;
  v_qty NUMERIC; v_cost NUMERIC; v_tax_rate NUMERIC; v_line_total NUMERIC; v_line_tax NUMERIC; v_product UUID;
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

  INSERT INTO public.purchase_invoices(invoice_number, supplier_id, warehouse_id, status, subtotal, discount, tax, total, paid, payment_method, note, created_by)
  VALUES (v_invoice_no, _supplier_id, _warehouse_id,
    CASE WHEN COALESCE(_paid,0) >= v_total THEN 'paid'::invoice_status ELSE 'partial'::invoice_status END,
    v_subtotal, COALESCE(_discount,0), v_tax_total, v_total, COALESCE(_paid,0),
    _payment_method::payment_method, _note, v_user)
  RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_product := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::NUMERIC;
    v_cost := (v_item->>'unit_cost')::NUMERIC;
    v_tax_rate := COALESCE((v_item->>'tax_rate')::NUMERIC, 0);
    v_line_total := v_qty * v_cost;
    v_line_tax := v_line_total * v_tax_rate / 100;
    INSERT INTO public.purchase_invoice_items(invoice_id, product_id, quantity, unit_cost, discount, tax, total)
    VALUES (v_invoice_id, v_product, v_qty, v_cost, 0, v_line_tax, v_line_total + v_line_tax);
    INSERT INTO public.inventory(product_id, warehouse_id, quantity) VALUES (v_product, _warehouse_id, v_qty)
    ON CONFLICT (product_id, warehouse_id) DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity, updated_at = now();
    INSERT INTO public.stock_movements(product_id, warehouse_id, movement_type, quantity, unit_cost, reference_type, reference_id, note, created_by)
    VALUES (v_product, _warehouse_id, 'purchase'::movement_type, v_qty, v_cost, 'purchase', v_invoice_id, 'Purchase receipt', v_user);
  END LOOP;

  IF COALESCE(_paid,0) < v_total THEN
    UPDATE public.suppliers SET balance = balance + (v_total - COALESCE(_paid,0)), updated_at = now() WHERE id = _supplier_id;
  END IF;
  RETURN v_invoice_id;
END $function$;

CREATE OR REPLACE FUNCTION public.create_sales_return(_invoice_id uuid, _warehouse_id uuid, _customer_id uuid, _refund_method text, _note text, _items jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID; v_no TEXT; v_user UUID := auth.uid();
  v_item JSONB; v_sub NUMERIC := 0; v_tax NUMERIC := 0; v_tot NUMERIC := 0;
  v_qty NUMERIC; v_price NUMERIC; v_tr NUMERIC; v_lt NUMERIC; v_ltax NUMERIC; v_p UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_staff(v_user) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF jsonb_array_length(_items)=0 THEN RAISE EXCEPTION 'No items'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := (v_item->>'quantity')::NUMERIC;
    v_price := (v_item->>'unit_price')::NUMERIC;
    v_tr := COALESCE((v_item->>'tax_rate')::NUMERIC,0);
    v_lt := v_qty*v_price; v_ltax := v_lt*v_tr/100;
    v_sub := v_sub+v_lt; v_tax := v_tax+v_ltax;
  END LOOP;
  v_tot := v_sub+v_tax;
  v_no := public.next_sales_return_number();

  INSERT INTO public.sales_returns(return_number,invoice_id,customer_id,warehouse_id,subtotal,tax,total,refund_method,note,created_by)
  VALUES(v_no,_invoice_id,_customer_id,_warehouse_id,v_sub,v_tax,v_tot,_refund_method::payment_method,_note,v_user)
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::NUMERIC;
    v_price := (v_item->>'unit_price')::NUMERIC;
    v_tr := COALESCE((v_item->>'tax_rate')::NUMERIC,0);
    v_lt := v_qty*v_price; v_ltax := v_lt*v_tr/100;
    INSERT INTO public.sales_return_items(return_id,product_id,quantity,unit_price,tax,total)
    VALUES(v_id,v_p,v_qty,v_price,v_ltax,v_lt+v_ltax);
    INSERT INTO public.inventory(product_id,warehouse_id,quantity) VALUES(v_p,_warehouse_id,v_qty)
    ON CONFLICT(product_id,warehouse_id) DO UPDATE SET quantity=public.inventory.quantity+EXCLUDED.quantity, updated_at=now();
    INSERT INTO public.stock_movements(product_id,warehouse_id,movement_type,quantity,unit_cost,reference_type,reference_id,note,created_by)
    VALUES(v_p,_warehouse_id,'return_in'::movement_type,v_qty,v_price,'sales_return',v_id,'Sales return',v_user);
  END LOOP;

  IF _customer_id IS NOT NULL THEN
    UPDATE public.customers SET balance = GREATEST(balance - v_tot, 0), updated_at=now() WHERE id=_customer_id;
  END IF;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.create_purchase_return(_invoice_id uuid, _warehouse_id uuid, _supplier_id uuid, _refund_method text, _note text, _items jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID; v_no TEXT; v_user UUID := auth.uid();
  v_item JSONB; v_sub NUMERIC := 0; v_tax NUMERIC := 0; v_tot NUMERIC := 0;
  v_qty NUMERIC; v_cost NUMERIC; v_tr NUMERIC; v_lt NUMERIC; v_ltax NUMERIC; v_p UUID; v_stock NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_staff(v_user) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF jsonb_array_length(_items)=0 THEN RAISE EXCEPTION 'No items'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::NUMERIC;
    SELECT quantity INTO v_stock FROM public.inventory WHERE product_id=v_p AND warehouse_id=_warehouse_id;
    IF v_stock IS NULL OR v_stock < v_qty THEN RAISE EXCEPTION 'Insufficient stock for product %', v_p; END IF;
    v_cost := (v_item->>'unit_cost')::NUMERIC;
    v_tr := COALESCE((v_item->>'tax_rate')::NUMERIC,0);
    v_lt := v_qty*v_cost; v_ltax := v_lt*v_tr/100;
    v_sub := v_sub+v_lt; v_tax := v_tax+v_ltax;
  END LOOP;
  v_tot := v_sub+v_tax;
  v_no := public.next_purchase_return_number();

  INSERT INTO public.purchase_returns(return_number,invoice_id,supplier_id,warehouse_id,subtotal,tax,total,refund_method,note,created_by)
  VALUES(v_no,_invoice_id,_supplier_id,_warehouse_id,v_sub,v_tax,v_tot,_refund_method::payment_method,_note,v_user)
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::NUMERIC;
    v_cost := (v_item->>'unit_cost')::NUMERIC;
    v_tr := COALESCE((v_item->>'tax_rate')::NUMERIC,0);
    v_lt := v_qty*v_cost; v_ltax := v_lt*v_tr/100;
    INSERT INTO public.purchase_return_items(return_id,product_id,quantity,unit_cost,tax,total)
    VALUES(v_id,v_p,v_qty,v_cost,v_ltax,v_lt+v_ltax);
    UPDATE public.inventory SET quantity=quantity-v_qty, updated_at=now() WHERE product_id=v_p AND warehouse_id=_warehouse_id;
    INSERT INTO public.stock_movements(product_id,warehouse_id,movement_type,quantity,unit_cost,reference_type,reference_id,note,created_by)
    VALUES(v_p,_warehouse_id,'return_out'::movement_type,v_qty,v_cost,'purchase_return',v_id,'Purchase return',v_user);
  END LOOP;

  IF _supplier_id IS NOT NULL THEN
    UPDATE public.suppliers SET balance = GREATEST(balance - v_tot, 0), updated_at=now() WHERE id=_supplier_id;
  END IF;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.create_stock_transfer(_from uuid, _to uuid, _note text, _items jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID; v_no TEXT; v_user UUID := auth.uid();
  v_item JSONB; v_p UUID; v_qty NUMERIC; v_stock NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_staff(v_user) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _from = _to THEN RAISE EXCEPTION 'Source and destination must differ'; END IF;
  IF jsonb_array_length(_items)=0 THEN RAISE EXCEPTION 'No items'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::NUMERIC;
    SELECT quantity INTO v_stock FROM public.inventory WHERE product_id=v_p AND warehouse_id=_from;
    IF v_stock IS NULL OR v_stock < v_qty THEN RAISE EXCEPTION 'Insufficient stock for product %', v_p; END IF;
  END LOOP;

  v_no := public.next_transfer_number();
  INSERT INTO public.stock_transfers(transfer_number,from_warehouse_id,to_warehouse_id,note,created_by)
  VALUES(v_no,_from,_to,_note,v_user) RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::NUMERIC;
    INSERT INTO public.stock_transfer_items(transfer_id,product_id,quantity) VALUES(v_id,v_p,v_qty);
    UPDATE public.inventory SET quantity=quantity-v_qty, updated_at=now() WHERE product_id=v_p AND warehouse_id=_from;
    INSERT INTO public.inventory(product_id,warehouse_id,quantity) VALUES(v_p,_to,v_qty)
    ON CONFLICT(product_id,warehouse_id) DO UPDATE SET quantity=public.inventory.quantity+EXCLUDED.quantity, updated_at=now();
    INSERT INTO public.stock_movements(product_id,warehouse_id,movement_type,quantity,reference_type,reference_id,note,created_by)
    VALUES(v_p,_from,'transfer_out'::movement_type,v_qty,'transfer',v_id,'Transfer out',v_user);
    INSERT INTO public.stock_movements(product_id,warehouse_id,movement_type,quantity,reference_type,reference_id,note,created_by)
    VALUES(v_p,_to,'transfer_in'::movement_type,v_qty,'transfer',v_id,'Transfer in',v_user);
  END LOOP;

  RETURN v_id;
END $function$;
