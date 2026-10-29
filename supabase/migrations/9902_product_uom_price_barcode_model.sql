-- Product-specific units, defaults, prices and barcodes.
-- This adds the normalized master-data model and line snapshot fields. Existing
-- invoice RPCs/UI remain on the base unit until the next integration step wires
-- their atomic posting paths to this model; do not enable alternate UoMs yet.
BEGIN;

ALTER TABLE public.units
  ADD COLUMN dimension_code text DEFAULT 'CUSTOM' NOT NULL,
  ADD COLUMN factor_to_reference numeric(30,12),
  ADD CONSTRAINT units_dimension_code_check CHECK (
    dimension_code IN ('COUNT', 'MASS', 'VOLUME', 'LENGTH', 'AREA', 'TIME', 'PACKAGING', 'CUSTOM')
  ),
  ADD CONSTRAINT units_factor_to_reference_positive CHECK (
    factor_to_reference IS NULL OR factor_to_reference > 0
  );

CREATE TABLE public.product_uoms (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  product_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  factor_to_base numeric(30,12) NOT NULL,
  conversion_basis text DEFAULT 'STANDARD' NOT NULL,
  conversion_note text,
  quantity_increment numeric(30,12) DEFAULT 0.001 NOT NULL,
  can_purchase boolean DEFAULT false NOT NULL,
  can_sell boolean DEFAULT false NOT NULL,
  is_default_purchase boolean DEFAULT false NOT NULL,
  is_default_sale boolean DEFAULT false NOT NULL,
  is_base boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT product_uoms_pkey PRIMARY KEY (id),
  CONSTRAINT product_uoms_product_id_unit_id_key UNIQUE (product_id, unit_id),
  CONSTRAINT product_uoms_id_product_id_key UNIQUE (id, product_id),
  CONSTRAINT product_uoms_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
  CONSTRAINT product_uoms_unit_id_fkey
    FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE RESTRICT,
  CONSTRAINT product_uoms_factor_positive CHECK (factor_to_base > 0),
  CONSTRAINT product_uoms_conversion_basis_check CHECK (
    conversion_basis IN ('STANDARD', 'FIXED_PACKAGE', 'ITEM_SPECIFIC')
    AND ((conversion_basis = 'STANDARD' AND conversion_note IS NULL)
      OR (conversion_basis <> 'STANDARD' AND length(btrim(coalesce(conversion_note, ''))) >= 3))
  ),
  CONSTRAINT product_uoms_increment_positive CHECK (quantity_increment > 0),
  CONSTRAINT product_uoms_increment_precision CHECK (quantity_increment = round(quantity_increment, 6)),
  CONSTRAINT product_uoms_base_factor_one CHECK (NOT is_base OR factor_to_base = 1),
  CONSTRAINT product_uoms_default_purchase_enabled CHECK (NOT is_default_purchase OR can_purchase),
  CONSTRAINT product_uoms_default_sale_enabled CHECK (NOT is_default_sale OR can_sell)
);

CREATE UNIQUE INDEX product_uoms_one_base_per_product
  ON public.product_uoms(product_id) WHERE is_base;
CREATE UNIQUE INDEX product_uoms_one_default_purchase_per_product
  ON public.product_uoms(product_id) WHERE is_default_purchase AND is_active;
CREATE UNIQUE INDEX product_uoms_one_default_sale_per_product
  ON public.product_uoms(product_id) WHERE is_default_sale AND is_active;
CREATE INDEX product_uoms_product_active_idx
  ON public.product_uoms(product_id, is_active);

