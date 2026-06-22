
-- Sequences
CREATE SEQUENCE IF NOT EXISTS public.sales_return_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.purchase_return_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.stock_transfer_seq START 1;

-- Sales returns
CREATE TABLE public.sales_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number TEXT NOT NULL UNIQUE,
  invoice_id UUID REFERENCES public.sales_invoices(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  refund_method payment_method,
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_returns TO authenticated;
GRANT ALL ON public.sales_returns TO service_role;
ALTER TABLE public.sales_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read sret" ON public.sales_returns FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff write sret" ON public.sales_returns FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.sales_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES public.sales_returns(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC NOT NULL,
  tax NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_return_items TO authenticated;
GRANT ALL ON public.sales_return_items TO service_role;
ALTER TABLE public.sales_return_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read sret_i" ON public.sales_return_items FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff write sret_i" ON public.sales_return_items FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Purchase returns
CREATE TABLE public.purchase_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number TEXT NOT NULL UNIQUE,
  invoice_id UUID REFERENCES public.purchase_invoices(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  refund_method payment_method,
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_returns TO authenticated;
GRANT ALL ON public.purchase_returns TO service_role;
ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read pret" ON public.purchase_returns FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff write pret" ON public.purchase_returns FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.purchase_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES public.purchase_returns(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC NOT NULL,
  tax NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_return_items TO authenticated;
GRANT ALL ON public.purchase_return_items TO service_role;
ALTER TABLE public.purchase_return_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read pret_i" ON public.purchase_return_items FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff write pret_i" ON public.purchase_return_items FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Stock transfers
CREATE TABLE public.stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number TEXT NOT NULL UNIQUE,
  from_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  to_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  status TEXT NOT NULL DEFAULT 'completed',
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_warehouse_id <> to_warehouse_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_transfers TO authenticated;
GRANT ALL ON public.stock_transfers TO service_role;
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read xfer" ON public.stock_transfers FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff write xfer" ON public.stock_transfers FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.stock_transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity NUMERIC NOT NULL CHECK (quantity > 0)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_transfer_items TO authenticated;
GRANT ALL ON public.stock_transfer_items TO service_role;
ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read xfer_i" ON public.stock_transfer_items FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff write xfer_i" ON public.stock_transfer_items FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Number helpers
CREATE OR REPLACE FUNCTION public.next_sales_return_number() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n BIGINT; BEGIN n := nextval('public.sales_return_seq'); RETURN 'SR-'||to_char(now(),'YYYYMM')||'-'||lpad(n::TEXT,4,'0'); END $$;

CREATE OR REPLACE FUNCTION public.next_purchase_return_number() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n BIGINT; BEGIN n := nextval('public.purchase_return_seq'); RETURN 'PR-'||to_char(now(),'YYYYMM')||'-'||lpad(n::TEXT,4,'0'); END $$;

CREATE OR REPLACE FUNCTION public.next_transfer_number() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n BIGINT; BEGIN n := nextval('public.stock_transfer_seq'); RETURN 'TR-'||to_char(now(),'YYYYMM')||'-'||lpad(n::TEXT,4,'0'); END $$;

-- Create Sales Return
CREATE OR REPLACE FUNCTION public.create_sales_return(_invoice_id uuid, _warehouse_id uuid, _customer_id uuid, _refund_method text, _note text, _items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

    INSERT INTO public.inventory(product_id,warehouse_id,quantity)
    VALUES(v_p,_warehouse_id,v_qty)
    ON CONFLICT(product_id,warehouse_id) DO UPDATE SET quantity=public.inventory.quantity+EXCLUDED.quantity, updated_at=now();

    INSERT INTO public.stock_movements(product_id,warehouse_id,movement_type,quantity,unit_cost,reference_type,reference_id,note,created_by)
    VALUES(v_p,_warehouse_id,'in',v_qty,v_price,'sales_return',v_id,'Sales return',v_user);
  END LOOP;

  -- Reduce customer balance if refund reduces their debt
  IF _customer_id IS NOT NULL THEN
    UPDATE public.customers SET balance = GREATEST(balance - v_tot, 0), updated_at=now() WHERE id=_customer_id;
  END IF;
  RETURN v_id;
END $$;

-- Create Purchase Return
CREATE OR REPLACE FUNCTION public.create_purchase_return(_invoice_id uuid, _warehouse_id uuid, _supplier_id uuid, _refund_method text, _note text, _items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

    UPDATE public.inventory SET quantity=quantity-v_qty, updated_at=now()
      WHERE product_id=v_p AND warehouse_id=_warehouse_id;

    INSERT INTO public.stock_movements(product_id,warehouse_id,movement_type,quantity,unit_cost,reference_type,reference_id,note,created_by)
    VALUES(v_p,_warehouse_id,'out',v_qty,v_cost,'purchase_return',v_id,'Purchase return',v_user);
  END LOOP;

  IF _supplier_id IS NOT NULL THEN
    UPDATE public.suppliers SET balance = GREATEST(balance - v_tot, 0), updated_at=now() WHERE id=_supplier_id;
  END IF;
  RETURN v_id;
END $$;

-- Create Stock Transfer
CREATE OR REPLACE FUNCTION public.create_stock_transfer(_from uuid, _to uuid, _note text, _items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

    UPDATE public.inventory SET quantity=quantity-v_qty, updated_at=now()
      WHERE product_id=v_p AND warehouse_id=_from;

    INSERT INTO public.inventory(product_id,warehouse_id,quantity)
    VALUES(v_p,_to,v_qty)
    ON CONFLICT(product_id,warehouse_id) DO UPDATE SET quantity=public.inventory.quantity+EXCLUDED.quantity, updated_at=now();

    INSERT INTO public.stock_movements(product_id,warehouse_id,movement_type,quantity,reference_type,reference_id,note,created_by)
    VALUES(v_p,_from,'out',v_qty,'transfer',v_id,'Transfer out',v_user);
    INSERT INTO public.stock_movements(product_id,warehouse_id,movement_type,quantity,reference_type,reference_id,note,created_by)
    VALUES(v_p,_to,'in',v_qty,'transfer',v_id,'Transfer in',v_user);
  END LOOP;

  RETURN v_id;
END $$;
