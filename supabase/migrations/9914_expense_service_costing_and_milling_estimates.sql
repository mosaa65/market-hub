BEGIN;

-- Expense service-cost analysis and milling-service cost estimates.
-- Customer-owned grain remains custody and never becomes company inventory.

INSERT INTO public.expense_cost_centers (code, name, name_ar, is_active)
SELECT 'MILLING-SERVICE', 'Milling service', 'خدمة الطحن', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.expense_cost_centers
  WHERE upper(coalesce(code, '')) = 'MILLING-SERVICE'
     OR name_ar = 'خدمة الطحن'
);

ALTER TABLE public.milling_service_documents
  ADD COLUMN IF NOT EXISTS estimated_cost_basis text,
  ADD COLUMN IF NOT EXISTS estimated_cost_rate numeric(18,4),
  ADD COLUMN IF NOT EXISTS estimated_cost_quantity numeric(18,3),
  ADD COLUMN IF NOT EXISTS estimated_cost_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS estimated_cost_captured_at timestamptz;

-- Preserve sub-unit rates such as a cost per kilogram.
ALTER TABLE public.milling_service_documents
  ALTER COLUMN fee_per_unit TYPE numeric(18,6);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'milling_service_documents_estimated_cost_basis_check'
       AND conrelid = 'public.milling_service_documents'::regclass
  ) THEN
    ALTER TABLE public.milling_service_documents
      ADD CONSTRAINT milling_service_documents_estimated_cost_basis_check
      CHECK (estimated_cost_basis IS NULL OR estimated_cost_basis IN ('BAG', 'KG'));
  END IF;
END
$migration$;

COMMENT ON COLUMN public.milling_service_documents.estimated_cost_rate IS
  'Snapshot of the service product cost_price per its configured base unit. Analytic estimate only; it never posts to the ledger.';
COMMENT ON COLUMN public.milling_service_documents.estimated_cost_amount IS
  'Estimated cost snapshot for this customer service document; actual service expenses remain ordinary expenses.';

CREATE OR REPLACE FUNCTION public.capture_milling_service_estimate_from_intake()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_basis text;
  v_rate numeric(18,4);
  v_short_name text;
  v_name_ar text;
  v_quantity numeric(18,3);
BEGIN
  IF NEW.entry_type <> 'INTAKE' OR NEW.milling_document_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.cost_price, u.short_name, u.name_ar, d.billing_basis
    INTO v_rate, v_short_name, v_name_ar, v_basis
    FROM public.milling_service_documents d
    JOIN public.sales_invoice_items si ON si.invoice_id = d.sales_invoice_id
    JOIN public.products p ON p.id = si.product_id AND p.item_class = 'SERVICE'
    LEFT JOIN public.units u ON u.id = coalesce(p.base_uom_id, p.unit_id)
   WHERE d.id = NEW.milling_document_id
   ORDER BY si.id
   LIMIT 1;

  v_basis := CASE
    WHEN upper(coalesce(v_basis, '')) IN ('PER_BAG', 'BAG') THEN 'BAG'
    WHEN upper(coalesce(v_basis, '')) IN ('PER_KG', 'KG') THEN 'KG'
    WHEN lower(coalesce(v_short_name, '')) IN ('bag', 'sack', 'كيس', 'جوال')
      OR coalesce(v_name_ar, '') ILIKE '%كيس%'
      OR coalesce(v_name_ar, '') ILIKE '%جوال%' THEN 'BAG'
    WHEN lower(coalesce(v_short_name, '')) IN ('kg', 'كجم', 'كغ', 'كيلوجرام')
      OR coalesce(v_name_ar, '') ILIKE '%كيلو%'
      OR coalesce(v_name_ar, '') ILIKE '%كجم%' THEN 'KG'
    WHEN coalesce(NEW.bags_in, 0) > 0 THEN 'BAG'
    WHEN coalesce(NEW.kg_in, 0) > 0 THEN 'KG'
    ELSE NULL
  END;

  IF v_basis = 'BAG' THEN
    SELECT coalesce(sum(bags_in), 0)::numeric(18,3)
      INTO v_quantity
      FROM public.custody_ledger
     WHERE milling_document_id = NEW.milling_document_id
       AND entry_type = 'INTAKE';
  ELSIF v_basis = 'KG' THEN
    SELECT coalesce(sum(kg_in), 0)::numeric(18,3)
      INTO v_quantity
      FROM public.custody_ledger
     WHERE milling_document_id = NEW.milling_document_id
       AND entry_type = 'INTAKE';
  END IF;

  UPDATE public.milling_service_documents
     SET estimated_cost_basis = CASE WHEN coalesce(v_rate, 0) > 0 THEN v_basis ELSE NULL END,
         estimated_cost_rate = CASE WHEN coalesce(v_rate, 0) > 0 THEN v_rate ELSE NULL END,
         estimated_cost_quantity = CASE WHEN coalesce(v_rate, 0) > 0 THEN v_quantity ELSE NULL END,
         estimated_cost_amount = CASE
           WHEN coalesce(v_rate, 0) > 0 AND coalesce(v_quantity, 0) > 0
           THEN round(v_rate * v_quantity, 2)
           ELSE NULL
         END,
         estimated_cost_captured_at = CASE WHEN coalesce(v_rate, 0) > 0 THEN now() ELSE NULL END
   WHERE id = NEW.milling_document_id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS custody_capture_milling_service_estimate ON public.custody_ledger;
