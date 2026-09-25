
-- ============================================================================
-- Repair customer ledger posting without changing or deleting user data.
--
-- Guarantees:
--   * No UPDATE/DELETE against customers, invoices, payments, or ledger rows.
--   * Existing ledger rows are never modified.
--   * Missing historical ledger rows are inserted idempotently using source_key.
--   * Future credit sales are posted to customer_ledger in the same transaction.
--   * Existing payment RPC is intentionally preserved; it already posts payments.
--
-- Root cause addressed:
--   The active create_sale overloads were superseded by later migrations with
--   inconsistent bodies/signatures. Some invoices updated customers.balance but
--   never appended the corresponding sale entry to customer_ledger.
--
-- This migration only adds ledger entries and replaces the existing sale RPC.
-- It does not alter database schema, existing source documents, or balances.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Non-destructive historical repair: missing sale debit.
-- ---------------------------------------------------------------------------
-- The original migration inserted only invoice outstanding amounts as sale
-- debits, while it also inserted historical customer payments as credits. To
-- avoid changing those existing rows and to avoid double-counting, this repair
-- adds only the missing debit delta needed to reconcile each invoice's own
-- ledger activity. A payment made at invoice creation with no customer_payment
-- row is deliberately not invented; its invoice remains settled.
INSERT INTO public.customer_ledger (
  customer_id,
  entry_type,
  debit,
  credit,
  reference_id,
  reference_type,
  occurred_at,
  created_by,
  source_key,
  note
)
SELECT
  s.customer_id,
  'sale',
  round(
    greatest(
      coalesce(s.total, 0)
      - coalesce(s.paid, 0)
      + coalesce((
          SELECT sum(p.amount)
          FROM public.customer_payments AS p
          WHERE p.invoice_id = s.id
        ), 0)
      - coalesce((
          SELECT sum(l.debit)
          FROM public.customer_ledger AS l
          WHERE l.reference_id = s.id
            AND l.reference_type = 'sales_invoice'
            AND l.entry_type = 'sale'
        ), 0),
      0
    ),
    2
  ),
 0,
  s.id,
  'sales_invoice',
  s.created_at,
  s.created_by,
  'repair:sale-delta:' || s.id,
  'إصلاح دفتر العميل — استكمال قيد بيع الفاتورة'
FROM public.sales_invoices AS s
WHERE s.customer_id IS NOT NULL
  AND coalesce(s.total, 0) > 0
  AND s.status NOT IN ('cancelled'::public.invoice_status, 'returned'::public.invoice_status)
  AND round(
    greatest(
      coalesce(s.total, 0)
      - coalesce(s.paid, 0)
      + coalesce((
          SELECT sum(p.amount)
          FROM public.customer_payments AS p
          WHERE p.invoice_id = s.id
        ), 0)
      - coalesce((
          SELECT sum(l.debit)
          FROM public.customer_ledger AS l
          WHERE l.reference_id = s.id
            AND l.reference_type = 'sales_invoice'
            AND l.entry_type = 'sale'
        ), 0),
      0
    ),
    2
  ) > 0