CREATE TABLE public.product_uom_prices (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id integer DEFAULT 1 NOT NULL,
  product_id uuid NOT NULL,
  product_uom_id uuid NOT NULL,
  sale_price numeric(18,4),
  purchase_price numeric(18,4),
  updated_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT product_uom_prices_pkey PRIMARY KEY (id),
  CONSTRAINT product_uom_prices_company_uom_key UNIQUE (company_id, product_uom_id),
  CONSTRAINT product_uom_prices_nonnegative CHECK (
    (sale_price IS NULL OR sale_price >= 0)
    AND (purchase_price IS NULL OR purchase_price >= 0)
  ),
  CONSTRAINT product_uom_prices_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.company_settings(id) ON DELETE CASCADE,
  CONSTRAINT product_uom_prices_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
  CONSTRAINT product_uom_prices_product_uom_fk
    FOREIGN KEY (product_uom_id, product_id)
    REFERENCES public.product_uoms(id, product_id) ON DELETE CASCADE
);

CREATE TABLE public.product_uom_barcodes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id integer DEFAULT 1 NOT NULL,
  product_id uuid NOT NULL,
  product_uom_id uuid NOT NULL,
  barcode text NOT NULL,
  is_primary boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT product_uom_barcodes_pkey PRIMARY KEY (id),
  CONSTRAINT product_uom_barcodes_company_barcode_key UNIQUE (company_id, barcode),
  CONSTRAINT product_uom_barcodes_code_nonempty CHECK (
    length(btrim(barcode)) > 0 AND barcode = btrim(barcode)
  ),
  CONSTRAINT product_uom_barcodes_product_uom_fk
    FOREIGN KEY (product_uom_id, product_id)
    REFERENCES public.product_uoms(id, product_id) ON DELETE CASCADE,
  CONSTRAINT product_uom_barcodes_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.company_settings(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX product_uom_barcodes_one_primary_per_uom
  ON public.product_uom_barcodes(company_id, product_uom_id)
  WHERE is_primary AND is_active;
CREATE INDEX product_uom_barcodes_product_idx
  ON public.product_uom_barcodes(company_id, product_id, is_active);

ALTER TABLE public.sales_invoice_items
  ADD COLUMN entered_quantity numeric(18,6),
  ADD COLUMN base_quantity numeric(18,6),
  ADD COLUMN uom_conversion_factor numeric(30,12),
  ADD COLUMN entered_unit_price numeric(18,4);

ALTER TABLE public.purchase_invoice_items
  ADD COLUMN uom_id uuid,
  ADD COLUMN entered_quantity numeric(18,6),
  ADD COLUMN base_quantity numeric(18,6),
  ADD COLUMN uom_conversion_factor numeric(30,12),
  ADD COLUMN entered_unit_cost numeric(18,4);

ALTER TABLE public.sales_invoice_items
  ADD CONSTRAINT sales_invoice_items_uom_snapshot_check CHECK (
    num_nonnulls(entered_quantity, base_quantity, uom_conversion_factor, entered_unit_price) IN (0, 4)
    AND (entered_quantity IS NULL OR (entered_quantity > 0 AND base_quantity > 0
      AND uom_conversion_factor > 0 AND entered_unit_price >= 0))
  );

ALTER TABLE public.purchase_invoice_items
  ADD CONSTRAINT purchase_invoice_items_uom_snapshot_check CHECK (
    num_nonnulls(entered_quantity, base_quantity, uom_conversion_factor, entered_unit_cost) IN (0, 4)
    AND (entered_quantity IS NULL OR (entered_quantity > 0 AND base_quantity > 0
      AND uom_conversion_factor > 0 AND entered_unit_cost >= 0))
  ),
  ADD CONSTRAINT purchase_invoice_items_uom_id_fkey
    FOREIGN KEY (uom_id) REFERENCES public.units(id) ON DELETE SET NULL;

ALTER TABLE public.product_uoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_uom_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_uom_barcodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_uoms_staff_read ON public.product_uoms
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY product_uom_prices_staff_read ON public.product_uom_prices
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()) AND company_id = 1);
CREATE POLICY product_uom_barcodes_staff_read ON public.product_uom_barcodes
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()) AND company_id = 1);

REVOKE ALL ON public.product_uoms, public.product_uom_prices, public.product_uom_barcodes
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.product_uoms, public.product_uom_prices, public.product_uom_barcodes
  TO authenticated;