CREATE TRIGGER custody_capture_milling_service_estimate
AFTER INSERT ON public.custody_ledger
FOR EACH ROW
WHEN (NEW.entry_type = 'INTAKE' AND NEW.milling_document_id IS NOT NULL)
EXECUTE FUNCTION public.capture_milling_service_estimate_from_intake();

CREATE OR REPLACE FUNCTION public.milling_service_cost_report(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT CURRENT_DATE,
  p_cost_center_id uuid DEFAULT NULL
)
RETURNS TABLE (
  cost_center_id uuid,
  cost_center_name text,
  expense_amount numeric,
  expense_document_count bigint,
  processed_bags numeric,
  processed_kg numeric,
  estimated_service_cost numeric,
  estimate_covered_bags numeric,
  estimate_covered_kg numeric,
  completed_invoice_revenue numeric,
  completed_document_count bigint,
  actual_cost_per_bag numeric,
  actual_cost_per_kg numeric,
  estimated_cost_per_bag numeric,
  estimated_cost_per_kg numeric,
  service_contribution_after_allocated_cost numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := public.expense_actor();
  v_cost_center_id uuid := p_cost_center_id;
BEGIN
  PERFORM public.expense_assert_capability(v_user, 'expense.report');
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'The report start date must not be after its end date';
  END IF;

  IF v_cost_center_id IS NULL THEN
    SELECT id INTO v_cost_center_id
      FROM public.expense_cost_centers
     WHERE upper(coalesce(code, '')) = 'MILLING-SERVICE'
        OR name_ar = 'خدمة الطحن'
     ORDER BY CASE WHEN upper(coalesce(code, '')) = 'MILLING-SERVICE' THEN 0 ELSE 1 END
     LIMIT 1;
  END IF;
  IF v_cost_center_id IS NULL THEN
    RAISE EXCEPTION 'Create or select a cost center for the milling service';
  END IF;

  RETURN QUERY
  WITH center AS (
    SELECT cc.id, coalesce(cc.name_ar, cc.name) AS label
      FROM public.expense_cost_centers cc
     WHERE cc.id = v_cost_center_id AND cc.is_active
  ), expense_totals AS (
    SELECT coalesce(sum(l.net_amount + CASE WHEN e.tax_recoverable THEN 0 ELSE l.tax_amount END), 0)::numeric AS amount,
           count(DISTINCT e.id)::bigint AS document_count
      FROM public.expense_lines l
      JOIN public.expense_entries e ON e.id = l.entry_id
     WHERE coalesce(l.cost_center_id, e.cost_center_id) = v_cost_center_id
       AND e.status = ANY (ARRAY['POSTED','PARTIALLY_PAID','PAID','CLOSED']::public.expense_status[])
       AND (p_date_from IS NULL OR e.expense_date >= p_date_from)
       AND (p_date_to IS NULL OR e.expense_date <= p_date_to)
  ), milling AS (
    SELECT coalesce(sum(cl.bags_out), 0)::numeric AS bags,
           coalesce(sum(cl.kg_out), 0)::numeric AS kg
      FROM public.custody_ledger cl
     WHERE cl.entry_type = 'MILLING'
       AND (cl.bags_out > 0 OR cl.kg_out > 0)
       AND (p_date_from IS NULL OR cl.created_at::date >= p_date_from)
       AND (p_date_to IS NULL OR cl.created_at::date <= p_date_to)
  ), estimates AS (
    -- Billing estimates belong to intake tickets. The multi-grain milling RPC
    -- records custody movements by its own processing number, so do not join
    -- estimates through milling_document_id (it is NULL on that path).
    SELECT coalesce(sum(d.estimated_cost_amount), 0)::numeric AS amount,
           coalesce(sum(CASE WHEN d.estimated_cost_basis = 'BAG'
                             THEN d.estimated_cost_amount ELSE 0 END), 0)::numeric AS bag_amount,
           coalesce(sum(CASE WHEN d.estimated_cost_basis = 'KG'
                             THEN d.estimated_cost_amount ELSE 0 END), 0)::numeric AS kg_amount,
           coalesce(sum(CASE WHEN d.estimated_cost_basis = 'BAG'
                             THEN d.estimated_cost_quantity ELSE 0 END), 0)::numeric AS bags,
           coalesce(sum(CASE WHEN d.estimated_cost_basis = 'KG'
                             THEN d.estimated_cost_quantity ELSE 0 END), 0)::numeric AS kg
      FROM public.milling_service_documents d
     WHERE d.estimated_cost_amount IS NOT NULL
       AND (p_date_from IS NULL OR d.received_at::date >= p_date_from)
       AND (p_date_to IS NULL OR d.received_at::date <= p_date_to)
  ), completed AS (
    SELECT coalesce(sum(si.total), 0)::numeric AS revenue,
           count(*)::bigint AS document_count
      FROM public.milling_service_documents d
      JOIN public.sales_invoices si ON si.id = d.sales_invoice_id
     WHERE d.status = 'DELIVERED'
       AND d.delivered_at IS NOT NULL
       AND (p_date_from IS NULL OR d.delivered_at::date >= p_date_from)
       AND (p_date_to IS NULL OR d.delivered_at::date <= p_date_to)
  )
  SELECT center.id,
         center.label,
         expense_totals.amount,
         expense_totals.document_count,
         milling.bags,
         milling.kg,
         estimates.amount,
         estimates.bags,
         estimates.kg,
         completed.revenue,
         completed.document_count,
         CASE WHEN milling.bags > 0 THEN round(expense_totals.amount / milling.bags, 4) END,
         CASE WHEN milling.kg > 0 THEN round(expense_totals.amount / milling.kg, 4) END,
         CASE WHEN estimates.bags > 0 THEN round(estimates.bag_amount / estimates.bags, 4) END,
         CASE WHEN estimates.kg > 0 THEN round(estimates.kg_amount / estimates.kg, 4) END,
         completed.revenue - expense_totals.amount
    FROM center CROSS JOIN expense_totals CROSS JOIN milling CROSS JOIN estimates CROSS JOIN completed;
END;
$function$;

-- The historic multi-intake RPC posts the correct net invoice amount, but it
-- stores every service line as quantity=1 and loses the billing unit. This
-- wrapper keeps that proven payment/treasury flow, then restores the gross,
-- discount, quantity, UOM and unit-rate snapshots without changing the posted
-- journal amount. The journal remains balanced because the line total is net.
CREATE OR REPLACE FUNCTION public.create_milling_service_document_multi_priced(
  p_customer_id uuid,
  p_warehouse_id uuid,
  p_grains jsonb,
  p_service_item_id uuid,
  p_service_gross numeric,
  p_discount numeric,
  p_payment_method text,
  p_paid numeric,
  p_notes text,
  p_payment_splits jsonb,
  p_billing_basis text,
  p_fee_quantity numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
  v_document_id uuid;
  v_invoice_id uuid;
  v_service record;
  v_basis text := upper(coalesce(p_billing_basis, ''));
  v_unit_basis text;
  v_quantity numeric(18,3) := round(coalesce(p_fee_quantity, 0), 3);
  v_expected_quantity numeric(18,3);
  v_gross numeric(18,2) := round(coalesce(p_service_gross, 0), 2);
  v_discount numeric(18,2) := round(coalesce(p_discount, 0), 2);
  v_net numeric(18,2);
  v_rate numeric(18,6);
  v_unit_increment numeric(30,12);
  v_description text;
BEGIN
  IF v_basis NOT IN ('PER_BAG', 'PER_KG') THEN
    RAISE EXCEPTION 'Billing basis must be PER_BAG or PER_KG';
  END IF;
  IF v_quantity <= 0 THEN
    RAISE EXCEPTION 'The billed bag or kilogram quantity must be positive';
  END IF;
  IF v_gross <= 0 OR v_discount < 0 OR v_discount >= v_gross THEN
    RAISE EXCEPTION 'The net milling service fee must remain positive after discount';
  END IF;
  IF p_grains IS NULL OR jsonb_typeof(p_grains) <> 'array' THEN
    RAISE EXCEPTION 'At least one grain line is required';
  END IF;

  IF v_basis = 'PER_BAG' THEN
    SELECT round(coalesce(sum(g.bags), 0), 3)
      INTO v_expected_quantity
      FROM jsonb_to_recordset(p_grains) AS g(item_id uuid, bags numeric, kg numeric);
    v_unit_increment := 0.001;
  ELSE
    SELECT round(coalesce(sum(g.kg), 0), 3)
      INTO v_expected_quantity
      FROM jsonb_to_recordset(p_grains) AS g(item_id uuid, bags numeric, kg numeric);
    v_unit_increment := 0.001;
  END IF;
  IF v_expected_quantity <= 0 OR v_quantity <> v_expected_quantity THEN
    RAISE EXCEPTION 'Billed quantity (%) does not match received quantity (%) for %',
      v_quantity, v_expected_quantity, v_basis;
  END IF;

  SELECT p.id, p.cost_price, coalesce(p.base_uom_id, p.unit_id) AS uom_id,
         p.name_ar, p.name, u.short_name, u.name AS uom_name, u.name_ar AS uom_name_ar
    INTO v_service
    FROM public.products p
    LEFT JOIN public.units u ON u.id = coalesce(p.base_uom_id, p.unit_id)
   WHERE p.id = p_service_item_id
     AND p.item_class = 'SERVICE'
     AND p.is_active
     AND p.is_sellable;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Milling service must be an active sellable service item';
  END IF;

  v_unit_basis := CASE
    WHEN lower(coalesce(v_service.short_name, '') || ' ' || coalesce(v_service.uom_name_ar, '') || ' ' || coalesce(v_service.uom_name, ''))
      ~ '(bag|sack|كيس|جوال)' THEN 'PER_BAG'
    WHEN lower(coalesce(v_service.short_name, '') || ' ' || coalesce(v_service.uom_name_ar, '') || ' ' || coalesce(v_service.uom_name, ''))
      ~ '(kg|كجم|كغ|كيلو|kilogram)' THEN 'PER_KG'
    ELSE NULL
  END;
  IF v_unit_basis IS NOT NULL AND v_unit_basis <> v_basis THEN
    RAISE EXCEPTION 'Billing basis % does not match service item base unit %',
      v_basis, coalesce(v_service.uom_name_ar, v_service.uom_name, v_service.short_name, 'unknown');
  END IF;

  v_net := round(v_gross - v_discount, 2);
  v_rate := round(v_gross / v_quantity, 6);
  v_description := format(
    'أجور الطحن — %s %s × %s',
    trim(to_char(v_quantity, 'FM999999990.###')),
    CASE WHEN v_basis = 'PER_BAG' THEN 'كيس' ELSE 'كجم' END,
    trim(to_char(v_rate, 'FM999999990.######'))
  );

  -- The old RPC handles authentication, credit limits, payment splits, cash
  -- settlement and custody intake atomically. Passing net/zero discount makes
  -- its pre-posted journal match cash + receivable exactly.
  v_result := public.create_milling_service_document_multi(
    p_customer_id, p_warehouse_id, p_grains, p_service_item_id,
    v_net, 0, p_payment_method, p_paid, p_notes, coalesce(p_payment_splits, '[]'::jsonb)
  );
  v_document_id := nullif(v_result ->> 'document_id', '')::uuid;
  v_invoice_id := nullif(v_result ->> 'invoice_id', '')::uuid;
  IF v_document_id IS NULL OR v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'The milling intake did not return its invoice and document references';
  END IF;

  UPDATE public.sales_invoices
     SET subtotal = v_gross,
         discount = v_discount,
         total = v_net
   WHERE id = v_invoice_id;

  UPDATE public.sales_invoice_items
     SET description = v_description,
         quantity = v_quantity,
         unit_price = round(v_gross / v_quantity, 2),
         discount = v_discount,
         tax = 0,
         total = v_net,
         line_type = 'SERVICE',
         stock_effect = 'NONE',
         uom_id = v_service.uom_id,
         entered_quantity = v_quantity,
         entered_unit_price = v_rate,
         base_quantity = v_quantity,
         base_unit_price = v_rate,
         uom_conversion_factor = 1,
         uom_quantity_increment = v_unit_increment
   WHERE invoice_id = v_invoice_id
     AND product_id = p_service_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The posted milling invoice is missing its service line';
  END IF;

  UPDATE public.milling_service_documents
     SET billing_basis = v_basis,
         fee_per_unit = v_rate,
         fee_quantity = v_quantity,
         estimated_cost_basis = CASE
           WHEN coalesce(v_service.cost_price, 0) > 0 THEN
             CASE WHEN v_basis = 'PER_BAG' THEN 'BAG' ELSE 'KG' END
           ELSE NULL END,
         estimated_cost_rate = CASE
           WHEN coalesce(v_service.cost_price, 0) > 0 THEN v_service.cost_price ELSE NULL END,
         estimated_cost_quantity = CASE
           WHEN coalesce(v_service.cost_price, 0) > 0 THEN v_quantity ELSE NULL END,
         estimated_cost_amount = CASE
           WHEN coalesce(v_service.cost_price, 0) > 0
             THEN round(v_service.cost_price * v_quantity, 2) ELSE NULL END,
         estimated_cost_captured_at = CASE
           WHEN coalesce(v_service.cost_price, 0) > 0 THEN now() ELSE NULL END
   WHERE id = v_document_id;

  RETURN v_result || jsonb_build_object(
    'billing_basis', v_basis,
    'fee_per_unit', v_rate,
    'fee_quantity', v_quantity
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.capture_milling_service_estimate_from_intake() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_milling_service_estimate_from_intake() TO service_role;
REVOKE ALL ON FUNCTION public.milling_service_cost_report(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.milling_service_cost_report(date, date, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_milling_service_document_multi_priced(uuid, uuid, jsonb, uuid, numeric, numeric, text, numeric, text, jsonb, text, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_milling_service_document_multi_priced(uuid, uuid, jsonb, uuid, numeric, numeric, text, numeric, text, jsonb, text, numeric)
  TO authenticated, service_role;

DO $allowlist$
DECLARE
  v_current text[];
  v_name text;
  v_additions text[] := ARRAY[
    'milling_service_cost_report',
    'create_milling_service_document_multi_priced'
  ]::text[];
BEGIN
  EXECUTE 'SELECT public.rpc_allowlist()' INTO v_current;
  v_current := coalesce(v_current, ARRAY[]::text[]);
  FOREACH v_name IN ARRAY v_additions LOOP
    IF NOT (v_name = ANY(v_current)) THEN
      v_current := array_append(v_current, v_name);
    END IF;
  END LOOP;
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.rpc_allowlist() RETURNS text[]
    LANGUAGE sql IMMUTABLE SET search_path = public
    AS $body$ SELECT %L::text[] $body$
  $fn$, v_current);
END;
$allowlist$;
REVOKE ALL ON FUNCTION public.rpc_allowlist() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
