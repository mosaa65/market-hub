-- POS split-payment follow-up: accept the already-supported cheque ENUM and
-- reject a tender total above the posted invoice total.
-- This is additive and leaves the single-method create_sale overload unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_sale(
  _warehouse_id uuid,
  _customer_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb,
  _sale_date date,
  _payment_splits jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id uuid;
  v_total numeric;
  v_paid numeric;
  v_user uuid := auth.uid();
  v_split record;
  v_component_count integer := 0;
  v_split_total numeric := 0;
  v_distinct_methods integer := 0;
  v_single_method text;
  v_recorded_method text := _payment_method;
  v_create_method text;
BEGIN
  IF coalesce(jsonb_typeof(_payment_splits), 'jsonb') <> 'array'
     OR coalesce(jsonb_array_length(_payment_splits), 0) = 0 THEN
    RETURN public.create_sale(
      _warehouse_id, _customer_id, _payment_method, _paid, _discount, _note, _items, _sale_date
    );
  END IF;

  FOR v_split IN
    SELECT part ->> 'method' AS method,
           coalesce((part ->> 'amount')::numeric, 0) AS amount
    FROM jsonb_array_elements(_payment_splits) AS part
  LOOP
    IF v_split.method IS NULL
      OR v_split.method NOT IN ('cash', 'card', 'bank_transfer', 'mobile_money', 'cheque') THEN
      RAISE EXCEPTION 'Unsupported payment method: %', v_split.method;
    END IF;
    IF v_split.amount <= 0 THEN
      RAISE EXCEPTION 'Every payment tender component requires a positive amount';
    END IF;

    v_component_count := v_component_count + 1;
    v_split_total := v_split_total + v_split.amount;
  END LOOP;

  SELECT count(DISTINCT part ->> 'method'), min(part ->> 'method')
    INTO v_distinct_methods, v_single_method
  FROM jsonb_array_elements(_payment_splits) AS part;

  -- The invoice's original journal is posted inside the legacy create_sale
  -- overload before tender rows can be inserted. Until post_sales_invoice is
  -- upgraded to debit every tender's own ledger account, a true multi-method
  -- split would be reported correctly but posted to one account. Refuse it
  -- transactionally rather than write a misleading journal.
  IF v_distinct_methods > 1 THEN
    RAISE EXCEPTION 'Multi-method payment requires split-aware ledger posting';
  END IF;

  IF v_component_count <> v_distinct_methods THEN
    RAISE EXCEPTION 'A payment method may only be included once in a split';
  END IF;

  IF round(v_split_total, 2) <> round(coalesce(_paid, 0), 2) THEN
    RAISE EXCEPTION
      'Payment breakdown total % does not match the paid amount %',
      round(v_split_total, 2), round(coalesce(_paid, 0), 2);
  END IF;

  v_recorded_method := CASE
    WHEN v_distinct_methods > 1 THEN 'split'
    ELSE v_single_method
  END;

  -- The legacy single-method function's allow-list predates cheque and split.
  -- Use a ledger-safe single method to create the invoice, then restore its
  -- tender identity after creation. For a cheque-only tender the canonical
  -- ledger family is bank; for a multi-method invoice the posting is the
  -- existing split/cash-settlement path and the tender rows remain authoritative.
  v_create_method := CASE
    WHEN v_recorded_method = 'cheque' THEN 'bank_transfer'
    WHEN v_recorded_method = 'split' THEN 'cash'
    ELSE v_recorded_method
  END;

  v_invoice_id := public.create_sale(
    _warehouse_id, _customer_id, v_create_method, _paid, _discount, _note, _items, _sale_date
  );

  SELECT total, paid INTO v_total, v_paid
  FROM public.sales_invoices
  WHERE id = v_invoice_id
  FOR UPDATE;

  IF round(v_split_total, 2) > round(v_total, 2) THEN
    RAISE EXCEPTION 'Payment breakdown cannot exceed the invoice total';
  END IF;

  IF round(v_split_total, 2) <> round(v_paid, 2) THEN
    RAISE EXCEPTION 'Tender breakdown does not match the recorded paid amount';
  END IF;

  UPDATE public.sales_invoices
  SET payment_method = v_recorded_method::public.payment_method,
      updated_at = now()
  WHERE id = v_invoice_id
    AND payment_method IS DISTINCT FROM v_recorded_method::public.payment_method;

  FOR v_split IN
    SELECT part ->> 'method' AS method,
           coalesce((part ->> 'amount')::numeric, 0) AS amount
    FROM jsonb_array_elements(_payment_splits) AS part
  LOOP
    INSERT INTO public.customer_payment_splits (
      customer_id, invoice_id, method, amount, occurred_at, created_by
    )
    VALUES (
      _customer_id,
      v_invoice_id,
      v_split.method::public.payment_method,
      round(v_split.amount, 2),
      coalesce(_sale_date, current_date)::timestamp + localtime,
      v_user
    );
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user,
    'sale.tender_breakdown.recorded',
    'sales_invoice',
    v_invoice_id,
    jsonb_build_object(
      'recorded_payment_method', v_recorded_method,
      'components', v_component_count,
      'tender_total', round(v_split_total, 2),
      'total', v_total,
      'paid', v_paid
    )
  );

  RETURN v_invoice_id;
END;
$function$;

COMMIT;