GRANT ALL ON public.product_uoms, public.product_uom_prices, public.product_uom_barcodes
  TO service_role;

CREATE OR REPLACE FUNCTION public.product_uom_factor(
  _product_id uuid,
  _unit_id uuid,
  _direction text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_base_unit uuid;
  v_unit_id uuid;
  v_factor numeric;
  v_active boolean;
  v_allowed boolean;
BEGIN
  IF coalesce(_direction, '') NOT IN ('SALE', 'PURCHASE') THEN
    RAISE EXCEPTION 'Unsupported product unit direction: %', _direction
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(p.base_uom_id, p.unit_id)
    INTO v_base_unit
    FROM public.products p
   WHERE p.id = _product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % does not exist', _product_id;
  END IF;

  v_unit_id := coalesce(_unit_id, v_base_unit);
  IF v_unit_id IS NULL THEN
    IF _unit_id IS NULL THEN RETURN 1; END IF;
    RAISE EXCEPTION 'Item % has no base unit configured', _product_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT pu.factor_to_base, pu.is_active,
         CASE WHEN _direction = 'SALE' THEN pu.can_sell ELSE pu.can_purchase END
    INTO v_factor, v_active, v_allowed
    FROM public.product_uoms pu
   WHERE pu.product_id = _product_id AND pu.unit_id = v_unit_id;

  IF FOUND THEN
    IF v_active IS NOT TRUE OR v_allowed IS NOT TRUE THEN
      RAISE EXCEPTION 'Unit % is not enabled for % on item %',
        v_unit_id, lower(_direction), _product_id USING ERRCODE = 'check_violation';
    END IF;
    RETURN v_factor;
  END IF;

  -- Compatibility for existing products and existing callers: the old unit_id
  -- remains the base unit until the item-unit settings are explicitly saved.
  IF v_base_unit IS NOT NULL AND v_unit_id = v_base_unit THEN
    RETURN 1;
  END IF;

  RAISE EXCEPTION 'Unit % is not configured for item %', v_unit_id, _product_id
    USING ERRCODE = 'check_violation';
END;
$function$;

CREATE OR REPLACE FUNCTION public.product_quantity_in_base(
  _product_id uuid,
  _quantity numeric,
  _unit_id uuid,
  _direction text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_increment numeric;
  v_base_quantity numeric;
BEGIN
  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION 'Document quantity must be positive' USING ERRCODE = '22023';
  END IF;
  SELECT pu.quantity_increment
    INTO v_increment
    FROM public.product_uoms pu
   WHERE pu.product_id = _product_id
     AND pu.unit_id = coalesce(
       _unit_id,
       (SELECT coalesce(p.base_uom_id, p.unit_id)
          FROM public.products p WHERE p.id = _product_id)
     )
     AND pu.is_active;
  v_increment := coalesce(v_increment, 0.001);
  IF mod(_quantity, v_increment) <> 0 THEN
    RAISE EXCEPTION 'Quantity for item % must be a multiple of %',
      _product_id, v_increment USING ERRCODE = '22023';
  END IF;
  v_base_quantity := _quantity * public.product_uom_factor(_product_id, _unit_id, _direction);

  -- Current inventory, batch and cost tables store three decimal places.
  -- Refuse a conversion that would be silently rounded by those tables.
  IF v_base_quantity <> round(v_base_quantity, 3) THEN
    RAISE EXCEPTION
      'Converted quantity for item % exceeds current inventory precision (0.001); use a finer base unit',
      _product_id USING ERRCODE = '22023';
  END IF;
  RETURN v_base_quantity;
END;
$function$;

CREATE OR REPLACE FUNCTION public.product_uom_price(
  _product_id uuid,
  _unit_id uuid,
  _direction text,
  _company_id integer DEFAULT 1
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_base_unit uuid;
  v_unit_id uuid;
  v_factor numeric;
  v_base_price numeric;
  v_unit_price numeric;
BEGIN
  IF coalesce(_direction, '') NOT IN ('SALE', 'PURCHASE') THEN
    RAISE EXCEPTION 'Unsupported product unit direction: %', _direction
      USING ERRCODE = '22023';
  END IF;
  v_factor := public.product_uom_factor(_product_id, _unit_id, _direction);

  SELECT coalesce(p.base_uom_id, p.unit_id),
         CASE WHEN _direction = 'SALE'
              THEN coalesce(ci.default_sale_price, p.sale_price)
              ELSE coalesce(ci.default_cost, p.cost_price)
          END
    INTO v_base_unit, v_base_price
    FROM public.products p
    LEFT JOIN public.company_items ci
      ON ci.item_id = p.id AND ci.company_id = _company_id AND ci.is_active
   WHERE p.id = _product_id AND p.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % is not available', _product_id;
  END IF;

  v_unit_id := coalesce(_unit_id, v_base_unit);
  IF v_unit_id IS NOT DISTINCT FROM v_base_unit THEN
    RETURN coalesce(v_base_price, 0);
  END IF;
  SELECT CASE WHEN _direction = 'SALE' THEN pr.sale_price ELSE pr.purchase_price END
    INTO v_unit_price
    FROM public.product_uoms pu
    LEFT JOIN public.product_uom_prices pr
      ON pr.product_uom_id = pu.id AND pr.company_id = _company_id
   WHERE pu.product_id = _product_id AND pu.unit_id = v_unit_id
     AND pu.is_active;

  RETURN coalesce(v_unit_price, coalesce(v_base_price, 0) * v_factor);
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_product_barcode(
  _barcode text,
  _company_id integer DEFAULT 1
)
RETURNS TABLE(product_id uuid, uom_id uuid, factor_to_base numeric, sale_price numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_code text := btrim(coalesce(_barcode, ''));
BEGIN
  IF _company_id IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'This database currently has one active company context'
      USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_code = '' THEN RETURN; END IF;

  RETURN QUERY
  SELECT b.product_id, pu.unit_id, pu.factor_to_base,
         public.product_uom_price(b.product_id, pu.unit_id, 'SALE', _company_id)
    FROM public.product_uom_barcodes b
    JOIN public.product_uoms pu ON pu.id = b.product_uom_id
    JOIN public.products p ON p.id = b.product_id AND p.is_active AND p.is_sellable
   WHERE b.company_id = _company_id AND b.barcode = v_code
     AND b.is_active AND pu.is_active
   LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT p.id, coalesce(p.base_uom_id, p.unit_id), 1::numeric,
         public.product_uom_price(p.id, coalesce(p.base_uom_id, p.unit_id), 'SALE', _company_id)
    FROM public.products p
   WHERE p.barcode = v_code AND p.is_active AND p.is_sellable
   LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_product_uom_settings(
  _product_id uuid,
  _units jsonb,
  _barcodes jsonb DEFAULT '[]'::jsonb,
  _company_id integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.sync_product_base_uom()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.sync_product_base_uom() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS products_sync_base_uom_insert ON public.products;
CREATE TRIGGER products_sync_base_uom_insert
AFTER INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.sync_product_base_uom();
DROP TRIGGER IF EXISTS products_sync_base_uom_update ON public.products;
CREATE TRIGGER products_sync_base_uom_update
AFTER UPDATE OF unit_id, base_uom_id, sales_uom_id, purchase_uom_id,
  sale_price, cost_price, barcode, is_sellable, is_purchasable
ON public.products
FOR EACH ROW EXECUTE FUNCTION public.sync_product_base_uom();

-- Add the two public RPCs to the existing authenticated-call contract.
CREATE OR REPLACE FUNCTION public.rpc_allowlist()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'create_sale', 'create_sales_return', 'create_purchase', 'create_purchase_return',
    'create_stock_transfer', 'post_sales_invoice', 'post_purchase_invoice',
    'post_stock_delta', 'post_stock_settlement', 'post_stock_adjustment', 'post_opening_stock',
    'receive_customer_owned_stock', 'release_customer_owned_stock', 'create_opening_balance',
    'post_opening_balance', 'reverse_opening_balance', 'search_products', 'item_line_type',
    'item_stock_effect', 'item_effective_policy', 'item_has_stock_history', 'resolve_unit_cost',
    'product_reference_counts', 'warehouse_reference_counts', 'save_item_policy',
    'approve_item_policy_change', 'clear_cheque', 'bounce_cheque',
    'reconcile_batches_with_inventory', 'save_product_batch', 'get_batch_kpis',
    'delete_product_batch', 'save_batch_settings', 'record_customer_payment',
    'record_customer_payment_splits', 'record_supplier_payment', 'get_supplier_statement',
    'adjust_loyalty', 'customer_credit_limit_allows', 'custody_intake', 'custody_milling',
    'custody_deliver', 'custody_delivery', 'custody_adjust', 'custody_balances',
    'custody_link_invoice', 'create_milling_service_document',
    'create_milling_service_document_multi', 'milling_document_delivery',
    'smart_manufacture', 'consume_internal_supplies', 'milling_custody_intake',
    'milling_custody_issue_milling', 'milling_custody_deliver', 'milling_custody_adjust',
    'create_journal_entry', 'reverse_journal_entry', 'get_chart_of_accounts_tree',
    'activate_fixed_asset', 'dispose_fixed_asset', 'run_depreciation',
    'run_batch_depreciation', 'run_contract_amortization', 'run_batch_amortization',
    'close_fiscal_year', 'open_fiscal_year', 'set_period_status', 'generate_tax_declaration',
    'settle_tax_period', 'pay_tax_settlement', 'create_expense', 'update_expense',
    'submit_expense', 'decide_expense', 'post_expense', 'close_expense', 'cancel_expense',
    'reverse_expense', 'record_expense_payment', 'reverse_expense_payment', 'list_expenses',
    'expense_detail', 'expense_summary', 'expense_report', 'expense_lookups',
    'save_expense_category', 'delete_expense_category', 'create_tenant_payment_method',
    'update_payment_method_identity', 'remove_tenant_payment_method', 'is_system_customer',
    'is_system_supplier', 'fn_format_document_number', 'fn_resolve_document_numbering',
    'fn_set_document_numbering', 'fn_document_numbering_sequence_name', 'backup_export_all',
    'backup_restore_all', 'backup_schema_fingerprint', 'has_role', 'is_staff',
    'is_platform_admin', 'is_platform_superadmin', 'can_read_finance',
    'can_read_expense_entry', 'can_author_payment_methods', 'can_operate_milling',
    'can_view_milling', 'platform_admin_audit_self',
    'save_product_uom_settings', 'resolve_product_barcode'
  ];
$$;

REVOKE ALL ON FUNCTION public.product_uom_factor(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.product_quantity_in_base(uuid, numeric, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.product_uom_price(uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_product_barcode(text, integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_product_uom_settings(uuid, jsonb, jsonb, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_product_barcode(text, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_product_uom_settings(uuid, jsonb, jsonb, integer)
  TO authenticated, service_role;

COMMENT ON TABLE public.product_uoms IS
  'Per-item alternate units with explicit conversion to the stock base unit; transaction entry is enabled by migration 102.';
COMMENT ON TABLE public.product_uom_prices IS
  'Optional company-specific default sales and reference purchase prices for each item unit; actual posted document prices remain transaction snapshots.';
COMMENT ON TABLE public.product_uom_barcodes IS
  'Barcode identifiers mapped to a product unit so a scan selects both item and transaction unit.';
COMMENT ON FUNCTION public.product_quantity_in_base(uuid, numeric, uuid, text) IS
  'Converts a document quantity to stock base quantity and rejects values finer than the current three-decimal inventory schema.';

COMMIT;

-- Rollback (manual only): drop product_uom_barcodes, product_uom_prices and
-- product_uoms after verifying their references; remove the added snapshot
-- columns and foreign keys; restore rpc_allowlist() from migration 75 and
-- revoke the two new RPC grants. Do not run rollback automatically against data.
