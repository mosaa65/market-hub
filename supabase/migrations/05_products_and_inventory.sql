-- ============================================================================
-- 06_products_and_inventory.sql
--
-- الأطراف: العملاء، الموردون، دفتر العملاء، نقاط الولاء.
--
-- مُستخرج من الحالة النهائية الحقيقية لقاعدة البيانات، لا من تاريخ الملفات.
-- لا يحتوي أي بيانات أعمال أو تجارية. راجع supabase/MIGRATIONS_RULES.md
-- ============================================================================

-- ── TABLES ────────────────────────────────────────────────────────────────
CREATE TABLE public.products (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sku text,
  barcode text,
  name text,
  name_ar text NOT NULL,
  description text,
  image_url text,
  category_id uuid,
  brand_id uuid,
  unit_id uuid,
  cost_price numeric(14,2) DEFAULT 0 NOT NULL,
  sale_price numeric(14,2) DEFAULT 0 NOT NULL,
  tax_rate numeric(6,3) DEFAULT 0 NOT NULL,
  min_stock numeric(14,3) DEFAULT 0 NOT NULL,
  track_expiry boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  shelf_location text,
  is_service boolean DEFAULT false NOT NULL,
  origin_id uuid,
  quality_grade_id uuid,
  item_nature public.item_nature DEFAULT 'GOOD'::item_nature NOT NULL,
  inventory_policy public.inventory_policy DEFAULT 'TRACKED'::inventory_policy NOT NULL,
  tracking public.item_tracking DEFAULT 'NONE'::item_tracking NOT NULL,
  costing_method public.costing_method DEFAULT 'MOVING_AVERAGE'::costing_method NOT NULL,
  is_sellable boolean DEFAULT true NOT NULL,
  is_purchasable boolean DEFAULT true NOT NULL,
  status public.item_status DEFAULT 'ACTIVE'::item_status NOT NULL,
  base_uom_id uuid,
  sales_uom_id uuid,
  purchase_uom_id uuid,
  uom_conversions jsonb DEFAULT '[]'::jsonb NOT NULL,
  item_class public.item_class,
  standard_cost numeric(18,4),
  package_type_id uuid,
  package_weight_kg numeric(10,3)
);

CREATE TABLE public.product_compatibilities (
  product_id uuid NOT NULL,
  vehicle_model_id uuid NOT NULL
);

CREATE TABLE public.company_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id integer DEFAULT 1 NOT NULL,
  item_id uuid NOT NULL,
  inventory_policy public.inventory_policy,
  costing_method public.costing_method,
  default_cost numeric(14,2),
  default_sale_price numeric(14,2),
  tax_rate numeric(6,3),
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.item_policy_review_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  product_id uuid NOT NULL,
  reason text NOT NULL,
  detail jsonb DEFAULT '{}'::jsonb NOT NULL,
  resolved_at timestamp with time zone,
  resolved_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.costing_policy_history (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  costing_method public.costing_method NOT NULL,
  previous_method public.costing_method,
  reason text,
  changed_by uuid,
  changed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.inventory (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  product_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  quantity numeric(14,3) DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  owner_type public.owner_type DEFAULT 'COMPANY'::owner_type NOT NULL,
  owner_id uuid
);

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
  owner_type public.owner_type DEFAULT 'COMPANY'::owner_type NOT NULL,
  owner_id uuid
);

CREATE TABLE public.item_cost_layers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  product_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  owner_type public.owner_type DEFAULT 'COMPANY'::owner_type NOT NULL,
  owner_id uuid,
  quantity numeric(18,3) DEFAULT 0 NOT NULL,
  total_value numeric(18,2) DEFAULT 0 NOT NULL,
  valuation_method public.costing_method DEFAULT 'MOVING_AVERAGE'::costing_method NOT NULL,
  last_unit_cost numeric(18,4) DEFAULT 0 NOT NULL,
  last_movement_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.item_cost_transactions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  product_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  owner_type public.owner_type DEFAULT 'COMPANY'::owner_type NOT NULL,
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
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.product_batches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  product_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  batch_number text NOT NULL,
  expiry_date date,
  quantity numeric DEFAULT 0 NOT NULL,
  unit_cost numeric DEFAULT 0 NOT NULL,
  note text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.stock_transfers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  transfer_number text NOT NULL,
  from_warehouse_id uuid NOT NULL,
  to_warehouse_id uuid NOT NULL,
  status text DEFAULT 'completed'::text NOT NULL,
  note text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.stock_transfer_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  transfer_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric NOT NULL
);

CREATE TABLE public.stock_openings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  document_number text NOT NULL,
  warehouse_id uuid NOT NULL,
  effective_date date DEFAULT CURRENT_DATE NOT NULL,
  note text,
  total_value numeric(14,2) DEFAULT 0 NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.stock_opening_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  opening_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric(14,3) NOT NULL,
  unit_cost numeric(14,2) DEFAULT 0 NOT NULL,
  total_cost numeric(14,2) DEFAULT 0 NOT NULL,
  note text
);

CREATE TABLE public.stock_adjustments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  document_number text NOT NULL,
  warehouse_id uuid NOT NULL,
  effective_date date DEFAULT CURRENT_DATE NOT NULL,
  reason text NOT NULL,
  note text,
  total_value numeric(14,2) DEFAULT 0 NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.stock_adjustment_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  adjustment_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric(14,3) NOT NULL,
  unit_cost numeric(14,2) DEFAULT 0 NOT NULL,
  total_cost numeric(14,2) DEFAULT 0 NOT NULL,
  note text
);

