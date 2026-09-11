-- A business date is separate from the timestamp at which the cashier posts a sale.
-- Keep the existing secure posting function as the source of truth, then set the
-- document/movement dates atomically for back-dated entries.
CREATE OR REPLACE FUNCTION public.create_sale(
  _warehouse_id uuid,
  _customer_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb,
  _sale_date date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id uuid;
  v_posted_at timestamptz;
BEGIN
  IF _sale_date IS NULL THEN
    RAISE EXCEPTION 'Sale date is required';
  END IF;

  v_invoice_id := public.create_sale(
    _warehouse_id, _customer_id, _payment_method, _paid, _discount, _note, _items
  );
  v_posted_at := _sale_date::timestamp + localtime;

  UPDATE public.sales_invoices
  SET created_at = v_posted_at, updated_at = now()
  WHERE id = v_invoice_id;

  UPDATE public.stock_movements
  SET created_at = v_posted_at
  WHERE reference_id = v_invoice_id AND reference_type = 'sale';

  RETURN v_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date) TO authenticated;
