-- ============================================================================
-- الترحيل 008_purchasing_and_returns.sql — مجال: purchasing_and_returns
-- جزء من خط الأساس الجديد: تعريف نهائي واحد لكل كائن، مبني من مخطط مرجعي
-- مستخرج من الترحيلات التاريخية الكاملة (راجع supabase/migrations/README.md).
-- ============================================================================

--
-- Name: consume_purchase_return_item_batches(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.consume_purchase_return_item_batches() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_invoice_id uuid;
  v_warehouse_id uuid;
  v_tracking public.item_tracking;
  v_remaining numeric := NEW.quantity;
  v_take numeric;
  v_source record;
BEGIN
  SELECT pr.invoice_id, pr.warehouse_id INTO v_invoice_id, v_warehouse_id
    FROM public.purchase_returns pr WHERE pr.id = NEW.return_id FOR UPDATE;
  IF v_invoice_id IS NULL THEN
    SELECT tracking INTO v_tracking FROM public.products WHERE id = NEW.product_id;
    IF v_tracking = 'BATCH'::public.item_tracking THEN
      RAISE EXCEPTION 'Batch-tracked purchase returns must reference the original purchase invoice'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.purchase_invoices WHERE id = v_invoice_id FOR UPDATE;
  SELECT tracking INTO v_tracking FROM public.products WHERE id = NEW.product_id;
  IF v_tracking <> 'BATCH'::public.item_tracking THEN RETURN NEW; END IF;

  FOR v_source IN
    SELECT pii.id AS invoice_item_id, pb.id AS batch_id, pb.quantity AS batch_quantity,
           pii.quantity - coalesce((
             SELECT sum(ra.quantity) FROM public.purchase_return_item_batch_allocations ra
              WHERE ra.purchase_invoice_item_id = pii.id
           ), 0) AS returnable
      FROM public.purchase_invoice_items pii
      JOIN public.product_batches pb
        ON pb.product_id = pii.product_id AND pb.warehouse_id = v_warehouse_id
       AND pb.batch_number = pii.batch_number
     WHERE pii.invoice_id = v_invoice_id AND pii.product_id = NEW.product_id
       AND (NEW.invoice_item_id IS NULL OR pii.id = NEW.invoice_item_id)
       AND pii.stock_effect = 'STOCK_RECEIPT'
       AND pii.quantity > coalesce((
         SELECT sum(ra.quantity) FROM public.purchase_return_item_batch_allocations ra
          WHERE ra.purchase_invoice_item_id = pii.id
       ), 0)
     ORDER BY pii.id, pb.id
     FOR UPDATE OF pb
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF v_source.batch_quantity <= 0 THEN CONTINUE; END IF;
    v_take := least(v_source.returnable, v_remaining, v_source.batch_quantity);
    UPDATE public.product_batches SET quantity = round(quantity - v_take, 3), updated_at = now()
     WHERE id = v_source.batch_id;
    INSERT INTO public.purchase_return_item_batch_allocations(
      purchase_return_item_id, purchase_invoice_item_id, batch_id, quantity
    ) VALUES (NEW.id, v_source.invoice_item_id, v_source.batch_id, v_take);
    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Original purchase invoice line does not have enough remaining lot quantity for % base units', v_remaining
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: guard_purchase_return_item_origin(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.guard_purchase_return_item_origin() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_invoice_id uuid;
  v_return_supplier uuid;
  v_return_warehouse uuid;
  v_invoice_supplier uuid;
  v_invoice_warehouse uuid;
  v_purchased numeric;
  v_returned numeric;
BEGIN
  IF NEW.product_id IS NULL OR NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'Purchase return line requires a product and positive quantity'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT pr.invoice_id, pr.supplier_id, pr.warehouse_id
    INTO v_invoice_id, v_return_supplier, v_return_warehouse
    FROM public.purchase_returns pr WHERE pr.id = NEW.return_id FOR UPDATE;
  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Purchase returns must reference the original purchase invoice'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT pi.supplier_id, pi.warehouse_id
    INTO v_invoice_supplier, v_invoice_warehouse
    FROM public.purchase_invoices pi WHERE pi.id = v_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original purchase invoice does not exist' USING ERRCODE = 'check_violation';
  END IF;
  IF v_return_supplier IS DISTINCT FROM v_invoice_supplier
     OR v_return_warehouse IS DISTINCT FROM v_invoice_warehouse THEN
    RAISE EXCEPTION 'Purchase return supplier and warehouse must match the original invoice'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(pii.quantity), 0)
    INTO v_purchased
    FROM public.purchase_invoice_items pii
   WHERE pii.invoice_id = v_invoice_id AND pii.product_id = NEW.product_id;
  IF v_purchased <= 0 THEN
    RAISE EXCEPTION 'Item % is not on the original purchase invoice', NEW.product_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(pri.quantity), 0)
    INTO v_returned
    FROM public.purchase_return_items pri
    JOIN public.purchase_returns pr ON pr.id = pri.return_id
   WHERE pr.invoice_id = v_invoice_id AND pri.product_id = NEW.product_id;
  IF v_returned + NEW.quantity > v_purchased THEN
    RAISE EXCEPTION 'Purchase return exceeds received quantity: received %, already returned %, requested %',
      v_purchased, v_returned, NEW.quantity USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: require_purchase_batch_for_batch_items(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.require_purchase_batch_for_batch_items() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.product_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.products p
       WHERE p.id = NEW.product_id
         AND p.tracking = 'BATCH'::public.item_tracking
     )
     AND nullif(btrim(coalesce(NEW.batch_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Batch-tracked purchase items require a batch number'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

--
-- Name: resolve_purchase_line(jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.resolve_purchase_line(p_line jsonb, OUT o_product_id uuid, OUT o_quantity numeric, OUT o_line_type text, OUT o_stock_effect text) RETURNS record
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_is_service_flag boolean := coalesce((p_line ->> 'is_service')::boolean, false);
  v_nature public.item_nature;
BEGIN
  o_product_id := nullif(btrim(coalesce(p_line ->> 'product_id', '')), '')::uuid;
  o_quantity   := (p_line ->> 'quantity')::numeric;

  IF o_product_id IS NULL THEN
    o_line_type    := 'AD_HOC_SERVICE';
    o_stock_effect := 'NONE';
    RETURN;
  END IF;

  SELECT p.item_nature INTO v_nature FROM public.products p WHERE p.id = o_product_id;

  IF v_nature IS NULL THEN
    IF v_is_service_flag THEN
      o_product_id   := NULL;
      o_line_type    := 'AD_HOC_SERVICE';
      o_stock_effect := 'NONE';
      RETURN;
    END IF;
    RAISE EXCEPTION 'Item % does not exist', o_product_id;
  END IF;

  o_line_type    := public.item_line_type(o_product_id, false);
  o_stock_effect := public.item_stock_effect(o_product_id, 'in');
END $$;

--
-- Name: save_product_uom_settings(uuid, jsonb, jsonb, integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.save_product_uom_settings(_product_id uuid, _units jsonb, _barcodes jsonb DEFAULT '[]'::jsonb, _company_id integer DEFAULT 1) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row jsonb;
  v_barcode jsonb;
  v_unit_id uuid;
  v_product_uom_id uuid;
  v_existing_base uuid;
  v_new_base uuid;
  v_sales_unit uuid;
  v_purchase_unit uuid;
  v_count integer;
  v_distinct_units integer;
  v_base_count integer;
  v_sales_defaults integer;
  v_purchase_defaults integer;
  v_product_sellable boolean;
  v_product_purchasable boolean;
  v_factor numeric;
  v_basis text;
  v_conversion_note text;
  v_base_dimension text;
  v_base_reference_factor numeric;
  v_unit_dimension text;
  v_unit_reference_factor numeric;
  v_expected_factor numeric;
  v_increment numeric;
  v_can_sell boolean;
  v_can_purchase boolean;
  v_default_sale boolean;
  v_default_purchase boolean;
  v_is_base boolean;
  v_sale_price numeric;
  v_purchase_price numeric;
  v_code text;
  v_primary boolean;
BEGIN
  IF v_user IS NULL OR NOT (
    public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')
  ) THEN
    RAISE EXCEPTION 'Only an owner or manager can change item units and prices'
      USING ERRCODE = '42501';
  END IF;
  IF _company_id IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'This database currently has one active company context'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.company_settings cs WHERE cs.id = _company_id) THEN
    RAISE EXCEPTION 'Company settings must be initialized before saving item prices'
      USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(jsonb_typeof(_units), '') <> 'array'
     OR coalesce(jsonb_typeof(_barcodes), '') <> 'array' THEN
    RAISE EXCEPTION 'Units and barcodes must be JSON arrays' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(p.base_uom_id, p.unit_id), p.is_sellable, p.is_purchasable
    INTO v_existing_base, v_product_sellable, v_product_purchasable
    FROM public.products p WHERE p.id = _product_id AND p.is_active
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item % is not available', _product_id; END IF;

  SELECT count(*)::integer,
         count(DISTINCT x.value ->> 'unit_id')::integer,
         count(*) FILTER (WHERE coalesce((x.value ->> 'is_base')::boolean, false))::integer,
         count(*) FILTER (WHERE coalesce((x.value ->> 'default_sale')::boolean, false))::integer,
         count(*) FILTER (WHERE coalesce((x.value ->> 'default_purchase')::boolean, false))::integer
    INTO v_count, v_distinct_units, v_base_count, v_sales_defaults, v_purchase_defaults
    FROM jsonb_array_elements(_units) AS x(value);
  IF v_count = 0 OR v_distinct_units <> v_count OR v_base_count <> 1
     OR v_sales_defaults > 1 OR v_purchase_defaults > 1 THEN
    RAISE EXCEPTION 'Configure one base unit and at most one default per transaction direction'
      USING ERRCODE = '22023';
  END IF;
  IF v_product_sellable AND v_sales_defaults <> 1 THEN
    RAISE EXCEPTION 'A sellable item requires one default sales unit' USING ERRCODE = '22023';
  END IF;
  IF NOT v_product_sellable AND v_sales_defaults <> 0 THEN
    RAISE EXCEPTION 'A non-sellable item cannot have a default sales unit' USING ERRCODE = '22023';
  END IF;
  IF v_product_purchasable AND v_purchase_defaults <> 1 THEN
    RAISE EXCEPTION 'A purchasable item requires one default purchase unit' USING ERRCODE = '22023';
  END IF;
  IF NOT v_product_purchasable AND v_purchase_defaults <> 0 THEN
    RAISE EXCEPTION 'A non-purchasable item cannot have a default purchase unit' USING ERRCODE = '22023';
  END IF;

  SELECT nullif(value ->> 'unit_id', '')::uuid
    INTO v_new_base
    FROM jsonb_array_elements(_units) AS j(value)
   WHERE coalesce((value ->> 'is_base')::boolean, false)
   LIMIT 1;
  SELECT u.dimension_code, u.factor_to_reference
    INTO v_base_dimension, v_base_reference_factor
    FROM public.units u WHERE u.id = v_new_base;
  IF NOT FOUND THEN RAISE EXCEPTION 'Base unit does not exist' USING ERRCODE = '22023'; END IF;

  -- Removing default flags first avoids transient collisions with partial unique indexes.
  UPDATE public.product_uoms
     SET is_base = false, is_default_sale = false, is_default_purchase = false,
         is_active = false, can_sell = false, can_purchase = false,
         updated_at = now()
   WHERE product_id = _product_id;

  FOR v_row IN SELECT value FROM jsonb_array_elements(_units) AS j(value)
  LOOP
    v_unit_id := nullif(v_row ->> 'unit_id', '')::uuid;
    v_factor := (v_row ->> 'factor_to_base')::numeric;
    v_basis := coalesce(nullif(v_row ->> 'conversion_basis', ''), 'STANDARD');
    v_conversion_note := nullif(btrim(coalesce(v_row ->> 'conversion_note', '')), '');
    v_increment := nullif(v_row ->> 'quantity_increment', '')::numeric;
    v_can_sell := coalesce((v_row ->> 'can_sell')::boolean, false);
    v_can_purchase := coalesce((v_row ->> 'can_purchase')::boolean, false);
    v_default_sale := coalesce((v_row ->> 'default_sale')::boolean, false);
    v_default_purchase := coalesce((v_row ->> 'default_purchase')::boolean, false);
    v_is_base := coalesce((v_row ->> 'is_base')::boolean, false);
    v_sale_price := nullif(v_row ->> 'sale_price', '')::numeric;
    v_purchase_price := nullif(v_row ->> 'purchase_price', '')::numeric;

    SELECT u.dimension_code INTO v_unit_dimension
      FROM public.units u WHERE u.id = v_unit_id;
    IF v_increment IS NULL THEN
      v_increment := CASE WHEN v_unit_dimension IN ('COUNT', 'PACKAGING') THEN 1 ELSE 0.001 END;
    END IF;
    IF v_unit_id IS NULL OR v_factor IS NULL OR v_factor <= 0
       OR v_increment IS NULL OR v_increment <= 0
       OR v_factor <> round(v_factor, 12)
       OR v_increment <> round(v_increment, 6)
       OR (v_sale_price IS NOT NULL AND v_sale_price <> round(v_sale_price, 4))
       OR (v_purchase_price IS NOT NULL AND v_purchase_price <> round(v_purchase_price, 4)) THEN
      RAISE EXCEPTION 'Every item unit needs a unit, positive factor, and positive quantity step'
        USING ERRCODE = '22023';
    END IF;
    IF v_factor * v_increment <> round(v_factor * v_increment, 3) THEN
      RAISE EXCEPTION
        'This unit step does not convert exactly to the current 0.001 base-stock precision; increase the step or choose a finer base unit'
        USING ERRCODE = '22023';
    END IF;
    IF v_is_base AND (v_factor <> 1 OR v_basis <> 'STANDARD' OR v_conversion_note IS NOT NULL) THEN
      RAISE EXCEPTION 'The base unit conversion factor must equal 1' USING ERRCODE = '22023';
    END IF;
    IF v_is_base THEN
      -- Base prices already live on products/company_items; do not shadow a
      -- company-specific base price with a second, less-specific price row.
      v_sale_price := NULL;
      v_purchase_price := NULL;
    END IF;
    IF v_default_sale AND NOT v_can_sell OR v_default_purchase AND NOT v_can_purchase THEN
      RAISE EXCEPTION 'Default unit must be enabled for its transaction direction'
        USING ERRCODE = '22023';
    END IF;
    IF (v_default_sale OR v_can_sell) AND NOT v_product_sellable THEN
      RAISE EXCEPTION 'The item is not enabled for sales' USING ERRCODE = '22023';
    END IF;
    IF (v_default_purchase OR v_can_purchase) AND NOT v_product_purchasable THEN
      RAISE EXCEPTION 'The item is not enabled for purchasing' USING ERRCODE = '22023';
    END IF;
    SELECT u.dimension_code, u.factor_to_reference
      INTO v_unit_dimension, v_unit_reference_factor
      FROM public.units u WHERE u.id = v_unit_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unit % does not exist', v_unit_id USING ERRCODE = '22023'; END IF;

    IF NOT v_is_base THEN
      IF v_unit_dimension = v_base_dimension
         AND v_unit_reference_factor IS NOT NULL
         AND v_base_reference_factor IS NOT NULL THEN
        v_expected_factor := round(v_unit_reference_factor / v_base_reference_factor, 12);
        IF v_factor <> v_expected_factor OR v_basis <> 'STANDARD' OR v_conversion_note IS NOT NULL THEN
          RAISE EXCEPTION 'Standard unit conversion is %, not %', v_expected_factor, v_factor
            USING ERRCODE = '22023';
        END IF;
      ELSIF v_unit_dimension = 'PACKAGING' OR v_base_dimension = 'PACKAGING' THEN
        IF v_basis <> 'FIXED_PACKAGE' OR v_conversion_note IS NULL THEN
          RAISE EXCEPTION 'Packaging conversions require a fixed content factor and a note describing the package contents'
            USING ERRCODE = '22023';
        END IF;
      ELSIF v_unit_dimension = 'CUSTOM' OR v_base_dimension = 'CUSTOM' THEN
        IF v_basis <> 'ITEM_SPECIFIC' OR v_conversion_note IS NULL THEN
          RAISE EXCEPTION 'Custom unit conversions require an item-specific explanation'
            USING ERRCODE = '22023';
        END IF;
      ELSE
        RAISE EXCEPTION 'Cannot convert between % and % without a dedicated measurement model',
          v_unit_dimension, v_base_dimension USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_is_base THEN
      v_new_base := v_unit_id;
      IF v_existing_base IS DISTINCT FROM v_new_base
         AND public.item_has_stock_history(_product_id) THEN
        RAISE EXCEPTION 'Base unit cannot change after item stock history exists; use an approved stock conversion document'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.product_uoms old
        LEFT JOIN public.sales_invoice_items si
          ON si.product_id = old.product_id AND si.uom_id = old.unit_id
        LEFT JOIN public.purchase_invoice_items pi
          ON pi.product_id = old.product_id AND pi.uom_id = old.unit_id
       WHERE old.product_id = _product_id AND old.unit_id = v_unit_id
         AND old.factor_to_base <> v_factor
         AND ((si.id IS NOT NULL AND si.uom_conversion_factor IS NULL)
           OR (pi.id IS NOT NULL AND pi.uom_conversion_factor IS NULL))
    ) THEN
      RAISE EXCEPTION 'Cannot change the conversion of a unit used by an invoice without a saved conversion snapshot'
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.product_uoms (
      product_id, unit_id, factor_to_base, conversion_basis, conversion_note, quantity_increment,
      can_purchase, can_sell, is_default_purchase, is_default_sale,
      is_base, is_active, updated_at
    ) VALUES (
      _product_id, v_unit_id, v_factor, v_basis, v_conversion_note, v_increment,
      v_can_purchase, v_can_sell, v_default_purchase, v_default_sale,
      v_is_base, true, now()
    )
    ON CONFLICT (product_id, unit_id) DO UPDATE SET
      factor_to_base = EXCLUDED.factor_to_base,
      conversion_basis = EXCLUDED.conversion_basis,
      conversion_note = EXCLUDED.conversion_note,
      quantity_increment = EXCLUDED.quantity_increment,
      can_purchase = EXCLUDED.can_purchase,
      can_sell = EXCLUDED.can_sell,
      is_default_purchase = EXCLUDED.is_default_purchase,
      is_default_sale = EXCLUDED.is_default_sale,
      is_base = EXCLUDED.is_base,
      is_active = true,
      updated_at = now()
    RETURNING id INTO v_product_uom_id;

    INSERT INTO public.product_uom_prices (
      company_id, product_id, product_uom_id, sale_price, purchase_price,
      updated_by, updated_at
    ) VALUES (
      _company_id, _product_id, v_product_uom_id, v_sale_price, v_purchase_price,
      v_user, now()
    )
    ON CONFLICT (company_id, product_uom_id) DO UPDATE SET
      sale_price = EXCLUDED.sale_price,
      purchase_price = EXCLUDED.purchase_price,
      updated_by = EXCLUDED.updated_by,
      updated_at = now();

    IF v_default_sale THEN v_sales_unit := v_unit_id; END IF;
    IF v_default_purchase THEN v_purchase_unit := v_unit_id; END IF;
  END LOOP;

  -- Barcodes are unit-specific. Omitted codes are disabled, never deleted.
  UPDATE public.product_uom_barcodes
     SET is_active = false
   WHERE product_id = _product_id AND company_id = _company_id;
  FOR v_barcode IN SELECT value FROM jsonb_array_elements(_barcodes) AS j(value)
  LOOP
    v_unit_id := nullif(v_barcode ->> 'unit_id', '')::uuid;
    v_code := btrim(coalesce(v_barcode ->> 'barcode', ''));
    v_primary := coalesce((v_barcode ->> 'is_primary')::boolean, false);
    IF v_unit_id IS NULL OR v_code = '' THEN
      RAISE EXCEPTION 'Every barcode needs a unit and non-empty code' USING ERRCODE = '22023';
    END IF;
    SELECT pu.id INTO v_product_uom_id
      FROM public.product_uoms pu
     WHERE pu.product_id = _product_id AND pu.unit_id = v_unit_id AND pu.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Barcode unit % is not configured for item %', v_unit_id, _product_id
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.products p
       WHERE p.barcode = v_code AND p.id <> _product_id
    ) THEN
      RAISE EXCEPTION 'Barcode % is already assigned to another item', v_code
        USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.product_uom_barcodes (
      company_id, product_id, product_uom_id, barcode, is_primary, is_active
    ) VALUES (_company_id, _product_id, v_product_uom_id, v_code, v_primary, true)
    ON CONFLICT (company_id, barcode) DO UPDATE SET
      product_id = EXCLUDED.product_id,
      product_uom_id = EXCLUDED.product_uom_id,
      is_primary = EXCLUDED.is_primary,
      is_active = true;
  END LOOP;

  UPDATE public.products p
     SET base_uom_id = v_new_base,
         unit_id = v_new_base,
         sales_uom_id = v_sales_unit,
         purchase_uom_id = v_purchase_unit
   WHERE p.id = _product_id;
END;
$$;

--
-- Name: sync_purchase_invoice_item_batch(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.sync_purchase_invoice_item_batch() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_warehouse_id uuid;
  v_tracking public.item_tracking;
BEGIN
  IF NEW.product_id IS NULL OR NEW.stock_effect IS DISTINCT FROM 'STOCK_RECEIPT' THEN
    RETURN NEW;
  END IF;

  SELECT p.tracking INTO v_tracking
  FROM public.products p
  WHERE p.id = NEW.product_id;

  IF v_tracking <> 'BATCH'::public.item_tracking THEN
    RETURN NEW;
  END IF;

  IF nullif(btrim(coalesce(NEW.batch_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Batch-tracked purchase items require a batch number'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT pi.warehouse_id INTO v_warehouse_id
  FROM public.purchase_invoices pi
  WHERE pi.id = NEW.invoice_id;

  INSERT INTO public.product_batches (
    product_id, warehouse_id, batch_number, expiry_date, quantity, unit_cost, created_by
  )
  VALUES (
    NEW.product_id, v_warehouse_id, btrim(NEW.batch_number), NEW.expiry_date,
    NEW.quantity, NEW.unit_cost, auth.uid()
  )
  ON CONFLICT (product_id, warehouse_id, batch_number) DO UPDATE
  SET quantity = round(public.product_batches.quantity + EXCLUDED.quantity, 3),
      unit_cost = CASE
        WHEN public.product_batches.quantity + EXCLUDED.quantity > 0 THEN
          round((public.product_batches.quantity * public.product_batches.unit_cost +
                 EXCLUDED.quantity * EXCLUDED.unit_cost) /
                (public.product_batches.quantity + EXCLUDED.quantity), 4)
        ELSE public.product_batches.unit_cost
      END,
      expiry_date = coalesce(EXCLUDED.expiry_date, public.product_batches.expiry_date),
      updated_at = now();

  RETURN NEW;
END;
$$;

--
-- Name: trg_purchase_invoice_to_supplier_ledger(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.trg_purchase_invoice_to_supplier_ledger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.supplier_id IS NOT NULL THEN
    -- إثبات حركة استحقاق الفاتورة (Credit للمورد)
    INSERT INTO public.supplier_ledger (
      supplier_id, entry_type, debit, credit, balance_after,
      reference_type, reference_id, occurred_at, source_key, note, created_by
    ) VALUES (
      NEW.supplier_id,
      'PURCHASE_INVOICE',
      0,
      round(NEW.total, 2),
      (SELECT balance FROM public.suppliers WHERE id = NEW.supplier_id),
      'purchase_invoice',
      NEW.id,
      coalesce(NEW.created_at, now()),
      'PINV-' || NEW.id::text,
      'فاتورة مشتريات رقم ' || NEW.invoice_number || coalesce(' - ' || NEW.note, ''),
      NEW.created_by
    ) ON CONFLICT (source_key) DO NOTHING;

    -- إثبات السداد الفوري المرافق للفاتورة إن وُجد (Debit للمورد)
    IF coalesce(NEW.paid, 0) > 0 THEN
      INSERT INTO public.supplier_ledger (
        supplier_id, entry_type, debit, credit, balance_after,
        reference_type, reference_id, occurred_at, source_key, note, created_by
      ) VALUES (
        NEW.supplier_id,
        'PAYMENT',
        round(NEW.paid, 2),
        0,
        (SELECT balance FROM public.suppliers WHERE id = NEW.supplier_id),
        'purchase_invoice_payment',
        NEW.id,
        coalesce(NEW.created_at, now()),
        'PINV-PAID-' || NEW.id::text,
        'سداد فوري مرافق لفاتورة مشتريات ' || NEW.invoice_number,
        NEW.created_by
      ) ON CONFLICT (source_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: trg_purchase_return_to_supplier_ledger(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.trg_purchase_return_to_supplier_ledger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.supplier_id IS NOT NULL THEN
    -- إثبات مرتجع الشراء (Debit للمورد - تخفيض دينه)
    INSERT INTO public.supplier_ledger (
      supplier_id, entry_type, debit, credit, balance_after,
      reference_type, reference_id, occurred_at, source_key, note, created_by
    ) VALUES (
      NEW.supplier_id,
      'PURCHASE_RETURN',
      round(NEW.total, 2),
      0,
      (SELECT balance FROM public.suppliers WHERE id = NEW.supplier_id),
      'purchase_return',
      NEW.id,
      coalesce(NEW.created_at, now()),
      'PRET-' || NEW.id::text,
      'مرتجع مشتريات رقم ' || NEW.return_number || coalesce(' - ' || NEW.note, ''),
      NEW.created_by
    ) ON CONFLICT (source_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: warehouse_reference_counts(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.warehouse_reference_counts(p_warehouse_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_inventory  bigint := 0;
  v_movements  bigint := 0;
  v_sales      bigint := 0;
  v_purchases  bigint := 0;
  v_transfers  bigint := 0;
  v_blocking   bigint := 0;
BEGIN
  SELECT count(*) INTO v_inventory FROM public.inventory WHERE warehouse_id = p_warehouse_id;
  SELECT count(*) INTO v_movements FROM public.stock_movements WHERE warehouse_id = p_warehouse_id;

  BEGIN
    SELECT count(*) INTO v_sales FROM public.sales_invoices WHERE warehouse_id = p_warehouse_id;
  EXCEPTION WHEN undefined_column THEN v_sales := 0;
  END;

  BEGIN
    SELECT count(*) INTO v_purchases FROM public.purchase_invoices WHERE warehouse_id = p_warehouse_id;
  EXCEPTION WHEN undefined_column THEN v_purchases := 0;
  END;

  BEGIN
    SELECT count(*) INTO v_transfers FROM public.stock_transfers
      WHERE from_warehouse_id = p_warehouse_id OR to_warehouse_id = p_warehouse_id;
  EXCEPTION WHEN undefined_table THEN v_transfers := 0;
       WHEN undefined_column THEN v_transfers := 0;
  END;

  v_blocking := v_inventory + v_movements + v_sales + v_purchases + v_transfers;

  RETURN jsonb_build_object(
    'warehouse_id',   p_warehouse_id,
    'inventory_rows', v_inventory,
    'stock_movements',v_movements,
    'sales_invoices', v_sales,
    'purchase_invoices', v_purchases,
    'transfers',      v_transfers,
    'blocking_total', v_blocking,
    'can_delete',     v_blocking = 0
  );
END;
$$;

--
-- Name: goods_receipt_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.goods_receipt_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: purchase_invoice_items; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.purchase_invoice_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric(14,3) NOT NULL,
    unit_cost numeric(14,2) NOT NULL,
    discount numeric(14,2) DEFAULT 0 NOT NULL,
    tax numeric(14,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) NOT NULL,
    line_type text,
    stock_effect text,
    batch_number text,
    expiry_date date,
    uom_id uuid,
    entered_quantity numeric(18,6),
    base_quantity numeric(18,6),
    uom_conversion_factor numeric(30,12),
    entered_unit_cost numeric(18,4),
    base_unit_cost numeric(18,6),
    uom_quantity_increment numeric(30,12),
    CONSTRAINT purchase_invoice_items_base_unit_cost_nonnegative CHECK (((base_unit_cost IS NULL) OR (base_unit_cost >= (0)::numeric))),
    CONSTRAINT purchase_invoice_items_line_type_valid CHECK (((line_type IS NULL) OR (line_type = ANY (ARRAY['STOCKED_GOOD'::text, 'UNTRACKED_GOOD'::text, 'SERVICE'::text, 'CUSTOMER_OWNED_GOOD'::text, 'AD_HOC_SERVICE'::text])))),
    CONSTRAINT purchase_invoice_items_uom_increment_positive CHECK (((uom_quantity_increment IS NULL) OR (uom_quantity_increment > (0)::numeric))),
    CONSTRAINT purchase_invoice_items_uom_snapshot_check CHECK (((num_nonnulls(entered_quantity, base_quantity, uom_conversion_factor, entered_unit_cost, uom_quantity_increment) = ANY (ARRAY[0, 5])) AND ((entered_quantity IS NULL) OR ((entered_quantity > (0)::numeric) AND (base_quantity > (0)::numeric) AND (uom_conversion_factor > (0)::numeric) AND (entered_unit_cost >= (0)::numeric) AND (uom_quantity_increment > (0)::numeric)))))
);

--
-- Name: purchase_invoice_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.purchase_invoice_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: purchase_invoices; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.purchase_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_number text NOT NULL,
    supplier_id uuid,
    warehouse_id uuid,
    status public.invoice_status DEFAULT 'draft'::public.invoice_status NOT NULL,
    payment_status public.payment_status DEFAULT 'unpaid'::public.payment_status NOT NULL,
    subtotal numeric(14,2) DEFAULT 0 NOT NULL,
    discount numeric(14,2) DEFAULT 0 NOT NULL,
    tax numeric(14,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) DEFAULT 0 NOT NULL,
    paid numeric(14,2) DEFAULT 0 NOT NULL,
    payment_method public.payment_method,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    document_number text GENERATED ALWAYS AS (invoice_number) STORED,
    cashbox_id uuid,
    bank_account_id uuid,
    payment_method_id text,
    payment_reference text,
    CONSTRAINT purchase_invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: purchase_order_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.purchase_order_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: purchase_return_item_batch_allocations; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.purchase_return_item_batch_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_return_item_id uuid NOT NULL,
    purchase_invoice_item_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    quantity numeric(14,3) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT purchase_return_item_batch_allocations_quantity_check CHECK ((quantity > (0)::numeric))
);

--
-- Name: purchase_return_items; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.purchase_return_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric NOT NULL,
    unit_cost numeric NOT NULL,
    tax numeric DEFAULT 0 NOT NULL,
    total numeric DEFAULT 0 NOT NULL,
    line_type text,
    invoice_item_id uuid,
    uom_id uuid,
    uom_quantity_increment numeric(30,12),
    entered_quantity numeric(18,6),
    base_quantity numeric(18,6),
    uom_conversion_factor numeric(30,12),
    entered_unit_cost numeric(18,4),
    CONSTRAINT purchase_return_items_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT purchase_return_items_uom_snapshot_check CHECK (((num_nonnulls(entered_quantity, base_quantity, uom_conversion_factor, entered_unit_cost, uom_quantity_increment) = ANY (ARRAY[0, 5])) AND ((entered_quantity IS NULL) OR ((entered_quantity > (0)::numeric) AND (base_quantity > (0)::numeric) AND (uom_conversion_factor > (0)::numeric) AND (entered_unit_cost >= (0)::numeric) AND (uom_quantity_increment > (0)::numeric)))))
);

--
-- Name: purchase_return_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.purchase_return_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: purchase_returns; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.purchase_returns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_number text NOT NULL,
    invoice_id uuid,
    supplier_id uuid,
    warehouse_id uuid NOT NULL,
    subtotal numeric DEFAULT 0 NOT NULL,
    tax numeric DEFAULT 0 NOT NULL,
    total numeric DEFAULT 0 NOT NULL,
    refund_method public.payment_method,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    document_number text GENERATED ALWAYS AS (return_number) STORED,
    cashbox_id uuid,
    bank_account_id uuid,
    payment_method_id text,
    payment_reference text,
    CONSTRAINT purchase_returns_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);


--
-- Name: FUNCTION consume_purchase_return_item_batches(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.consume_purchase_return_item_batches() FROM PUBLIC;

GRANT ALL ON FUNCTION public.consume_purchase_return_item_batches() TO service_role;


--
-- Name: FUNCTION guard_purchase_return_item_origin(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.guard_purchase_return_item_origin() FROM PUBLIC;

GRANT ALL ON FUNCTION public.guard_purchase_return_item_origin() TO service_role;


--
-- Name: FUNCTION require_purchase_batch_for_batch_items(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.require_purchase_batch_for_batch_items() IS 'Requires a batch identifier on purchases of batch-tracked items to keep POS batch stock in sync.';

--
-- Name: FUNCTION require_purchase_batch_for_batch_items(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.require_purchase_batch_for_batch_items() FROM PUBLIC;

GRANT ALL ON FUNCTION public.require_purchase_batch_for_batch_items() TO service_role;


--
-- Name: FUNCTION resolve_purchase_line(p_line jsonb, OUT o_product_id uuid, OUT o_quantity numeric, OUT o_line_type text, OUT o_stock_effect text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.resolve_purchase_line(p_line jsonb, OUT o_product_id uuid, OUT o_quantity numeric, OUT o_line_type text, OUT o_stock_effect text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.resolve_purchase_line(p_line jsonb, OUT o_product_id uuid, OUT o_quantity numeric, OUT o_line_type text, OUT o_stock_effect text) TO service_role;


--
-- Name: FUNCTION save_product_uom_settings(_product_id uuid, _units jsonb, _barcodes jsonb, _company_id integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.save_product_uom_settings(_product_id uuid, _units jsonb, _barcodes jsonb, _company_id integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.save_product_uom_settings(_product_id uuid, _units jsonb, _barcodes jsonb, _company_id integer) TO authenticated;

GRANT ALL ON FUNCTION public.save_product_uom_settings(_product_id uuid, _units jsonb, _barcodes jsonb, _company_id integer) TO service_role;


--
-- Name: FUNCTION sync_purchase_invoice_item_batch(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.sync_purchase_invoice_item_batch() FROM PUBLIC;

GRANT ALL ON FUNCTION public.sync_purchase_invoice_item_batch() TO service_role;


--
-- Name: FUNCTION trg_purchase_invoice_to_supplier_ledger(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.trg_purchase_invoice_to_supplier_ledger() FROM PUBLIC;

GRANT ALL ON FUNCTION public.trg_purchase_invoice_to_supplier_ledger() TO service_role;


--
-- Name: FUNCTION trg_purchase_return_to_supplier_ledger(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.trg_purchase_return_to_supplier_ledger() FROM PUBLIC;

GRANT ALL ON FUNCTION public.trg_purchase_return_to_supplier_ledger() TO service_role;


--
-- Name: FUNCTION warehouse_reference_counts(p_warehouse_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.warehouse_reference_counts(p_warehouse_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.warehouse_reference_counts(p_warehouse_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.warehouse_reference_counts(p_warehouse_id uuid) TO authenticated;


--
-- Name: SEQUENCE goods_receipt_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT USAGE ON SEQUENCE public.goods_receipt_seq TO service_role;

GRANT SELECT,USAGE ON SEQUENCE public.goods_receipt_seq TO authenticated;


--
-- Name: purchase_invoice_items purchase_invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_invoice_items
    ADD CONSTRAINT purchase_invoice_items_pkey PRIMARY KEY (id);

--
-- Name: idx_purchase_invoice_items_product; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_purchase_invoice_items_product ON public.purchase_invoice_items USING btree (product_id);

--
-- Name: purchase_invoice_items purchase_invoice_item_sync_batch; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE CONSTRAINT TRIGGER purchase_invoice_item_sync_batch AFTER INSERT ON public.purchase_invoice_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.sync_purchase_invoice_item_batch();

--
-- Name: purchase_invoice_items purchase_invoice_items_product_flags; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER purchase_invoice_items_product_flags BEFORE INSERT OR UPDATE ON public.purchase_invoice_items FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_product_flags();

--
-- Name: purchase_invoice_items purchase_items_require_batch_number; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER purchase_items_require_batch_number BEFORE INSERT OR UPDATE OF product_id, batch_number ON public.purchase_invoice_items FOR EACH ROW EXECUTE FUNCTION public.require_purchase_batch_for_batch_items();

--
-- Name: purchase_invoice_items pur_item_manage; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY pur_item_manage ON public.purchase_invoice_items TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role) OR public.has_role(auth.uid(), 'warehouse'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role) OR public.has_role(auth.uid(), 'warehouse'::public.app_role)));

--
-- Name: purchase_invoice_items pur_item_view; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY pur_item_view ON public.purchase_invoice_items FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: purchase_invoice_items; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.purchase_invoice_items ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE purchase_invoice_items; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.purchase_invoice_items TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.purchase_invoice_items TO authenticated;


--
-- Name: SEQUENCE purchase_invoice_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,USAGE ON SEQUENCE public.purchase_invoice_seq TO authenticated;


--
-- Name: purchase_register; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.purchase_register WITH (security_invoker='true') AS
 SELECT i.id AS purchase_item_id,
    i.invoice_id,
    s.invoice_number,
    s.created_at,
    s.supplier_id,
    s.status,
    i.product_id,
    p.name AS item_name,
    p.name_ar AS item_name_ar,
    p.sku,
    i.quantity,
    i.unit_cost,
    i.discount,
    i.tax,
    i.total,
    COALESCE(i.line_type,
        CASE
            WHEN (i.product_id IS NULL) THEN 'AD_HOC_SERVICE'::text
            ELSE public.item_line_type(i.product_id, false)
        END) AS line_type,
    COALESCE(i.stock_effect, 'NONE'::text) AS stock_effect,
    (COALESCE(i.stock_effect, 'NONE'::text) = 'STOCK_RECEIPT'::text) AS increases_inventory,
    COALESCE(i.uom_id, p.base_uom_id, p.unit_id) AS uom_id,
    COALESCE(i.entered_quantity, i.quantity) AS entered_quantity,
    COALESCE(i.entered_unit_cost, i.unit_cost) AS entered_unit_cost,
    COALESCE(i.uom_conversion_factor, (1)::numeric) AS uom_conversion_factor,
    u.name AS uom_name,
    COALESCE(u.name_ar, u.name) AS uom_name_ar,
    COALESCE(p.base_uom_id, p.unit_id) AS base_uom_id,
    base_u.name AS base_uom_name,
    COALESCE(base_u.name_ar, base_u.name) AS base_uom_name_ar
   FROM ((((public.purchase_invoice_items i
     JOIN public.purchase_invoices s ON ((s.id = i.invoice_id)))
     LEFT JOIN public.products p ON ((p.id = i.product_id)))
     LEFT JOIN public.units u ON ((u.id = COALESCE(i.uom_id, p.base_uom_id, p.unit_id))))
     LEFT JOIN public.units base_u ON ((base_u.id = COALESCE(p.base_uom_id, p.unit_id))));

--
-- Name: purchase_invoices purchase_invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_invoice_number_key UNIQUE (invoice_number);

--
-- Name: purchase_invoices purchase_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_pkey PRIMARY KEY (id);

--
-- Name: purchase_invoices purchases_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER purchases_updated BEFORE UPDATE ON public.purchase_invoices FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: purchase_invoices trg_purchase_invoice_supplier_ledger; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_purchase_invoice_supplier_ledger AFTER INSERT ON public.purchase_invoices FOR EACH ROW EXECUTE FUNCTION public.trg_purchase_invoice_to_supplier_ledger();

--
-- Name: purchase_invoices pur_manage; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY pur_manage ON public.purchase_invoices TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role) OR public.has_role(auth.uid(), 'warehouse'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role) OR public.has_role(auth.uid(), 'warehouse'::public.app_role)));

--
-- Name: purchase_invoices pur_view; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY pur_view ON public.purchase_invoices FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: purchase_invoices; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE purchase_invoices; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.purchase_invoices TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.purchase_invoices TO authenticated;


--
-- Name: SEQUENCE purchase_order_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT USAGE ON SEQUENCE public.purchase_order_seq TO service_role;

GRANT SELECT,USAGE ON SEQUENCE public.purchase_order_seq TO authenticated;


--
-- Name: purchase_return_item_batch_allocations purchase_return_item_batch_al_purchase_return_item_id_purch_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_return_item_batch_allocations
    ADD CONSTRAINT purchase_return_item_batch_al_purchase_return_item_id_purch_key UNIQUE (purchase_return_item_id, purchase_invoice_item_id, batch_id);

--
-- Name: purchase_return_item_batch_allocations purchase_return_item_batch_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_return_item_batch_allocations
    ADD CONSTRAINT purchase_return_item_batch_allocations_pkey PRIMARY KEY (id);

--
-- Name: idx_purchase_return_batch_allocations_source; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_purchase_return_batch_allocations_source ON public.purchase_return_item_batch_allocations USING btree (purchase_invoice_item_id, batch_id);


--
-- Name: COLUMN purchase_return_items.invoice_item_id; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.purchase_return_items.invoice_item_id IS 'Exact source purchase invoice line used to validate quantity, historical unit conversion, price, and batch return.';

--
-- Name: purchase_return_items purchase_return_items_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_return_items
    ADD CONSTRAINT purchase_return_items_pkey PRIMARY KEY (id);

--
-- Name: idx_purchase_return_items_product; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_purchase_return_items_product ON public.purchase_return_items USING btree (product_id);

--
-- Name: purchase_return_items_invoice_item_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX purchase_return_items_invoice_item_idx ON public.purchase_return_items USING btree (invoice_item_id) WHERE (invoice_item_id IS NOT NULL);

--
-- Name: purchase_return_items purchase_return_item_consume_batches; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER purchase_return_item_consume_batches AFTER INSERT ON public.purchase_return_items FOR EACH ROW EXECUTE FUNCTION public.consume_purchase_return_item_batches();

--
-- Name: purchase_return_items purchase_return_item_origin_guard; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER purchase_return_item_origin_guard BEFORE INSERT ON public.purchase_return_items FOR EACH ROW EXECUTE FUNCTION public.guard_purchase_return_item_origin();

--
-- Name: purchase_return_items; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.purchase_return_items ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_return_items staff read pret_i; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "staff read pret_i" ON public.purchase_return_items FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: purchase_return_items staff write pret_i; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "staff write pret_i" ON public.purchase_return_items TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

--
-- Name: TABLE purchase_return_items; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.purchase_return_items TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.purchase_return_items TO authenticated;


--
-- Name: SEQUENCE purchase_return_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,USAGE ON SEQUENCE public.purchase_return_seq TO authenticated;


--
-- Name: purchase_returns purchase_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_pkey PRIMARY KEY (id);

--
-- Name: purchase_returns purchase_returns_return_number_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_return_number_key UNIQUE (return_number);

--
-- Name: purchase_returns trg_purchase_return_supplier_ledger; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_purchase_return_supplier_ledger AFTER INSERT ON public.purchase_returns FOR EACH ROW EXECUTE FUNCTION public.trg_purchase_return_to_supplier_ledger();

--
-- Name: purchase_returns; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_returns staff read pret; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "staff read pret" ON public.purchase_returns FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: purchase_returns staff write pret; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "staff write pret" ON public.purchase_returns TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

--
-- Name: TABLE purchase_returns; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.purchase_returns TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.purchase_returns TO authenticated;


--
-- Name: VIEW purchase_register; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON VIEW public.purchase_register IS 'Invoice register: quantity/unit_cost remain base-stock values; entered_quantity/entered_unit_cost and UoM labels preserve the document unit.';

--
-- Name: TABLE purchase_register; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.purchase_register TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.purchase_register TO service_role;
