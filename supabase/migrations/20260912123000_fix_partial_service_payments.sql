-- Correct partial credit payments when an invoice contains both products and services.
CREATE OR REPLACE FUNCTION public.create_sale(
  _warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric,
  _discount numeric, _note text, _items jsonb, _sale_date date
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invoice_id uuid; v_base_items jsonb; v_service record; v_service_total numeric := 0;
  v_generic_id uuid; v_has_products boolean; v_paid numeric; v_total numeric; v_final_paid numeric;
  v_balance numeric; v_limit numeric; v_balance_adjustment numeric;
BEGIN
  IF coalesce(jsonb_typeof(_items), '') <> 'array' OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Cart is empty'; END IF;
  IF _sale_date IS NULL THEN RAISE EXCEPTION 'Sale date is required'; END IF;
  SELECT coalesce(jsonb_agg(x.value), '[]'::jsonb), count(*) > 0 INTO v_base_items, v_has_products FROM jsonb_array_elements(_items) x WHERE coalesce(x.value->>'is_service', 'false') <> 'true';
  SELECT id INTO v_generic_id FROM public.products WHERE sku = 'SERVICE-CUSTOM';
  IF NOT v_has_products THEN v_base_items := jsonb_build_array(jsonb_build_object('product_id', v_generic_id, 'quantity', 1, 'unit_price', 0, 'tax_rate', 0)); END IF;
  v_invoice_id := public.create_sale(_warehouse_id, _customer_id, _payment_method, _paid, _discount, _note, v_base_items);
  IF NOT v_has_products THEN DELETE FROM public.sales_invoice_items WHERE invoice_id = v_invoice_id AND product_id = v_generic_id; DELETE FROM public.stock_movements WHERE reference_id = v_invoice_id AND product_id = v_generic_id; UPDATE public.inventory SET quantity = quantity + 1 WHERE warehouse_id = _warehouse_id AND product_id = v_generic_id; END IF;
  FOR v_service IN SELECT value FROM jsonb_array_elements(_items) WHERE coalesce(value->>'is_service', 'false') = 'true' LOOP
    IF coalesce(trim(v_service.value->>'name'), '') = '' OR coalesce((v_service.value->>'quantity')::numeric, 0) <= 0 OR coalesce((v_service.value->>'unit_price')::numeric, -1) < 0 THEN RAISE EXCEPTION 'Every service requires a name, price, and positive quantity'; END IF;
    v_service_total := v_service_total + round((v_service.value->>'quantity')::numeric * (v_service.value->>'unit_price')::numeric, 2);
    INSERT INTO public.sales_invoice_items(invoice_id, product_id, description, quantity, unit_price, discount, tax, total) VALUES (v_invoice_id, NULL, trim(v_service.value->>'name'), (v_service.value->>'quantity')::numeric, (v_service.value->>'unit_price')::numeric, 0, 0, round((v_service.value->>'quantity')::numeric * (v_service.value->>'unit_price')::numeric, 2));
  END LOOP;
  SELECT total, paid INTO v_total, v_paid FROM public.sales_invoices WHERE id = v_invoice_id FOR UPDATE;
  IF _payment_method = 'credit' THEN
    v_final_paid := least(coalesce(_paid, 0), v_total + v_service_total);
    v_balance_adjustment := (v_total + v_service_total - v_final_paid) - (v_total - v_paid);
    SELECT balance, credit_limit INTO v_balance, v_limit FROM public.customers WHERE id = _customer_id FOR UPDATE;
    IF coalesce(v_balance, 0) + v_balance_adjustment > coalesce(v_limit, 0) THEN RAISE EXCEPTION 'Credit limit would be exceeded'; END IF;
    UPDATE public.customers SET balance = balance + v_balance_adjustment, updated_at = now() WHERE id = _customer_id;
  ELSE v_final_paid := v_total + v_service_total; END IF;
  UPDATE public.sales_invoices SET total = v_total + v_service_total, subtotal = subtotal + v_service_total, paid = v_final_paid,
    status = CASE WHEN v_final_paid >= v_total + v_service_total THEN 'paid'::public.invoice_status WHEN v_final_paid = 0 THEN 'unpaid'::public.invoice_status ELSE 'partial'::public.invoice_status END,
    created_at = _sale_date::timestamp + localtime, updated_at = now() WHERE id = v_invoice_id;
  UPDATE public.stock_movements SET created_at = _sale_date::timestamp + localtime WHERE reference_id = v_invoice_id AND reference_type = 'sale';
  RETURN v_invoice_id;
END; $$;