-- ── CONSTRAINTS ───────────────────────────────────────────────────────────
ALTER TABLE public.products ADD CONSTRAINT "products_none_costing_requires_untracked" CHECK (((costing_method <> 'NONE'::costing_method) OR (inventory_policy = 'UNTRACKED'::inventory_policy)));
ALTER TABLE public.products ADD CONSTRAINT "products_service_cannot_be_tracked" CHECK (((item_nature <> 'SERVICE'::item_nature) OR (inventory_policy = 'UNTRACKED'::inventory_policy)));
ALTER TABLE public.products ADD CONSTRAINT "products_untracked_has_no_tracking" CHECK (((inventory_policy <> 'UNTRACKED'::inventory_policy) OR (tracking = 'NONE'::item_tracking)));
ALTER TABLE public.products ADD CONSTRAINT "products_pkey" PRIMARY KEY (id);
ALTER TABLE public.products ADD CONSTRAINT "products_barcode_key" UNIQUE (barcode);
ALTER TABLE public.products ADD CONSTRAINT "products_sku_key" UNIQUE (sku);
ALTER TABLE public.product_compatibilities ADD CONSTRAINT "product_compatibilities_pkey" PRIMARY KEY (product_id, vehicle_model_id);
ALTER TABLE public.company_items ADD CONSTRAINT "company_items_cost_nonnegative" CHECK (((default_cost IS NULL) OR (default_cost >= (0)::numeric)));
ALTER TABLE public.company_items ADD CONSTRAINT "company_items_price_nonnegative" CHECK (((default_sale_price IS NULL) OR (default_sale_price >= (0)::numeric)));
ALTER TABLE public.company_items ADD CONSTRAINT "company_items_tax_valid" CHECK (((tax_rate IS NULL) OR ((tax_rate >= (0)::numeric) AND (tax_rate <= (100)::numeric))));
ALTER TABLE public.company_items ADD CONSTRAINT "company_items_pkey" PRIMARY KEY (id);
ALTER TABLE public.company_items ADD CONSTRAINT "company_items_unique" UNIQUE (company_id, item_id);
ALTER TABLE public.item_policy_review_queue ADD CONSTRAINT "item_policy_review_queue_pkey" PRIMARY KEY (id);
ALTER TABLE public.item_policy_review_queue ADD CONSTRAINT "item_policy_review_queue_unique" UNIQUE (product_id, reason);
ALTER TABLE public.costing_policy_history ADD CONSTRAINT "costing_policy_history_pkey" PRIMARY KEY (id);
ALTER TABLE public.inventory ADD CONSTRAINT "inventory_pkey" PRIMARY KEY (id);
ALTER TABLE public.inventory ADD CONSTRAINT "inventory_product_id_warehouse_id_key" UNIQUE (product_id, warehouse_id);
ALTER TABLE public.stock_movements ADD CONSTRAINT "stock_movements_adjustment_reason_required" CHECK (((movement_type <> 'adjustment'::movement_type) OR ((adjustment_reason IS NOT NULL) AND (btrim(adjustment_reason) <> ''::text)))) NOT VALID;
ALTER TABLE public.stock_movements ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY (id);
ALTER TABLE public.item_cost_layers ADD CONSTRAINT "item_cost_layers_qty_check" CHECK ((quantity >= (0)::numeric));
ALTER TABLE public.item_cost_layers ADD CONSTRAINT "item_cost_layers_value_check" CHECK ((total_value >= (0)::numeric));
ALTER TABLE public.item_cost_layers ADD CONSTRAINT "item_cost_layers_pkey" PRIMARY KEY (id);
ALTER TABLE public.item_cost_transactions ADD CONSTRAINT "item_cost_transactions_direction_check" CHECK ((direction = ANY (ARRAY['IN'::text, 'OUT'::text, 'REVALUE'::text])));
ALTER TABLE public.item_cost_transactions ADD CONSTRAINT "item_cost_transactions_pkey" PRIMARY KEY (id);
ALTER TABLE public.product_batches ADD CONSTRAINT "product_batches_pkey" PRIMARY KEY (id);
ALTER TABLE public.product_batches ADD CONSTRAINT "product_batches_product_id_warehouse_id_batch_number_key" UNIQUE (product_id, warehouse_id, batch_number);
ALTER TABLE public.stock_transfers ADD CONSTRAINT "stock_transfers_check" CHECK ((from_warehouse_id <> to_warehouse_id));
ALTER TABLE public.stock_transfers ADD CONSTRAINT "stock_transfers_pkey" PRIMARY KEY (id);
ALTER TABLE public.stock_transfers ADD CONSTRAINT "stock_transfers_transfer_number_key" UNIQUE (transfer_number);
ALTER TABLE public.stock_transfer_items ADD CONSTRAINT "stock_transfer_items_quantity_check" CHECK ((quantity > (0)::numeric));
ALTER TABLE public.stock_transfer_items ADD CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY (id);
ALTER TABLE public.stock_openings ADD CONSTRAINT "stock_openings_pkey" PRIMARY KEY (id);
ALTER TABLE public.stock_openings ADD CONSTRAINT "stock_openings_document_number_key" UNIQUE (document_number);
ALTER TABLE public.stock_opening_items ADD CONSTRAINT "stock_opening_items_quantity_check" CHECK ((quantity > (0)::numeric));
ALTER TABLE public.stock_opening_items ADD CONSTRAINT "stock_opening_items_unit_cost_check" CHECK ((unit_cost >= (0)::numeric));
ALTER TABLE public.stock_opening_items ADD CONSTRAINT "stock_opening_items_pkey" PRIMARY KEY (id);
ALTER TABLE public.stock_adjustments ADD CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY (id);
ALTER TABLE public.stock_adjustments ADD CONSTRAINT "stock_adjustments_document_number_key" UNIQUE (document_number);
ALTER TABLE public.stock_adjustment_items ADD CONSTRAINT "stock_adjustment_items_quantity_check" CHECK ((quantity <> (0)::numeric));
ALTER TABLE public.stock_adjustment_items ADD CONSTRAINT "stock_adjustment_items_unit_cost_check" CHECK ((unit_cost >= (0)::numeric));
ALTER TABLE public.stock_adjustment_items ADD CONSTRAINT "stock_adjustment_items_pkey" PRIMARY KEY (id);

-- ── INDEXES ───────────────────────────────────────────────────────────────
CREATE INDEX idx_products_inventory_policy ON public.products USING btree (inventory_policy);
CREATE INDEX idx_products_item_nature ON public.products USING btree (item_nature);
CREATE INDEX idx_products_status ON public.products USING btree (status);
CREATE INDEX products_name_idx ON public.products USING gin (to_tsvector('simple'::regconfig, ((((((COALESCE(name, ''::text) || ' '::text) || COALESCE(name_ar, ''::text)) || ' '::text) || COALESCE(sku, ''::text)) || ' '::text) || COALESCE(barcode, ''::text))));
CREATE INDEX idx_company_items_company ON public.company_items USING btree (company_id);
CREATE INDEX idx_company_items_item ON public.company_items USING btree (item_id);
CREATE INDEX idx_inventory_owner ON public.inventory USING btree (owner_type, owner_id) WHERE (owner_id IS NOT NULL);
CREATE INDEX idx_inventory_product ON public.inventory USING btree (product_id);
CREATE INDEX idx_inventory_warehouse ON public.inventory USING btree (warehouse_id);
CREATE UNIQUE INDEX inventory_product_warehouse_owner_key ON public.inventory USING btree (product_id, warehouse_id, owner_type, owner_id) NULLS NOT DISTINCT;
CREATE INDEX idx_stock_movements_kind ON public.stock_movements USING btree (movement_kind);
CREATE INDEX idx_stock_movements_owner ON public.stock_movements USING btree (owner_type, owner_id) WHERE (owner_id IS NOT NULL);
CREATE INDEX idx_stock_movements_product ON public.stock_movements USING btree (product_id);
CREATE INDEX idx_stock_movements_reference ON public.stock_movements USING btree (reference_type, reference_id);
CREATE INDEX idx_stock_movements_source ON public.stock_movements USING btree (source_type, source_id);
CREATE INDEX idx_stock_movements_warehouse ON public.stock_movements USING btree (warehouse_id);
CREATE UNIQUE INDEX ux_item_cost_layers_position ON public.item_cost_layers USING btree (product_id, warehouse_id, owner_type, owner_id) NULLS NOT DISTINCT;
CREATE INDEX ix_item_cost_tx_product ON public.item_cost_transactions USING btree (product_id, created_at DESC);
CREATE INDEX idx_batches_expiry ON public.product_batches USING btree (expiry_date) WHERE (expiry_date IS NOT NULL);
CREATE INDEX idx_batches_product ON public.product_batches USING btree (product_id);
CREATE INDEX idx_stock_transfer_items_product ON public.stock_transfer_items USING btree (product_id);
CREATE INDEX idx_stock_opening_items_opening ON public.stock_opening_items USING btree (opening_id);
CREATE INDEX idx_stock_opening_items_product ON public.stock_opening_items USING btree (product_id);
CREATE INDEX idx_stock_adjustment_items_adj ON public.stock_adjustment_items USING btree (adjustment_id);
CREATE INDEX idx_stock_adjustment_items_product ON public.stock_adjustment_items USING btree (product_id);

