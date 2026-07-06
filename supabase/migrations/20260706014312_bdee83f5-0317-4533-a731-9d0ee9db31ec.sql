
CREATE TABLE public.customer_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES public.sales_invoices(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method payment_method NOT NULL DEFAULT 'cash',
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_payments TO authenticated;
GRANT ALL ON public.customer_payments TO service_role;

ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_manage_payments" ON public.customer_payments
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER trg_customer_payments_updated
  BEFORE UPDATE ON public.customer_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_customer_payments_customer ON public.customer_payments(customer_id, payment_date DESC);
CREATE INDEX idx_customer_payments_invoice ON public.customer_payments(invoice_id);

CREATE OR REPLACE FUNCTION public.record_customer_payment(
  _customer_id UUID,
  _invoice_id UUID,
  _amount NUMERIC,
  _method TEXT,
  _payment_date DATE,
  _note TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_user UUID := auth.uid();
  v_total NUMERIC;
  v_paid NUMERIC;
  v_customer UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_staff(v_user) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _customer_id IS NULL THEN RAISE EXCEPTION 'Customer required'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be > 0'; END IF;

  IF _invoice_id IS NOT NULL THEN
    SELECT total, paid, customer_id INTO v_total, v_paid, v_customer
      FROM public.sales_invoices WHERE id = _invoice_id FOR UPDATE;
    IF v_total IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF v_customer IS DISTINCT FROM _customer_id THEN
      RAISE EXCEPTION 'Invoice does not belong to this customer';
    END IF;
  END IF;

  INSERT INTO public.customer_payments(customer_id, invoice_id, amount, payment_method, payment_date, note, created_by)
  VALUES (_customer_id, _invoice_id, _amount, _method::payment_method, COALESCE(_payment_date, CURRENT_DATE), _note, v_user)
  RETURNING id INTO v_id;

  IF _invoice_id IS NOT NULL THEN
    UPDATE public.sales_invoices
      SET paid = paid + _amount,
          status = CASE WHEN paid + _amount >= total THEN 'paid'::invoice_status ELSE 'partial'::invoice_status END,
          updated_at = now()
      WHERE id = _invoice_id;
  END IF;

  UPDATE public.customers
    SET balance = GREATEST(balance - _amount, 0), updated_at = now()
    WHERE id = _customer_id;

  RETURN v_id;
END $$;
