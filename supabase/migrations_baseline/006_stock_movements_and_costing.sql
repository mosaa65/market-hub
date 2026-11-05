-- ============================================================================
-- الترحيل 006_stock_movements_and_costing.sql — مجال: stock_movements_and_costing
-- جزء من خط الأساس الجديد: تعريف نهائي واحد لكل كائن، مبني من مخطط مرجعي
-- مستخرج من الترحيلات التاريخية الكاملة (راجع supabase/migrations/README.md).
-- ============================================================================

--
-- Name: apply_cost_movement(uuid, uuid, numeric, numeric, text, uuid, text, public.owner_type, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.apply_cost_movement(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_incoming_cost numeric DEFAULT NULL::numeric, p_source_type text DEFAULT NULL::text, p_source_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text, p_owner_type public.owner_type DEFAULT 'COMPANY'::public.owner_type, p_owner_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_method   public.costing_method := CASE
    WHEN p_owner_type = 'COMPANY'::public.owner_type
      THEN public.company_costing_method()
    ELSE 'MOVING_AVERAGE'::public.costing_method
  END;
  v_qty0     numeric := 0;
  v_val0     numeric := 0;
  v_in_cost  numeric;
  v_out_cost numeric;
  v_qty1     numeric;
  v_val1     numeric;
  v_tx_cost  numeric;
BEGIN
  IF p_signed_qty IS NULL OR p_signed_qty = 0 THEN RETURN; END IF;
  IF p_signed_qty <> round(p_signed_qty, 3) THEN
    RAISE EXCEPTION 'Stock movement quantity exceeds the supported precision of three decimal places'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_product_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Item and location are required to value a movement';
  END IF;
  IF p_owner_type = 'COMPANY'::public.owner_type
     AND v_method IS DISTINCT FROM 'MOVING_AVERAGE'::public.costing_method THEN
    RAISE EXCEPTION
      'Company stock posting is blocked because the saved costing method (%) is not supported. Switch to MOVING_AVERAGE in Stock Settings before posting stock documents.',
      v_method USING ERRCODE = '55000';
  END IF;

  SELECT cl.quantity, cl.total_value INTO v_qty0, v_val0
    FROM public.item_cost_layers cl
   WHERE cl.product_id = p_product_id AND cl.warehouse_id = p_warehouse_id
     AND cl.owner_type = p_owner_type AND cl.owner_id IS NOT DISTINCT FROM p_owner_id
   FOR UPDATE;
  v_qty0 := coalesce(v_qty0, 0);
  v_val0 := coalesce(v_val0, 0);
  v_qty1 := round(v_qty0 + p_signed_qty, 3);

  IF p_signed_qty > 0 THEN
    v_in_cost := coalesce(
      p_incoming_cost,
      CASE WHEN v_qty0 > 0 THEN round(v_val0 / v_qty0, 4) END,
      (SELECT p.cost_price FROM public.products p WHERE p.id = p_product_id), 0);
    v_val1 := v_val0 + round(p_signed_qty * v_in_cost, 2);
    v_tx_cost := coalesce(p_incoming_cost, v_in_cost, 0);
  ELSE
    v_out_cost := CASE WHEN v_qty0 > 0 THEN round(v_val0 / v_qty0, 4)
                       ELSE coalesce((SELECT p.cost_price FROM public.products p WHERE p.id = p_product_id), 0)
                  END;
    -- Do not clamp at zero: a negative value is the estimated cost of an
    -- oversold balance and is settled by the next receipt.
    v_val1 := v_val0 - round(abs(p_signed_qty) * v_out_cost, 2);
    v_tx_cost := coalesce(v_out_cost, 0);
  END IF;

  INSERT INTO public.item_cost_layers
    (product_id, warehouse_id, owner_type, owner_id, quantity, total_value,
     valuation_method, last_unit_cost, last_movement_at, updated_at)
  VALUES
    (p_product_id, p_warehouse_id, p_owner_type, p_owner_id, v_qty1, v_val1,
     v_method, coalesce(p_incoming_cost, v_in_cost, v_out_cost, 0), now(), now())
  ON CONFLICT (product_id, warehouse_id, owner_type, owner_id)
  DO UPDATE SET quantity = EXCLUDED.quantity, total_value = EXCLUDED.total_value,
                valuation_method = EXCLUDED.valuation_method,
                last_unit_cost = EXCLUDED.last_unit_cost, last_movement_at = now(), updated_at = now();

  INSERT INTO public.item_cost_transactions
    (product_id, warehouse_id, owner_type, owner_id, direction, quantity, unit_cost, value,
     method, quantity_before, value_before, quantity_after, value_after, source_type, source_id, note)
  VALUES
    (p_product_id, p_warehouse_id, p_owner_type, p_owner_id,
     CASE WHEN p_signed_qty > 0 THEN 'IN' ELSE 'OUT' END, abs(p_signed_qty), v_tx_cost,
     round(abs(p_signed_qty) * v_tx_cost, 2), v_method, v_qty0, v_val0, v_qty1, v_val1,
     p_source_type, p_source_id, p_note);

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'cost.movement_applied', 'product', p_product_id,
    jsonb_build_object('warehouse_id', p_warehouse_id, 'method', v_method,
      'direction', CASE WHEN p_signed_qty > 0 THEN 'IN' ELSE 'OUT' END,
      'quantity', abs(p_signed_qty), 'actual_purchase_cost', CASE WHEN p_signed_qty > 0 THEN p_incoming_cost ELSE NULL END,
      'valuation_unit_cost', CASE WHEN p_signed_qty > 0 THEN v_in_cost ELSE v_out_cost END,
      'quantity_after', v_qty1, 'value_after', v_val1, 'source_type', p_source_type, 'source_id', p_source_id));
END;
$$;

--
-- Name: create_opening_balance(date, jsonb, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_opening_balance(_effective_date date, _lines jsonb, _notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
  v_num text;
  l jsonb;
  v_side text;
  v_section text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may open the books';
  END IF;
  IF _effective_date IS NULL THEN
    RAISE EXCEPTION 'Effective date is required';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'An opening entry needs at least one line';
  END IF;

  v_num := 'OB-' || to_char(_effective_date, 'YYYYMMDD') || '-' ||
           lpad(nextval('public.opening_balance_seq')::text, 3, '0');
  INSERT INTO public.opening_balance_documents
    (document_number, effective_date, status, fiscal_year, notes, created_by)
  VALUES
    (v_num, _effective_date, 'DRAFT', EXTRACT(YEAR FROM _effective_date)::int,
     nullif(btrim(coalesce(_notes, '')), ''), v_user)
  RETURNING id INTO v_id;

  FOR l IN SELECT * FROM jsonb_array_elements(_lines)
  LOOP
    v_section := l->>'section';
    IF v_section NOT IN ('STOCK','RECEIVABLE','PAYABLE','CASH','BANK','ASSET','LIABILITY','CAPITAL') THEN
      RAISE EXCEPTION 'Unknown opening section: %', v_section;
    END IF;
    v_side := CASE WHEN v_section IN ('STOCK','RECEIVABLE','CASH','BANK','ASSET')
                   THEN 'DEBIT' ELSE 'CREDIT' END;
    IF coalesce((l->>'amount')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Line amount must be greater than zero (section %)', v_section;
    END IF;
    IF v_section = 'STOCK' AND ((l->>'product_id') IS NULL OR (l->>'warehouse_id') IS NULL
       OR coalesce((l->>'quantity')::numeric, 0) <= 0) THEN
      RAISE EXCEPTION 'Stock opening line requires an item, warehouse and positive quantity';
    END IF;
    IF v_section = 'RECEIVABLE' AND (l->>'customer_id') IS NULL THEN
      RAISE EXCEPTION 'Receivable opening line requires a customer';
    END IF;
    IF v_section = 'PAYABLE' AND (l->>'supplier_id') IS NULL THEN
      RAISE EXCEPTION 'Payable opening line requires a supplier';
    END IF;

    INSERT INTO public.opening_balance_lines
      (document_id, section, side, ref_type, ref_id, product_id, warehouse_id,
       customer_id, supplier_id, description, quantity, unit_cost, amount, ledger_account_code)
    VALUES
      (v_id, v_section, v_side, l->>'ref_type', (l->>'ref_id')::uuid,
       (l->>'product_id')::uuid, (l->>'warehouse_id')::uuid,
       (l->>'customer_id')::uuid, (l->>'supplier_id')::uuid,
       coalesce(nullif(btrim(coalesce(l->>'description', '')), ''), v_section),
       (l->>'quantity')::numeric, (l->>'unit_cost')::numeric,
       (l->>'amount')::numeric, nullif(btrim(l->>'ledger_account_code'), ''));
  END LOOP;
  RETURN v_id;
END;
$$;

--
-- Name: delete_product_batch(uuid, boolean); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.delete_product_batch(p_batch_id uuid, p_sync_inventory boolean DEFAULT true) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_prod uuid;
  v_wh   uuid;
  v_qty  numeric;
  v_cost numeric;
  v_batch_no text;
  v_tracked boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT product_id, warehouse_id, quantity, unit_cost, batch_number
    INTO v_prod, v_wh, v_qty, v_cost, v_batch_no
  FROM public.product_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT (inventory_policy = 'TRACKED') INTO v_tracked
  FROM public.products WHERE id = v_prod;

  DELETE FROM public.product_batches WHERE id = p_batch_id;

  IF p_sync_inventory AND v_qty > 0 AND coalesce(v_tracked, true) THEN
    PERFORM public.post_stock_delta(
      v_prod,
      v_wh,
      -v_qty,
      v_cost,
      'ADJUSTMENT'::public.stock_movement_kind,
      'product_batch',
      p_batch_id,
      'حذف دفعة رقم: ' || v_batch_no,
      'COMPANY'::public.owner_type,
      NULL,
      'adjustment'::public.movement_type
    );
  END IF;

  RETURN true;
END $$;

--
-- Name: get_batch_kpis(integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.get_batch_kpis(p_warning_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_soon_limit date := CURRENT_DATE + (coalesce(p_warning_days, 30) || ' days')::interval;
  v_total bigint;
  v_expired bigint;
  v_soon bigint;
  v_valid bigint;
  v_none bigint;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date <= v_today),
    count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date > v_today AND expiry_date <= v_soon_limit),
    count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date > v_soon_limit),
    count(*) FILTER (WHERE expiry_date IS NULL)
  INTO
    v_total, v_expired, v_soon, v_valid, v_none
  FROM public.product_batches;

  RETURN jsonb_build_object(
    'total', coalesce(v_total, 0),
    'expired', coalesce(v_expired, 0),
    'soon', coalesce(v_soon, 0),
    'valid', coalesce(v_valid, 0),
    'none', coalesce(v_none, 0),
    'at_risk', coalesce(v_expired, 0) + coalesce(v_soon, 0)
  );
END $$;

--
-- Name: guard_company_stock_movement_scope(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.guard_company_stock_movement_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_product public.products%ROWTYPE;
BEGIN
  IF NEW.owner_type <> 'COMPANY'::public.owner_type THEN
    RETURN NEW;
  END IF;
  SELECT p.* INTO v_product FROM public.products p WHERE p.id = NEW.product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير موجود'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_product.is_custody_item IS TRUE
     OR v_product.inventory_policy = 'CUSTOMER_OWNED'::public.inventory_policy THEN
    RAISE EXCEPTION
      'لا يمكن تسجيل حركة مخزون شركة لصنف مملوك للعميل؛ استخدم مسار العهدة'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: item_stock_effect(uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.item_stock_effect(p_item_id uuid, p_direction text) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_nature public.item_nature;
  v_policy public.inventory_policy;
BEGIN
  SELECT p.item_nature INTO v_nature FROM public.products p WHERE p.id = p_item_id;
  IF v_nature IS NULL THEN
    RETURN 'NONE';
  END IF;

  -- A SERVICE never moves company stock, in either direction.
  IF v_nature = 'SERVICE' THEN
    RETURN 'NONE';
  END IF;

  v_policy := public.item_effective_policy(p_item_id);

  -- Rule 4 / Rule 5: only TRACKED goods move stock. UNTRACKED goods are sold
  -- and purchased without any inventory effect; CUSTOMER_OWNED material is
  -- never company stock, so a normal sale/purchase never touches it.
  IF v_policy <> 'TRACKED' THEN
    RETURN 'NONE';
  END IF;

  RETURN CASE WHEN p_direction = 'out' THEN 'STOCK_ISSUE' ELSE 'STOCK_RECEIPT' END;
END $$;

--
-- Name: next_stock_adjustment_number(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.next_stock_adjustment_number() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE n bigint;
BEGIN
  n := nextval('public.stock_adjustment_seq');
  RETURN 'ADJ-' || to_char(now(), 'YYYYMM') || '-' || lpad(n::text, 4, '0');
END $$;

--
-- Name: next_stock_opening_number(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.next_stock_opening_number() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE n bigint;
BEGIN
  n := nextval('public.stock_opening_seq');
  RETURN 'OP-' || to_char(now(), 'YYYYMM') || '-' || lpad(n::text, 4, '0');
END $$;

--
-- Name: post_opening_stock(uuid, date, text, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.post_opening_stock(_warehouse_id uuid, _effective_date date, _note text, _items jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user       uuid := auth.uid();
  v_id         uuid;
  v_number     text;
  v_line       record;
  v_policy     public.inventory_policy;
  v_nature     public.item_nature;
  v_total      numeric := 0;
  v_line_total numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'warehouse')
    OR public.has_role(v_user, 'accountant')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to post opening stock';
  END IF;

  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required';
  END IF;

  IF coalesce(jsonb_typeof(_items), '') <> 'array'
     OR coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'Opening stock requires at least one item';
  END IF;

  -- Validate everything BEFORE writing the document header.
  FOR v_line IN
    SELECT (line ->> 'product_id')::uuid                 AS product_id,
           (line ->> 'quantity')::numeric                AS quantity,
           coalesce((line ->> 'unit_cost')::numeric, 0)  AS unit_cost,
           nullif(btrim(coalesce(line ->> 'note', '')), '') AS note
    FROM jsonb_array_elements(_items) AS line
  LOOP
    IF v_line.product_id IS NULL OR v_line.quantity IS NULL OR v_line.quantity <= 0 THEN
      RAISE EXCEPTION 'Every opening line requires an item and a positive quantity';
    END IF;
    IF v_line.unit_cost < 0 THEN
      RAISE EXCEPTION 'Unit cost cannot be negative';
    END IF;

    SELECT p.item_nature INTO v_nature FROM public.products p WHERE p.id = v_line.product_id;
    IF v_nature IS NULL THEN
      RAISE EXCEPTION 'Item % does not exist', v_line.product_id;
    END IF;

    IF v_nature = 'SERVICE' THEN
      -- Rule 2: a service never holds a balance. Do not let a workaround
      -- re-enter through opening stock.
      RAISE EXCEPTION 'Item % is a SERVICE and cannot hold an inventory balance', v_line.product_id;
    END IF;

    v_policy := public.item_effective_policy(v_line.product_id);
    IF v_policy <> 'TRACKED' THEN
      RAISE EXCEPTION
        'Item % has inventory policy %, so it cannot receive an opening balance (only TRACKED items can)',
        v_line.product_id, v_policy;
    END IF;
  END LOOP;

  v_number := public.next_stock_opening_number();

  INSERT INTO public.stock_openings (document_number, warehouse_id, effective_date, note, created_by)
  VALUES (v_number, _warehouse_id, coalesce(_effective_date, current_date),
          nullif(btrim(coalesce(_note, '')), ''), v_user)
  RETURNING id INTO v_id;

  FOR v_line IN
    SELECT (line ->> 'product_id')::uuid                 AS product_id,
           (line ->> 'quantity')::numeric                AS quantity,
           coalesce((line ->> 'unit_cost')::numeric, 0)  AS unit_cost,
           nullif(btrim(coalesce(line ->> 'note', '')), '') AS note
    FROM jsonb_array_elements(_items) AS line
  LOOP
    v_line_total := round(v_line.quantity * v_line.unit_cost, 2);
    v_total := v_total + v_line_total;

    INSERT INTO public.stock_opening_items (opening_id, product_id, quantity, unit_cost, total_cost, note)
    VALUES (v_id, v_line.product_id, v_line.quantity, v_line.unit_cost, v_line_total, v_line.note);

    PERFORM public.post_stock_delta(
      v_line.product_id,
      _warehouse_id,
      v_line.quantity,                 -- positive: stock increases
      v_line.unit_cost,
      'OPENING'::public.stock_movement_kind,
      'stock_opening',
      v_id,
      coalesce(v_line.note, 'رصيد أول المدة'),
      'COMPANY'::public.owner_type,
      NULL,
      'opening'::public.movement_type
    );
  END LOOP;

  UPDATE public.stock_openings SET total_value = v_total WHERE id = v_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'stock_opening.posted', 'stock_opening', v_id,
    jsonb_build_object(
      'document_number', v_number,
      'warehouse_id', _warehouse_id,
      'effective_date', coalesce(_effective_date, current_date),
      'lines', jsonb_array_length(_items),
      'total_value', v_total
    ));

  RETURN v_id;
END $$;

--
-- Name: post_stock_delta(uuid, uuid, numeric, numeric, public.stock_movement_kind, text, uuid, text, public.owner_type, uuid, public.movement_type); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.post_stock_delta(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_unit_cost numeric DEFAULT NULL::numeric, p_movement_kind public.stock_movement_kind DEFAULT 'ADJUSTMENT'::public.stock_movement_kind, p_source_type text DEFAULT NULL::text, p_source_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text, p_owner_type public.owner_type DEFAULT 'COMPANY'::public.owner_type, p_owner_id uuid DEFAULT NULL::uuid, p_movement_type_legacy public.movement_type DEFAULT NULL::public.movement_type) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_mt public.movement_type;
  v_policy public.inventory_policy;
  v_nature public.item_nature;
  v_before numeric;
  v_after numeric;
  v_val0 numeric;
  v_val1 numeric;
  v_value numeric;
  v_movement_id uuid;
  v_allow_negative_sales boolean := false;
  v_permitted_negative_issue boolean := false;
BEGIN
  IF v_user IS NOT NULL AND NOT public.is_staff(v_user) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF p_signed_qty IS NULL OR p_signed_qty = 0 THEN RETURN; END IF;
  IF p_signed_qty <> round(p_signed_qty, 3) THEN
    RAISE EXCEPTION 'Stock movement quantity exceeds the supported precision of three decimal places'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_product_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Item and warehouse are required for a stock movement';
  END IF;

  SELECT allow_negative_sales INTO v_allow_negative_sales
    FROM public.company_settings WHERE id = 1 FOR SHARE;
  v_allow_negative_sales := coalesce(v_allow_negative_sales, false);
  v_permitted_negative_issue := v_allow_negative_sales
    AND p_owner_type = 'COMPANY'::public.owner_type
    AND p_movement_kind = 'ISSUE'::public.stock_movement_kind
    AND p_source_type = 'sales_invoice';

  v_mt := coalesce(p_movement_type_legacy, CASE p_movement_kind
    WHEN 'RECEIPT' THEN 'purchase'::public.movement_type
    WHEN 'ISSUE' THEN 'sale'::public.movement_type
    WHEN 'TRANSFER_IN' THEN 'transfer_in'::public.movement_type
    WHEN 'TRANSFER_OUT' THEN 'transfer_out'::public.movement_type
    ELSE 'adjustment'::public.movement_type END);

  SELECT p.item_nature, public.item_effective_policy(p.id) INTO v_nature, v_policy
    FROM public.products p WHERE p.id = p_product_id;
  IF v_nature = 'SERVICE' OR v_policy <> 'TRACKED' THEN
    RAISE EXCEPTION 'Item % does not hold company stock (nature %, policy %)',
      p_product_id, coalesce(v_nature::text, '?'), coalesce(v_policy::text, '?');
  END IF;

  SELECT i.quantity INTO v_before FROM public.inventory i
   WHERE i.product_id = p_product_id AND i.warehouse_id = p_warehouse_id
     AND i.owner_type = p_owner_type AND i.owner_id IS NOT DISTINCT FROM p_owner_id FOR UPDATE;
  v_before := coalesce(v_before, 0);
  v_after := round(v_before + p_signed_qty, 3);
  IF v_after < 0 AND NOT v_permitted_negative_issue THEN
    RAISE EXCEPTION 'Insufficient stock for item % in warehouse %: available %, requested %',
      p_product_id, p_warehouse_id, v_before, abs(p_signed_qty) USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.inventory (product_id, warehouse_id, owner_type, owner_id, quantity)
  VALUES (p_product_id, p_warehouse_id, p_owner_type, p_owner_id, v_after)
  ON CONFLICT (product_id, warehouse_id, owner_type, owner_id)
  DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();

  SELECT cl.total_value INTO v_val0 FROM public.item_cost_layers cl
   WHERE cl.product_id = p_product_id AND cl.warehouse_id = p_warehouse_id
     AND cl.owner_type = p_owner_type AND cl.owner_id IS NOT DISTINCT FROM p_owner_id;
  v_val0 := coalesce(v_val0, 0);

  PERFORM set_config('app.stock_engine', 'on', true);
  INSERT INTO public.stock_movements
    (product_id, warehouse_id, movement_type, quantity, unit_cost, reference, note, created_by,
     movement_kind, source_type, source_id, owner_type, owner_id, adjustment_reason)
  VALUES
    (p_product_id, p_warehouse_id, v_mt, p_signed_qty, p_unit_cost,
     coalesce(p_source_type, '') || coalesce(':' || p_source_id::text, ''), p_note, v_user,
     p_movement_kind, p_source_type, p_source_id, p_owner_type, p_owner_id,
     CASE WHEN v_mt = 'adjustment'::public.movement_type
       THEN coalesce(nullif(btrim(p_note), ''), nullif(btrim(p_source_type), ''), 'Stock adjustment') ELSE NULL END)
  RETURNING id INTO v_movement_id;

  PERFORM public.apply_cost_movement(p_product_id, p_warehouse_id, p_signed_qty, p_unit_cost,
    p_source_type, p_source_id, p_note, p_owner_type, p_owner_id);

  SELECT cl.total_value INTO v_val1 FROM public.item_cost_layers cl
   WHERE cl.product_id = p_product_id AND cl.warehouse_id = p_warehouse_id
     AND cl.owner_type = p_owner_type AND cl.owner_id IS NOT DISTINCT FROM p_owner_id;
  v_val1 := coalesce(v_val1, 0);
  v_value := CASE WHEN p_signed_qty > 0 THEN round(abs(v_val1 - v_val0), 2)
                  ELSE round(abs(v_val0 - v_val1), 2) END;
  UPDATE public.stock_movements SET total_cost = v_value,
    unit_cost = CASE WHEN p_signed_qty <> 0 THEN round(v_value / abs(p_signed_qty), 4) ELSE unit_cost END
   WHERE id = v_movement_id;
  PERFORM set_config('app.stock_engine', 'off', true);
END;
$$;

--
-- Name: post_stock_settlement(uuid, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.post_stock_settlement(p_warehouse_id uuid, p_reason text, p_note text, p_lines jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_doc   uuid;
  v_no    text;
  v_line  record;
  v_before numeric;
  v_diff  numeric;
  v_unit_cost numeric;
  v_total_value numeric := 0;
  v_lines_posted integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')) THEN
    RAISE EXCEPTION 'Only an owner or manager may post a stock settlement'
      USING ERRCODE = '42501';
  END IF;

  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = p_warehouse_id AND w.is_active) THEN
    RAISE EXCEPTION 'Selected warehouse is unavailable';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A settlement reason is required';
  END IF;
  IF coalesce(jsonb_typeof(p_lines), '') <> 'array' OR coalesce(jsonb_array_length(p_lines), 0) = 0 THEN
    RAISE EXCEPTION 'A settlement needs at least one line';
  END IF;

  v_no := public.next_stock_adjustment_number();

  INSERT INTO public.stock_adjustments
    (document_number, warehouse_id, effective_date, reason, note, total_value, created_by)
  VALUES
    (v_no, p_warehouse_id, CURRENT_DATE, btrim(p_reason),
     nullif(btrim(p_note), ''), 0, v_user)
  RETURNING id INTO v_doc;

  FOR v_line IN
    SELECT (l ->> 'product_id')::uuid AS product_id,
           (l ->> 'actual_qty')::numeric AS actual_qty
      FROM jsonb_array_elements(p_lines) AS l
  LOOP
    IF v_line.product_id IS NULL OR v_line.actual_qty IS NULL OR v_line.actual_qty < 0 THEN
      RAISE EXCEPTION 'Every settlement line needs an item and a non-negative actual quantity';
    END IF;

    SELECT coalesce(i.quantity, 0) INTO v_before
      FROM public.inventory i
     WHERE i.product_id = v_line.product_id
       AND i.warehouse_id = p_warehouse_id
       AND i.owner_type = 'COMPANY'
       AND i.owner_id IS NULL;

    v_before := coalesce(v_before, 0);
    v_diff   := round(v_line.actual_qty - v_before, 3);

    -- صفر فرق = لا حركة ولا سطر مستند.
    IF v_diff = 0 THEN
      CONTINUE;
    END IF;

    v_unit_cost := coalesce(
      public.resolve_unit_cost(v_line.product_id, p_warehouse_id),
      (SELECT p.cost_price FROM public.products p WHERE p.id = v_line.product_id),
      0
    );
    v_total_value := v_total_value + round(v_diff * v_unit_cost, 2);
    v_lines_posted := v_lines_posted + 1;

    PERFORM public.post_stock_delta(
      p_product_id           => v_line.product_id,
      p_warehouse_id         => p_warehouse_id,
      p_signed_qty           => v_diff,
      -- زيادة: بقيمة الوحدة المعروفة. نقص: يقيّمه المحرّك بمتوسط الطبقة.
      p_unit_cost            => CASE WHEN v_diff > 0 THEN v_unit_cost ELSE NULL END,
      p_movement_kind        => 'ADJUSTMENT'::public.stock_movement_kind,
      p_source_type          => 'stock_adjustment',
      p_source_id            => v_doc,
      p_note                 => 'تسوية جردية ' || v_no || ' — ' || btrim(p_reason)
                                || coalesce(' — ' || nullif(btrim(p_note), ''), ''),
      p_owner_type           => 'COMPANY'::public.owner_type,
      p_owner_id             => NULL,
      p_movement_type_legacy => 'adjustment'::public.movement_type
    );

    INSERT INTO public.stock_adjustment_items
      (adjustment_id, product_id, quantity, unit_cost, total_cost, note)
    VALUES
      (v_doc, v_line.product_id, v_diff, v_unit_cost,
       round(v_diff * v_unit_cost, 2),
       format('%s → %s', v_before, v_line.actual_qty));
  END LOOP;

  IF v_lines_posted = 0 THEN
    RAISE EXCEPTION 'No differences to post - every counted quantity matches the book balance';
  END IF;

  UPDATE public.stock_adjustments
     SET total_value = round(v_total_value, 2)
   WHERE id = v_doc;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'stock.settlement.posted', 'stock_adjustment', v_doc,
    jsonb_build_object(
      'document_number', v_no,
      'warehouse_id', p_warehouse_id,
      'reason', btrim(p_reason),
      'lines', v_lines_posted,
      'value_delta', round(v_total_value, 2)
    ));

  RETURN v_doc;
END $$;

--
-- Name: receive_customer_owned_stock(uuid, uuid, uuid, numeric, numeric, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.receive_customer_owned_stock(_customer_id uuid, _product_id uuid, _warehouse_id uuid, _quantity numeric, _unit_cost numeric, _note text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_nature      public.item_nature;
  v_movement_id uuid;
  v_new_qty     numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'warehouse')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to receive customer-owned material';
  END IF;

  IF _customer_id IS NULL OR _product_id IS NULL OR _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Customer, item and location are all required';
  END IF;

  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;

  -- A service can never be physically received.
  SELECT p.item_nature INTO v_nature FROM public.products p WHERE p.id = _product_id;
  IF v_nature IS NULL THEN
    RAISE EXCEPTION 'Item % does not exist', _product_id;
  END IF;
  IF v_nature = 'SERVICE' THEN
    RAISE EXCEPTION 'Item % is a SERVICE and cannot be held as physical material', _product_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = _customer_id) THEN
    RAISE EXCEPTION 'Customer % does not exist', _customer_id;
  END IF;

  v_new_qty := public.post_stock_delta(
    _product_id,
    _warehouse_id,
    _quantity,
    coalesce(_unit_cost, 0),
    'RECEIPT'::public.stock_movement_kind,
    'customer_owned_receipt',
    NULL,
    coalesce(nullif(btrim(coalesce(_note, '')), ''), 'استلام مادة مملوكة للعميل'),
    'CUSTOMER'::public.owner_type,
    _customer_id,
    'purchase'::public.movement_type
  );

  SELECT id INTO v_movement_id
  FROM public.stock_movements
  WHERE product_id = _product_id
    AND warehouse_id = _warehouse_id
    AND owner_type = 'CUSTOMER'
    AND owner_id = _customer_id
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'customer_owned.received', 'customers', _customer_id,
    jsonb_build_object(
      'product_id', _product_id,
      'warehouse_id', _warehouse_id,
      'quantity', _quantity,
      'unit_cost', coalesce(_unit_cost, 0),
      'resulting_quantity', v_new_qty,
      'movement_id', v_movement_id
    ));

  RETURN v_movement_id;
END $$;

--
-- Name: reconcile_batches_with_inventory(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.reconcile_batches_with_inventory(p_warehouse_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_rec record;
  v_diff numeric;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR v_rec IN
    WITH batch_sums AS (
      SELECT product_id, warehouse_id, sum(quantity) as total_batch_qty
      FROM public.product_batches
      WHERE (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id)
      GROUP BY product_id, warehouse_id
    ),
    inv_stocks AS (
      SELECT product_id, warehouse_id, quantity as inv_qty
      FROM public.inventory
      WHERE owner_type = 'COMPANY'
        AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id)
    )
    SELECT
      coalesce(b.product_id, i.product_id) as product_id,
      coalesce(b.warehouse_id, i.warehouse_id) as warehouse_id,
      coalesce(b.total_batch_qty, 0) as batch_qty,
      coalesce(i.inv_qty, 0) as inventory_qty
    FROM batch_sums b
    FULL OUTER JOIN inv_stocks i
      ON b.product_id = i.product_id AND b.warehouse_id = i.warehouse_id
    WHERE coalesce(b.total_batch_qty, 0) <> coalesce(i.inv_qty, 0)
  LOOP
    v_diff := v_rec.batch_qty - v_rec.inventory_qty;
    v_results := v_results || jsonb_build_object(
      'product_id', v_rec.product_id,
      'warehouse_id', v_rec.warehouse_id,
      'batch_qty', v_rec.batch_qty,
      'inventory_qty', v_rec.inventory_qty,
      'difference', v_diff
    );
  END LOOP;

  RETURN v_results;
END $$;

--
-- Name: release_customer_owned_stock(uuid, uuid, uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.release_customer_owned_stock(_customer_id uuid, _product_id uuid, _warehouse_id uuid, _quantity numeric, _note text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_movement_id uuid;
  v_new_qty     numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'warehouse')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to release customer-owned material';
  END IF;

  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;

  v_new_qty := public.post_stock_delta(
    _product_id,
    _warehouse_id,
    -_quantity,                     -- leaving the premises
    0,
    'ISSUE'::public.stock_movement_kind,
    'customer_owned_delivery',
    NULL,
    coalesce(nullif(btrim(coalesce(_note, '')), ''), 'تسليم مادة مملوكة للعميل'),
    'CUSTOMER'::public.owner_type,
    _customer_id,
    'sale'::public.movement_type
  );

  SELECT id INTO v_movement_id
  FROM public.stock_movements
  WHERE product_id = _product_id
    AND warehouse_id = _warehouse_id
    AND owner_type = 'CUSTOMER'
    AND owner_id = _customer_id
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'customer_owned.released', 'customers', _customer_id,
    jsonb_build_object(
      'product_id', _product_id,
      'warehouse_id', _warehouse_id,
      'quantity', _quantity,
      'resulting_quantity', v_new_qty,
      'movement_id', v_movement_id
    ));

  RETURN v_movement_id;
END $$;

--
-- Name: resolve_unit_cost(uuid, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.resolve_unit_cost(p_product_id uuid, p_warehouse_id uuid DEFAULT NULL::uuid, p_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_method public.costing_method := public.company_costing_method();
  v_layer  record;
  v_cat    numeric;
  v_standard numeric;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Standard cost is a property of the item, not of the warehouse: the same
  -- standard applies everywhere, and that is what makes it a standard.
  IF v_method = 'STANDARD' THEN
    SELECT p.standard_cost
      INTO v_standard
      FROM public.products p
     WHERE p.id = p_product_id;

    IF v_standard IS NOT NULL THEN
      RETURN v_standard;
    END IF;
    -- No standard set yet: fall through to the layer, then to the catalogue.
    -- A zero would be worse than a reference, because zero margin hides a
    -- missing configuration instead of reporting it.
  END IF;

  -- Company-owned layer, optionally at a specific warehouse. Aggregated
  -- across warehouses when none is named, because a valuation belongs to the
  -- company unless the caller is asking about one silo.
  SELECT sum(cl.quantity)                                   AS qty,
         sum(cl.total_value)                                AS val,
         CASE WHEN sum(cl.quantity) <> 0
              THEN round(sum(cl.total_value) / sum(cl.quantity), 4)
              ELSE 0 END                                    AS avg_cost,
         bool_or(cl.valuation_method = 'STANDARD')          AS any_standard
    INTO v_layer
    FROM public.item_cost_layers cl
   WHERE cl.product_id = p_product_id
     AND cl.owner_type = 'COMPANY'::public.owner_type
     AND (p_warehouse_id IS NULL OR cl.warehouse_id = p_warehouse_id)
     AND (p_as_of IS NULL OR cl.updated_at <= p_as_of);

  IF v_layer.qty IS NOT NULL AND v_layer.qty <> 0 AND NOT v_layer.any_standard THEN
    RETURN v_layer.avg_cost;
  END IF;

  -- Last resort: the catalogue reference, clearly a reference and not an
  -- actual. Callers that report a margin must say so when this is what they
  -- used, which resolve_unit_cost signals by returning a cost with no
  -- supporting movement.
  SELECT p.cost_price INTO v_cat FROM public.products p WHERE p.id = p_product_id;
  RETURN coalesce(v_cat, 0);
END $$;

--
-- Name: save_item_policy(uuid, public.item_nature, public.inventory_policy, public.costing_method, public.item_tracking, boolean, boolean, uuid, uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.save_item_policy(_item_id uuid, _item_nature public.item_nature, _inventory_policy public.inventory_policy, _costing_method public.costing_method, _tracking public.item_tracking, _is_sellable boolean, _is_purchasable boolean, _base_uom_id uuid DEFAULT NULL::uuid, _sales_uom_id uuid DEFAULT NULL::uuid, _purchase_uom_id uuid DEFAULT NULL::uuid, _uom_conversions jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_product public.products%ROWTYPE;
  v_before  jsonb;
  v_after   jsonb;
  v_policy_changed boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'warehouse')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to edit item policy';
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % does not exist', _item_id;
  END IF;

  IF _item_nature = 'SERVICE' AND _inventory_policy <> 'UNTRACKED' THEN
    RAISE EXCEPTION 'A SERVICE can only be UNTRACKED';
  END IF;
  IF _inventory_policy = 'TRACKED' AND _costing_method = 'NONE' THEN
    RAISE EXCEPTION 'A TRACKED item requires a costing method other than NONE';
  END IF;
  IF _inventory_policy = 'UNTRACKED' AND _tracking <> 'NONE' THEN
    RAISE EXCEPTION 'An UNTRACKED item cannot require batch or serial tracking';
  END IF;
  IF NOT _is_sellable AND NOT _is_purchasable THEN
    RAISE EXCEPTION 'An item must be usable for selling, purchasing, or both';
  END IF;

  IF _uom_conversions IS NOT NULL AND jsonb_typeof(_uom_conversions) <> 'array' THEN
    RAISE EXCEPTION 'UOM conversions must be a JSON array';
  END IF;

  v_policy_changed :=
    _item_nature      IS DISTINCT FROM v_product.item_nature
    OR _inventory_policy IS DISTINCT FROM v_product.inventory_policy
    OR _costing_method   IS DISTINCT FROM v_product.costing_method
    OR _tracking         IS DISTINCT FROM v_product.tracking;

  -- When only the commercial flags or units change, no policy transition is
  -- happening and the plain path is enough.
  IF NOT v_policy_changed THEN
    UPDATE public.products
    SET is_sellable      = _is_sellable,
        is_purchasable   = _is_purchasable,
        base_uom_id      = _base_uom_id,
        sales_uom_id     = _sales_uom_id,
        purchase_uom_id  = _purchase_uom_id,
        uom_conversions  = coalesce(_uom_conversions, uom_conversions),
        updated_at       = now()
    WHERE id = _item_id;

    RETURN _item_id;
  END IF;

  -- A policy change is a governed transition. If the item has no history yet,
  -- the trigger allows the direct write; if it has history, the owner/manager
  -- rule applies and the change is audited.
  IF public.item_has_stock_history(_item_id) THEN
    IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')) THEN
      RAISE EXCEPTION
        'Item % has inventory history; only an owner or manager may change its policy',
        _item_id;
    END IF;

    v_before := jsonb_build_object(
      'item_nature', v_product.item_nature,
      'inventory_policy', v_product.inventory_policy,
      'costing_method', v_product.costing_method,
      'tracking', v_product.tracking
    );

    PERFORM set_config('app.allow_policy_change', 'on', true);
  END IF;

  UPDATE public.products
  SET item_nature      = _item_nature,
      inventory_policy = _inventory_policy,
      costing_method   = _costing_method,
      tracking         = _tracking,
      is_sellable      = _is_sellable,
      is_purchasable   = _is_purchasable,
      base_uom_id      = _base_uom_id,
      sales_uom_id     = _sales_uom_id,
      purchase_uom_id  = _purchase_uom_id,
      uom_conversions  = coalesce(_uom_conversions, uom_conversions),
      updated_at       = now()
  WHERE id = _item_id;

  IF v_before IS NOT NULL THEN
    v_after := jsonb_build_object(
      'item_nature', _item_nature,
      'inventory_policy', _inventory_policy,
      'costing_method', _costing_method,
      'tracking', _tracking
    );

    PERFORM public.audit_item_policy_snapshot(
      _item_id,
      'item_policy.changed',
      v_before,
      v_after,
      'item_editor'
    );
  END IF;

  RETURN _item_id;
END $$;

--
-- Name: save_product_batch(uuid, uuid, text, date, numeric, numeric, text, boolean, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.save_product_batch(p_product_id uuid, p_warehouse_id uuid, p_batch_number text, p_expiry_date date DEFAULT NULL::date, p_quantity numeric DEFAULT 0, p_unit_cost numeric DEFAULT 0, p_note text DEFAULT NULL::text, p_sync_inventory boolean DEFAULT true, p_batch_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id   uuid;
  v_old_qty numeric := 0;
  v_delta numeric := 0;
  v_product_tracked boolean;
  v_cost numeric := coalesce(p_unit_cost, 0);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Product is required for batch';
  END IF;
  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required for batch';
  END IF;
  IF p_batch_number IS NULL OR btrim(p_batch_number) = '' THEN
    RAISE EXCEPTION 'Batch number is required';
  END IF;
  IF p_quantity < 0 THEN
    RAISE EXCEPTION 'Batch quantity cannot be negative';
  END IF;
  IF v_cost < 0 THEN
    RAISE EXCEPTION 'Batch unit cost cannot be negative';
  END IF;

  SELECT (inventory_policy = 'TRACKED') INTO v_product_tracked
  FROM public.products WHERE id = p_product_id;

  IF p_batch_id IS NOT NULL THEN
    -- Editing existing batch
    SELECT id, quantity INTO v_id, v_old_qty
    FROM public.product_batches
    WHERE id = p_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Batch % not found', p_batch_id;
    END IF;

    UPDATE public.product_batches
    SET product_id = p_product_id,
        warehouse_id = p_warehouse_id,
        batch_number = btrim(p_batch_number),
        expiry_date = p_expiry_date,
        quantity = p_quantity,
        unit_cost = v_cost,
        note = nullif(btrim(p_note), ''),
        updated_at = now()
    WHERE id = v_id;

    v_delta := p_quantity - v_old_qty;
  ELSE
    -- Creating new batch
    SELECT id, quantity INTO v_id, v_old_qty
    FROM public.product_batches
    WHERE product_id = p_product_id
      AND warehouse_id = p_warehouse_id
      AND batch_number = btrim(p_batch_number)
    FOR UPDATE;

    IF FOUND THEN
      -- Existing batch number for same product and warehouse
      UPDATE public.product_batches
      SET quantity = round(quantity + p_quantity, 3),
          unit_cost = CASE WHEN v_cost > 0 THEN v_cost ELSE unit_cost END,
          expiry_date = coalesce(p_expiry_date, expiry_date),
          note = coalesce(nullif(btrim(p_note), ''), note),
          updated_at = now()
      WHERE id = v_id;

      v_delta := p_quantity;
    ELSE
      INSERT INTO public.product_batches (
        product_id, warehouse_id, batch_number, expiry_date, quantity, unit_cost, note, created_by
      )
      VALUES (
        p_product_id, p_warehouse_id, btrim(p_batch_number), p_expiry_date,
        p_quantity, v_cost, nullif(btrim(p_note), ''), v_user
      )
      RETURNING id INTO v_id;

      v_delta := p_quantity;
    END IF;
  END IF;

  -- Sync with inventory ledger if enabled
  IF p_sync_inventory AND v_delta <> 0 AND coalesce(v_product_tracked, true) THEN
    PERFORM public.post_stock_delta(
      p_product_id,
      p_warehouse_id,
      v_delta,
      v_cost,
      CASE WHEN v_delta > 0 THEN 'RECEIPT'::public.stock_movement_kind ELSE 'ADJUSTMENT'::public.stock_movement_kind END,
      'product_batch',
      v_id,
      CASE WHEN v_delta > 0 THEN 'توريد دفعة: ' || btrim(p_batch_number) ELSE 'تعديل دفعة: ' || btrim(p_batch_number) END,
      'COMPANY'::public.owner_type,
      NULL,
      CASE WHEN v_delta > 0 THEN 'purchase'::public.movement_type ELSE 'adjustment'::public.movement_type END
    );
  END IF;

  RETURN v_id;
END $$;

--
-- Name: set_company_costing_method(text, text, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.set_company_costing_method(_method text, _source text, _notes text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_old public.costing_method;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')) THEN
    RAISE EXCEPTION 'Only an owner or manager can change the company costing method';
  END IF;

  _method := upper(btrim(coalesce(_method, '')));
  IF _method <> 'MOVING_AVERAGE' THEN
    RAISE EXCEPTION
      'Only MOVING_AVERAGE is currently available. FIFO valuation layers and standard cost variance posting are not complete.'
      USING ERRCODE = '22023';
  END IF;

  SELECT costing_method INTO v_old
    FROM public.company_costing_settings
   WHERE id = 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company costing settings row is missing';
  END IF;
  IF v_old = 'MOVING_AVERAGE'::public.costing_method THEN
    RETURN;
  END IF;

  IF EXISTS (
       SELECT 1
         FROM public.inventory i
        WHERE i.owner_type = 'COMPANY'::public.owner_type
          AND i.quantity <> 0
     ) OR EXISTS (
       SELECT 1
         FROM public.item_cost_layers cl
        WHERE cl.owner_type = 'COMPANY'::public.owner_type
          AND (cl.quantity <> 0 OR cl.total_value <> 0)
     ) THEN
    RAISE EXCEPTION
      'Cannot switch the saved costing method while company stock or non-zero cost layers exist. Reconcile the balances before changing the valuation method.'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.company_costing_settings
     SET costing_method = 'MOVING_AVERAGE'::public.costing_method,
         effective_from = CURRENT_DATE,
         updated_by = v_user,
         updated_at = now(),
         notes = nullif(btrim(coalesce(_notes, '')), '')
   WHERE id = 1;

  INSERT INTO public.costing_policy_history
    (costing_method, previous_method, reason, changed_by)
  VALUES
    ('MOVING_AVERAGE'::public.costing_method, v_old,
     nullif(btrim(coalesce(_notes, '')), ''), v_user);
END;
$$;

--
-- Name: sync_product_base_uom(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.sync_product_base_uom() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_base_unit uuid := coalesce(NEW.base_uom_id, NEW.unit_id);
  v_product_uom_id uuid;
  v_old_base uuid;
  v_legacy_barcode text;
  v_increment numeric;
  v_sales_default_unit uuid;
  v_purchase_default_unit uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_base := coalesce(OLD.base_uom_id, OLD.unit_id);
    IF v_old_base IS DISTINCT FROM v_base_unit
       AND public.item_has_stock_history(NEW.id) THEN
      RAISE EXCEPTION 'Base unit cannot change after item stock history exists; use an approved stock conversion document'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF v_base_unit IS NULL THEN
    IF TG_OP = 'UPDATE' AND v_old_base IS NOT NULL THEN
      UPDATE public.product_uoms
         SET is_active = false, is_base = false,
             is_default_sale = false, is_default_purchase = false,
             updated_at = now()
       WHERE product_id = NEW.id AND unit_id = v_old_base;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND v_old_base IS DISTINCT FROM v_base_unit THEN
    UPDATE public.product_uoms
       SET is_active = false, is_base = false,
           is_default_sale = false, is_default_purchase = false,
           can_sell = false, can_purchase = false, updated_at = now()
     WHERE product_id = NEW.id AND unit_id = v_old_base;
    UPDATE public.product_uom_barcodes
       SET is_active = false, is_primary = false
     WHERE product_id = NEW.id AND product_uom_id IN (
       SELECT id FROM public.product_uoms WHERE product_id = NEW.id AND unit_id = v_old_base
     );
  END IF;

  -- When a product is no longer eligible for one direction, disable all its
  -- UoMs in that direction. Re-enabling restores only the base UoM as default.
  IF NOT NEW.is_sellable THEN
    UPDATE public.product_uoms SET can_sell = false, is_default_sale = false, updated_at = now()
     WHERE product_id = NEW.id AND (can_sell OR is_default_sale);
  END IF;
  IF NOT NEW.is_purchasable THEN
    UPDATE public.product_uoms SET can_purchase = false, is_default_purchase = false, updated_at = now()
     WHERE product_id = NEW.id AND (can_purchase OR is_default_purchase);
  END IF;

  IF NEW.is_sellable THEN
    SELECT pu.unit_id INTO v_sales_default_unit
      FROM public.product_uoms pu
     WHERE pu.product_id = NEW.id AND pu.unit_id = NEW.sales_uom_id
       AND pu.is_active AND pu.can_sell;
    v_sales_default_unit := coalesce(v_sales_default_unit, v_base_unit);
    UPDATE public.product_uoms SET is_default_sale = false, updated_at = now()
     WHERE product_id = NEW.id AND is_default_sale;
    UPDATE public.product_uoms SET is_default_sale = true, updated_at = now()
     WHERE product_id = NEW.id AND unit_id = v_sales_default_unit AND is_active AND can_sell;
  END IF;
  IF NEW.is_purchasable THEN
    SELECT pu.unit_id INTO v_purchase_default_unit
      FROM public.product_uoms pu
     WHERE pu.product_id = NEW.id AND pu.unit_id = NEW.purchase_uom_id
       AND pu.is_active AND pu.can_purchase;
    v_purchase_default_unit := coalesce(v_purchase_default_unit, v_base_unit);
    UPDATE public.product_uoms SET is_default_purchase = false, updated_at = now()
     WHERE product_id = NEW.id AND is_default_purchase;
    UPDATE public.product_uoms SET is_default_purchase = true, updated_at = now()
     WHERE product_id = NEW.id AND unit_id = v_purchase_default_unit AND is_active AND can_purchase;
  END IF;

  SELECT CASE WHEN u.dimension_code IN ('COUNT', 'PACKAGING') THEN 1 ELSE 0.001 END
    INTO v_increment
    FROM public.units u WHERE u.id = v_base_unit;
  v_increment := coalesce(v_increment, 0.001);

  INSERT INTO public.product_uoms (
    product_id, unit_id, factor_to_base, conversion_basis, conversion_note, quantity_increment,
    can_purchase, can_sell, is_default_purchase, is_default_sale,
    is_base, is_active, updated_at
  ) VALUES (
    NEW.id, v_base_unit, 1, 'STANDARD', NULL, v_increment,
    NEW.is_purchasable,
    NEW.is_sellable,
    NEW.is_purchasable AND v_purchase_default_unit = v_base_unit,
    NEW.is_sellable AND v_sales_default_unit = v_base_unit,
    true, true, now()
  )
  ON CONFLICT (product_id, unit_id) DO UPDATE SET
    factor_to_base = 1,
    can_purchase = EXCLUDED.can_purchase,
    can_sell = EXCLUDED.can_sell,
    is_default_purchase = EXCLUDED.is_default_purchase,
    is_default_sale = EXCLUDED.is_default_sale,
    is_base = true,
    is_active = true,
    updated_at = now()
  RETURNING id INTO v_product_uom_id;

  v_legacy_barcode := nullif(btrim(coalesce(NEW.barcode, '')), '');
  IF TG_OP = 'UPDATE' THEN
    IF OLD.barcode IS DISTINCT FROM NEW.barcode THEN
      UPDATE public.product_uom_barcodes
         SET is_active = false, is_primary = false
       WHERE company_id = 1 AND product_id = NEW.id
         AND barcode = btrim(coalesce(OLD.barcode, ''));
    END IF;
  END IF;

  IF v_legacy_barcode IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.company_settings cs WHERE cs.id = 1) THEN
    IF EXISTS (
      SELECT 1 FROM public.product_uom_barcodes b
       WHERE b.company_id = 1 AND b.barcode = v_legacy_barcode AND b.product_id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'Barcode % is already assigned to a unit of another item', v_legacy_barcode
        USING ERRCODE = '23505';
    END IF;
    UPDATE public.product_uom_barcodes
       SET is_primary = false
     WHERE company_id = 1 AND product_uom_id = v_product_uom_id
       AND is_active AND barcode <> v_legacy_barcode AND is_primary;
    INSERT INTO public.product_uom_barcodes (
      company_id, product_id, product_uom_id, barcode, is_primary, is_active
    ) VALUES (1, NEW.id, v_product_uom_id, v_legacy_barcode, true, true)
    ON CONFLICT (company_id, barcode) DO UPDATE SET
      product_id = EXCLUDED.product_id,
      product_uom_id = EXCLUDED.product_uom_id,
      is_primary = true,
      is_active = true;
  END IF;

  RETURN NEW;
END;
$$;

--
-- Name: tg_guard_item_policy_change(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.tg_guard_item_policy_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_allow text := current_setting('app.allow_policy_change', true);
BEGIN
  IF v_allow = 'on' THEN
    RETURN NEW;
  END IF;

  -- Nature and policy changes are both restricted once history exists.
  IF NEW.inventory_policy IS DISTINCT FROM OLD.inventory_policy
     OR NEW.item_nature IS DISTINCT FROM OLD.item_nature
     OR NEW.costing_method IS DISTINCT FROM OLD.costing_method
  THEN
    IF public.item_has_stock_history(OLD.id) THEN
      RAISE EXCEPTION
        'Item % has inventory history; policy changes must go through approve_item_policy_change()',
        OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Rule 2 enforced again at the transition point: an item with history can
  -- never become a SERVICE, because that would retroactively re-label real
  -- stock movements as a non-stock service.
  IF NEW.item_nature = 'SERVICE' AND OLD.item_nature <> 'SERVICE' THEN
    IF public.item_has_stock_history(OLD.id) THEN
      RAISE EXCEPTION
        'Item % has inventory history and cannot be converted to SERVICE', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END $$;

--
-- Name: tg_stock_movements_engine_only(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.tg_stock_movements_engine_only() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF coalesce(current_setting('app.stock_engine', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    'Stock movements must be posted through post_stock_delta so quantity and cost stay in step'
    USING ERRCODE = 'restrict_violation';
END $$;

--
-- Name: update_opening_balance(uuid, date, jsonb, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.update_opening_balance(_document_id uuid, _effective_date date, _lines jsonb, _notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_doc record;
  l jsonb;
  v_section text;
  v_side text;
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')
      OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may edit opening balances';
  END IF;
  IF _effective_date IS NULL THEN RAISE EXCEPTION 'Effective date is required'; END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'An opening entry needs at least one line';
  END IF;

  SELECT * INTO v_doc FROM public.opening_balance_documents WHERE id = _document_id FOR UPDATE;
  IF NOT FOUND OR v_doc.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only a draft opening document can be edited';
  END IF;

  UPDATE public.opening_balance_documents
    SET effective_date = _effective_date,
        fiscal_year = EXTRACT(YEAR FROM _effective_date)::int,
        notes = nullif(btrim(coalesce(_notes, '')), '')
    WHERE id = _document_id;
  DELETE FROM public.opening_balance_lines WHERE document_id = _document_id;

  FOR l IN SELECT * FROM jsonb_array_elements(_lines)
  LOOP
    v_section := l->>'section';
    IF v_section NOT IN ('STOCK','RECEIVABLE','PAYABLE','CASH','BANK','ASSET','LIABILITY','CAPITAL') THEN
      RAISE EXCEPTION 'Unknown opening section: %', v_section;
    END IF;
    v_side := CASE WHEN v_section IN ('STOCK','RECEIVABLE','CASH','BANK','ASSET')
                   THEN 'DEBIT' ELSE 'CREDIT' END;
    IF coalesce((l->>'amount')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Line amount must be greater than zero (section %)', v_section;
    END IF;
    IF v_section = 'STOCK' AND ((l->>'product_id') IS NULL OR (l->>'warehouse_id') IS NULL
       OR coalesce((l->>'quantity')::numeric, 0) <= 0) THEN
      RAISE EXCEPTION 'Stock opening line requires an item, warehouse and positive quantity';
    END IF;
    IF v_section = 'RECEIVABLE' AND (l->>'customer_id') IS NULL THEN
      RAISE EXCEPTION 'Receivable opening line requires a customer';
    END IF;
    IF v_section = 'PAYABLE' AND (l->>'supplier_id') IS NULL THEN
      RAISE EXCEPTION 'Payable opening line requires a supplier';
    END IF;

    INSERT INTO public.opening_balance_lines
      (document_id, section, side, ref_type, ref_id, product_id, warehouse_id,
       customer_id, supplier_id, description, quantity, unit_cost, amount, ledger_account_code)
    VALUES
      (_document_id, v_section, v_side, l->>'ref_type', (l->>'ref_id')::uuid,
       (l->>'product_id')::uuid, (l->>'warehouse_id')::uuid,
       (l->>'customer_id')::uuid, (l->>'supplier_id')::uuid,
       coalesce(nullif(btrim(coalesce(l->>'description', '')), ''), v_section),
       (l->>'quantity')::numeric, (l->>'unit_cost')::numeric,
       (l->>'amount')::numeric, nullif(btrim(l->>'ledger_account_code'), ''));
  END LOOP;
  RETURN _document_id;
END;
$$;

--
-- Name: stock_positions; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.stock_positions WITH (security_invoker='true') AS
 SELECT i.product_id AS item_id,
    i.warehouse_id,
    i.owner_type,
    i.owner_id,
    i.quantity,
    p.item_nature,
    COALESCE(ci.inventory_policy, p.inventory_policy) AS inventory_policy,
    p.costing_method,
    COALESCE(ci.default_cost, p.cost_price, (0)::numeric) AS reference_unit_cost,
        CASE
            WHEN ((i.owner_type = 'COMPANY'::public.owner_type) AND (COALESCE(ci.inventory_policy, p.inventory_policy) = 'TRACKED'::public.inventory_policy)) THEN round((i.quantity * COALESCE(ci.default_cost, p.cost_price, (0)::numeric)), 2)
            ELSE (0)::numeric
        END AS reference_valuation,
    (i.owner_type = 'COMPANY'::public.owner_type) AS is_company_owned,
    w.name AS warehouse_name,
    w.name_ar AS warehouse_name_ar,
    p.name AS item_name,
    p.name_ar AS item_name_ar,
    p.sku
   FROM (((public.inventory i
     JOIN public.products p ON ((p.id = i.product_id)))
     JOIN public.warehouses w ON ((w.id = i.warehouse_id)))
     LEFT JOIN public.company_items ci ON (((ci.item_id = p.id) AND (ci.company_id = 1) AND ci.is_active)));

--
-- Name: item_cost_layers; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.item_cost_layers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    owner_type public.owner_type DEFAULT 'COMPANY'::public.owner_type NOT NULL,
    owner_id uuid,
    quantity numeric(18,3) DEFAULT 0 NOT NULL,
    total_value numeric(18,2) DEFAULT 0 NOT NULL,
    valuation_method public.costing_method DEFAULT 'MOVING_AVERAGE'::public.costing_method NOT NULL,
    last_unit_cost numeric(18,4) DEFAULT 0 NOT NULL,
    last_movement_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: item_cost_transactions; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.item_cost_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    owner_type public.owner_type DEFAULT 'COMPANY'::public.owner_type NOT NULL,
    owner_id uuid,
    direction text NOT NULL,
    quantity numeric(18,3) NOT NULL,
    unit_cost numeric(18,4) NOT NULL,
    value numeric(18,2) NOT NULL,
    method public.costing_method NOT NULL,
    quantity_before numeric(18,3) NOT NULL,
    value_before numeric(18,2) NOT NULL,
    quantity_after numeric(18,3) NOT NULL,
    value_after numeric(18,2) NOT NULL,
    source_type text,
    source_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_cost_transactions_direction_check CHECK ((direction = ANY (ARRAY['IN'::text, 'OUT'::text, 'REVALUE'::text])))
);

--
-- Name: opening_balance_documents; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.opening_balance_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_number text NOT NULL,
    effective_date date NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    fiscal_year integer NOT NULL,
    total_assets numeric(18,2) DEFAULT 0 NOT NULL,
    total_liabilities numeric(18,2) DEFAULT 0 NOT NULL,
    capital_required numeric(18,2),
    reverses_document_id uuid,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    posted_by uuid,
    posted_at timestamp with time zone,
    CONSTRAINT opening_balance_documents_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'POSTED'::text, 'REVERSED'::text]))),
    CONSTRAINT opening_balance_posted_has_date CHECK (((status = 'DRAFT'::text) OR (posted_at IS NOT NULL))),
    CONSTRAINT opening_balance_documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
    CONSTRAINT opening_balance_documents_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES auth.users(id)
);

--
-- Name: opening_balance_lines; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.opening_balance_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    section text NOT NULL,
    side text NOT NULL,
    ref_type text,
    ref_id uuid,
    product_id uuid,
    warehouse_id uuid,
    customer_id uuid,
    supplier_id uuid,
    description text NOT NULL,
    quantity numeric(18,3),
    unit_cost numeric(18,4),
    amount numeric(18,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ledger_account_code text,
    CONSTRAINT opening_balance_lines_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT opening_balance_lines_section_check CHECK ((section = ANY (ARRAY['STOCK'::text, 'RECEIVABLE'::text, 'PAYABLE'::text, 'CASH'::text, 'BANK'::text, 'ASSET'::text, 'LIABILITY'::text, 'CAPITAL'::text]))),
    CONSTRAINT opening_balance_lines_side_check CHECK ((side = ANY (ARRAY['DEBIT'::text, 'CREDIT'::text]))),
    CONSTRAINT opening_balance_lines_stock_shape CHECK (((section <> 'STOCK'::text) OR ((product_id IS NOT NULL) AND (warehouse_id IS NOT NULL) AND (quantity IS NOT NULL))))
);

--
-- Name: opening_balance_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.opening_balance_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: stock_adjustment_items; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.stock_adjustment_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    adjustment_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric(14,3) NOT NULL,
    unit_cost numeric(14,2) DEFAULT 0 NOT NULL,
    total_cost numeric(14,2) DEFAULT 0 NOT NULL,
    note text,
    CONSTRAINT stock_adjustment_items_quantity_check CHECK ((quantity <> (0)::numeric)),
    CONSTRAINT stock_adjustment_items_unit_cost_check CHECK ((unit_cost >= (0)::numeric))
);

--
-- Name: stock_adjustment_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.stock_adjustment_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: stock_adjustments; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.stock_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_number text NOT NULL,
    warehouse_id uuid NOT NULL,
    effective_date date DEFAULT CURRENT_DATE NOT NULL,
    reason text NOT NULL,
    note text,
    total_value numeric(14,2) DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_adjustments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    movement_type public.movement_type NOT NULL,
    quantity numeric(14,3) NOT NULL,
    unit_cost numeric(14,2),
    reference text,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reference_type text,
    reference_id uuid,
    adjustment_reason text,
    movement_kind public.stock_movement_kind,
    source_type text,
    source_id uuid,
    total_cost numeric(14,2),
    owner_type public.owner_type DEFAULT 'COMPANY'::public.owner_type NOT NULL,
    owner_id uuid,
    production_order_id uuid,
    CONSTRAINT stock_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: stock_opening_items; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.stock_opening_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    opening_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric(14,3) NOT NULL,
    unit_cost numeric(14,2) DEFAULT 0 NOT NULL,
    total_cost numeric(14,2) DEFAULT 0 NOT NULL,
    note text,
    CONSTRAINT stock_opening_items_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT stock_opening_items_unit_cost_check CHECK ((unit_cost >= (0)::numeric))
);

--
-- Name: stock_opening_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.stock_opening_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: stock_openings; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.stock_openings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_number text NOT NULL,
    warehouse_id uuid NOT NULL,
    effective_date date DEFAULT CURRENT_DATE NOT NULL,
    note text,
    total_value numeric(14,2) DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_openings_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: stock_transfer_items; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.stock_transfer_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transfer_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric NOT NULL,
    CONSTRAINT stock_transfer_items_quantity_check CHECK ((quantity > (0)::numeric))
);

--
-- Name: stock_transfer_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.stock_transfer_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: stock_transfers; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.stock_transfers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transfer_number text NOT NULL,
    from_warehouse_id uuid NOT NULL,
    to_warehouse_id uuid NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    document_number text GENERATED ALWAYS AS (transfer_number) STORED,
    CONSTRAINT stock_transfers_check CHECK ((from_warehouse_id <> to_warehouse_id)),
    CONSTRAINT stock_transfers_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);


--
-- Name: FUNCTION apply_cost_movement(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_incoming_cost numeric, p_source_type text, p_source_id uuid, p_note text, p_owner_type public.owner_type, p_owner_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.apply_cost_movement(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_incoming_cost numeric, p_source_type text, p_source_id uuid, p_note text, p_owner_type public.owner_type, p_owner_id uuid) IS 'Internal moving-average valuation writer. Company movements fail closed when an unsupported costing method remains saved; customer-owned material never uses company costing policy.';

--
-- Name: FUNCTION apply_cost_movement(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_incoming_cost numeric, p_source_type text, p_source_id uuid, p_note text, p_owner_type public.owner_type, p_owner_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.apply_cost_movement(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_incoming_cost numeric, p_source_type text, p_source_id uuid, p_note text, p_owner_type public.owner_type, p_owner_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.apply_cost_movement(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_incoming_cost numeric, p_source_type text, p_source_id uuid, p_note text, p_owner_type public.owner_type, p_owner_id uuid) TO service_role;


--
-- Name: FUNCTION create_opening_balance(_effective_date date, _lines jsonb, _notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_opening_balance(_effective_date date, _lines jsonb, _notes text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_opening_balance(_effective_date date, _lines jsonb, _notes text) TO service_role;

GRANT ALL ON FUNCTION public.create_opening_balance(_effective_date date, _lines jsonb, _notes text) TO authenticated;


--
-- Name: FUNCTION delete_product_batch(p_batch_id uuid, p_sync_inventory boolean); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.delete_product_batch(p_batch_id uuid, p_sync_inventory boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.delete_product_batch(p_batch_id uuid, p_sync_inventory boolean) TO service_role;

GRANT ALL ON FUNCTION public.delete_product_batch(p_batch_id uuid, p_sync_inventory boolean) TO authenticated;


--
-- Name: FUNCTION get_batch_kpis(p_warning_days integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.get_batch_kpis(p_warning_days integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_batch_kpis(p_warning_days integer) TO service_role;

GRANT ALL ON FUNCTION public.get_batch_kpis(p_warning_days integer) TO authenticated;


--
-- Name: FUNCTION guard_company_stock_movement_scope(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.guard_company_stock_movement_scope() FROM PUBLIC;


--
-- Name: FUNCTION item_stock_effect(p_item_id uuid, p_direction text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.item_stock_effect(p_item_id uuid, p_direction text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.item_stock_effect(p_item_id uuid, p_direction text) TO service_role;

GRANT ALL ON FUNCTION public.item_stock_effect(p_item_id uuid, p_direction text) TO authenticated;


--
-- Name: FUNCTION next_stock_adjustment_number(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.next_stock_adjustment_number() FROM PUBLIC;

GRANT ALL ON FUNCTION public.next_stock_adjustment_number() TO service_role;


--
-- Name: FUNCTION next_stock_opening_number(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.next_stock_opening_number() FROM PUBLIC;

GRANT ALL ON FUNCTION public.next_stock_opening_number() TO service_role;


--
-- Name: FUNCTION post_opening_stock(_warehouse_id uuid, _effective_date date, _note text, _items jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.post_opening_stock(_warehouse_id uuid, _effective_date date, _note text, _items jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.post_opening_stock(_warehouse_id uuid, _effective_date date, _note text, _items jsonb) TO service_role;

GRANT ALL ON FUNCTION public.post_opening_stock(_warehouse_id uuid, _effective_date date, _note text, _items jsonb) TO authenticated;


--
-- Name: FUNCTION post_stock_delta(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_unit_cost numeric, p_movement_kind public.stock_movement_kind, p_source_type text, p_source_id uuid, p_note text, p_owner_type public.owner_type, p_owner_id uuid, p_movement_type_legacy public.movement_type); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.post_stock_delta(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_unit_cost numeric, p_movement_kind public.stock_movement_kind, p_source_type text, p_source_id uuid, p_note text, p_owner_type public.owner_type, p_owner_id uuid, p_movement_type_legacy public.movement_type) IS 'Posts quantity and exact valuation-layer value atomically; receipts and issues both record the layer value change.';

--
-- Name: FUNCTION post_stock_delta(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_unit_cost numeric, p_movement_kind public.stock_movement_kind, p_source_type text, p_source_id uuid, p_note text, p_owner_type public.owner_type, p_owner_id uuid, p_movement_type_legacy public.movement_type); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.post_stock_delta(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_unit_cost numeric, p_movement_kind public.stock_movement_kind, p_source_type text, p_source_id uuid, p_note text, p_owner_type public.owner_type, p_owner_id uuid, p_movement_type_legacy public.movement_type) FROM PUBLIC;

GRANT ALL ON FUNCTION public.post_stock_delta(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_unit_cost numeric, p_movement_kind public.stock_movement_kind, p_source_type text, p_source_id uuid, p_note text, p_owner_type public.owner_type, p_owner_id uuid, p_movement_type_legacy public.movement_type) TO service_role;


--
-- Name: FUNCTION post_stock_settlement(p_warehouse_id uuid, p_reason text, p_note text, p_lines jsonb); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.post_stock_settlement(p_warehouse_id uuid, p_reason text, p_note text, p_lines jsonb) IS 'T-47: اعتماد تسوية جردية — مستند + حركات عبر المحرّك (كمية وقيمة) في معاملة واحدة. تستبدل الكتابة المباشرة على inventory/stock_movements من الواجهة.';

--
-- Name: FUNCTION post_stock_settlement(p_warehouse_id uuid, p_reason text, p_note text, p_lines jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.post_stock_settlement(p_warehouse_id uuid, p_reason text, p_note text, p_lines jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.post_stock_settlement(p_warehouse_id uuid, p_reason text, p_note text, p_lines jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.post_stock_settlement(p_warehouse_id uuid, p_reason text, p_note text, p_lines jsonb) TO service_role;


--
-- Name: FUNCTION receive_customer_owned_stock(_customer_id uuid, _product_id uuid, _warehouse_id uuid, _quantity numeric, _unit_cost numeric, _note text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.receive_customer_owned_stock(_customer_id uuid, _product_id uuid, _warehouse_id uuid, _quantity numeric, _unit_cost numeric, _note text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.receive_customer_owned_stock(_customer_id uuid, _product_id uuid, _warehouse_id uuid, _quantity numeric, _unit_cost numeric, _note text) TO service_role;

GRANT ALL ON FUNCTION public.receive_customer_owned_stock(_customer_id uuid, _product_id uuid, _warehouse_id uuid, _quantity numeric, _unit_cost numeric, _note text) TO authenticated;


--
-- Name: FUNCTION reconcile_batches_with_inventory(p_warehouse_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.reconcile_batches_with_inventory(p_warehouse_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.reconcile_batches_with_inventory(p_warehouse_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.reconcile_batches_with_inventory(p_warehouse_id uuid) TO authenticated;


--
-- Name: FUNCTION release_customer_owned_stock(_customer_id uuid, _product_id uuid, _warehouse_id uuid, _quantity numeric, _note text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.release_customer_owned_stock(_customer_id uuid, _product_id uuid, _warehouse_id uuid, _quantity numeric, _note text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.release_customer_owned_stock(_customer_id uuid, _product_id uuid, _warehouse_id uuid, _quantity numeric, _note text) TO service_role;

GRANT ALL ON FUNCTION public.release_customer_owned_stock(_customer_id uuid, _product_id uuid, _warehouse_id uuid, _quantity numeric, _note text) TO authenticated;


--
-- Name: FUNCTION resolve_unit_cost(p_product_id uuid, p_warehouse_id uuid, p_as_of timestamp with time zone); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.resolve_unit_cost(p_product_id uuid, p_warehouse_id uuid, p_as_of timestamp with time zone) FROM PUBLIC;

GRANT ALL ON FUNCTION public.resolve_unit_cost(p_product_id uuid, p_warehouse_id uuid, p_as_of timestamp with time zone) TO service_role;

GRANT ALL ON FUNCTION public.resolve_unit_cost(p_product_id uuid, p_warehouse_id uuid, p_as_of timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION save_item_policy(_item_id uuid, _item_nature public.item_nature, _inventory_policy public.inventory_policy, _costing_method public.costing_method, _tracking public.item_tracking, _is_sellable boolean, _is_purchasable boolean, _base_uom_id uuid, _sales_uom_id uuid, _purchase_uom_id uuid, _uom_conversions jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.save_item_policy(_item_id uuid, _item_nature public.item_nature, _inventory_policy public.inventory_policy, _costing_method public.costing_method, _tracking public.item_tracking, _is_sellable boolean, _is_purchasable boolean, _base_uom_id uuid, _sales_uom_id uuid, _purchase_uom_id uuid, _uom_conversions jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.save_item_policy(_item_id uuid, _item_nature public.item_nature, _inventory_policy public.inventory_policy, _costing_method public.costing_method, _tracking public.item_tracking, _is_sellable boolean, _is_purchasable boolean, _base_uom_id uuid, _sales_uom_id uuid, _purchase_uom_id uuid, _uom_conversions jsonb) TO service_role;

GRANT ALL ON FUNCTION public.save_item_policy(_item_id uuid, _item_nature public.item_nature, _inventory_policy public.inventory_policy, _costing_method public.costing_method, _tracking public.item_tracking, _is_sellable boolean, _is_purchasable boolean, _base_uom_id uuid, _sales_uom_id uuid, _purchase_uom_id uuid, _uom_conversions jsonb) TO authenticated;


--
-- Name: FUNCTION save_product_batch(p_product_id uuid, p_warehouse_id uuid, p_batch_number text, p_expiry_date date, p_quantity numeric, p_unit_cost numeric, p_note text, p_sync_inventory boolean, p_batch_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.save_product_batch(p_product_id uuid, p_warehouse_id uuid, p_batch_number text, p_expiry_date date, p_quantity numeric, p_unit_cost numeric, p_note text, p_sync_inventory boolean, p_batch_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.save_product_batch(p_product_id uuid, p_warehouse_id uuid, p_batch_number text, p_expiry_date date, p_quantity numeric, p_unit_cost numeric, p_note text, p_sync_inventory boolean, p_batch_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.save_product_batch(p_product_id uuid, p_warehouse_id uuid, p_batch_number text, p_expiry_date date, p_quantity numeric, p_unit_cost numeric, p_note text, p_sync_inventory boolean, p_batch_id uuid) TO authenticated;


--
-- Name: FUNCTION set_company_costing_method(_method text, _source text, _notes text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.set_company_costing_method(_method text, _source text, _notes text) IS 'Allows only the supported company-wide moving-average method until FIFO and standard valuation are fully integrated.';

--
-- Name: FUNCTION set_company_costing_method(_method text, _source text, _notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.set_company_costing_method(_method text, _source text, _notes text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.set_company_costing_method(_method text, _source text, _notes text) TO service_role;


--
-- Name: products products_sync_base_uom_insert; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER products_sync_base_uom_insert AFTER INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.sync_product_base_uom();

--
-- Name: products products_sync_base_uom_update; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER products_sync_base_uom_update AFTER UPDATE OF unit_id, base_uom_id, sales_uom_id, purchase_uom_id, sale_price, cost_price, barcode, is_sellable, is_purchasable ON public.products FOR EACH ROW EXECUTE FUNCTION public.sync_product_base_uom();

--
-- Name: FUNCTION sync_product_base_uom(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.sync_product_base_uom() FROM PUBLIC;

GRANT ALL ON FUNCTION public.sync_product_base_uom() TO service_role;


--
-- Name: products products_guard_policy_change; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER products_guard_policy_change BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.tg_guard_item_policy_change();

--
-- Name: FUNCTION tg_guard_item_policy_change(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.tg_guard_item_policy_change() FROM PUBLIC;

GRANT ALL ON FUNCTION public.tg_guard_item_policy_change() TO service_role;


--
-- Name: FUNCTION update_opening_balance(_document_id uuid, _effective_date date, _lines jsonb, _notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.update_opening_balance(_document_id uuid, _effective_date date, _lines jsonb, _notes text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.update_opening_balance(_document_id uuid, _effective_date date, _lines jsonb, _notes text) TO authenticated;

GRANT ALL ON FUNCTION public.update_opening_balance(_document_id uuid, _effective_date date, _lines jsonb, _notes text) TO service_role;


--
-- Name: company_stock_positions; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.company_stock_positions WITH (security_invoker='true') AS
 SELECT item_id,
    warehouse_id,
    owner_type,
    owner_id,
    quantity,
    item_nature,
    inventory_policy,
    costing_method,
    reference_unit_cost,
    reference_valuation,
    is_company_owned,
    warehouse_name,
    warehouse_name_ar,
    item_name,
    item_name_ar,
    sku
   FROM public.stock_positions
  WHERE ((owner_type = 'COMPANY'::public.owner_type) AND (inventory_policy = 'TRACKED'::public.inventory_policy));

--
-- Name: customer_owned_positions; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.customer_owned_positions WITH (security_invoker='true') AS
 SELECT item_id,
    warehouse_id,
    owner_type,
    owner_id,
    quantity,
    item_nature,
    inventory_policy,
    costing_method,
    reference_unit_cost,
    reference_valuation,
    is_company_owned,
    warehouse_name,
    warehouse_name_ar,
    item_name,
    item_name_ar,
    sku
   FROM public.stock_positions
  WHERE (owner_type <> 'COMPANY'::public.owner_type);

--
-- Name: TABLE stock_positions; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.stock_positions TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.stock_positions TO service_role;


--
-- Name: item_valuation; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.item_valuation WITH (security_invoker='true') AS
 WITH qty AS (
         SELECT inventory.product_id,
            sum(inventory.quantity) AS on_hand_qty
           FROM public.inventory
          WHERE (inventory.owner_type = 'COMPANY'::public.owner_type)
          GROUP BY inventory.product_id
        ), val AS (
         SELECT cl.product_id,
            sum(cl.total_value) AS valuation,
            count(*) FILTER (WHERE (cl.total_value > (0)::numeric)) AS valued_layers
           FROM public.item_cost_layers cl
          WHERE (cl.owner_type = 'COMPANY'::public.owner_type)
          GROUP BY cl.product_id
        )
 SELECT p.id AS product_id,
    p.sku,
    p.name_ar,
    p.item_class,
    COALESCE(q.on_hand_qty, (0)::numeric) AS on_hand_qty,
    COALESCE(v.valuation, (0)::numeric) AS valuation,
        CASE
            WHEN (COALESCE(q.on_hand_qty, (0)::numeric) <> (0)::numeric) THEN round((COALESCE(v.valuation, (0)::numeric) / q.on_hand_qty), 4)
            ELSE (0)::numeric
        END AS actual_unit_cost,
        CASE
            WHEN ((v.valued_layers IS NULL) OR (v.valued_layers = 0)) THEN 'REFERENCE_ONLY'::text
            ELSE 'ACTUAL'::text
        END AS valuation_basis,
    p.cost_price AS catalogue_cost,
    p.standard_cost
   FROM ((public.products p
     LEFT JOIN qty q ON ((q.product_id = p.id)))
     LEFT JOIN val v ON ((v.product_id = p.id)));

--
-- Name: standard_cost_readiness; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.standard_cost_readiness WITH (security_invoker='true') AS
 SELECT p.id AS product_id,
    p.sku,
    p.name_ar,
    p.item_class,
    p.unit_id,
    p.cost_price AS catalogue_cost,
    p.standard_cost,
        CASE
            WHEN (cl.quantity > (0)::numeric) THEN round((cl.total_value / cl.quantity), 4)
            ELSE NULL::numeric
        END AS implied_standard,
    COALESCE(cl.quantity, (0)::numeric) AS on_hand_qty,
        CASE
            WHEN (p.standard_cost IS NOT NULL) THEN 'READY'::text
            WHEN (cl.quantity > (0)::numeric) THEN 'NEEDS_DECISION'::text
            ELSE 'NO_HISTORY'::text
        END AS readiness,
        CASE
            WHEN (p.standard_cost IS NOT NULL) THEN 'معيار معتمد'::text
            WHEN (cl.quantity > (0)::numeric) THEN 'لا يوجد معيار — رشح القيمة القائمة، أو أدخل ميزانية'::text
            ELSE 'لا يوجد معيار ولا حركات — أدخل الميزانية يدوياً'::text
        END AS note
   FROM (public.products p
     LEFT JOIN LATERAL ( SELECT sum(c.quantity) AS quantity,
            sum(c.total_value) AS total_value
           FROM public.item_cost_layers c
          WHERE ((c.product_id = p.id) AND (c.owner_type = 'COMPANY'::public.owner_type))) cl ON (true))
  WHERE (p.is_active AND (p.item_nature = 'GOOD'::public.item_nature) AND (p.inventory_policy = 'TRACKED'::public.inventory_policy) AND (p.item_class <> 'SERVICE'::public.item_class) AND (p.standard_cost IS NULL));

--
-- Name: item_cost_layers item_cost_layers_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.item_cost_layers
    ADD CONSTRAINT item_cost_layers_pkey PRIMARY KEY (id);

--
-- Name: ux_item_cost_layers_position; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX ux_item_cost_layers_position ON public.item_cost_layers USING btree (product_id, warehouse_id, owner_type, owner_id) NULLS NOT DISTINCT;

--
-- Name: item_cost_layers item_cost_layers_guard_company_scope; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER item_cost_layers_guard_company_scope BEFORE INSERT OR UPDATE OF product_id, owner_type, owner_id ON public.item_cost_layers FOR EACH ROW WHEN ((new.owner_type = 'COMPANY'::public.owner_type)) EXECUTE FUNCTION public.guard_production_company_stock_scope();

--
-- Name: item_cost_layers cost_layers_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY cost_layers_read ON public.item_cost_layers FOR SELECT TO authenticated USING ((public.is_staff(auth.uid()) AND ((owner_type = 'COMPANY'::public.owner_type) OR (owner_id = auth.uid()))));

--
-- Name: item_cost_layers; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.item_cost_layers ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE item_cost_layers; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.item_cost_layers TO service_role;


--
-- Name: item_cost_transactions item_cost_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.item_cost_transactions
    ADD CONSTRAINT item_cost_transactions_pkey PRIMARY KEY (id);

--
-- Name: ix_item_cost_tx_product; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_item_cost_tx_product ON public.item_cost_transactions USING btree (product_id, created_at DESC);

--
-- Name: item_cost_transactions cost_tx_read_finance; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY cost_tx_read_finance ON public.item_cost_transactions FOR SELECT TO authenticated USING ((public.can_read_finance(auth.uid()) AND ((owner_type = 'COMPANY'::public.owner_type) OR (owner_id = auth.uid()))));

--
-- Name: item_cost_transactions; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.item_cost_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE item_cost_transactions; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.item_cost_transactions TO service_role;


--
-- Name: opening_balance_documents opening_balance_documents_document_number_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.opening_balance_documents
    ADD CONSTRAINT opening_balance_documents_document_number_key UNIQUE (document_number);

--
-- Name: opening_balance_documents opening_balance_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.opening_balance_documents
    ADD CONSTRAINT opening_balance_documents_pkey PRIMARY KEY (id);

--
-- Name: opening_balance_documents opening_bal_read_finance; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY opening_bal_read_finance ON public.opening_balance_documents FOR SELECT TO authenticated USING (public.can_read_finance(auth.uid()));

--
-- Name: opening_balance_documents; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.opening_balance_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE opening_balance_documents; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.opening_balance_documents TO service_role;


--
-- Name: COLUMN opening_balance_lines.ledger_account_code; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.opening_balance_lines.ledger_account_code IS 'T-11: توجيه اختياري لحساب الترحيل. عند غيابه تُشتق من القسم (CASH→1101، BANK→1111، ASSET→1411، LIABILITY→2111، CAPITAL→3111).';

--
-- Name: opening_balance_summary; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.opening_balance_summary WITH (security_invoker='true') AS
 SELECT d.id,
    d.document_number,
    d.effective_date,
    d.status,
    d.fiscal_year,
    d.total_assets,
    d.total_liabilities,
    d.capital_required,
    d.notes,
    COALESCE(s.stock_amount, (0)::numeric) AS stock_amount,
    COALESCE(s.receivable_amount, (0)::numeric) AS receivable_amount,
    COALESCE(s.payable_amount, (0)::numeric) AS payable_amount,
    COALESCE(s.cash_amount, (0)::numeric) AS cash_amount,
    COALESCE(s.bank_amount, (0)::numeric) AS bank_amount,
    COALESCE(s.asset_amount, (0)::numeric) AS asset_amount,
    COALESCE(s.liability_amount, (0)::numeric) AS liability_amount,
    COALESCE(s.capital_amount, (0)::numeric) AS capital_amount,
    COALESCE(s.debit, (0)::numeric) AS total_debits,
    COALESCE(s.credit, (0)::numeric) AS total_credits,
    round((COALESCE(s.debit, (0)::numeric) - COALESCE(s.credit, (0)::numeric)), 2) AS capital_required_now,
    (COALESCE(s.debit, (0)::numeric) = COALESCE(s.credit, (0)::numeric)) AS is_balanced
   FROM (public.opening_balance_documents d
     LEFT JOIN LATERAL ( SELECT sum(l.amount) FILTER (WHERE (l.side = 'DEBIT'::text)) AS debit,
            sum(l.amount) FILTER (WHERE (l.side = 'CREDIT'::text)) AS credit,
            sum(l.amount) FILTER (WHERE (l.section = 'STOCK'::text)) AS stock_amount,
            sum(l.amount) FILTER (WHERE (l.section = 'RECEIVABLE'::text)) AS receivable_amount,
            sum(l.amount) FILTER (WHERE (l.section = 'PAYABLE'::text)) AS payable_amount,
            sum(l.amount) FILTER (WHERE (l.section = 'CASH'::text)) AS cash_amount,
            sum(l.amount) FILTER (WHERE (l.section = 'BANK'::text)) AS bank_amount,
            sum(l.amount) FILTER (WHERE (l.section = 'ASSET'::text)) AS asset_amount,
            sum(l.amount) FILTER (WHERE (l.section = 'LIABILITY'::text)) AS liability_amount,
            sum(l.amount) FILTER (WHERE (l.section = 'CAPITAL'::text)) AS capital_amount
           FROM public.opening_balance_lines l
          WHERE (l.document_id = d.id)) s ON (true));

--
-- Name: opening_balance_lines opening_balance_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.opening_balance_lines
    ADD CONSTRAINT opening_balance_lines_pkey PRIMARY KEY (id);

--
-- Name: ix_opening_lines_doc; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_opening_lines_doc ON public.opening_balance_lines USING btree (document_id);

--
-- Name: ix_opening_lines_ref; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_opening_lines_ref ON public.opening_balance_lines USING btree (ref_type, ref_id);

--
-- Name: opening_balance_lines opening_bal_lines_read_finance; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY opening_bal_lines_read_finance ON public.opening_balance_lines FOR SELECT TO authenticated USING (public.can_read_finance(auth.uid()));

--
-- Name: opening_balance_lines; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.opening_balance_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE opening_balance_lines; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.opening_balance_lines TO service_role;


--
-- Name: SEQUENCE opening_balance_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,USAGE ON SEQUENCE public.opening_balance_seq TO authenticated;


--
-- Name: stock_adjustment_items stock_adjustment_items_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_adjustment_items
    ADD CONSTRAINT stock_adjustment_items_pkey PRIMARY KEY (id);

--
-- Name: idx_stock_adjustment_items_adj; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_stock_adjustment_items_adj ON public.stock_adjustment_items USING btree (adjustment_id);

--
-- Name: idx_stock_adjustment_items_product; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_stock_adjustment_items_product ON public.stock_adjustment_items USING btree (product_id);

--
-- Name: stock_adjustment_items; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.stock_adjustment_items ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_adjustment_items stock_adjustment_items_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY stock_adjustment_items_read ON public.stock_adjustment_items FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: TABLE stock_adjustment_items; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.stock_adjustment_items TO service_role;

GRANT SELECT ON TABLE public.stock_adjustment_items TO authenticated;


--
-- Name: SEQUENCE stock_adjustment_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT USAGE ON SEQUENCE public.stock_adjustment_seq TO service_role;

GRANT SELECT,USAGE ON SEQUENCE public.stock_adjustment_seq TO authenticated;


--
-- Name: stock_adjustments stock_adjustments_document_number_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_adjustments
    ADD CONSTRAINT stock_adjustments_document_number_key UNIQUE (document_number);

--
-- Name: stock_adjustments stock_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_adjustments
    ADD CONSTRAINT stock_adjustments_pkey PRIMARY KEY (id);

--
-- Name: stock_adjustments; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_adjustments stock_adjustments_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY stock_adjustments_read ON public.stock_adjustments FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: TABLE stock_adjustments; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.stock_adjustments TO service_role;

GRANT SELECT ON TABLE public.stock_adjustments TO authenticated;

--
-- Name: item_has_stock_history(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.item_has_stock_history(p_item_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.product_id = p_item_id)
      OR EXISTS (SELECT 1 FROM public.inventory i WHERE i.product_id = p_item_id AND i.quantity <> 0)
$$;


--
-- Name: COLUMN stock_movements.production_order_id; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.stock_movements.production_order_id IS 'أمر الإنتاج الشركة المالك للحركة (صرف مادة/استلام ناتج/عكس). NULL لغير الإنتاج.';

--
-- Name: stock_movements stock_movements_adjustment_reason_required; Type: CHECK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.stock_movements
    ADD CONSTRAINT stock_movements_adjustment_reason_required CHECK (((movement_type <> 'adjustment'::public.movement_type) OR ((adjustment_reason IS NOT NULL) AND (btrim(adjustment_reason) <> ''::text)))) NOT VALID;

--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);

--
-- Name: idx_stock_movements_kind; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_stock_movements_kind ON public.stock_movements USING btree (movement_kind);

--
-- Name: idx_stock_movements_owner; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_stock_movements_owner ON public.stock_movements USING btree (owner_type, owner_id) WHERE (owner_id IS NOT NULL);

--
-- Name: idx_stock_movements_product; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_stock_movements_product ON public.stock_movements USING btree (product_id);

--
-- Name: idx_stock_movements_reference; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_stock_movements_reference ON public.stock_movements USING btree (reference_type, reference_id);

--
-- Name: idx_stock_movements_source; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_stock_movements_source ON public.stock_movements USING btree (source_type, source_id);

--
-- Name: idx_stock_movements_warehouse; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_stock_movements_warehouse ON public.stock_movements USING btree (warehouse_id);

--
-- Name: stock_movements_production_order_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX stock_movements_production_order_idx ON public.stock_movements USING btree (production_order_id) WHERE (production_order_id IS NOT NULL);

--
-- Name: stock_movements stock_movements_guard_company_scope; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER stock_movements_guard_company_scope BEFORE INSERT ON public.stock_movements FOR EACH ROW WHEN ((new.owner_type = 'COMPANY'::public.owner_type)) EXECUTE FUNCTION public.guard_company_stock_movement_scope();

--
-- Name: stock_movements tg_stock_movements_engine_only; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER tg_stock_movements_engine_only BEFORE INSERT OR DELETE OR UPDATE ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.tg_stock_movements_engine_only();

--
-- Name: stock_movements mv_view; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY mv_view ON public.stock_movements FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: stock_movements; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE stock_movements; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.stock_movements TO service_role;

GRANT SELECT ON TABLE public.stock_movements TO authenticated;


--
-- Name: stock_opening_items stock_opening_items_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_opening_items
    ADD CONSTRAINT stock_opening_items_pkey PRIMARY KEY (id);

--
-- Name: idx_stock_opening_items_opening; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_stock_opening_items_opening ON public.stock_opening_items USING btree (opening_id);

--
-- Name: idx_stock_opening_items_product; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_stock_opening_items_product ON public.stock_opening_items USING btree (product_id);

--
-- Name: stock_opening_items; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.stock_opening_items ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_opening_items stock_opening_items_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY stock_opening_items_read ON public.stock_opening_items FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: TABLE stock_opening_items; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.stock_opening_items TO service_role;

GRANT SELECT ON TABLE public.stock_opening_items TO authenticated;


--
-- Name: SEQUENCE stock_opening_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,USAGE ON SEQUENCE public.stock_opening_seq TO authenticated;


--
-- Name: stock_openings stock_openings_document_number_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_openings
    ADD CONSTRAINT stock_openings_document_number_key UNIQUE (document_number);

--
-- Name: stock_openings stock_openings_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_openings
    ADD CONSTRAINT stock_openings_pkey PRIMARY KEY (id);

--
-- Name: stock_openings; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.stock_openings ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_openings stock_openings_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY stock_openings_read ON public.stock_openings FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: TABLE stock_openings; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.stock_openings TO service_role;

GRANT SELECT ON TABLE public.stock_openings TO authenticated;


--
-- Name: stock_transfer_items stock_transfer_items_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_pkey PRIMARY KEY (id);

--
-- Name: idx_stock_transfer_items_product; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_stock_transfer_items_product ON public.stock_transfer_items USING btree (product_id);

--
-- Name: stock_transfer_items staff read xfer_i; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "staff read xfer_i" ON public.stock_transfer_items FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: stock_transfer_items staff write xfer_i; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "staff write xfer_i" ON public.stock_transfer_items TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

--
-- Name: stock_transfer_items; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE stock_transfer_items; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.stock_transfer_items TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stock_transfer_items TO authenticated;


--
-- Name: SEQUENCE stock_transfer_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,USAGE ON SEQUENCE public.stock_transfer_seq TO authenticated;


--
-- Name: stock_transfers stock_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_pkey PRIMARY KEY (id);

--
-- Name: stock_transfers stock_transfers_transfer_number_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_transfer_number_key UNIQUE (transfer_number);

--
-- Name: stock_transfers staff read xfer; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "staff read xfer" ON public.stock_transfers FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: stock_transfers staff write xfer; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "staff write xfer" ON public.stock_transfers TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

--
-- Name: stock_transfers; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE stock_transfers; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.stock_transfers TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stock_transfers TO authenticated;


--
-- Name: inventory_valuation; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.inventory_valuation WITH (security_invoker='true') AS
 SELECT p.item_id,
    p.item_name,
    p.item_name_ar,
    p.sku,
    p.warehouse_id,
    p.warehouse_name,
    p.warehouse_name_ar,
    p.quantity,
    p.costing_method,
    p.reference_unit_cost,
    p.reference_valuation,
    (p.costing_method <> 'STANDARD'::public.costing_method) AS valuation_is_reference_based,
    COALESCE(product.base_uom_id, product.unit_id) AS base_uom_id,
    base_unit.name AS base_uom_name,
    COALESCE(base_unit.name_ar, base_unit.name) AS base_uom_name_ar,
    product.min_stock
   FROM ((public.company_stock_positions p
     LEFT JOIN public.products product ON ((product.id = p.item_id)))
     LEFT JOIN public.units base_unit ON ((base_unit.id = COALESCE(product.base_uom_id, product.unit_id))));

--
-- Name: TABLE company_stock_positions; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.company_stock_positions TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.company_stock_positions TO service_role;


--
-- Name: TABLE customer_owned_positions; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.customer_owned_positions TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.customer_owned_positions TO service_role;


--
-- Name: milling_inventory_report; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.milling_inventory_report WITH (security_invoker='true') AS
 SELECT p.item_class,
    p.id AS product_id,
    p.sku,
    p.name_ar,
    COALESCE(i.warehouse_name_ar, '—'::text) AS warehouse,
    COALESCE(i.qty, (0)::numeric) AS on_hand_qty,
    COALESCE(u.name_ar, '—'::text) AS unit,
    COALESCE(v.actual_unit_cost, (0)::numeric) AS unit_cost,
    (COALESCE(i.qty, (0)::numeric) * COALESCE(v.actual_unit_cost, (0)::numeric)) AS valuation,
    COALESCE(v.valuation_basis, 'REFERENCE_ONLY'::text) AS cost_basis
   FROM (((public.products p
     LEFT JOIN LATERAL ( SELECT sp.warehouse_name_ar,
            sp.quantity AS qty
           FROM public.stock_positions sp
          WHERE ((sp.item_id = p.id) AND sp.is_company_owned AND (sp.quantity <> (0)::numeric))
          ORDER BY sp.warehouse_name_ar) i ON (true))
     LEFT JOIN public.units u ON ((u.id = p.base_uom_id)))
     LEFT JOIN public.item_valuation v ON ((v.product_id = p.id)))
  WHERE ((p.item_class = ANY (ARRAY['RAW_MATERIAL'::public.item_class, 'FINISHED_GOOD'::public.item_class, 'BY_PRODUCT'::public.item_class, 'NON_STOCK_ITEM'::public.item_class])) AND p.is_active AND ((COALESCE(i.qty, (0)::numeric) <> (0)::numeric) OR (COALESCE(v.on_hand_qty, (0)::numeric) <> (0)::numeric)));

--
-- Name: TABLE item_valuation; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.item_valuation TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.item_valuation TO service_role;


--
-- Name: TABLE standard_cost_readiness; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.standard_cost_readiness TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.standard_cost_readiness TO service_role;


--
-- Name: TABLE opening_balance_summary; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.opening_balance_summary TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.opening_balance_summary TO service_role;


--
-- Name: FUNCTION item_has_stock_history(p_item_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.item_has_stock_history(p_item_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.item_has_stock_history(p_item_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.item_has_stock_history(p_item_id uuid) TO authenticated;


--
-- Name: FUNCTION tg_stock_movements_engine_only(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.tg_stock_movements_engine_only() FROM PUBLIC;

GRANT ALL ON FUNCTION public.tg_stock_movements_engine_only() TO service_role;


--
-- Name: VIEW inventory_valuation; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON VIEW public.inventory_valuation IS 'Company inventory by item and warehouse, with the base stock unit and minimum alert level exposed beside each quantity.';

--
-- Name: inventory_low_stock; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.inventory_low_stock WITH (security_invoker='true') AS
 SELECT v.item_id,
    v.item_name,
    v.item_name_ar,
    v.sku,
    v.warehouse_id,
    v.warehouse_name,
    v.warehouse_name_ar,
    v.quantity,
    v.costing_method,
    v.reference_unit_cost,
    v.reference_valuation,
    v.valuation_is_reference_based,
    v.base_uom_id,
    v.base_uom_name,
    v.base_uom_name_ar,
    v.min_stock
   FROM public.inventory_valuation v
UNION ALL
 SELECT product.id AS item_id,
    product.name AS item_name,
    product.name_ar AS item_name_ar,
    product.sku,
    warehouse.id AS warehouse_id,
    warehouse.name AS warehouse_name,
    warehouse.name_ar AS warehouse_name_ar,
    (0)::numeric AS quantity,
    product.costing_method,
    COALESCE(company_item.default_cost, product.cost_price, (0)::numeric) AS reference_unit_cost,
    (0)::numeric AS reference_valuation,
    (product.costing_method <> 'STANDARD'::public.costing_method) AS valuation_is_reference_based,
    COALESCE(product.base_uom_id, product.unit_id) AS base_uom_id,
    base_unit.name AS base_uom_name,
    COALESCE(base_unit.name_ar, base_unit.name) AS base_uom_name_ar,
    product.min_stock
   FROM (((public.products product
     JOIN public.warehouses warehouse ON (warehouse.is_active))
     LEFT JOIN public.company_items company_item ON (((company_item.item_id = product.id) AND (company_item.company_id = 1) AND company_item.is_active)))
     LEFT JOIN public.units base_unit ON ((base_unit.id = COALESCE(product.base_uom_id, product.unit_id))))
  WHERE (product.is_active AND (product.status = 'ACTIVE'::public.item_status) AND (product.item_nature = 'GOOD'::public.item_nature) AND (NOT product.is_service) AND (product.item_class IS DISTINCT FROM 'SERVICE'::public.item_class) AND (product.is_sellable OR product.is_purchasable) AND (COALESCE(company_item.inventory_policy, product.inventory_policy) = 'TRACKED'::public.inventory_policy) AND (product.min_stock > (0)::numeric) AND (NOT (EXISTS ( SELECT 1
           FROM public.company_stock_positions existing_position
          WHERE ((existing_position.item_id = product.id) AND (existing_position.warehouse_id = warehouse.id))))));

--
-- Name: TABLE inventory_valuation; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.inventory_valuation TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.inventory_valuation TO service_role;


--
-- Name: TABLE milling_inventory_report; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.milling_inventory_report TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.milling_inventory_report TO service_role;


--
-- Name: VIEW inventory_low_stock; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON VIEW public.inventory_low_stock IS 'Company stock rows plus zero rows for active tracked goods with a positive alert threshold and no company position in an active warehouse. Not a financial valuation source.';

--
-- Name: TABLE inventory_low_stock; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.inventory_low_stock TO authenticated;

GRANT SELECT ON TABLE public.inventory_low_stock TO service_role;