-- ── FUNCTIONS ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.adjust_loyalty(_customer uuid, _points numeric, _kind text, _note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id UUID; v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_staff(v_user) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _kind NOT IN ('earn','redeem','adjust') THEN RAISE EXCEPTION 'Invalid kind'; END IF;

  INSERT INTO public.loyalty_transactions(customer_id, points, kind, note, created_by)
  VALUES (_customer, _points, _kind, _note, v_user)
  RETURNING id INTO v_id;

  UPDATE public.customers
    SET loyalty_points = GREATEST(loyalty_points + (CASE WHEN _kind='redeem' THEN -ABS(_points) ELSE ABS(_points) END), 0),
        updated_at = now()
    WHERE id = _customer;

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.apply_cost_movement(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_incoming_cost numeric DEFAULT NULL::numeric, p_source_type text DEFAULT NULL::text, p_source_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text, p_owner_type owner_type DEFAULT 'COMPANY'::owner_type, p_owner_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user     uuid := auth.uid();
  v_method   public.costing_method := public.company_costing_method();
  v_qty0     numeric := 0;
  v_val0     numeric := 0;
  v_in_cost  numeric;
  v_out_cost numeric;
  v_qty1     numeric;
  v_val1     numeric;
  v_standard numeric;
  v_pending  integer;
BEGIN
  IF p_signed_qty IS NULL OR p_signed_qty = 0 THEN
    RETURN;  -- nothing to value; not an error
  END IF;
  IF p_product_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Item and location are required to value a movement';
  END IF;

  SELECT cl.quantity, cl.total_value
    INTO v_qty0, v_val0
    FROM public.item_cost_layers cl
   WHERE cl.product_id   = p_product_id
     AND cl.warehouse_id = p_warehouse_id
     AND cl.owner_type   = p_owner_type
     AND cl.owner_id IS NOT DISTINCT FROM p_owner_id
   FOR UPDATE;

  v_qty0 := coalesce(v_qty0, 0);
  v_val0 := coalesce(v_val0, 0);
  v_qty1 := round(v_qty0 + p_signed_qty, 3);

  IF p_signed_qty > 0 THEN
    IF v_method = 'STANDARD' THEN
      SELECT p.standard_cost INTO v_standard
        FROM public.products p WHERE p.id = p_product_id;

      IF v_standard IS NULL OR v_standard = 0 THEN
        -- Name how many items are blocking, so the operator is not left with
        -- one error per receipt and no idea of the size of the job.
        SELECT count(*)::int INTO v_pending
          FROM public.standard_cost_readiness;
        RAISE EXCEPTION
          'Standard cost is not set for this item (%). % more tracked item(s) also lack one - see standard_cost_readiness.',
          p_product_id, v_pending;
      END IF;

      v_in_cost := v_standard;
    ELSE
      v_in_cost := coalesce(
        p_incoming_cost,
        CASE WHEN v_qty0 > 0 THEN round(v_val0 / v_qty0, 4) END,
        (SELECT p.cost_price FROM public.products p WHERE p.id = p_product_id),
        0
      );
    END IF;

    v_val1 := v_val0 + round(p_signed_qty * v_in_cost, 2);

  ELSE
    IF v_qty0 <= 0 THEN
      v_out_cost := coalesce(
        (SELECT p.standard_cost FROM public.products p
          WHERE p.id = p_product_id AND v_method = 'STANDARD'),
        (SELECT p.cost_price FROM public.products p WHERE p.id = p_product_id),
        0
      );
    ELSE
      v_out_cost := round(v_val0 / v_qty0, 4);
    END IF;

    v_val1 := v_val0 - round(abs(p_signed_qty) * v_out_cost, 2);
    IF v_qty1 <= 0 OR v_val1 < 0 THEN
      v_val1 := 0;
    END IF;
  END IF;

  INSERT INTO public.item_cost_layers
    (product_id, warehouse_id, owner_type, owner_id, quantity, total_value,
     valuation_method, last_unit_cost, last_movement_at, updated_at)
  VALUES
    (p_product_id, p_warehouse_id, p_owner_type, p_owner_id, v_qty1, v_val1,
     v_method,
     coalesce(p_incoming_cost, v_in_cost, v_out_cost, 0),
     now(), now())
  ON CONFLICT (product_id, warehouse_id, owner_type, owner_id)
  DO UPDATE SET quantity         = EXCLUDED.quantity,
                total_value      = EXCLUDED.total_value,
                valuation_method = EXCLUDED.valuation_method,
                last_unit_cost   = EXCLUDED.last_unit_cost,
                last_movement_at = now(),
                updated_at       = now();

  -- The ledger records what was ACTUALLY paid, never the valuation it was
  -- given. Under STANDARD the two differ, and that gap IS the variance the
  -- method exists to expose.
  INSERT INTO public.item_cost_transactions
    (product_id, warehouse_id, owner_type, owner_id, direction, quantity,
     unit_cost, value, method, quantity_before, value_before,
     quantity_after, value_after, source_type, source_id, note)
  VALUES
    (p_product_id, p_warehouse_id, p_owner_type, p_owner_id,
     CASE WHEN p_signed_qty > 0 THEN 'IN' ELSE 'OUT' END,
     abs(p_signed_qty),
     coalesce(p_incoming_cost, 0),
     round(abs(p_signed_qty) * coalesce(p_incoming_cost, 0), 2),
     v_method, v_qty0, v_val0, v_qty1, v_val1,
     p_source_type, p_source_id, p_note);

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'cost.movement_applied', 'product', p_product_id,
    jsonb_build_object(
      'warehouse_id', p_warehouse_id, 'method', v_method,
      'direction', CASE WHEN p_signed_qty > 0 THEN 'IN' ELSE 'OUT' END,
      'quantity', abs(p_signed_qty),
      'actual_cost', coalesce(p_incoming_cost, 0),
      'valuation_cost', coalesce(v_in_cost, v_out_cost, 0),
      'quantity_after', v_qty1, 'value_after', v_val1,
      'source_type', p_source_type, 'source_id', p_source_id));
END $function$;

CREATE OR REPLACE FUNCTION public.approve_item_policy_change(_item_id uuid, _new_nature item_nature, _new_policy inventory_policy, _new_costing costing_method, _new_tracking item_tracking, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user    uuid := auth.uid();
  v_before  jsonb;
  v_after   jsonb;
  v_product public.products%ROWTYPE;
  v_balance numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')) THEN
    RAISE EXCEPTION 'Only an owner or manager may approve an item policy change';
  END IF;

  IF coalesce(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'A written reason is required for every policy change';
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % does not exist', _item_id;
  END IF;

  -- ------------------------------------------------------------------ rules
  -- Rule 2: a SERVICE is not a way to switch stock off, and it can never hold
  -- a stock balance. Allowing SERVICE + TRACKED would resurrect the exact
  -- workaround this project is removing.
  IF _new_nature = 'SERVICE' AND _new_policy <> 'UNTRACKED' THEN
    RAISE EXCEPTION 'A SERVICE can only be UNTRACKED';
  END IF;

  IF _new_policy = 'UNTRACKED' AND _new_tracking <> 'NONE' THEN
    RAISE EXCEPTION 'An UNTRACKED item cannot require batch or serial tracking';
  END IF;

  IF _new_costing = 'NONE' AND _new_policy <> 'UNTRACKED' THEN
    RAISE EXCEPTION 'Costing method NONE is only valid for an UNTRACKED item';
  END IF;

  -- Moving a good OUT of tracking while it still holds stock would orphan that
  -- stock. The operator must clear the balance first (sell it, adjust it to
  -- zero, or move it to a customer-owned position) so the numbers stay honest.
  SELECT coalesce(sum(i.quantity), 0)
    INTO v_balance
  FROM public.inventory i
  WHERE i.product_id = _item_id
    AND i.owner_type = 'COMPANY'
    AND i.owner_id IS NULL;

  IF _new_policy <> 'TRACKED'
     AND v_product.inventory_policy = 'TRACKED'
     AND v_balance <> 0 THEN
    RAISE EXCEPTION
      'Item % still holds % units. Clear the balance with an adjustment before leaving TRACKED.',
      _item_id, v_balance;
  END IF;

  -- A tracked item needs a costing method that can actually value it.
  IF _new_policy = 'TRACKED' AND _new_costing = 'NONE' THEN
    RAISE EXCEPTION 'A TRACKED item requires a costing method other than NONE';
  END IF;

  v_before := jsonb_build_object(
    'item_nature', v_product.item_nature,
    'inventory_policy', v_product.inventory_policy,
    'costing_method', v_product.costing_method,
    'tracking', v_product.tracking
  );
  v_after := jsonb_build_object(
    'item_nature', _new_nature,
    'inventory_policy', _new_policy,
    'costing_method', _new_costing,
    'tracking', _new_tracking
  );

  -- Open the guard for this transaction only. set_config(..., true) is
  -- transaction-scoped, so the exemption cannot leak to another statement.
  PERFORM set_config('app.allow_policy_change', 'on', true);

  UPDATE public.products
  SET item_nature      = _new_nature,
      inventory_policy = _new_policy,
      costing_method   = _new_costing,
      tracking         = _new_tracking,
      updated_at       = now()
  WHERE id = _item_id;

  -- ⚠️ كان الوسيط الخامس هو نص السبب (btrim(_reason)) بينما توقيع الدالة
  --    p_source text — أي أن "المصدر" يُكتب داخل payload.source_document
  --    ويضيع السبب. أُصلح ليمرّر السبب في مكانه الصحيح، والمصدر ثابت.
  RETURN public.audit_item_policy_snapshot(
    _item_id,
    'item_policy.changed',
    v_before,
    v_after,
    'approval:' || btrim(_reason)
  );
END $function$;

CREATE OR REPLACE FUNCTION public.audit_item_policy_snapshot(p_item_id uuid, p_action text, p_before jsonb, p_after jsonb, p_source text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  -- ⚠️ audit_logs.action و entity_type هما NOT NULL: تمرير NULL كان يرمي
  --    23502 بدل تسجيل الحدث. نضع قيمًا افتراضية صريحة حتى لو نادت الدالة
  --    دالة جديدة بنفس العقد بلا وسيط.
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    auth.uid(),
    coalesce(nullif(btrim(p_action), ''), 'item_policy.updated'),
    'product_policy',
    p_item_id,
    jsonb_build_object(
      'before', p_before,
      'after', p_after,
      'source_document', p_source,
      'recorded_at', now()
    )
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.company_costing_method()
 RETURNS costing_method
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    (SELECT costing_method FROM public.company_costing_settings WHERE id = 1),
    'MOVING_AVERAGE'::public.costing_method
  );
$function$;

CREATE OR REPLACE FUNCTION public.create_stock_transfer(_from uuid, _to uuid, _note text, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id     uuid;
  v_no     text;
  v_user   uuid := auth.uid();
  v_item   jsonb;
  v_p      uuid;
  v_qty    numeric;
  v_stock  numeric;
  v_nature public.item_nature;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _from = _to THEN
    RAISE EXCEPTION 'Source and destination must differ';
  END IF;
  IF coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p   := (v_item ->> 'product_id')::uuid;
    v_qty := (v_item ->> 'quantity')::numeric;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid transfer quantity';
    END IF;

    SELECT p.item_nature INTO v_nature FROM public.products p WHERE p.id = v_p;
    IF v_nature = 'SERVICE' THEN
      RAISE EXCEPTION 'Item % is a SERVICE and cannot be transferred', v_p;
    END IF;
    IF public.item_effective_policy(v_p) <> 'TRACKED' THEN
      RAISE EXCEPTION 'Item % is not a tracked item and cannot be transferred between warehouses', v_p;
    END IF;

    SELECT i.quantity INTO v_stock
    FROM public.inventory i
    WHERE i.product_id = v_p
      AND i.warehouse_id = _from
      AND i.owner_type = 'COMPANY'
      AND i.owner_id IS NULL;

    IF coalesce(v_stock, 0) < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for item %', v_p;
    END IF;
  END LOOP;

  v_no := public.next_transfer_number();

  INSERT INTO public.stock_transfers (transfer_number, from_warehouse_id, to_warehouse_id, note, created_by)
  VALUES (v_no, _from, _to, nullif(btrim(_note), ''), v_user)
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p   := (v_item ->> 'product_id')::uuid;
    v_qty := (v_item ->> 'quantity')::numeric;

    INSERT INTO public.stock_transfer_items (transfer_id, product_id, quantity)
    VALUES (v_id, v_p, v_qty);

    PERFORM public.post_stock_delta(
      v_p, _from, -v_qty, NULL,
      'TRANSFER_OUT'::public.stock_movement_kind, 'stock_transfer', v_id,
      'Transfer out', 'COMPANY'::public.owner_type, NULL,
      'transfer_out'::public.movement_type
    );

    PERFORM public.post_stock_delta(
      v_p, _to, v_qty, NULL,
      'TRANSFER_IN'::public.stock_movement_kind, 'stock_transfer', v_id,
      'Transfer in', 'COMPANY'::public.owner_type, NULL,
      'transfer_in'::public.movement_type
    );
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'stock_transfer.posted', 'stock_transfer', v_id,
    jsonb_build_object(
      'transfer_number', v_no,
      'from_warehouse_id', _from,
      'to_warehouse_id', _to,
      'line_count', jsonb_array_length(_items)
    ));

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.customer_credit_limit_allows(p_customer_id uuid, p_new_due numeric)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.customers AS c
    CROSS JOIN public.company_settings AS s
    WHERE c.id = p_customer_id
      AND (
        NOT s.enforce_customer_credit_limit
        OR coalesce(c.credit_limit, 0) = 0
        OR coalesce(c.balance, 0) + greatest(coalesce(p_new_due, 0), 0) <= c.credit_limit
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.customer_ledger_balance(p_customer_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT round(coalesce(sum(l.debit - l.credit), 0), 2)
  FROM public.customer_ledger AS l
  WHERE l.customer_id = p_customer_id
$function$;

CREATE OR REPLACE FUNCTION public.item_effective_policy(p_item_id uuid)
 RETURNS inventory_policy
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(ci.inventory_policy, p.inventory_policy)
  FROM public.products p
  LEFT JOIN public.company_items ci
    ON ci.item_id = p.id AND ci.company_id = 1 AND ci.is_active
  WHERE p.id = p_item_id
$function$;

CREATE OR REPLACE FUNCTION public.item_has_stock_history(p_item_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.product_id = p_item_id)
      OR EXISTS (SELECT 1 FROM public.inventory i WHERE i.product_id = p_item_id AND i.quantity <> 0)
$function$;

CREATE OR REPLACE FUNCTION public.item_line_type(p_item_id uuid, p_is_ad_hoc boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nature public.item_nature;
  v_policy public.inventory_policy;
BEGIN
  IF p_is_ad_hoc THEN
    RETURN 'AD_HOC_SERVICE';
  END IF;
  IF p_item_id IS NULL THEN
    RETURN 'AD_HOC_SERVICE';
  END IF;

  SELECT p.item_nature INTO v_nature FROM public.products p WHERE p.id = p_item_id;
  IF v_nature IS NULL THEN
    RETURN 'AD_HOC_SERVICE';
  END IF;
  IF v_nature = 'SERVICE' THEN
    RETURN 'SERVICE';
  END IF;

  v_policy := public.item_effective_policy(p_item_id);
  RETURN CASE v_policy
    WHEN 'TRACKED'        THEN 'STOCKED_GOOD'
    WHEN 'CUSTOMER_OWNED' THEN 'CUSTOMER_OWNED_GOOD'
    ELSE 'UNTRACKED_GOOD'
  END;
END $function$;

CREATE OR REPLACE FUNCTION public.item_stock_effect(p_item_id uuid, p_direction text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.next_stock_adjustment_number()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n bigint;
BEGIN
  n := nextval('public.stock_adjustment_seq');
  RETURN 'ADJ-' || to_char(now(), 'YYYYMM') || '-' || lpad(n::text, 4, '0');
END $function$;

CREATE OR REPLACE FUNCTION public.next_stock_opening_number()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n bigint;
BEGIN
  n := nextval('public.stock_opening_seq');
  RETURN 'OP-' || to_char(now(), 'YYYYMM') || '-' || lpad(n::text, 4, '0');
END $function$;

-- NOTE: next_transfer_number() is defined ONCE, in 14_document_numbering_engine.sql.
-- This file used to define its own copy reading stock_transfer_seq directly. The
-- engine now owns that sequence and the display format, so a second definition
-- here would be dead code whose body could silently drift from the engine's
-- (R-13/R-14). The function name and signature are unchanged, so no caller breaks.

CREATE OR REPLACE FUNCTION public.post_opening_stock(_warehouse_id uuid, _effective_date date, _note text, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.post_stock_adjustment(_warehouse_id uuid, _reason text, _note text, _effective_date date, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    RAISE EXCEPTION 'You are not permitted to post stock adjustments';
  END IF;

  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required';
  END IF;

  IF coalesce(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'A documented reason is required for every stock adjustment';
  END IF;

  IF coalesce(jsonb_typeof(_items), '') <> 'array'
     OR coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'A stock adjustment requires at least one item';
  END IF;

  FOR v_line IN
    SELECT (line ->> 'product_id')::uuid                 AS product_id,
           (line ->> 'quantity')::numeric                AS quantity,
           coalesce((line ->> 'unit_cost')::numeric, 0)  AS unit_cost,
           nullif(btrim(coalesce(line ->> 'note', '')), '') AS note
    FROM jsonb_array_elements(_items) AS line
  LOOP
    IF v_line.product_id IS NULL OR v_line.quantity IS NULL OR v_line.quantity = 0 THEN
      RAISE EXCEPTION 'Every adjustment line requires an item and a non-zero quantity';
    END IF;

    SELECT p.item_nature INTO v_nature FROM public.products p WHERE p.id = v_line.product_id;
    IF v_nature IS NULL THEN
      RAISE EXCEPTION 'Item % does not exist', v_line.product_id;
    END IF;
    IF v_nature = 'SERVICE' THEN
      RAISE EXCEPTION 'Item % is a SERVICE and has no inventory to adjust', v_line.product_id;
    END IF;

    v_policy := public.item_effective_policy(v_line.product_id);
    IF v_policy <> 'TRACKED' THEN
      RAISE EXCEPTION
        'Item % has inventory policy %, so it has no inventory balance to adjust',
        v_line.product_id, v_policy;
    END IF;
  END LOOP;

  v_number := public.next_stock_adjustment_number();

  INSERT INTO public.stock_adjustments (document_number, warehouse_id, effective_date, reason, note, created_by)
  VALUES (v_number, _warehouse_id, coalesce(_effective_date, current_date), btrim(_reason),
          nullif(btrim(coalesce(_note, '')), ''), v_user)
  RETURNING id INTO v_id;

  FOR v_line IN
    SELECT (line ->> 'product_id')::uuid                 AS product_id,
           (line ->> 'quantity')::numeric                AS quantity,
           coalesce((line ->> 'unit_cost')::numeric, 0)  AS unit_cost,
           nullif(btrim(coalesce(line ->> 'note', '')), '') AS note
    FROM jsonb_array_elements(_items) AS line
  LOOP
    v_line_total := round(abs(v_line.quantity) * v_line.unit_cost, 2);
    v_total := v_total + v_line_total;

    INSERT INTO public.stock_adjustment_items (adjustment_id, product_id, quantity, unit_cost, total_cost, note)
    VALUES (v_id, v_line.product_id, v_line.quantity, v_line.unit_cost, v_line_total, v_line.note);

    -- signed quantity goes straight through: positive adds, negative removes.
    PERFORM public.post_stock_delta(
      v_line.product_id,
      _warehouse_id,
      v_line.quantity,
      v_line.unit_cost,
      'ADJUSTMENT'::public.stock_movement_kind,
      'stock_adjustment',
      v_id,
      coalesce(v_line.note, btrim(_reason)),
      'COMPANY'::public.owner_type,
      NULL,
      'adjustment'::public.movement_type
    );
  END LOOP;

  -- The DB constraint requires a coded reason on every adjustment movement.
  UPDATE public.stock_movements
  SET adjustment_reason = btrim(_reason)
  WHERE source_type = 'stock_adjustment'
    AND source_id = v_id
    AND movement_kind = 'ADJUSTMENT'
    AND adjustment_reason IS NULL;

  UPDATE public.stock_adjustments SET total_value = v_total WHERE id = v_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'stock_adjustment.posted', 'stock_adjustment', v_id,
    jsonb_build_object(
      'document_number', v_number,
      'warehouse_id', _warehouse_id,
      'reason', btrim(_reason),
      'effective_date', coalesce(_effective_date, current_date),
      'lines', jsonb_array_length(_items),
      'total_value', v_total
    ));

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.post_stock_delta(p_product_id uuid, p_warehouse_id uuid, p_signed_qty numeric, p_unit_cost numeric DEFAULT NULL::numeric, p_movement_kind stock_movement_kind DEFAULT 'ADJUSTMENT'::stock_movement_kind, p_source_type text DEFAULT NULL::text, p_source_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text, p_owner_type owner_type DEFAULT 'COMPANY'::owner_type, p_owner_id uuid DEFAULT NULL::uuid, p_movement_type_legacy movement_type DEFAULT NULL::movement_type)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing    numeric;
  v_new_qty     numeric;
  v_total_cost  numeric;
  v_legacy_type public.movement_type;
  v_owner_type  public.owner_type := COALESCE(p_owner_type, 'COMPANY');
BEGIN
  IF p_signed_qty IS NULL OR p_signed_qty = 0 THEN
    RAISE EXCEPTION 'Stock delta must be a non-zero quantity';
  END IF;

  IF p_product_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Item and location are required for a stock movement';
  END IF;

  -- Lock the exact position being changed.
  SELECT quantity
    INTO v_existing
  FROM public.inventory
  WHERE product_id = p_product_id
    AND warehouse_id = p_warehouse_id
    AND owner_type = v_owner_type
    AND owner_id IS NOT DISTINCT FROM p_owner_id
  FOR UPDATE;

  v_existing := COALESCE(v_existing, 0);
  v_new_qty  := round(v_existing + p_signed_qty, 3);

  -- Stock can never go negative, for company stock or for customer-owned stock.
  IF v_new_qty < 0 THEN
    RAISE EXCEPTION
      'Insufficient stock: item %, location %, available %, requested %',
      p_product_id, p_warehouse_id, v_existing, abs(p_signed_qty)
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.inventory (product_id, warehouse_id, quantity, owner_type, owner_id, updated_at)
  VALUES (p_product_id, p_warehouse_id, v_new_qty, v_owner_type, p_owner_id, now())
  ON CONFLICT (product_id, warehouse_id, owner_type, owner_id)
  DO UPDATE SET quantity = v_new_qty, updated_at = now();

  v_total_cost := CASE
    WHEN p_unit_cost IS NULL THEN NULL
    ELSE round(abs(p_signed_qty) * p_unit_cost, 2)
  END;

  -- Legacy enum value, so the old reporting paths keep working unchanged.
  v_legacy_type := COALESCE(
    p_movement_type_legacy,
    CASE p_movement_kind
      WHEN 'RECEIPT'      THEN 'purchase'::public.movement_type
      WHEN 'ISSUE'        THEN 'sale'::public.movement_type
      WHEN 'TRANSFER_IN'  THEN 'transfer_in'::public.movement_type
      WHEN 'TRANSFER_OUT' THEN 'transfer_out'::public.movement_type
      WHEN 'OPENING'      THEN 'opening'::public.movement_type
      -- PRODUCTION كان يسقط في ELSE فيُسجّل «adjustment»، وهو خطأ: ناتج الإنتاج
      -- ليس تسوية جرد، وتسجيله كذلك يجعل تقرير الإنتاج يخلو من نواتجه.
      WHEN 'PRODUCTION'   THEN 'production_in'::public.movement_type
      ELSE 'adjustment'::public.movement_type
    END
  );

  INSERT INTO public.stock_movements (
    product_id, warehouse_id, movement_type, movement_kind,
    quantity, unit_cost, total_cost,
    reference_type, reference_id, source_type, source_id,
    owner_type, owner_id,
    note, created_by
  )
  VALUES (
    p_product_id, p_warehouse_id, v_legacy_type, p_movement_kind,
    abs(p_signed_qty), p_unit_cost, v_total_cost,
    p_source_type, p_source_id, p_source_type, p_source_id,
    v_owner_type, p_owner_id,
    nullif(btrim(COALESCE(p_note, '')), ''), auth.uid()
  );

  RETURN v_new_qty;
END $function$;

CREATE OR REPLACE FUNCTION public.product_delete_guard(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_counts jsonb;
  v_blocking bigint;
BEGIN
  -- Permission check: only owner/manager may hard-delete a product.
  IF NOT (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'manager')
    OR public.is_platform_admin(auth.uid())
  ) THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'forbidden');
  END IF;

  v_counts   := public.product_reference_counts(p_product_id);
  v_blocking := COALESCE((v_counts ->> 'blocking_total')::bigint, 0);

  IF v_blocking > 0 THEN
    -- Referenced by history -> never delete. The UI offers deactivation instead.
    RETURN jsonb_build_object(
      'deleted', false,
      'reason',  'referenced',
      'counts',  v_counts
    );
  END IF;

  -- Not referenced by any document or movement: safe to remove.
  -- Clean the pure-catalog satellites that carry no financial meaning.
  BEGIN
    DELETE FROM public.product_compatibilities WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  DELETE FROM public.inventory WHERE product_id = p_product_id;

  DELETE FROM public.products WHERE id = p_product_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'deleted', true,
    'reason',  'deleted',
    'counts',  v_counts
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.product_reference_counts(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sales_items      bigint := 0;
  v_purchase_items   bigint := 0;
  v_sales_returns    bigint := 0;
  v_purchase_returns bigint := 0;
  v_transfers        bigint := 0;
  v_stock_movements  bigint := 0;
  v_inventory_rows   bigint := 0;
  v_compatibilities  bigint := 0;
  v_blocking         bigint := 0;
BEGIN
  -- Historical / financial documents: these MUST block deletion.
  SELECT count(*) INTO v_sales_items
    FROM public.sales_invoice_items WHERE product_id = p_product_id;

  SELECT count(*) INTO v_purchase_items
    FROM public.purchase_invoice_items WHERE product_id = p_product_id;

  -- Returns and transfers are guarded dynamically: some deployments have these
  -- tables, older ones do not. Missing tables count as zero.
  BEGIN
    SELECT count(*) INTO v_sales_returns
      FROM public.sales_return_items WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_sales_returns := 0;
  END;

  BEGIN
    SELECT count(*) INTO v_purchase_returns
      FROM public.purchase_return_items WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_purchase_returns := 0;
  END;

  BEGIN
    SELECT count(*) INTO v_transfers
      FROM public.stock_transfer_items WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_transfers := 0;
  END;

  -- Audit trail: destroying this loses the product's stock history.
  SELECT count(*) INTO v_stock_movements
    FROM public.stock_movements WHERE product_id = p_product_id;

  SELECT count(*) INTO v_inventory_rows
    FROM public.inventory WHERE product_id = p_product_id;

  BEGIN
    SELECT count(*) INTO v_compatibilities
      FROM public.product_compatibilities WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_compatibilities := 0;
  END;

  v_blocking := v_sales_items + v_purchase_items + v_sales_returns
              + v_purchase_returns + v_transfers + v_stock_movements;

  RETURN jsonb_build_object(
    'product_id',          p_product_id,
    'sales_items',         v_sales_items,
    'purchase_items',      v_purchase_items,
    'sales_returns',       v_sales_returns,
    'purchase_returns',    v_purchase_returns,
    'transfers',           v_transfers,
    'stock_movements',     v_stock_movements,
    'inventory_rows',      v_inventory_rows,
    'compatibilities',     v_compatibilities,
    'blocking_total',      v_blocking,
    'can_delete',          v_blocking = 0,
    'has_history',         v_stock_movements > 0 OR v_inventory_rows > 0
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.receive_customer_owned_stock(_customer_id uuid, _product_id uuid, _warehouse_id uuid, _quantity numeric, _unit_cost numeric, _note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.release_customer_owned_stock(_customer_id uuid, _product_id uuid, _warehouse_id uuid, _quantity numeric, _note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.resolve_unit_cost(p_product_id uuid, p_warehouse_id uuid DEFAULT NULL::uuid, p_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.save_item_policy(_item_id uuid, _item_nature item_nature, _inventory_policy inventory_policy, _costing_method costing_method, _tracking item_tracking, _is_sellable boolean, _is_purchasable boolean, _base_uom_id uuid DEFAULT NULL::uuid, _sales_uom_id uuid DEFAULT NULL::uuid, _purchase_uom_id uuid DEFAULT NULL::uuid, _uom_conversions jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.search_products(p_query text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_brand_id uuid DEFAULT NULL::uuid, p_unit_id uuid DEFAULT NULL::uuid, p_origin_id uuid DEFAULT NULL::uuid, p_active boolean DEFAULT NULL::boolean, p_low_stock boolean DEFAULT NULL::boolean, p_sort_key text DEFAULT 'created_at'::text, p_sort_dir text DEFAULT 'desc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, name text, name_ar text, sku text, barcode text, sale_price numeric, cost_price numeric, tax_rate numeric, min_stock numeric, shelf_location text, origin_id uuid, quality_grade_id uuid, is_active boolean, category_id uuid, brand_id uuid, unit_id uuid, created_at timestamp with time zone, category_name text, category_name_ar text, brand_name text, brand_name_ar text, unit_short_name text, unit_name_ar text, stock_qty numeric, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH filtered AS (
    SELECT
      p.id, p.name, p.name_ar, p.sku, p.barcode,
      p.sale_price, p.cost_price, p.tax_rate, p.min_stock, p.shelf_location,
      p.origin_id, p.quality_grade_id, p.is_active,
      p.category_id, p.brand_id, p.unit_id, p.created_at,
      c.name    AS category_name,
      c.name_ar AS category_name_ar,
      b.name    AS brand_name,
      b.name_ar AS brand_name_ar,
      u.short_name AS unit_short_name,
      u.name_ar    AS unit_name_ar,
      COALESCE((
        SELECT sum(i.quantity) FROM public.inventory i WHERE i.product_id = p.id
      ), 0) AS stock_qty
    FROM public.products p
    LEFT JOIN public.categories c ON c.id = p.category_id
    LEFT JOIN public.brands     b ON b.id = p.brand_id
    LEFT JOIN public.units      u ON u.id = p.unit_id
    WHERE
      -- Fuzzy-ish text search: case-insensitive substring across the identity
      -- fields. Uses simple LIKE so it works on any Postgres without extensions.
      (
        p_query IS NULL
        OR btrim(p_query) = ''
        OR p.name        ILIKE '%' || btrim(p_query) || '%'
        OR p.name_ar     ILIKE '%' || btrim(p_query) || '%'
        OR p.sku         ILIKE '%' || btrim(p_query) || '%'
        OR p.barcode     ILIKE '%' || btrim(p_query) || '%'
        OR p.shelf_location ILIKE '%' || btrim(p_query) || '%'
      )
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
      AND (p_brand_id    IS NULL OR p.brand_id    = p_brand_id)
      AND (p_unit_id     IS NULL OR p.unit_id     = p_unit_id)
      AND (p_origin_id   IS NULL OR p.origin_id   = p_origin_id)
      AND (p_active      IS NULL OR p.is_active   = p_active)
  ),
  counted AS (
    SELECT *, count(*) OVER () AS total_count FROM filtered
  )
  SELECT
    id, name, name_ar, sku, barcode,
    sale_price, cost_price, tax_rate, min_stock, shelf_location,
    origin_id, quality_grade_id, is_active,
    category_id, brand_id, unit_id, created_at,
    category_name, category_name_ar, brand_name, brand_name_ar,
    unit_short_name, unit_name_ar,
    stock_qty, total_count
  FROM counted
  WHERE
    p_low_stock IS NULL
    OR (p_low_stock = true  AND stock_qty <= min_stock)
    OR (p_low_stock = false AND stock_qty >  min_stock)
  ORDER BY
    CASE WHEN p_sort_key = 'name'       AND p_sort_dir = 'asc'  THEN COALESCE(name_ar, name) END ASC NULLS LAST,
    CASE WHEN p_sort_key = 'name'       AND p_sort_dir = 'desc' THEN COALESCE(name_ar, name) END DESC NULLS LAST,
    CASE WHEN p_sort_key = 'sku'        AND p_sort_dir = 'asc'  THEN sku END ASC NULLS LAST,
    CASE WHEN p_sort_key = 'sku'        AND p_sort_dir = 'desc' THEN sku END DESC NULLS LAST,
    CASE WHEN p_sort_key = 'sale_price' AND p_sort_dir = 'asc'  THEN sale_price END ASC NULLS LAST,
    CASE WHEN p_sort_key = 'sale_price' AND p_sort_dir = 'desc' THEN sale_price END DESC NULLS LAST,
    CASE WHEN p_sort_key = 'cost_price' AND p_sort_dir = 'asc'  THEN cost_price END ASC NULLS LAST,
    CASE WHEN p_sort_key = 'cost_price' AND p_sort_dir = 'desc' THEN cost_price END DESC NULLS LAST,
    CASE WHEN p_sort_key = 'stock'      AND p_sort_dir = 'asc'  THEN stock_qty END ASC NULLS LAST,
    CASE WHEN p_sort_key = 'stock'      AND p_sort_dir = 'desc' THEN stock_qty END DESC NULLS LAST,
    CASE WHEN p_sort_key = 'created_at' AND p_sort_dir = 'asc'  THEN created_at END ASC NULLS LAST,
    CASE WHEN p_sort_key = 'created_at' AND p_sort_dir = 'desc' THEN created_at END DESC NULLS LAST,
    created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
$function$;

CREATE OR REPLACE FUNCTION public.set_company_costing_method(_method text, _source text, _notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_old  public.costing_method;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')) THEN
    RAISE EXCEPTION 'Only an owner or manager can change the company costing method';
  END IF;
  -- ⚠️ _method قد تكون NULL (أو بأحرف صغيرة من الواجهة). التحقق القديم
  --    `_method NOT IN (...)` يقبل NULL بصمت لأن NULL NOT IN (...) = NULL،
  --    ثم يُدرج NULL في costing_policy_history.costing_method (NOT NULL)
  --    فيرمي 23502 بدل رسالة واضحة. الآن يُرفض null/farغ صراحةً ويُطبَّع الحرف.
  _method := upper(btrim(coalesce(_method, '')));
  IF _method IS NULL OR _method = '' THEN
    RAISE EXCEPTION 'Costing method is required (MOVING_AVERAGE or STANDARD)'
      USING ERRCODE = '22023';
  END IF;
  IF _method NOT IN ('MOVING_AVERAGE', 'STANDARD') THEN
    RAISE EXCEPTION 'Costing method must be MOVING_AVERAGE or STANDARD (got %)', _method
      USING ERRCODE = '22023';
  END IF;

  SELECT costing_method INTO v_old FROM public.company_costing_settings WHERE id = 1 FOR UPDATE;
  IF v_old = _method::public.costing_method THEN
    RETURN;  -- idempotent: re-selecting the same method is not a change
  END IF;

  UPDATE public.company_costing_settings
     SET costing_method = _method::public.costing_method,
         standard_cost_source = coalesce(_source, standard_cost_source),
         effective_from    = CURRENT_DATE,
         updated_by        = v_user,
         updated_at        = now(),
         notes             = nullif(btrim(coalesce(_notes, '')), '')
   WHERE id = 1;

  INSERT INTO public.costing_policy_history (costing_method, previous_method, reason, changed_by)
  VALUES (_method::public.costing_method, v_old, nullif(btrim(coalesce(_notes, '')), ''), v_user);
END $function$;

CREATE OR REPLACE FUNCTION public.set_company_item_policy(_item_id uuid, _inventory_policy inventory_policy DEFAULT NULL::inventory_policy, _costing_method costing_method DEFAULT NULL::costing_method, _default_cost numeric DEFAULT NULL::numeric, _default_sale_price numeric DEFAULT NULL::numeric, _tax_rate numeric DEFAULT NULL::numeric, _is_active boolean DEFAULT true, _company_id integer DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user    uuid := auth.uid();
  v_id      uuid;
  v_before  jsonb;
  v_after   jsonb;
  v_nature  public.item_nature;
  v_balance numeric;
  v_existing public.company_items%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')) THEN
    RAISE EXCEPTION 'Only an owner or manager may change a company item policy';
  END IF;

  SELECT p.item_nature INTO v_nature FROM public.products p WHERE p.id = _item_id;
  IF v_nature IS NULL THEN
    RAISE EXCEPTION 'Item % does not exist', _item_id;
  END IF;

  IF v_nature = 'SERVICE' AND _inventory_policy IS NOT NULL AND _inventory_policy <> 'UNTRACKED' THEN
    RAISE EXCEPTION 'A SERVICE can only be UNTRACKED in any company';
  END IF;

  IF _default_cost IS NOT NULL AND _default_cost < 0 THEN
    RAISE EXCEPTION 'Default cost cannot be negative';
  END IF;
  IF _default_sale_price IS NOT NULL AND _default_sale_price < 0 THEN
    RAISE EXCEPTION 'Default sale price cannot be negative';
  END IF;
  IF _tax_rate IS NOT NULL AND (_tax_rate < 0 OR _tax_rate > 100) THEN
    RAISE EXCEPTION 'Tax rate must be between 0 and 100';
  END IF;

  SELECT * INTO v_existing
  FROM public.company_items
  WHERE company_id = _company_id AND item_id = _item_id
  FOR UPDATE;

  -- Refuse to strand stock by turning tracking off for a company that holds it.
  IF _inventory_policy IS NOT NULL AND _inventory_policy <> 'TRACKED' THEN
    SELECT coalesce(sum(i.quantity), 0) INTO v_balance
    FROM public.inventory i
    WHERE i.product_id = _item_id
      AND i.owner_type = 'COMPANY'
      AND i.owner_id IS NULL;

    IF v_balance <> 0
       AND coalesce(v_existing.inventory_policy, (SELECT p.inventory_policy FROM public.products p WHERE p.id = _item_id)) = 'TRACKED' THEN
      RAISE EXCEPTION
        'Company % still holds % units of item %. Clear the balance before leaving TRACKED.',
        _company_id, v_balance, _item_id;
    END IF;
  END IF;

  v_before := CASE WHEN v_existing.id IS NULL THEN NULL ELSE
    jsonb_build_object(
      'inventory_policy', v_existing.inventory_policy,
      'costing_method', v_existing.costing_method,
      'default_cost', v_existing.default_cost,
      'default_sale_price', v_existing.default_sale_price,
      'tax_rate', v_existing.tax_rate,
      'is_active', v_existing.is_active
    ) END;

  INSERT INTO public.company_items (
    company_id, item_id, inventory_policy, costing_method,
    default_cost, default_sale_price, tax_rate, is_active
  )
  VALUES (
    _company_id, _item_id, _inventory_policy, _costing_method,
    _default_cost, _default_sale_price, _tax_rate, coalesce(_is_active, true)
  )
  ON CONFLICT (company_id, item_id) DO UPDATE
  SET inventory_policy   = COALESCE(EXCLUDED.inventory_policy,   public.company_items.inventory_policy),
      costing_method     = COALESCE(EXCLUDED.costing_method,     public.company_items.costing_method),
      default_cost       = COALESCE(EXCLUDED.default_cost,       public.company_items.default_cost),
      default_sale_price = COALESCE(EXCLUDED.default_sale_price, public.company_items.default_sale_price),
      tax_rate           = COALESCE(EXCLUDED.tax_rate,           public.company_items.tax_rate),
      is_active          = EXCLUDED.is_active,
      updated_at         = now()
  RETURNING id INTO v_id;

  SELECT jsonb_build_object(
           'inventory_policy', ci.inventory_policy,
           'costing_method', ci.costing_method,
           'default_cost', ci.default_cost,
           'default_sale_price', ci.default_sale_price,
           'tax_rate', ci.tax_rate,
           'is_active', ci.is_active
         )
    INTO v_after
  FROM public.company_items ci WHERE ci.id = v_id;

  PERFORM public.audit_item_policy_snapshot(
    _item_id,
    'company_item_policy.changed',
    coalesce(v_before, '{}'::jsonb),
    v_after,
    'company:' || _company_id
  );

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.set_standard_costs(_costs jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_n    integer := 0;
  e      jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')) THEN
    RAISE EXCEPTION 'Only an owner or manager may set standard costs';
  END IF;
  IF _costs IS NULL OR jsonb_array_length(_costs) = 0 THEN
    RAISE EXCEPTION 'No standards supplied';
  END IF;

  FOR e IN SELECT * FROM jsonb_array_elements(_costs)
  LOOP
    IF coalesce((e->>'standard_cost')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Standard cost must be greater than zero for product %', e->>'product_id';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products p
                    WHERE p.id = (e->>'product_id')::uuid
                      AND p.item_nature = 'GOOD' AND p.inventory_policy = 'TRACKED') THEN
      RAISE EXCEPTION 'Product % is not a tracked good', e->>'product_id';
    END IF;

    UPDATE public.products
       SET standard_cost = (e->>'standard_cost')::numeric
     WHERE id = (e->>'product_id')::uuid;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    VALUES (v_user, 'product.standard_cost_set', 'product', (e->>'product_id')::uuid,
            jsonb_build_object('standard_cost', (e->>'standard_cost')::numeric,
                               'implied', (e->>'implied_standard')::numeric,
                               'note', nullif(btrim(coalesce(e->>'note','')), '')));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;

CREATE OR REPLACE FUNCTION public.sync_item_class_from_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.item_nature IS DISTINCT FROM OLD.item_nature
     OR NEW.inventory_policy IS DISTINCT FROM OLD.inventory_policy THEN

    -- الطبيعة تحكم أولاً: الخدمة خدمة.
    IF NEW.item_nature = 'SERVICE' THEN
      NEW.item_class := 'SERVICE';

    ELSIF NEW.item_nature = 'GOOD' THEN
      -- الأصناف التي تصنيفها *خاصية جوهرية* لا تُدهَس بالمنتج النهائي:
      -- خام قابل للاستهلاك، ناتج جانبي، وتعبئة تُشترى وتُستهلك.
      IF NEW.item_class IS NULL
         OR NEW.item_class NOT IN ('RAW_MATERIAL', 'BY_PRODUCT', 'PACKAGING') THEN
        NEW.item_class := 'FINISHED_GOOD';
      END IF;
    END IF;

    -- السياسة تحدّ الحالة التي لا تُمسك رصيداً.
    IF NEW.inventory_policy = 'CUSTOMER_OWNED' THEN
      -- أمانات العميل ليست مخزوناً تجارياً؛ تبقى ماديّةً في تصنيفها الأصلي.
      IF NEW.item_class IS NULL THEN
        NEW.item_class := 'NON_STOCK_ITEM';
      END IF;
    ELSIF NEW.inventory_policy = 'UNTRACKED' AND NEW.item_nature = 'GOOD' THEN
      -- صنف مادي غير متتبَّع: لا رصيد له مهما كان نوعه.
      NEW.item_class := 'NON_STOCK_ITEM';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.tg_guard_item_policy_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.warehouse_reference_counts(p_warehouse_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