ON CONFLICT (source_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Non-destructive historical repair: missing sales returns.
-- ---------------------------------------------------------------------------
-- A sales return reduces the customer's receivable, therefore it is a credit.
-- Existing return ledger rows are left untouched.
INSERT INTO public.customer_ledger (
  customer_id,
  entry_type,
  debit,
  credit,
  reference_id,
  reference_type,
  occurred_at,
  created_by,
  source_key,
  note
)
SELECT
  r.customer_id,
  'return',
 0,
  round(greatest(coalesce(r.total, 0), 0), 2),
  r.id,
  'sales_return',
  r.created_at,
  r.created_by,
  'repair:return:' || r.id,
  coalesce(nullif(trim(r.note), ''), 'إصلاح دفتر العميل — مرتجع مبيعات')
FROM public.sales_returns AS r
WHERE r.customer_id IS NOT NULL
  AND coalesce(r.total, 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.customer_ledger AS l
    WHERE l.reference_id = r.id
      AND l.reference_type = 'sales_return'
      AND l.entry_type = 'return'
  )
ON CONFLICT (source_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Repair the active 8-argument create_sale RPC.
-- ---------------------------------------------------------------------------
-- The business behaviour remains the existing one. The only functional ledger
-- addition is the idempotent sale posting after the final outstanding amount
-- is known, including service lines handled by this overload.
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
  v_base_items jsonb;
  v_service record;
  v_service_total numeric := 0;
  v_generic_id uuid;
  v_has_products boolean;
  v_paid numeric;
  v_total numeric;
  v_final_paid numeric;
  v_balance numeric;
  v_limit numeric;
  v_balance_adjustment numeric;
  v_outstanding numeric;
BEGIN
  IF coalesce(jsonb_typeof(_items), '') <> 'array'
    OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;
  IF _sale_date IS NULL THEN
    RAISE EXCEPTION 'Sale date is required';
  END IF;

  SELECT
    coalesce(jsonb_agg(x.value), '[]'::jsonb),
    count(*) > 0
  INTO v_base_items, v_has_products
  FROM jsonb_array_elements(_items) AS x
  WHERE coalesce(x.value->>'is_service', 'false') <> 'true';

  SELECT id
  INTO v_generic_id
  FROM public.products
  WHERE sku = 'SERVICE-CUSTOM';

  IF NOT v_has_products THEN
    v_base_items := jsonb_build_array(
      jsonb_build_object(
        'product_id', v_generic_id,
        'quantity', 1,
        'unit_price', 0,
        'tax_rate', 0
      )
    );
  END IF;

  -- Preserve the existing secure posting path for stock and invoice creation.
  v_invoice_id := public.create_sale(
    _warehouse_id,
    _customer_id,
    _payment_method,
    _paid,
    _discount,
    _note,
    v_base_items
  );

  IF NOT v_has_products THEN
    DELETE FROM public.sales_invoice_items
    WHERE invoice_id = v_invoice_id AND product_id = v_generic_id;

    DELETE FROM public.stock_movements
    WHERE reference_id = v_invoice_id AND product_id = v_generic_id;

    UPDATE public.inventory
    SET quantity = quantity + 1
    WHERE warehouse_id = _warehouse_id AND product_id = v_generic_id;
  END IF;

  FOR v_service IN
    SELECT value
    FROM jsonb_array_elements(_items)
    WHERE coalesce(value->>'is_service', 'false') = 'true'
  LOOP
    IF coalesce(trim(v_service.value->>'name'), '') = ''
      OR coalesce((v_service.value->>'quantity')::numeric, 0) <= 0
      OR coalesce((v_service.value->>'unit_price')::numeric, -1) < 0 THEN
      RAISE EXCEPTION 'Every service requires a name, price, and positive quantity';
    END IF;

    v_service_total := v_service_total + round(
      (v_service.value->>'quantity')::numeric
      * (v_service.value->>'unit_price')::numeric
      * (1 + coalesce((v_service.value->>'tax_rate')::numeric, 0) / 100),
      2
    );

    INSERT INTO public.sales_invoice_items (
      invoice_id,
      product_id,
      description,
      quantity,
      unit_price,
      discount,
      tax,
      total
    )
    VALUES (
      v_invoice_id,
      NULL,
      nullif(trim(v_service.value->>'name'), ''),
      (v_service.value->>'quantity')::numeric,
      (v_service.value->>'unit_price')::numeric,
      0,
      round(
        (v_service.value->>'quantity')::numeric
        * (v_service.value->>'unit_price')::numeric
        * coalesce((v_service.value->>'tax_rate')::numeric, 0) / 100,
        2
      ),
      round(
        (v_service.value->>'quantity')::numeric
        * (v_service.value->>'unit_price')::numeric
        * (1 + coalesce((v_service.value->>'tax_rate')::numeric, 0) / 100),
        2
      )
    );
  END LOOP;

  SELECT total, paid
  INTO v_total, v_paid
  FROM public.sales_invoices
  WHERE id = v_invoice_id
  FOR UPDATE;

  IF v_service_total > 0 THEN
    IF _payment_method = 'credit' THEN
      v_final_paid := least(coalesce(_paid, 0), v_total + v_service_total);
      v_balance_adjustment := round(
        (v_total + v_service_total - v_final_paid)
        - greatest(v_total - v_paid, 0),
        2
      );

      SELECT balance, credit_limit
      INTO v_balance, v_limit
      FROM public.customers
      WHERE id = _customer_id
      FOR UPDATE;

      IF coalesce(v_balance, 0) + v_balance_adjustment > coalesce(v_limit, 0)
        AND coalesce(v_limit, 0) > 0 THEN
        RAISE EXCEPTION 'Credit limit exceeded';
      END IF;
    ELSE
      v_final_paid := least(coalesce(_paid, 0), v_total + v_service_total);
    END IF;
  END IF;

  v_total := round(v_total + v_service_total, 2);
  v_final_paid := least(greatest(coalesce(_paid, 0), 0), v_total);
  v_outstanding := round(greatest(v_total - v_final_paid, 0), 2);

  IF v_outstanding > 0 AND _customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required when the sale has an unpaid amount';
  END IF;

  IF v_outstanding > 0
    AND NOT public.customer_credit_limit_allows(_customer_id, v_outstanding) THEN
    RAISE EXCEPTION
      'Credit limit exceeded: current balance %, requested debt %, limit %',
      v_balance,
      v_outstanding,
      v_limit;
  END IF;

  UPDATE public.sales_invoices
  SET total = v_total,
      subtotal = round(subtotal + v_service_total, 2),
      paid = v_final_paid,
      status = CASE
        WHEN v_final_paid >= v_total THEN 'paid'::public.invoice_status
        WHEN v_final_paid = 0 THEN 'unpaid'::public.invoice_status
        ELSE 'partial'::public.invoice_status
      END,
      created_at = _sale_date::timestamp + localtime,
      updated_at = now()
  WHERE id = v_invoice_id;

  IF _customer_id IS NOT NULL AND v_service_total > 0 AND v_outstanding > 0 THEN
    UPDATE public.customers
    SET balance = round(
      coalesce(balance, 0)
      + v_outstanding
      - greatest(v_total - v_paid, 0),
      2
    ),
    updated_at = now()
    WHERE id = _customer_id;
  END IF;

  -- The one authoritative posting for the final outstanding amount.
  -- source_key makes retries and replays safe without touching existing rows.
  IF _customer_id IS NOT NULL AND v_outstanding > 0 THEN
    INSERT INTO public.customer_ledger (
      customer_id,
      entry_type,
      debit,
      credit,
      reference_id,
      reference_type,
      occurred_at,
      created_by,
      source_key,
      note
    )
    VALUES (
      _customer_id,
      'sale',
      v_outstanding,
      0,
      v_invoice_id,
      'sales_invoice',
      _sale_date::timestamp + localtime,
      auth.uid(),
      'sale:' || v_invoice_id,
      'قيد بيع آجل'
    )
    ON CONFLICT (source_key) DO NOTHING;
  END IF;

  UPDATE public.stock_movements
  SET created_at = _sale_date::timestamp + localtime
  WHERE reference_id = v_invoice_id AND reference_type = 'sale';

  RETURN v_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Safety checks (read-only assertions; migration aborts on inconsistency).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  duplicate_sources integer;
  missing_customer_fk integer;
BEGIN
  SELECT count(*) INTO duplicate_sources
  FROM (
    SELECT source_key
    FROM public.customer_ledger
    WHERE source_key IS NOT NULL
    GROUP BY source_key
    HAVING count(*) > 1
  ) AS duplicates;

  IF duplicate_sources > 0 THEN
    RAISE EXCEPTION
      'Ledger repair stopped: % duplicate source_key groups already exist',
      duplicate_sources;
  END IF;

  SELECT count(*) INTO missing_customer_fk
  FROM public.customer_ledger AS l
  LEFT JOIN public.customers AS c ON c.id = l.customer_id
  WHERE c.id IS NULL;

  IF missing_customer_fk > 0 THEN
    RAISE EXCEPTION
      'Ledger repair stopped: % ledger rows reference missing customers',
      missing_customer_fk;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date)
IS 'Posts sales through the existing secure flow and appends one idempotent customer_ledger sale entry for the final outstanding amount. Does not modify existing source documents.';
