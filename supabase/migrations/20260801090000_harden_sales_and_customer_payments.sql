-- Transactional integrity baseline for sales and customer collections.
--
-- These operations are financial source documents. They must be posted through
-- controlled RPCs rather than browser-side INSERT/UPDATE/DELETE calls.

ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'unpaid';

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
SET search_path = public
AS $$
DECLARE
  v_invoice_id uuid;
  v_invoice_number text;
  v_user uuid := auth.uid();
  v_line record;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_discount numeric := coalesce(_discount, 0);
  v_total numeric := 0;
  v_paid numeric := 0;
  v_outstanding numeric := 0;
  v_price numeric;
  v_tax_rate numeric;
  v_cost numeric;
  v_stock numeric;
  v_customer_balance numeric;
  v_credit_limit numeric;
  v_line_total numeric;
  v_line_tax numeric;
  v_status public.invoice_status;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to post sales';
  END IF;

  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required';
  END IF;

  IF coalesce(jsonb_typeof(_items), '') <> 'array'
    OR coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  IF _payment_method NOT IN ('cash', 'card', 'bank_transfer', 'credit', 'mobile_money') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  IF v_discount < 0 THEN
    RAISE EXCEPTION 'Discount cannot be negative';
  END IF;

  IF coalesce(_paid, 0) < 0 THEN
    RAISE EXCEPTION 'Paid amount cannot be negative';
  END IF;

  -- Aggregate duplicate product lines and lock products/inventory in a stable
  -- order. This protects the stock check from concurrent checkouts.
  FOR v_line IN
    SELECT
      (line ->> 'product_id')::uuid AS product_id,
      sum((line ->> 'quantity')::numeric) AS quantity
    FROM jsonb_array_elements(_items) AS line
    GROUP BY (line ->> 'product_id')::uuid
    ORDER BY (line ->> 'product_id')::uuid
  LOOP
    IF v_line.product_id IS NULL OR v_line.quantity IS NULL OR v_line.quantity <= 0 THEN
      RAISE EXCEPTION 'Every sale line requires a product and a positive quantity';
    END IF;

    SELECT p.sale_price, p.tax_rate, p.cost_price, i.quantity
      INTO v_price, v_tax_rate, v_cost, v_stock
    FROM public.inventory AS i
    JOIN public.products AS p ON p.id = i.product_id
    WHERE i.product_id = v_line.product_id
      AND i.warehouse_id = _warehouse_id
      AND p.is_active = true
    FOR UPDATE OF i, p;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % is unavailable in the selected warehouse', v_line.product_id;
    END IF;

    IF v_stock < v_line.quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product %', v_line.product_id;
    END IF;

    IF v_price < 0 OR v_cost < 0 OR v_tax_rate < 0 OR v_tax_rate > 100 THEN
      RAISE EXCEPTION 'Product % has invalid pricing or tax configuration', v_line.product_id;
    END IF;

    v_line_total := round(v_line.quantity * v_price, 2);
    v_line_tax := round(v_line_total * v_tax_rate / 100, 2);
    v_subtotal := v_subtotal + v_line_total;
    v_tax_total := v_tax_total + v_line_tax;
  END LOOP;

  v_total := round(v_subtotal + v_tax_total - v_discount, 2);
  IF v_discount > v_subtotal + v_tax_total OR v_total < 0 THEN
    RAISE EXCEPTION 'Discount cannot exceed the invoice amount';
  END IF;

  IF _customer_id IS NOT NULL THEN
    SELECT balance, credit_limit
      INTO v_customer_balance, v_credit_limit
    FROM public.customers
    WHERE id = _customer_id
      AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected customer is unavailable';
    END IF;
  END IF;

  -- For cash/card/bank/mobile sales, record only the receivable amount as paid;
  -- any customer tender above the total is change, not revenue or a credit.
  IF _payment_method = 'credit' THEN
    IF _customer_id IS NULL THEN
      RAISE EXCEPTION 'A customer is required for a credit sale';
    END IF;
    v_paid := least(coalesce(_paid, 0), v_total);
  ELSE
    v_paid := v_total;
  END IF;

  v_outstanding := v_total - v_paid;
  IF v_outstanding > 0 THEN
    IF coalesce(v_customer_balance, 0) + v_outstanding > coalesce(v_credit_limit, 0) THEN
      RAISE EXCEPTION 'Credit limit would be exceeded';
    END IF;
  END IF;

  v_status := CASE
    WHEN v_paid >= v_total THEN 'paid'::public.invoice_status
    WHEN v_paid = 0 THEN 'unpaid'::public.invoice_status
    ELSE 'partial'::public.invoice_status
  END;

  v_invoice_number := public.next_invoice_number();

  INSERT INTO public.sales_invoices (
    invoice_number,
    customer_id,
    warehouse_id,
    status,
    subtotal,
    discount,
    tax,
    total,
    paid,
    payment_method,
    note,
    created_by
  )
  VALUES (
    v_invoice_number,
    _customer_id,
    _warehouse_id,
    v_status,
    v_subtotal,
    v_discount,
    v_tax_total,
    v_total,
    v_paid,
    _payment_method::public.payment_method,
    nullif(trim(_note), ''),
    v_user
  )
  RETURNING id INTO v_invoice_id;

  -- Re-read the authoritative product snapshot while the row remains locked;
  -- prices and tax rates supplied by the browser are intentionally ignored.
  FOR v_line IN
    SELECT
      (line ->> 'product_id')::uuid AS product_id,
      sum((line ->> 'quantity')::numeric) AS quantity
    FROM jsonb_array_elements(_items) AS line
    GROUP BY (line ->> 'product_id')::uuid
    ORDER BY (line ->> 'product_id')::uuid
  LOOP
    SELECT sale_price, tax_rate, cost_price
      INTO v_price, v_tax_rate, v_cost
    FROM public.products
    WHERE id = v_line.product_id;

    v_line_total := round(v_line.quantity * v_price, 2);
    v_line_tax := round(v_line_total * v_tax_rate / 100, 2);

    INSERT INTO public.sales_invoice_items (
      invoice_id, product_id, quantity, unit_price, discount, tax, total
    )
    VALUES (
      v_invoice_id, v_line.product_id, v_line.quantity, v_price, 0, v_line_tax, v_line_total + v_line_tax
    );

    UPDATE public.inventory
    SET quantity = quantity - v_line.quantity,
        updated_at = now()
    WHERE product_id = v_line.product_id
      AND warehouse_id = _warehouse_id
      AND quantity >= v_line.quantity;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stock changed while posting sale for product %', v_line.product_id;
    END IF;

    INSERT INTO public.stock_movements (
      product_id, warehouse_id, movement_type, quantity, unit_cost,
      reference_type, reference_id, note, created_by
    )
    VALUES (
      v_line.product_id, _warehouse_id, 'sale'::public.movement_type,
      v_line.quantity, v_cost, 'sale', v_invoice_id, 'POS sale', v_user
    );
  END LOOP;

  IF v_outstanding > 0 THEN
    UPDATE public.customers
    SET balance = balance + v_outstanding,
        updated_at = now()
    WHERE id = _customer_id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user,
    'sale.posted',
    'sales_invoice',
    v_invoice_id,
    jsonb_build_object(
      'invoice_number', v_invoice_number,
      'warehouse_id', _warehouse_id,
      'customer_id', _customer_id,
      'payment_method', _payment_method,
      'total', v_total,
      'paid', v_paid,
      'outstanding', v_outstanding
    )
  );

  RETURN v_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_customer_payment(
  _customer_id uuid,
  _invoice_id uuid,
  _amount numeric,
  _method text,
  _payment_date date,
  _note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_user uuid := auth.uid();
  v_invoice record;
  v_customer_balance numeric;
  v_remaining numeric := coalesce(_amount, 0);
  v_allocation numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'accountant')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to record customer payments';
  END IF;

  IF _customer_id IS NULL OR v_remaining <= 0 THEN
    RAISE EXCEPTION 'A customer and a positive amount are required';
  END IF;

  IF _method NOT IN ('cash', 'card', 'bank_transfer', 'mobile_money') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  SELECT balance
    INTO v_customer_balance
  FROM public.customers
  WHERE id = _customer_id
    AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer is unavailable';
  END IF;

  IF coalesce(v_customer_balance, 0) < v_remaining THEN
    RAISE EXCEPTION 'Customer balance reconciliation is required before recording this payment';
  END IF;

  IF _invoice_id IS NOT NULL THEN
    SELECT id, total, paid, customer_id
      INTO v_invoice
    FROM public.sales_invoices
    WHERE id = _invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;

    IF v_invoice.customer_id IS DISTINCT FROM _customer_id THEN
      RAISE EXCEPTION 'Invoice does not belong to this customer';
    END IF;

    IF v_invoice.total - v_invoice.paid <= 0 THEN
      RAISE EXCEPTION 'Invoice has no outstanding balance';
    END IF;

    IF v_remaining > v_invoice.total - v_invoice.paid THEN
      RAISE EXCEPTION 'Payment exceeds the invoice outstanding balance';
    END IF;

    INSERT INTO public.customer_payments (
      customer_id, invoice_id, amount, payment_method, payment_date, note, created_by
    )
    VALUES (
      _customer_id, _invoice_id, v_remaining, _method::public.payment_method,
      coalesce(_payment_date, current_date), nullif(trim(_note), ''), v_user
    )
    RETURNING id INTO v_id;

    UPDATE public.sales_invoices
    SET paid = paid + v_remaining,
        status = CASE
          WHEN paid + v_remaining >= total THEN 'paid'::public.invoice_status
          WHEN paid + v_remaining = 0 THEN 'unpaid'::public.invoice_status
          ELSE 'partial'::public.invoice_status
        END,
        updated_at = now()
    WHERE id = _invoice_id;
  ELSE
    -- A general customer payment is applied to the oldest outstanding invoices.
    -- This keeps customer balance, invoice status, and payment history aligned.
    FOR v_invoice IN
      SELECT id, total, paid
      FROM public.sales_invoices
      WHERE customer_id = _customer_id
        AND total > paid
        AND status NOT IN ('cancelled'::public.invoice_status, 'returned'::public.invoice_status)
      ORDER BY created_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_allocation := least(v_remaining, v_invoice.total - v_invoice.paid);

      INSERT INTO public.customer_payments (
        customer_id, invoice_id, amount, payment_method, payment_date, note, created_by
      )
      VALUES (
        _customer_id, v_invoice.id, v_allocation, _method::public.payment_method,
        coalesce(_payment_date, current_date), nullif(trim(_note), ''), v_user
      )
      RETURNING id INTO v_id;

      UPDATE public.sales_invoices
      SET paid = paid + v_allocation,
          status = CASE
            WHEN paid + v_allocation >= total THEN 'paid'::public.invoice_status
            ELSE 'partial'::public.invoice_status
          END,
          updated_at = now()
      WHERE id = v_invoice.id;

      v_remaining := v_remaining - v_allocation;
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Payment exceeds the customer outstanding balance';
    END IF;
  END IF;

  UPDATE public.customers
  SET balance = balance - _amount,
      updated_at = now()
  WHERE id = _customer_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user,
    'customer_payment.recorded',
    'customer',
    _customer_id,
    jsonb_build_object(
      'invoice_id', _invoice_id,
      'amount', _amount,
      'method', _method,
      'payment_date', coalesce(_payment_date, current_date)
    )
  );

  RETURN v_id;
END;
$$;

-- Posted sales and payment allocations are immutable from the browser. Read
-- access remains role-controlled; corrections must be posted as reversals.
DROP POLICY IF EXISTS "sale_manage" ON public.sales_invoices;
DROP POLICY IF EXISTS "sale_item_manage" ON public.sales_invoice_items;
REVOKE INSERT, UPDATE, DELETE ON public.sales_invoices, public.sales_invoice_items FROM authenticated;

DROP POLICY IF EXISTS "staff_manage_payments" ON public.customer_payments;
CREATE POLICY "staff_view_customer_payments"
  ON public.customer_payments
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.customer_payments FROM authenticated;

REVOKE ALL ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb)
  TO authenticated;

REVOKE ALL ON FUNCTION public.record_customer_payment(uuid, uuid, numeric, text, date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(uuid, uuid, numeric, text, date, text)
  TO authenticated;
