-- ============================================================================
-- الترحيل 005_products_and_inventory.sql — مجال: products_and_inventory
-- جزء من خط الأساس الجديد: تعريف نهائي واحد لكل كائن، مبني من مخطط مرجعي
-- مستخرج من الترحيلات التاريخية الكاملة (راجع supabase/migrations/README.md).
-- ============================================================================

--
-- Name: audit_item_policy_snapshot(uuid, text, jsonb, jsonb, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.audit_item_policy_snapshot(p_item_id uuid, p_action text, p_before jsonb, p_after jsonb, p_source text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
END $$;

--
-- Name: enforce_invoice_product_flags(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.enforce_invoice_product_flags() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_active boolean;
  v_allowed boolean;
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'sales_invoice_items' THEN
    SELECT p.is_active, p.is_sellable
      INTO v_active, v_allowed
      FROM public.products p
     WHERE p.id = NEW.product_id;
    IF NOT FOUND OR v_active IS NOT TRUE OR v_allowed IS NOT TRUE THEN
      RAISE EXCEPTION 'Item % is inactive or not marked as sellable', NEW.product_id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'purchase_invoice_items' THEN
    SELECT p.is_active, p.is_purchasable
      INTO v_active, v_allowed
      FROM public.products p
     WHERE p.id = NEW.product_id;
    IF NOT FOUND OR v_active IS NOT TRUE OR v_allowed IS NOT TRUE THEN
      RAISE EXCEPTION 'Item % is inactive or not marked as purchasable', NEW.product_id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unexpected invoice item table: %', TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END;
$$;

--
-- Name: item_line_type(uuid, boolean); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.item_line_type(p_item_id uuid, p_is_ad_hoc boolean DEFAULT false) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
END $$;

--
-- Name: product_quantity_in_base(uuid, numeric, uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.product_quantity_in_base(_product_id uuid, _quantity numeric, _unit_id uuid, _direction text) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: product_uom_factor(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.product_uom_factor(_product_id uuid, _unit_id uuid, _direction text) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: product_uom_price(uuid, uuid, text, integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.product_uom_price(_product_id uuid, _unit_id uuid, _direction text, _company_id integer DEFAULT 1) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: production_guard_cost_allocation_write(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.production_guard_cost_allocation_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'لا يمكن حذف تخصيص تكلفة إنتاج؛ اعكس أمر الإنتاج أولاً'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: production_lock_material_scope(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.production_lock_material_scope(p_warehouse_id uuid, p_product_ids uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_pid uuid;
BEGIN
  FOREACH v_pid IN ARRAY coalesce(p_product_ids, ARRAY[]::uuid[])
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'production_stock:' || coalesce(p_warehouse_id::text, '') || ':' || coalesce(v_pid::text, ''),
        0));
  END LOOP;
END;
$$;

--
-- Name: production_mass_in_kg(uuid, numeric); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.production_mass_in_kg(p_product_id uuid, p_base_quantity numeric) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_dimension text;
  v_factor numeric;
  v_package_weight numeric;
  v_kg_factor numeric;
BEGIN
  SELECT u.dimension_code, u.factor_to_reference, p.package_weight_kg
    INTO v_dimension, v_factor, v_package_weight
    FROM public.products p
    LEFT JOIN public.units u ON u.id = coalesce(p.base_uom_id, p.unit_id)
   WHERE p.id = p_product_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_dimension = 'MASS' AND v_factor IS NOT NULL THEN
    SELECT factor_to_reference INTO v_kg_factor
      FROM public.units
     WHERE dimension_code = 'MASS' AND lower(short_name) IN ('kg','كجم','كيلوجرام')
     ORDER BY CASE WHEN lower(short_name) = 'kg' THEN 0 ELSE 1 END
     LIMIT 1;
    IF v_kg_factor IS NULL OR v_kg_factor <= 0 THEN RETURN NULL; END IF;
    RETURN round(p_base_quantity * v_factor / v_kg_factor, 6);
  END IF;
  IF v_package_weight IS NOT NULL AND v_package_weight > 0 THEN
    RETURN round(p_base_quantity * v_package_weight, 6);
  END IF;
  RETURN NULL;
END;
$$;

--
-- Name: production_quantity_in_base(uuid, numeric, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.production_quantity_in_base(p_product_id uuid, p_quantity numeric, p_uom_id uuid) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_base_uom_id uuid;
  v_unit_id uuid;
  v_factor numeric;
  v_increment numeric;
  v_active boolean;
  v_base_quantity numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity<=0 THEN
    RAISE EXCEPTION 'كمية الإنتاج يجب أن تكون أكبر من صفر' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(p.base_uom_id,p.unit_id) INTO v_base_uom_id
    FROM public.products p WHERE p.id=p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الصنف غير موجود' USING ERRCODE='P0002'; END IF;
  v_unit_id:=coalesce(p_uom_id,v_base_uom_id);
  SELECT pu.factor_to_base,pu.quantity_increment,pu.is_active
    INTO v_factor,v_increment,v_active
    FROM public.product_uoms pu
   WHERE pu.product_id=p_product_id AND pu.unit_id=v_unit_id;
  IF FOUND THEN
    IF v_active IS NOT TRUE THEN
      RAISE EXCEPTION 'وحدة الإنتاج غير مفعّلة لهذا الصنف';
    END IF;
  ELSIF v_unit_id IS NOT DISTINCT FROM v_base_uom_id THEN
    v_factor:=1;
    v_increment:=0.001;
  ELSIF v_unit_id IS NULL AND v_base_uom_id IS NULL THEN
    v_factor:=1;
    v_increment:=0.001;
  ELSE
    RAISE EXCEPTION 'وحدة الإنتاج غير معرفة لهذا الصنف' USING ERRCODE='check_violation';
  END IF;
  IF mod(p_quantity,coalesce(v_increment,0.001))<>0 THEN
    RAISE EXCEPTION 'الكمية يجب أن تكون مضاعفاً لخطوة الوحدة %',coalesce(v_increment,0.001)
      USING ERRCODE='22023';
  END IF;
  v_base_quantity:=p_quantity*coalesce(v_factor,1);
  IF v_base_quantity<>round(v_base_quantity,3) THEN
    RAISE EXCEPTION 'الكمية المحولة تتجاوز دقة مخزون 0.001؛ اختر وحدة أساس أدق' USING ERRCODE='22023';
  END IF;
  RETURN v_base_quantity;
END;
$$;

--
-- Name: resolve_product_barcode(text, integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.resolve_product_barcode(_barcode text, _company_id integer DEFAULT 1) RETURNS TABLE(product_id uuid, uom_id uuid, factor_to_base numeric, sale_price numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: rpc_allowlist_before_company_production(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.rpc_allowlist_before_company_production() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
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

--
-- Name: set_company_item_policy(uuid, public.inventory_policy, public.costing_method, numeric, numeric, numeric, boolean, integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.set_company_item_policy(_item_id uuid, _inventory_policy public.inventory_policy DEFAULT NULL::public.inventory_policy, _costing_method public.costing_method DEFAULT NULL::public.costing_method, _default_cost numeric DEFAULT NULL::numeric, _default_sale_price numeric DEFAULT NULL::numeric, _tax_rate numeric DEFAULT NULL::numeric, _is_active boolean DEFAULT true, _company_id integer DEFAULT 1) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
END $$;

--
-- Name: set_standard_costs(jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.set_standard_costs(_costs jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
END $$;

--
-- Name: inventory; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.inventory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    quantity numeric(14,3) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_type public.owner_type DEFAULT 'COMPANY'::public.owner_type NOT NULL,
    owner_id uuid
);

--
-- Name: products; Type: TABLE; Schema: public; Owner: supabase_admin
--

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
    item_nature public.item_nature DEFAULT 'GOOD'::public.item_nature NOT NULL,
    inventory_policy public.inventory_policy DEFAULT 'TRACKED'::public.inventory_policy NOT NULL,
    tracking public.item_tracking DEFAULT 'NONE'::public.item_tracking NOT NULL,
    costing_method public.costing_method DEFAULT 'MOVING_AVERAGE'::public.costing_method NOT NULL,
    is_sellable boolean DEFAULT true NOT NULL,
    is_purchasable boolean DEFAULT true NOT NULL,
    status public.item_status DEFAULT 'ACTIVE'::public.item_status NOT NULL,
    base_uom_id uuid,
    sales_uom_id uuid,
    purchase_uom_id uuid,
    uom_conversions jsonb DEFAULT '[]'::jsonb NOT NULL,
    item_class public.item_class,
    standard_cost numeric(18,4),
    package_type_id uuid,
    package_weight_kg numeric(10,3),
    is_custody_item boolean DEFAULT false NOT NULL,
    batch_dispatch_strategy text,
    CONSTRAINT products_batch_dispatch_strategy_check CHECK (((batch_dispatch_strategy IS NULL) OR (batch_dispatch_strategy = ANY (ARRAY['FEFO'::text, 'FIFO'::text, 'MANUAL'::text])))),
    CONSTRAINT products_package_weight_positive_check CHECK (((package_weight_kg IS NULL) OR (package_weight_kg > (0)::numeric))),
    CONSTRAINT products_service_cannot_be_tracked CHECK (((item_nature <> 'SERVICE'::public.item_nature) OR (inventory_policy = 'UNTRACKED'::public.inventory_policy))),
    CONSTRAINT products_untracked_has_no_tracking CHECK (((inventory_policy <> 'UNTRACKED'::public.inventory_policy) OR (tracking = 'NONE'::public.item_tracking)))
);

--
-- Name: warehouses; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.warehouses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    code text,
    address text,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    name_ar text
);

--
-- Name: item_policy_review_queue; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.item_policy_review_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    reason text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_policy_review_queue_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: product_batches; Type: TABLE; Schema: public; Owner: supabase_admin
--

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
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_negative_balance boolean DEFAULT false NOT NULL,
    CONSTRAINT product_batches_quantity_or_negative_balance CHECK (((quantity >= (0)::numeric) OR is_negative_balance)),
    CONSTRAINT product_batches_unit_cost_nonnegative CHECK ((unit_cost >= (0)::numeric)),
    CONSTRAINT product_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);

--
-- Name: product_uom_barcodes; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.product_uom_barcodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id integer DEFAULT 1 NOT NULL,
    product_id uuid NOT NULL,
    product_uom_id uuid NOT NULL,
    barcode text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_uom_barcodes_code_nonempty CHECK (((length(btrim(barcode)) > 0) AND (barcode = btrim(barcode))))
);

--
-- Name: product_uom_prices; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.product_uom_prices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id integer DEFAULT 1 NOT NULL,
    product_id uuid NOT NULL,
    product_uom_id uuid NOT NULL,
    sale_price numeric(18,4),
    purchase_price numeric(18,4),
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_uom_prices_nonnegative CHECK ((((sale_price IS NULL) OR (sale_price >= (0)::numeric)) AND ((purchase_price IS NULL) OR (purchase_price >= (0)::numeric))))
);

--
-- Name: product_uoms; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.product_uoms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    factor_to_base numeric(30,12) NOT NULL,
    conversion_basis text DEFAULT 'STANDARD'::text NOT NULL,
    conversion_note text,
    quantity_increment numeric(30,12) DEFAULT 0.001 NOT NULL,
    can_purchase boolean DEFAULT false NOT NULL,
    can_sell boolean DEFAULT false NOT NULL,
    is_default_purchase boolean DEFAULT false NOT NULL,
    is_default_sale boolean DEFAULT false NOT NULL,
    is_base boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_uoms_base_factor_one CHECK (((NOT is_base) OR (factor_to_base = (1)::numeric))),
    CONSTRAINT product_uoms_conversion_basis_check CHECK (((conversion_basis = ANY (ARRAY['STANDARD'::text, 'FIXED_PACKAGE'::text, 'ITEM_SPECIFIC'::text])) AND (((conversion_basis = 'STANDARD'::text) AND (conversion_note IS NULL)) OR ((conversion_basis <> 'STANDARD'::text) AND (length(btrim(COALESCE(conversion_note, ''::text))) >= 3))))),
    CONSTRAINT product_uoms_default_purchase_enabled CHECK (((NOT is_default_purchase) OR can_purchase)),
    CONSTRAINT product_uoms_default_sale_enabled CHECK (((NOT is_default_sale) OR can_sell)),
    CONSTRAINT product_uoms_factor_positive CHECK ((factor_to_base > (0)::numeric)),
    CONSTRAINT product_uoms_increment_positive CHECK ((quantity_increment > (0)::numeric)),
    CONSTRAINT product_uoms_increment_precision CHECK ((quantity_increment = round(quantity_increment, 6)))
);


--
-- Name: FUNCTION audit_item_policy_snapshot(p_item_id uuid, p_action text, p_before jsonb, p_after jsonb, p_source text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.audit_item_policy_snapshot(p_item_id uuid, p_action text, p_before jsonb, p_after jsonb, p_source text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.audit_item_policy_snapshot(p_item_id uuid, p_action text, p_before jsonb, p_after jsonb, p_source text) TO service_role;


--
-- Name: FUNCTION enforce_invoice_product_flags(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.enforce_invoice_product_flags() IS 'Final server-side guard for active, sellable sales lines and active, purchasable purchase lines.';

--
-- Name: FUNCTION enforce_invoice_product_flags(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.enforce_invoice_product_flags() FROM PUBLIC;

GRANT ALL ON FUNCTION public.enforce_invoice_product_flags() TO service_role;


--
-- Name: FUNCTION item_line_type(p_item_id uuid, p_is_ad_hoc boolean); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.item_line_type(p_item_id uuid, p_is_ad_hoc boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.item_line_type(p_item_id uuid, p_is_ad_hoc boolean) TO service_role;

GRANT ALL ON FUNCTION public.item_line_type(p_item_id uuid, p_is_ad_hoc boolean) TO authenticated;


--
-- Name: FUNCTION product_quantity_in_base(_product_id uuid, _quantity numeric, _unit_id uuid, _direction text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.product_quantity_in_base(_product_id uuid, _quantity numeric, _unit_id uuid, _direction text) IS 'Converts a document quantity to stock base quantity and rejects values finer than the current three-decimal inventory schema.';

--
-- Name: FUNCTION product_quantity_in_base(_product_id uuid, _quantity numeric, _unit_id uuid, _direction text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.product_quantity_in_base(_product_id uuid, _quantity numeric, _unit_id uuid, _direction text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.product_quantity_in_base(_product_id uuid, _quantity numeric, _unit_id uuid, _direction text) TO service_role;


--
-- Name: FUNCTION product_uom_factor(_product_id uuid, _unit_id uuid, _direction text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.product_uom_factor(_product_id uuid, _unit_id uuid, _direction text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.product_uom_factor(_product_id uuid, _unit_id uuid, _direction text) TO service_role;


--
-- Name: FUNCTION product_uom_price(_product_id uuid, _unit_id uuid, _direction text, _company_id integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.product_uom_price(_product_id uuid, _unit_id uuid, _direction text, _company_id integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.product_uom_price(_product_id uuid, _unit_id uuid, _direction text, _company_id integer) TO service_role;


--
-- Name: FUNCTION production_guard_cost_allocation_write(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.production_guard_cost_allocation_write() FROM PUBLIC;


--
-- Name: FUNCTION production_lock_material_scope(p_warehouse_id uuid, p_product_ids uuid[]); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.production_lock_material_scope(p_warehouse_id uuid, p_product_ids uuid[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.production_lock_material_scope(p_warehouse_id uuid, p_product_ids uuid[]) TO service_role;


--
-- Name: FUNCTION production_mass_in_kg(p_product_id uuid, p_base_quantity numeric); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.production_mass_in_kg(p_product_id uuid, p_base_quantity numeric) FROM PUBLIC;

GRANT ALL ON FUNCTION public.production_mass_in_kg(p_product_id uuid, p_base_quantity numeric) TO service_role;


--
-- Name: FUNCTION production_quantity_in_base(p_product_id uuid, p_quantity numeric, p_uom_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.production_quantity_in_base(p_product_id uuid, p_quantity numeric, p_uom_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.production_quantity_in_base(p_product_id uuid, p_quantity numeric, p_uom_id uuid) TO service_role;


--
-- Name: FUNCTION resolve_product_barcode(_barcode text, _company_id integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.resolve_product_barcode(_barcode text, _company_id integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.resolve_product_barcode(_barcode text, _company_id integer) TO authenticated;

GRANT ALL ON FUNCTION public.resolve_product_barcode(_barcode text, _company_id integer) TO service_role;


--
-- Name: FUNCTION rpc_allowlist_before_company_production(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.rpc_allowlist_before_company_production() IS 'عقد RPC الواجهة، متضمّنًا نقطتي الدفع المجزأ للتحصيل والطحن.';

--
-- Name: rpc_allowlist_before_production_reversal(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.rpc_allowlist_before_production_reversal() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT public.rpc_allowlist_before_company_production() || ARRAY[
    'create_and_post_production_order','production_cost_sources',
    'set_production_expense_category_eligibility'
  ]::text[];
$$;

--
-- Name: FUNCTION rpc_allowlist_before_company_production(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.rpc_allowlist_before_company_production() FROM PUBLIC;

GRANT ALL ON FUNCTION public.rpc_allowlist_before_company_production() TO service_role;


--
-- Name: FUNCTION set_company_item_policy(_item_id uuid, _inventory_policy public.inventory_policy, _costing_method public.costing_method, _default_cost numeric, _default_sale_price numeric, _tax_rate numeric, _is_active boolean, _company_id integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.set_company_item_policy(_item_id uuid, _inventory_policy public.inventory_policy, _costing_method public.costing_method, _default_cost numeric, _default_sale_price numeric, _tax_rate numeric, _is_active boolean, _company_id integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.set_company_item_policy(_item_id uuid, _inventory_policy public.inventory_policy, _costing_method public.costing_method, _default_cost numeric, _default_sale_price numeric, _tax_rate numeric, _is_active boolean, _company_id integer) TO service_role;


--
-- Name: FUNCTION set_standard_costs(_costs jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.set_standard_costs(_costs jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.set_standard_costs(_costs jsonb) TO service_role;


--
-- Name: inventory inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_pkey PRIMARY KEY (id);

--
-- Name: inventory inventory_product_id_warehouse_id_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_product_id_warehouse_id_key UNIQUE (product_id, warehouse_id);

--
-- Name: idx_inventory_owner; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_inventory_owner ON public.inventory USING btree (owner_type, owner_id) WHERE (owner_id IS NOT NULL);

--
-- Name: idx_inventory_product; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_inventory_product ON public.inventory USING btree (product_id);

--
-- Name: idx_inventory_warehouse; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_inventory_warehouse ON public.inventory USING btree (warehouse_id);

--
-- Name: inventory_product_warehouse_owner_key; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX inventory_product_warehouse_owner_key ON public.inventory USING btree (product_id, warehouse_id, owner_type, owner_id) NULLS NOT DISTINCT;

--
-- Name: inventory inv_read_only_staff; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY inv_read_only_staff ON public.inventory FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: inventory inv_view; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY inv_view ON public.inventory FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: inventory; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE inventory; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.inventory TO service_role;

GRANT SELECT ON TABLE public.inventory TO authenticated;

--
-- Name: approve_item_policy_change(uuid, public.item_nature, public.inventory_policy, public.costing_method, public.item_tracking, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.approve_item_policy_change(_item_id uuid, _new_nature public.item_nature, _new_policy public.inventory_policy, _new_costing public.costing_method, _new_tracking public.item_tracking, _reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
END $$;

--
-- Name: guard_company_production_material_scope(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.guard_company_production_material_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_product public.products%ROWTYPE;
BEGIN
  SELECT p.*
    INTO v_product
    FROM public.products p
   WHERE p.id = NEW.product_id
     AND p.is_active
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المادة غير موجودة أو غير نشطة' USING ERRCODE = '23514';
  END IF;

  IF v_product.item_class NOT IN ('RAW_MATERIAL', 'PACKAGING')
     OR v_product.item_nature::text = 'SERVICE'
     OR v_product.is_custody_item IS TRUE
     OR public.item_effective_policy(v_product.id)::text <> 'TRACKED' THEN
    RAISE EXCEPTION
      'مواد الإنتاج يجب أن تكون مادة خام أو تعبئة مخزنية مملوكة للمنشأة؛ لا تقبل المنتجات التامة أو أصناف الأمانات'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

--
-- Name: guard_production_company_stock_scope(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.guard_production_company_stock_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_product public.products%ROWTYPE;
BEGIN
  SELECT p.* INTO v_product FROM public.products p WHERE p.id = NEW.product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير موجود' USING ERRCODE = 'P0002';
  END IF;
  IF v_product.is_custody_item IS TRUE
     OR v_product.inventory_policy = 'CUSTOMER_OWNED'::public.inventory_policy
     OR (NEW.owner_type = 'COMPANY'::public.owner_type AND NEW.owner_id IS NOT NULL) THEN
    RAISE EXCEPTION
      'لا يمكن ترحيل حبوب أو مخزون مملوك للعميل عبر مخزون الشركة؛ استخدم مسار عهدة العميل'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: item_effective_policy(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.item_effective_policy(p_item_id uuid) RETURNS public.inventory_policy
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(ci.inventory_policy, p.inventory_policy)
  FROM public.products p
  LEFT JOIN public.company_items ci
    ON ci.item_id = p.id AND ci.company_id = 1 AND ci.is_active
  WHERE p.id = p_item_id
$$;

--
-- Name: search_products(text, uuid, uuid, uuid, uuid, boolean, boolean, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.search_products(p_query text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_brand_id uuid DEFAULT NULL::uuid, p_unit_id uuid DEFAULT NULL::uuid, p_origin_id uuid DEFAULT NULL::uuid, p_active boolean DEFAULT NULL::boolean, p_low_stock boolean DEFAULT NULL::boolean, p_sort_key text DEFAULT 'created_at'::text, p_sort_dir text DEFAULT 'desc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, name text, name_ar text, sku text, barcode text, sale_price numeric, cost_price numeric, tax_rate numeric, min_stock numeric, shelf_location text, origin_id uuid, quality_grade_id uuid, is_active boolean, category_id uuid, brand_id uuid, unit_id uuid, created_at timestamp with time zone, category_name text, category_name_ar text, brand_name text, brand_name_ar text, unit_short_name text, unit_name_ar text, stock_qty numeric, total_count bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: COLUMN products.package_weight_kg; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.products.package_weight_kg IS 'السعة الافتراضية للعبوة بالكيلوجرام (مثال 50 أو 25). تُستخدم لتعبئة الوزن الافتراضي في شاشات الطحن والتسليم فقط.';

--
-- Name: COLUMN products.is_custody_item; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.products.is_custody_item IS 'منتج أمانات مطحنة (حبوب/نواتج) — يظهر في قوائم الطحن فقط وليس في المبيعات والمشتريات';

--
-- Name: COLUMN products.batch_dispatch_strategy; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.products.batch_dispatch_strategy IS 'Optional per-product batch dispatch override. NULL inherits company batch settings. This controls lot rotation, not inventory valuation.';

--
-- Name: item_classification_gaps; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.item_classification_gaps WITH (security_invoker='true') AS
 SELECT id,
    sku,
    name_ar,
    item_nature,
    item_class,
    inventory_policy,
        CASE
            WHEN ((sku IS NULL) OR (btrim(sku) = ''::text)) THEN 'بلا رمز صنف — التصنيف الخماسي غير مُتحقَّق منه (نخالة أم دقيق؟) يحتاج تأكيداً يدوياً'::text
            WHEN (item_nature = 'SERVICE'::public.item_nature) THEN 'nature: service, class must be SERVICE'::text
            WHEN (inventory_policy = 'CUSTOMER_OWNED'::public.inventory_policy) THEN 'policy: customer owned, class must be NON_STOCK_ITEM'::text
            WHEN (inventory_policy = 'UNTRACKED'::public.inventory_policy) THEN 'policy: untracked, class must be SERVICE or NON_STOCK_ITEM'::text
            WHEN (sku ~~ 'RM-%'::text) THEN 'sku: raw material prefix, class should be RAW_MATERIAL'::text
            WHEN (sku = 'FG-BRAN-40'::text) THEN 'catalogue: bran is a by-product'::text
            ELSE 'unclassified GOOD+TRACKED item'::text
        END AS reason
   FROM public.products p
  WHERE (is_active AND ((item_class IS NULL) OR ((sku IS NULL) OR (btrim(sku) = ''::text)) OR ((item_nature = 'SERVICE'::public.item_nature) AND (item_class <> 'SERVICE'::public.item_class)) OR ((inventory_policy = 'CUSTOMER_OWNED'::public.inventory_policy) AND (item_class <> 'NON_STOCK_ITEM'::public.item_class)) OR ((inventory_policy = 'UNTRACKED'::public.inventory_policy) AND (item_nature = 'GOOD'::public.item_nature) AND (item_class <> 'NON_STOCK_ITEM'::public.item_class)) OR ((sku ~~ 'RM-%'::text) AND (item_class <> 'RAW_MATERIAL'::public.item_class)) OR ((sku = 'FG-BRAN-40'::text) AND (item_class <> 'BY_PRODUCT'::public.item_class))));

--
-- Name: products products_barcode_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_barcode_key UNIQUE (barcode);

--
-- Name: products products_custody_items_are_customer_owned; Type: CHECK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.products
    ADD CONSTRAINT products_custody_items_are_customer_owned CHECK (((NOT is_custody_item) OR (inventory_policy = 'CUSTOMER_OWNED'::public.inventory_policy))) NOT VALID;

--
-- Name: products products_custody_items_have_no_commercial_prices; Type: CHECK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.products
    ADD CONSTRAINT products_custody_items_have_no_commercial_prices CHECK (((inventory_policy <> 'CUSTOMER_OWNED'::public.inventory_policy) OR ((sale_price = (0)::numeric) AND (cost_price = (0)::numeric) AND (tax_rate = (0)::numeric)))) NOT VALID;

--
-- Name: CONSTRAINT products_custody_items_have_no_commercial_prices ON products; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON CONSTRAINT products_custody_items_have_no_commercial_prices ON public.products IS 'Customer-owned milling goods have no commercial sale price, catalogue cost, or tax.';

--
-- Name: products products_customer_owned_items_are_custody; Type: CHECK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.products
    ADD CONSTRAINT products_customer_owned_items_are_custody CHECK (((inventory_policy <> 'CUSTOMER_OWNED'::public.inventory_policy) OR ((item_nature = 'GOOD'::public.item_nature) AND (tracking = 'NONE'::public.item_tracking) AND (costing_method = 'NONE'::public.costing_method) AND is_custody_item AND (NOT is_sellable) AND (NOT is_purchasable) AND (item_class = ANY (ARRAY['RAW_MATERIAL'::public.item_class, 'FINISHED_GOOD'::public.item_class, 'BY_PRODUCT'::public.item_class]))))) NOT VALID;

--
-- Name: CONSTRAINT products_customer_owned_items_are_custody ON products; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON CONSTRAINT products_customer_owned_items_are_custody ON public.products IS 'Customer-owned milling goods have no company valuation or commercial sale/purchase path.';

--
-- Name: products products_none_costing_requires_noncompany_stock; Type: CHECK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.products
    ADD CONSTRAINT products_none_costing_requires_noncompany_stock CHECK (((costing_method <> 'NONE'::public.costing_method) OR (inventory_policy = ANY (ARRAY['UNTRACKED'::public.inventory_policy, 'CUSTOMER_OWNED'::public.inventory_policy])))) NOT VALID;

--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);

--
-- Name: products products_sku_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_key UNIQUE (sku);

--
-- Name: idx_products_custody; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_products_custody ON public.products USING btree (item_class, is_custody_item) WHERE is_custody_item;

--
-- Name: idx_products_inventory_policy; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_products_inventory_policy ON public.products USING btree (inventory_policy);

--
-- Name: idx_products_item_nature; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_products_item_nature ON public.products USING btree (item_nature);

--
-- Name: idx_products_status; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_products_status ON public.products USING btree (status);

--
-- Name: products_name_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX products_name_idx ON public.products USING gin (to_tsvector('simple'::regconfig, ((((((COALESCE(name, ''::text) || ' '::text) || COALESCE(name_ar, ''::text)) || ' '::text) || COALESCE(sku, ''::text)) || ' '::text) || COALESCE(barcode, ''::text))));

--
-- Name: products products_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER products_updated BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: products tg_sync_item_class; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER tg_sync_item_class BEFORE INSERT OR UPDATE OF item_nature, inventory_policy ON public.products FOR EACH ROW EXECUTE FUNCTION public.sync_item_class_from_policy();

--
-- Name: products prod_manage; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY prod_manage ON public.products TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'warehouse'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role) OR public.has_role(auth.uid(), 'warehouse'::public.app_role)));

--
-- Name: products prod_view; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY prod_view ON public.products FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE products; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.products TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.products TO authenticated;


--
-- Name: warehouses warehouses_code_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_code_key UNIQUE (code);

--
-- Name: warehouses warehouses_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_pkey PRIMARY KEY (id);

--
-- Name: warehouses warehouses_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER warehouses_updated BEFORE UPDATE ON public.warehouses FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: warehouses; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

--
-- Name: warehouses wh_manage; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY wh_manage ON public.warehouses TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: warehouses wh_view; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY wh_view ON public.warehouses FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: TABLE warehouses; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.warehouses TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.warehouses TO authenticated;


--
-- Name: item_policy_review_queue item_policy_review_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.item_policy_review_queue
    ADD CONSTRAINT item_policy_review_queue_pkey PRIMARY KEY (id);

--
-- Name: item_policy_review_queue item_policy_review_queue_unique; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.item_policy_review_queue
    ADD CONSTRAINT item_policy_review_queue_unique UNIQUE (product_id, reason);

--
-- Name: item_policy_review_queue item_policy_review_manage; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY item_policy_review_manage ON public.item_policy_review_queue TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: item_policy_review_queue; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.item_policy_review_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: item_policy_review_queue item_policy_review_staff_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY item_policy_review_staff_read ON public.item_policy_review_queue FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: TABLE item_policy_review_queue; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.item_policy_review_queue TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.item_policy_review_queue TO authenticated;


--
-- Name: COLUMN product_batches.is_negative_balance; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.product_batches.is_negative_balance IS 'System-only negative-sale balancing batch. Physical receipt lots must remain non-negative.';

--
-- Name: product_batches product_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_batches
    ADD CONSTRAINT product_batches_pkey PRIMARY KEY (id);

--
-- Name: product_batches product_batches_product_id_warehouse_id_batch_number_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_batches
    ADD CONSTRAINT product_batches_product_id_warehouse_id_batch_number_key UNIQUE (product_id, warehouse_id, batch_number);

--
-- Name: idx_batches_expiry; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_batches_expiry ON public.product_batches USING btree (expiry_date) WHERE (expiry_date IS NOT NULL);

--
-- Name: idx_batches_product; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_batches_product ON public.product_batches USING btree (product_id);

--
-- Name: product_batches set_batches_updated_at; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER set_batches_updated_at BEFORE UPDATE ON public.product_batches FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: product_batches Staff read batches; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "Staff read batches" ON public.product_batches FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: product_batches Staff write batches; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "Staff write batches" ON public.product_batches TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

--
-- Name: product_batches; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.product_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE product_batches; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.product_batches TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.product_batches TO authenticated;


--
-- Name: TABLE product_uom_barcodes; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.product_uom_barcodes IS 'Barcode identifiers mapped to a product unit so a scan selects both item and transaction unit.';

--
-- Name: product_uom_barcodes product_uom_barcodes_company_barcode_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_uom_barcodes
    ADD CONSTRAINT product_uom_barcodes_company_barcode_key UNIQUE (company_id, barcode);

--
-- Name: product_uom_barcodes product_uom_barcodes_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_uom_barcodes
    ADD CONSTRAINT product_uom_barcodes_pkey PRIMARY KEY (id);

--
-- Name: product_uom_barcodes_one_primary_per_uom; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX product_uom_barcodes_one_primary_per_uom ON public.product_uom_barcodes USING btree (company_id, product_uom_id) WHERE (is_primary AND is_active);

--
-- Name: product_uom_barcodes_product_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX product_uom_barcodes_product_idx ON public.product_uom_barcodes USING btree (company_id, product_id, is_active);

--
-- Name: product_uom_barcodes; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.product_uom_barcodes ENABLE ROW LEVEL SECURITY;

--
-- Name: product_uom_barcodes product_uom_barcodes_staff_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY product_uom_barcodes_staff_read ON public.product_uom_barcodes FOR SELECT TO authenticated USING ((public.is_staff(auth.uid()) AND (company_id = 1)));

--
-- Name: TABLE product_uom_barcodes; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.product_uom_barcodes TO authenticated;

GRANT ALL ON TABLE public.product_uom_barcodes TO service_role;


--
-- Name: TABLE product_uom_prices; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.product_uom_prices IS 'Optional company-specific default sales and reference purchase prices for each item unit; actual posted document prices remain transaction snapshots.';

--
-- Name: product_uom_prices product_uom_prices_company_uom_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_uom_prices
    ADD CONSTRAINT product_uom_prices_company_uom_key UNIQUE (company_id, product_uom_id);

--
-- Name: product_uom_prices product_uom_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_uom_prices
    ADD CONSTRAINT product_uom_prices_pkey PRIMARY KEY (id);

--
-- Name: product_uom_prices; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.product_uom_prices ENABLE ROW LEVEL SECURITY;

--
-- Name: product_uom_prices product_uom_prices_staff_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY product_uom_prices_staff_read ON public.product_uom_prices FOR SELECT TO authenticated USING ((public.is_staff(auth.uid()) AND (company_id = 1)));

--
-- Name: TABLE product_uom_prices; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.product_uom_prices TO authenticated;

GRANT ALL ON TABLE public.product_uom_prices TO service_role;


--
-- Name: TABLE product_uoms; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.product_uoms IS 'Active item-specific purchase and sales units; stock quantities, batches, and valuation remain in the product base unit.';

--
-- Name: product_uoms product_uoms_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_uoms
    ADD CONSTRAINT product_uoms_id_product_id_key UNIQUE (id, product_id);

--
-- Name: product_uoms product_uoms_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_uoms
    ADD CONSTRAINT product_uoms_pkey PRIMARY KEY (id);

--
-- Name: product_uoms product_uoms_product_id_unit_id_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_uoms
    ADD CONSTRAINT product_uoms_product_id_unit_id_key UNIQUE (product_id, unit_id);

--
-- Name: product_uoms_one_base_per_product; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX product_uoms_one_base_per_product ON public.product_uoms USING btree (product_id) WHERE is_base;

--
-- Name: product_uoms_one_default_purchase_per_product; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX product_uoms_one_default_purchase_per_product ON public.product_uoms USING btree (product_id) WHERE (is_default_purchase AND is_active);

--
-- Name: product_uoms_one_default_sale_per_product; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX product_uoms_one_default_sale_per_product ON public.product_uoms USING btree (product_id) WHERE (is_default_sale AND is_active);

--
-- Name: product_uoms_product_active_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX product_uoms_product_active_idx ON public.product_uoms USING btree (product_id, is_active);

--
-- Name: product_uoms; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.product_uoms ENABLE ROW LEVEL SECURITY;

--
-- Name: product_uoms product_uoms_staff_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY product_uoms_staff_read ON public.product_uoms FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: TABLE product_uoms; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.product_uoms TO authenticated;

GRANT ALL ON TABLE public.product_uoms TO service_role;


--
-- Name: FUNCTION rpc_allowlist_before_production_reversal(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.rpc_allowlist_before_production_reversal() FROM PUBLIC;

GRANT ALL ON FUNCTION public.rpc_allowlist_before_production_reversal() TO service_role;


--
-- Name: FUNCTION approve_item_policy_change(_item_id uuid, _new_nature public.item_nature, _new_policy public.inventory_policy, _new_costing public.costing_method, _new_tracking public.item_tracking, _reason text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.approve_item_policy_change(_item_id uuid, _new_nature public.item_nature, _new_policy public.inventory_policy, _new_costing public.costing_method, _new_tracking public.item_tracking, _reason text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.approve_item_policy_change(_item_id uuid, _new_nature public.item_nature, _new_policy public.inventory_policy, _new_costing public.costing_method, _new_tracking public.item_tracking, _reason text) TO service_role;

GRANT ALL ON FUNCTION public.approve_item_policy_change(_item_id uuid, _new_nature public.item_nature, _new_policy public.inventory_policy, _new_costing public.costing_method, _new_tracking public.item_tracking, _reason text) TO authenticated;


--
-- Name: FUNCTION guard_company_production_material_scope(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.guard_company_production_material_scope() FROM PUBLIC;

GRANT ALL ON FUNCTION public.guard_company_production_material_scope() TO service_role;


--
-- Name: inventory inventory_guard_company_scope; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER inventory_guard_company_scope BEFORE INSERT OR UPDATE OF product_id, owner_type, owner_id ON public.inventory FOR EACH ROW WHEN ((new.owner_type = 'COMPANY'::public.owner_type)) EXECUTE FUNCTION public.guard_production_company_stock_scope();

--
-- Name: FUNCTION guard_production_company_stock_scope(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.guard_production_company_stock_scope() FROM PUBLIC;


--
-- Name: production_product_is_company_stock(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.production_product_is_company_stock(p_product_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT coalesce((
    SELECT p.is_active
       AND p.is_custody_item IS NOT TRUE
       AND p.inventory_policy <> 'CUSTOMER_OWNED'::public.inventory_policy
       AND public.item_effective_policy(p.id) = 'TRACKED'
      FROM public.products p
     WHERE p.id = p_product_id
  ), false);
$$;

--
-- Name: FUNCTION item_effective_policy(p_item_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.item_effective_policy(p_item_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.item_effective_policy(p_item_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.item_effective_policy(p_item_id uuid) TO authenticated;


--
-- Name: FUNCTION search_products(p_query text, p_category_id uuid, p_brand_id uuid, p_unit_id uuid, p_origin_id uuid, p_active boolean, p_low_stock boolean, p_sort_key text, p_sort_dir text, p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.search_products(p_query text, p_category_id uuid, p_brand_id uuid, p_unit_id uuid, p_origin_id uuid, p_active boolean, p_low_stock boolean, p_sort_key text, p_sort_dir text, p_limit integer, p_offset integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.search_products(p_query text, p_category_id uuid, p_brand_id uuid, p_unit_id uuid, p_origin_id uuid, p_active boolean, p_low_stock boolean, p_sort_key text, p_sort_dir text, p_limit integer, p_offset integer) TO service_role;

GRANT ALL ON FUNCTION public.search_products(p_query text, p_category_id uuid, p_brand_id uuid, p_unit_id uuid, p_origin_id uuid, p_active boolean, p_low_stock boolean, p_sort_key text, p_sort_dir text, p_limit integer, p_offset integer) TO authenticated;


--
-- Name: TABLE item_classification_gaps; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.item_classification_gaps TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.item_classification_gaps TO service_role;


--
-- Name: FUNCTION production_product_is_company_stock(p_product_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.production_product_is_company_stock(p_product_id uuid) IS 'هل الصنف مخزني متتبع ومملوك للشركة (ليس أمانة عميل)؟ يُستعمل في قيود الإنتاج.';

--
-- Name: FUNCTION production_product_is_company_stock(p_product_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.production_product_is_company_stock(p_product_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.production_product_is_company_stock(p_product_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.production_product_is_company_stock(p_product_id uuid) TO service_role;
