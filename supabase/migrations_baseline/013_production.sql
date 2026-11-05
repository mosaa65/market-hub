-- ============================================================================
-- الترحيل 013_production.sql — مجال: production
-- جزء من خط الأساس الجديد: تعريف نهائي واحد لكل كائن، مبني من مخطط مرجعي
-- مستخرج من الترحيلات التاريخية الكاملة (راجع supabase/migrations/README.md).
-- ============================================================================

--
-- Name: convert_stock(uuid, uuid, numeric, jsonb, numeric, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.convert_stock(_warehouse_id uuid, _source_item_id uuid, _source_qty numeric, _outputs jsonb, _loss_qty numeric, _notes text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_ref text;
  v_doc_id uuid := gen_random_uuid();
  v_total_output_qty numeric := 0;
  v_product public.products%ROWTYPE;
  r record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to run stock conversions';
  END IF;
  IF _warehouse_id IS NULL OR _source_item_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse and source item are required';
  END IF;
  IF coalesce(_source_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'Source quantity must be positive';
  END IF;
  IF _outputs IS NULL OR jsonb_typeof(_outputs) <> 'array' OR jsonb_array_length(_outputs) = 0 THEN
    RAISE EXCEPTION 'At least one output line is required';
  END IF;
  IF coalesce(_loss_qty, 0) < 0 THEN
    RAISE EXCEPTION 'Loss quantity cannot be negative';
  END IF;

  SELECT * INTO v_product FROM public.products p
   WHERE p.id = _source_item_id AND p.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source item is not an active product';
  END IF;
  IF v_product.is_custody_item IS TRUE
     OR v_product.inventory_policy = 'CUSTOMER_OWNED'::public.inventory_policy
     OR public.item_effective_policy(v_product.id) <> 'TRACKED' THEN
    RAISE EXCEPTION
      'التحويل المخزني للشركة فقط؛ أصناف عهدة العميل لا تتحول إلى مخزون مملوك'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs) AS o(item_id uuid, qty numeric)
  LOOP
    IF r.item_id IS NULL OR coalesce(r.qty, 0) <= 0 THEN
      RAISE EXCEPTION 'Every output line needs an item and a positive quantity';
    END IF;
    SELECT * INTO v_product FROM public.products p WHERE p.id = r.item_id AND p.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Output item % is not an active product', r.item_id;
    END IF;
    IF v_product.is_custody_item IS TRUE
       OR v_product.inventory_policy = 'CUSTOMER_OWNED'::public.inventory_policy THEN
      RAISE EXCEPTION 'ناتج التحويل لا يمكن أن يكون صنف أمانة عميل'
        USING ERRCODE = 'check_violation';
    END IF;
    v_total_output_qty := v_total_output_qty + coalesce(r.qty, 0);
  END LOOP;

  IF v_total_output_qty + coalesce(_loss_qty, 0) <> coalesce(_source_qty, 0) THEN
    RAISE EXCEPTION
      'Outputs + loss (%) must equal the source quantity (%)',
      v_total_output_qty + coalesce(_loss_qty, 0), coalesce(_source_qty, 0);
  END IF;

  v_ref := 'CV-' || to_char(now(), 'YYYYMM') || '-' ||
           lpad(nextval('public.milling_service_seq')::text, 4, '0');

  PERFORM public.post_stock_delta(
    p_product_id => _source_item_id,
    p_warehouse_id => _warehouse_id,
    p_signed_qty => -coalesce(_source_qty, 0),
    p_unit_cost => NULL,
    p_movement_kind => 'PRODUCTION'::public.stock_movement_kind,
    p_source_type => 'stock_conversion',
    p_source_id => v_doc_id,
    p_note => 'تحويل مخزون ' || v_ref || coalesce(' — ' || _notes, ''),
    p_owner_type => 'COMPANY'::public.owner_type,
    p_owner_id => NULL,
    p_movement_type_legacy => 'production_out'::public.movement_type);

  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs) AS o(item_id uuid, qty numeric)
  LOOP
    PERFORM public.post_stock_delta(
      p_product_id => r.item_id,
      p_warehouse_id => _warehouse_id,
      p_signed_qty => coalesce(r.qty, 0),
      p_unit_cost => NULL,
      p_movement_kind => 'PRODUCTION'::public.stock_movement_kind,
      p_source_type => 'stock_conversion',
      p_source_id => v_doc_id,
      p_note => 'تحويل مخزون ' || v_ref || coalesce(' — ' || _notes, ''),
      p_owner_type => 'COMPANY'::public.owner_type,
      p_owner_id => NULL,
      p_movement_type_legacy => 'production_in'::public.movement_type);
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'stock.conversion', 'stock_movements', v_doc_id,
    jsonb_build_object(
      'doc_id', v_doc_id,
      'ref', v_ref,
      'warehouse_id', _warehouse_id,
      'source_item_id', _source_item_id,
      'source_qty', coalesce(_source_qty, 0),
      'outputs', _outputs,
      'loss_qty', coalesce(_loss_qty, 0),
      'cost_model', 'FIXED_MANUAL — no allocation, no journal',
      'notes', _notes));

  RETURN v_ref;
END;
$$;

--
-- Name: create_and_post_production_order(uuid, uuid, date, text, jsonb, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_and_post_production_order(p_warehouse_id uuid, p_cost_center_id uuid, p_production_date date, p_notes text, p_materials jsonb, p_outputs jsonb, p_expenses jsonb DEFAULT '[]'::jsonb, p_losses jsonb DEFAULT '[]'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_order_id uuid;
BEGIN
  v_order_id:=public.create_production_order(p_warehouse_id,p_cost_center_id,p_production_date,p_notes);
  PERFORM public.complete_production_order(v_order_id,p_materials,p_outputs,p_expenses,p_losses);
  RETURN v_order_id;
END;
$$;

--
-- Name: create_production_order(uuid, uuid, date, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_production_order(p_warehouse_id uuid, p_cost_center_id uuid, p_production_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
  v_number text;
BEGIN
  IF v_user IS NULL OR NOT public.is_staff(v_user) OR NOT (
    public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
    OR public.has_role(v_user,'warehouse') OR public.has_role(v_user,'accountant')
  ) THEN RAISE EXCEPTION 'ليس لديك صلاحية إنشاء تشغيلة إنتاج'; END IF;
  IF p_warehouse_id IS NULL OR p_cost_center_id IS NULL OR p_production_date IS NULL THEN
    RAISE EXCEPTION 'المستودع ومركز التكلفة وتاريخ الإنتاج مطلوبة' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id=p_warehouse_id AND is_active) THEN
    RAISE EXCEPTION 'المستودع غير نشط أو غير موجود' USING ERRCODE='23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.expense_cost_centers WHERE id=p_cost_center_id AND is_active) THEN
    RAISE EXCEPTION 'مركز التكلفة غير نشط أو غير موجود' USING ERRCODE='23503';
  END IF;
  v_number := 'MO-' || to_char(p_production_date,'YYYYMMDD') || '-' ||
              lpad(nextval('public.production_order_number_seq')::text,5,'0');
  INSERT INTO public.production_orders(order_number,warehouse_id,cost_center_id,production_date,notes,created_by)
  VALUES (v_number,p_warehouse_id,p_cost_center_id,p_production_date,nullif(btrim(coalesce(p_notes,'')),''),v_user)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

--
-- Name: guard_allocated_expense_reversal(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.guard_allocated_expense_reversal() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status::text='REVERSED' AND OLD.status::text<>'REVERSED'
     AND EXISTS(
       SELECT 1 FROM public.production_order_cost_allocations a
       JOIN public.production_orders o ON o.id=a.production_order_id
       WHERE a.expense_entry_id=NEW.id AND o.status='POSTED'
     ) THEN
    RAISE EXCEPTION 'لا يمكن عكس المصروف؛ توجد تكلفة محملة على تشغيلات إنتاج مرحلة';
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: guard_reverse_production_with_shared_expenses(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.guard_reverse_production_with_shared_expenses(p_order_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.production_order_cost_allocations mine
      JOIN public.production_order_cost_allocations other
        ON other.expense_line_id = mine.expense_line_id
       AND other.production_order_id <> mine.production_order_id
      JOIN public.production_orders oo ON oo.id = other.production_order_id
     WHERE mine.production_order_id = p_order_id
       AND oo.status = 'POSTED'
  ) THEN
    RAISE EXCEPTION 'لا يمكن عكس التشغيلة: أحد مصروفاتها محمّل على أمر إنتاج آخر غير معكوس'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

--
-- Name: production_allocate_joint_cost(uuid, numeric); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.production_allocate_joint_cost(p_order_id uuid, p_total_allocatable numeric) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_count int;
  v_total_weight numeric;
  v_total_allocated numeric := 0;
  v_allocated numeric;
  v_delta numeric;
  r record;
BEGIN
  SELECT count(*), coalesce(sum(base_quantity * allocation_value_per_base), 0)
    INTO v_count, v_total_weight
    FROM public.production_order_outputs
   WHERE production_order_id = p_order_id;
  IF v_count = 0 THEN
    RETURN;
  END IF;
  IF v_count = 1 THEN
    UPDATE public.production_order_outputs SET allocated_cost = round(p_total_allocatable, 2),
           unit_cost = CASE WHEN base_quantity > 0
                            THEN round(p_total_allocatable, 2) / base_quantity ELSE 0 END
     WHERE production_order_id = p_order_id;
    RETURN;
  END IF;
  IF v_total_weight <= 0 THEN
    RAISE EXCEPTION 'وزن التوزيع غير موجب؛ يجب تحديد قيمة بيع تقديرية لوحدة الأساس لكل ناتج';
  END IF;

  FOR r IN
    SELECT id, base_quantity, allocation_value_per_base,
           row_number() OVER (ORDER BY created_at, id) AS rn
      FROM public.production_order_outputs
     WHERE production_order_id = p_order_id
     ORDER BY created_at, id
  LOOP
    IF r.rn = v_count THEN
      v_allocated := round(p_total_allocatable - v_total_allocated, 2);
    ELSE
      v_allocated := round(
        p_total_allocatable * (r.base_quantity * r.allocation_value_per_base) / v_total_weight, 2);
      v_total_allocated := v_total_allocated + v_allocated;
    END IF;
    UPDATE public.production_order_outputs SET allocated_cost = v_allocated,
           unit_cost = CASE WHEN base_quantity > 0 THEN v_allocated / base_quantity ELSE 0 END
     WHERE id = r.id;
  END LOOP;

  v_delta := round(p_total_allocatable - (SELECT coalesce(sum(allocated_cost), 0)
                                           FROM public.production_order_outputs
                                          WHERE production_order_id = p_order_id), 2);
  IF abs(v_delta) > 0.005 THEN
    RAISE EXCEPTION 'توزيع التكلفة على المخرجات غير متسق: فرق %', v_delta;
  END IF;
END;
$$;

--
-- Name: production_cost_sources(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.production_cost_sources() RETURNS TABLE(expense_line_id uuid, expense_entry_id uuid, reference text, expense_date date, description text, category_name text, cost_center_id uuid, account_code text, net_amount numeric, allocated_amount numeric, available_amount numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_read_finance(auth.uid()) THEN
    RAISE EXCEPTION 'لا تتوفر صلاحية قراءة مصروفات الإنتاج';
  END IF;
  RETURN QUERY
  SELECT l.id,e.id,e.reference,e.expense_date,coalesce(l.description,e.description,'مصروف'),
         coalesce(c.name_ar,c.name,'مصروف'),coalesce(l.cost_center_id,e.cost_center_id),
         a.code::text,l.net_amount,
         coalesce(sum(pa.amount),0)::numeric,
         greatest(l.net_amount-coalesce(sum(pa.amount),0),0)::numeric
    FROM public.expense_lines l
    JOIN public.expense_entries e ON e.id=l.entry_id
    JOIN public.expense_categories c
      ON c.id=l.category_id AND c.production_cost_eligible AND c.is_active
    JOIN public.accounts a ON a.id=c.account_id AND a.account_type::text='EXPENSE'
      AND a.is_active AND a.is_postable
    LEFT JOIN public.production_order_cost_allocations pa ON pa.expense_line_id=l.id
   WHERE e.status::text IN ('POSTED','PARTIALLY_PAID','PAID','CLOSED')
     AND l.net_amount > 0
   GROUP BY l.id,e.id,e.reference,e.expense_date,l.description,e.description,c.name_ar,c.name,
            l.cost_center_id,e.cost_center_id,a.code,l.net_amount
  HAVING l.net_amount-coalesce(sum(pa.amount),0) > 0
   ORDER BY e.expense_date DESC,e.reference,l.line_no;
END;
$$;

--
-- Name: production_guard_posted_void_output(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.production_guard_posted_void_output() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_status text;
BEGIN
  SELECT o.status INTO v_status
    FROM public.production_orders o
   WHERE o.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.production_order_id ELSE NEW.production_order_id END;
  IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'لا يمكن تعديل أو حذف سطور أمر إنتاج غير مسودة؛ اعكس الأمر أولاً'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: production_link_movement_to_order(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.production_link_movement_to_order() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_order_id uuid;
BEGIN
  IF NEW.production_order_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.source_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.source_type = 'production_material' THEN
    SELECT m.production_order_id INTO v_order_id
      FROM public.production_order_materials m WHERE m.id = NEW.source_id;
  ELSIF NEW.source_type = 'production_output' THEN
    SELECT o.production_order_id INTO v_order_id
      FROM public.production_order_outputs o WHERE o.id = NEW.source_id;
  ELSIF NEW.source_type = 'production_reversal_material' THEN
    SELECT m.production_order_id INTO v_order_id
      FROM public.production_order_materials m WHERE m.id = NEW.source_id;
  ELSIF NEW.source_type = 'production_reversal_output' THEN
    SELECT o.production_order_id INTO v_order_id
      FROM public.production_order_outputs o WHERE o.id = NEW.source_id;
  END IF;

  NEW.production_order_id := v_order_id;
  RETURN NEW;
END;
$$;

--
-- Name: production_order_history(integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.production_order_history(p_limit integer DEFAULT 250) RETURNS TABLE(id uuid, order_number text, production_date date, status text, warehouse_id uuid, cost_center_id uuid, material_cost numeric, conversion_cost numeric, total_cost numeric, output_cost numeric, abnormal_loss_cost numeric, notes text, completed_at timestamp with time zone, reversed_at timestamp with time zone, reversal_reason text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 250), 1), 500);
BEGIN
  IF v_user IS NULL OR NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية قراءة سجل الإنتاج';
  END IF;
  RETURN QUERY
    SELECT o.id, o.order_number, o.production_date, o.status, o.warehouse_id,
           o.cost_center_id, o.material_cost, o.conversion_cost, o.total_cost,
           o.output_cost, o.abnormal_loss_cost, o.notes, o.completed_at,
           o.reversed_at, o.reversal_reason
      FROM public.production_orders o
     ORDER BY o.created_at DESC
     LIMIT v_limit;
END;
$$;

--
-- Name: smart_manufacture(jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.smart_manufacture(p_payload jsonb) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_warehouse_id uuid;
  v_grain_item_id uuid;
  v_grain_qty numeric;
  v_outputs jsonb;
  v_notes text;
  v_grain_uom_id uuid;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'حمولة التصنيع الذكي يجب أن تكون كائناً JSON' USING ERRCODE = '22023';
  END IF;

  v_warehouse_id := nullif(p_payload->>'_warehouse_id', '')::uuid;
  v_grain_item_id := nullif(p_payload->>'_grain_item_id', '')::uuid;
  v_grain_qty := nullif(p_payload->>'_grain_qty', '')::numeric;
  v_outputs := p_payload->_outputs;
  v_notes := nullif(p_payload->>'_notes', '');
  v_grain_uom_id := nullif(p_payload->>'_grain_uom_id', '')::uuid;
  IF v_warehouse_id IS NULL OR v_grain_item_id IS NULL OR v_grain_qty IS NULL THEN
    RAISE EXCEPTION 'الحقول _warehouse_id و_grain_item_id و_grain_qty مطلوبة' USING ERRCODE = '22023';
  END IF;

  RETURN public.smart_manufacture(
    v_warehouse_id,
    v_grain_item_id,
    v_grain_qty,
    v_outputs,
    v_notes,
    v_grain_uom_id
  );
END;
$$;

--
-- Name: smart_manufacture(uuid, uuid, numeric, jsonb, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN public.smart_manufacture(
    _warehouse_id, _grain_item_id, _grain_qty, _outputs, _notes, NULL::uuid);
END;
$$;

--
-- Name: smart_manufacture(uuid, uuid, numeric, jsonb, text, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text, _grain_uom_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_ref text;
  v_doc_id uuid := gen_random_uuid();
  v_grain_product public.products%ROWTYPE;
  v_output_product public.products%ROWTYPE;
  v_available numeric;
  v_grain_base_qty numeric;
  v_grain_mass_kg numeric;
  v_output_mass_kg numeric := 0;
  v_output_base_qty numeric := 0;
  v_output_count int;
  v_output_value numeric := 0;
  v_line_value numeric;
  v_line_uom_ok boolean;
  v_line_allocated numeric;
  v_unit_cost numeric;
  v_grain_cost numeric;
  v_total_input_cost numeric;
  v_allocatable_cost numeric;
  v_total_allocated numeric := 0;
  v_waste_mass_kg numeric := 0;
  v_waste_cost numeric := 0;
  v_line_idx int := 0;
  v_all_mass boolean := true;
  v_journal_lines jsonb := '[]'::jsonb;
  v_acct_code text;
  v_item_name text;
  r record;
  l record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to run smart manufacture';
  END IF;
  IF _warehouse_id IS NULL OR _grain_item_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse and grain item are required';
  END IF;
  IF coalesce(_grain_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'Grain quantity must be positive';
  END IF;
  IF _outputs IS NULL OR jsonb_typeof(_outputs) <> 'array' OR jsonb_array_length(_outputs) = 0 THEN
    RAISE EXCEPTION 'At least one output line is required';
  END IF;
  IF length(coalesce(_notes, '')) > 2000 THEN
    RAISE EXCEPTION 'ملاحظات التصنيع طويلة جداً (الحد 2000 محرف)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_grain_product
    FROM public.products p
   WHERE p.id = _grain_item_id AND p.item_class = 'RAW_MATERIAL' AND p.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Input must be an active RAW_MATERIAL grain';
  END IF;

  -- عزل الملكية: حبوب العميل لا تدخل مخزون الشركة من هنا.
  IF v_grain_product.is_custody_item IS TRUE
     OR v_grain_product.inventory_policy = 'CUSTOMER_OWNED'::public.inventory_policy THEN
    RAISE EXCEPTION
      'حبوب العميل المملوكة له لا تُصنَّع هنا؛ استخدم مسار العهدة وخدمة الطحن'
      USING ERRCODE = 'check_violation';
  END IF;
  IF public.item_effective_policy(v_grain_product.id) <> 'TRACKED' THEN
    RAISE EXCEPTION 'القمح المستخدم في التصنيع يجب أن يكون صنفاً مخزونياً متتابعاً'
      USING ERRCODE = 'check_violation';
  END IF;

  IF public.company_costing_method() IS DISTINCT FROM 'MOVING_AVERAGE'::public.costing_method THEN
    RAISE EXCEPTION
      'ترحيل الإنتاج متوقف: طريقة التكلفة المحفوظة (%) غير مدعومة لهذا المسار',
      public.company_costing_method()
      USING ERRCODE = '55000';
  END IF;

  v_output_count := jsonb_array_length(_outputs);
  v_grain_base_qty := public.production_quantity_in_base(
    v_grain_product.id, coalesce(_grain_qty, 0), _grain_uom_id);

  -- مادة القمح يجب أن تكون موجودة فعلاً بكميتها المحوّلة في مخزون الشركة.
  SELECT coalesce(i.quantity, 0) INTO v_available
    FROM public.inventory i
   WHERE i.product_id = v_grain_product.id
     AND i.warehouse_id = _warehouse_id
     AND i.owner_type = 'COMPANY'
     AND i.owner_id IS NULL
   FOR UPDATE;
  IF v_available < v_grain_base_qty THEN
    RAISE EXCEPTION
      'رصيد القمح غير كافٍ: المطلوب % وحدة أساس والمتاح %',
      round(v_grain_base_qty, 3), round(v_available, 3)
      USING ERRCODE = 'check_violation';
  END IF;

  v_grain_mass_kg := public.production_mass_in_kg(v_grain_product.id, v_grain_base_qty);
  IF v_grain_mass_kg IS NULL THEN
    v_all_mass := false;
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs)
             AS o(item_id uuid, qty numeric, uom_id uuid)
  LOOP
    IF r.item_id IS NULL OR coalesce(r.qty, 0) <= 0 THEN
      RAISE EXCEPTION 'Every output line needs an item and a positive quantity';
    END IF;
    SELECT * INTO v_output_product FROM public.products p WHERE p.id = r.item_id;
    IF NOT FOUND
       OR v_output_product.item_class NOT IN ('FINISHED_GOOD', 'BY_PRODUCT')
       OR v_output_product.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Outputs must be FINISHED_GOOD or BY_PRODUCT items';
    END IF;
    IF v_output_product.is_custody_item IS TRUE
       OR v_output_product.inventory_policy = 'CUSTOMER_OWNED'::public.inventory_policy THEN
      RAISE EXCEPTION 'ناتج التصنيع لا يمكن أن يكون صنفاً مملوكاً للعميل'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT public.production_product_is_company_stock(v_output_product.id) THEN
      RAISE EXCEPTION 'ناتج التصنيع يجب أن يكون مخزنياً متتبعاً للشركة'
        USING ERRCODE = 'check_violation';
    END IF;
    DECLARE
      v_base numeric;
      v_mass numeric;
    BEGIN
      v_base := public.production_quantity_in_base(v_output_product.id, r.qty, r.uom_id);
      v_mass := public.production_mass_in_kg(v_output_product.id, v_base);
      v_output_base_qty := v_output_base_qty + v_base;
      IF v_mass IS NULL THEN
        v_all_mass := false;
      ELSE
        v_output_mass_kg := v_output_mass_kg + v_mass;
      END IF;
      v_line_value := coalesce(v_base, 0) * coalesce(v_output_product.sale_price, 0);
      v_output_value := v_output_value + v_line_value;
    END;
  END LOOP;

  IF v_output_value <= 0 THEN
    RAISE EXCEPTION 'Outputs must have sale prices to allocate cost by relative value';
  END IF;

  SELECT coalesce(
    (SELECT round(sum(cl.total_value) / nullif(sum(cl.quantity), 0), 4)
       FROM public.item_cost_layers cl
      WHERE cl.product_id = v_grain_product.id
        AND cl.warehouse_id = _warehouse_id
        AND cl.owner_type = 'COMPANY'
        AND cl.quantity > 0),
    v_grain_product.cost_price,
    0
  ) INTO v_grain_cost;

  v_total_input_cost := round(v_grain_base_qty * coalesce(v_grain_cost, 0), 2);
  v_ref := 'SM-' || to_char(now(), 'YYYYMM') || '-' ||
           lpad(nextval('public.milling_service_seq')::text, 4, '0');

  IF NOT v_all_mass OR v_grain_mass_kg IS NULL THEN
    RAISE EXCEPTION
      'لا يمكن احتساب الفاقد: تعريف كتلي مفقود لأحد الأصناف. اضبط وحدة كتلة الأساس أو وزن العبوة'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_output_mass_kg > v_grain_mass_kg THEN
    RAISE EXCEPTION 'Total output mass (%) cannot exceed input grain mass (%)',
      round(v_output_mass_kg, 3), round(v_grain_mass_kg, 3)
      USING ERRCODE = 'check_violation';
  END IF;

  v_waste_mass_kg := greatest(0, v_grain_mass_kg - v_output_mass_kg);
  v_waste_cost := CASE WHEN v_waste_mass_kg > 0 AND v_grain_cost > 0
                    THEN round(v_waste_mass_kg * v_grain_cost, 2) ELSE 0 END;
  v_allocatable_cost := greatest(0, v_total_input_cost - v_waste_cost);
  IF v_allocatable_cost <= 0 THEN
    RAISE EXCEPTION 'لا يمكن ترحيل تصنيع بلا تكلفة قابلة للتوزيع';
  END IF;

  PERFORM public.post_stock_delta(
    p_product_id => v_grain_product.id,
    p_warehouse_id => _warehouse_id,
    p_signed_qty => -v_grain_base_qty,
    p_unit_cost => v_grain_cost,
    p_movement_kind => 'PRODUCTION'::public.stock_movement_kind,
    p_source_type => 'smart_manufacture',
    p_source_id => v_doc_id,
    p_note => 'تصنيع ذكي ' || v_ref || coalesce(' — ' || _notes, ''),
    p_owner_type => 'COMPANY'::public.owner_type,
    p_owner_id => NULL,
    p_movement_type_legacy => 'production_out'::public.movement_type);

  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs)
             AS o(item_id uuid, qty numeric, uom_id uuid)
  LOOP
    SELECT * INTO v_output_product FROM public.products p WHERE p.id = r.item_id;
    DECLARE
      v_base numeric := public.production_quantity_in_base(v_output_product.id, r.qty, r.uom_id);
      v_weight numeric := coalesce(v_base, 0) * coalesce(v_output_product.sale_price, 0);
      v_class text := v_output_product.item_class::text;
      v_name text := coalesce(v_output_product.name_ar, v_output_product.name);
    BEGIN
      v_line_idx := v_line_idx + 1;
      IF v_line_idx = v_output_count THEN
        v_line_allocated := v_allocatable_cost - v_total_allocated;
      ELSE
        v_line_allocated := round(v_allocatable_cost * (v_weight / v_output_value), 2);
        v_total_allocated := v_total_allocated + v_line_allocated;
      END IF;
      v_unit_cost := round(v_line_allocated / nullif(v_base, 0), 4);

      PERFORM public.post_stock_delta(
        p_product_id => v_output_product.id,
        p_warehouse_id => _warehouse_id,
        p_signed_qty => v_base,
        p_unit_cost => v_unit_cost,
        p_movement_kind => 'RECEIPT'::public.stock_movement_kind,
        p_source_type => 'smart_manufacture',
        p_source_id => v_doc_id,
        p_note => 'تصنيع ذكي ' || v_ref || coalesce(' — ' || _notes, ''),
        p_owner_type => 'COMPANY'::public.owner_type,
        p_owner_id => NULL,
        p_movement_type_legacy => 'production_in'::public.movement_type);

      v_acct_code := CASE WHEN v_class = 'BY_PRODUCT' THEN '1314' ELSE '1313' END;
      IF v_line_allocated > 0 THEN
        v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_code', v_acct_code,
          'debit', v_line_allocated,
          'credit', 0,
          'memo', 'إنتاج مخزون ' || v_name || ' (' || v_ref || ')');
      END IF;
    END;
  END LOOP;

  IF v_waste_cost > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_object(
      'account_code', '5921',
      'debit', v_waste_cost,
      'credit', 0,
      'memo', 'فاقد وتلف تشغيلي مطحنة (' || v_ref || ')');
  END IF;

  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_code', '1311',
    'debit', 0,
    'credit', v_total_input_cost,
    'memo', 'سحب قمح خام للتصنيع (' || v_ref || ')');

  PERFORM public.create_journal_entry(
    p_memo => 'تصنيع ذكي ' || v_ref || coalesce(' — ' || _notes, ''),
    p_entry_date => CURRENT_DATE,
    p_source_type => 'smart_manufacture',
    p_source_id => v_doc_id,
    p_is_system => true,
    p_lines => v_journal_lines);

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'manufacture.smart', 'stock_movement', v_doc_id,
    jsonb_build_object(
      'doc_id', v_doc_id,
      'ref', v_ref,
      'warehouse_id', _warehouse_id,
      'grain_item_id', v_grain_product.id,
      'grain_entered_qty', coalesce(_grain_qty, 0),
      'grain_uom_id', _grain_uom_id,
      'grain_base_qty', v_grain_base_qty,
      'grain_mass_kg', v_grain_mass_kg,
      'grain_unit_cost', v_grain_cost,
      'output_mass_kg', v_output_mass_kg,
      'waste_mass_kg', v_waste_mass_kg,
      'waste_cost', v_waste_cost,
      'total_cost', v_total_input_cost,
      'outputs', _outputs,
      'allocation', 'RELATIVE_SALES_VALUE',
      'uom_normalized', 'BASE_UOM',
      'waste_basis', 'MASS_KG'));

  RETURN v_ref;
END;
$$;

--
-- Name: smart_manufacture(uuid, uuid, numeric, jsonb, text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text, _grain_uom_id uuid, _output_uom_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_outputs jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(
    CASE WHEN nullif(elem->>'uom_id','') IS NULL AND _output_uom_id IS NOT NULL
         THEN jsonb_set(elem, '{uom_id}', to_jsonb(_output_uom_id::text))
         ELSE elem END), '[]'::jsonb)
    INTO v_outputs
    FROM jsonb_array_elements(coalesce(_outputs,'[]'::jsonb)) elem;
  RETURN public.smart_manufacture(
    _warehouse_id, _grain_item_id, _grain_qty, v_outputs, _notes, _grain_uom_id);
END;
$$;

--
-- Name: production_order_batch_allocations; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.production_order_batch_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    base_quantity numeric(18,6) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_order_batch_allocations_base_quantity_check CHECK ((base_quantity > (0)::numeric))
);

--
-- Name: production_order_cost_allocations; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.production_order_cost_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    production_order_id uuid NOT NULL,
    expense_line_id uuid NOT NULL,
    expense_entry_id uuid NOT NULL,
    cost_center_id uuid,
    expense_account_code text NOT NULL,
    amount numeric(18,2) NOT NULL,
    allocation_basis text NOT NULL,
    note text,
    journal_entry_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_cost_allocation_basis_nonblank CHECK ((length(btrim(allocation_basis)) >= 3)),
    CONSTRAINT production_order_cost_allocations_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT production_order_cost_allocations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: production_order_losses; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.production_order_losses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    production_order_id uuid NOT NULL,
    loss_type text NOT NULL,
    quantity numeric(18,6) NOT NULL,
    uom_id uuid NOT NULL,
    mass_kg numeric(18,6) NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_loss_reason_nonblank CHECK ((length(btrim(reason)) >= 3)),
    CONSTRAINT production_order_losses_loss_type_check CHECK ((loss_type = ANY (ARRAY['NORMAL'::text, 'ABNORMAL'::text]))),
    CONSTRAINT production_order_losses_mass_kg_check CHECK ((mass_kg > (0)::numeric)),
    CONSTRAINT production_order_losses_quantity_check CHECK ((quantity > (0)::numeric))
);

--
-- Name: production_order_materials; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.production_order_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    production_order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    entered_quantity numeric(18,6) NOT NULL,
    uom_id uuid,
    base_uom_id uuid,
    uom_conversion_factor numeric(30,12) NOT NULL,
    base_quantity numeric(18,6) NOT NULL,
    mass_kg numeric(18,6),
    unit_cost numeric(18,4) DEFAULT 0 NOT NULL,
    total_cost numeric(18,2) DEFAULT 0 NOT NULL,
    inventory_account_code text NOT NULL,
    stock_movement_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_material_mass_nonnegative CHECK (((mass_kg IS NULL) OR (mass_kg > (0)::numeric))),
    CONSTRAINT production_order_materials_base_quantity_check CHECK ((base_quantity > (0)::numeric)),
    CONSTRAINT production_order_materials_entered_quantity_check CHECK ((entered_quantity > (0)::numeric)),
    CONSTRAINT production_order_materials_uom_conversion_factor_check CHECK ((uom_conversion_factor > (0)::numeric))
);

--
-- Name: production_order_number_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.production_order_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: production_order_outputs; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.production_order_outputs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    production_order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    entered_quantity numeric(18,6) NOT NULL,
    uom_id uuid,
    base_uom_id uuid,
    uom_conversion_factor numeric(30,12) NOT NULL,
    base_quantity numeric(18,6) NOT NULL,
    mass_kg numeric(18,6),
    allocation_value_per_base numeric(18,6) DEFAULT 0 NOT NULL,
    allocated_cost numeric(18,2) DEFAULT 0 NOT NULL,
    actual_stock_cost numeric(18,2) DEFAULT 0 NOT NULL,
    unit_cost numeric(18,4) DEFAULT 0 NOT NULL,
    inventory_account_code text NOT NULL,
    batch_id uuid,
    batch_number text,
    expiry_date date,
    stock_movement_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_order_outputs_actual_stock_cost_check CHECK ((actual_stock_cost >= (0)::numeric)),
    CONSTRAINT production_order_outputs_allocated_cost_check CHECK ((allocated_cost >= (0)::numeric)),
    CONSTRAINT production_order_outputs_allocation_value_per_base_check CHECK ((allocation_value_per_base >= (0)::numeric)),
    CONSTRAINT production_order_outputs_base_quantity_check CHECK ((base_quantity > (0)::numeric)),
    CONSTRAINT production_order_outputs_entered_quantity_check CHECK ((entered_quantity > (0)::numeric)),
    CONSTRAINT production_order_outputs_uom_conversion_factor_check CHECK ((uom_conversion_factor > (0)::numeric)),
    CONSTRAINT production_output_mass_nonnegative CHECK (((mass_kg IS NULL) OR (mass_kg > (0)::numeric)))
);

--
-- Name: production_orders; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.production_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_number text NOT NULL,
    warehouse_id uuid NOT NULL,
    cost_center_id uuid NOT NULL,
    production_date date DEFAULT CURRENT_DATE NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    material_cost numeric(18,2) DEFAULT 0 NOT NULL,
    conversion_cost numeric(18,2) DEFAULT 0 NOT NULL,
    total_cost numeric(18,2) DEFAULT 0 NOT NULL,
    output_cost numeric(18,2) DEFAULT 0 NOT NULL,
    abnormal_loss_cost numeric(18,2) DEFAULT 0 NOT NULL,
    notes text,
    created_by uuid,
    completed_by uuid,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reversed_at timestamp with time zone,
    reversed_by uuid,
    reversal_reason text,
    CONSTRAINT production_order_reversal_audit_complete CHECK (((status <> 'REVERSED'::text) OR ((reversed_at IS NOT NULL) AND (reversed_by IS NOT NULL) AND (length(btrim(COALESCE(reversal_reason, ''::text))) >= 3)))),
    CONSTRAINT production_orders_abnormal_loss_cost_check CHECK ((abnormal_loss_cost >= (0)::numeric)),
    CONSTRAINT production_orders_conversion_cost_check CHECK ((conversion_cost >= (0)::numeric)),
    CONSTRAINT production_orders_material_cost_check CHECK ((material_cost >= (0)::numeric)),
    CONSTRAINT production_orders_output_cost_check CHECK ((output_cost >= (0)::numeric)),
    CONSTRAINT production_orders_posted_has_completion CHECK (((status <> 'POSTED'::text) OR (completed_at IS NOT NULL))),
    CONSTRAINT production_orders_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'POSTED'::text, 'CANCELLED'::text, 'REVERSED'::text]))),
    CONSTRAINT production_orders_total_cost_check CHECK ((total_cost >= (0)::numeric)),
    CONSTRAINT production_orders_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT production_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT production_orders_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES auth.users(id) ON DELETE SET NULL
);


--
-- Name: FUNCTION convert_stock(_warehouse_id uuid, _source_item_id uuid, _source_qty numeric, _outputs jsonb, _loss_qty numeric, _notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.convert_stock(_warehouse_id uuid, _source_item_id uuid, _source_qty numeric, _outputs jsonb, _loss_qty numeric, _notes text) FROM PUBLIC;


--
-- Name: FUNCTION create_and_post_production_order(p_warehouse_id uuid, p_cost_center_id uuid, p_production_date date, p_notes text, p_materials jsonb, p_outputs jsonb, p_expenses jsonb, p_losses jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_and_post_production_order(p_warehouse_id uuid, p_cost_center_id uuid, p_production_date date, p_notes text, p_materials jsonb, p_outputs jsonb, p_expenses jsonb, p_losses jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_and_post_production_order(p_warehouse_id uuid, p_cost_center_id uuid, p_production_date date, p_notes text, p_materials jsonb, p_outputs jsonb, p_expenses jsonb, p_losses jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.create_and_post_production_order(p_warehouse_id uuid, p_cost_center_id uuid, p_production_date date, p_notes text, p_materials jsonb, p_outputs jsonb, p_expenses jsonb, p_losses jsonb) TO service_role;


--
-- Name: FUNCTION create_production_order(p_warehouse_id uuid, p_cost_center_id uuid, p_production_date date, p_notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_production_order(p_warehouse_id uuid, p_cost_center_id uuid, p_production_date date, p_notes text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_production_order(p_warehouse_id uuid, p_cost_center_id uuid, p_production_date date, p_notes text) TO service_role;


--
-- Name: expense_entries expense_reversal_blocked_by_production; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER expense_reversal_blocked_by_production BEFORE UPDATE OF status ON public.expense_entries FOR EACH ROW EXECUTE FUNCTION public.guard_allocated_expense_reversal();

--
-- Name: FUNCTION guard_allocated_expense_reversal(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.guard_allocated_expense_reversal() FROM PUBLIC;

GRANT ALL ON FUNCTION public.guard_allocated_expense_reversal() TO service_role;


--
-- Name: FUNCTION guard_reverse_production_with_shared_expenses(p_order_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.guard_reverse_production_with_shared_expenses(p_order_id uuid) IS 'يرفض عكس أمر تكلفته من مصروف محمّل على أمر آخر مرحّل؛ يُستدعى من reverse_production_order عبر service role.';

--
-- Name: FUNCTION guard_reverse_production_with_shared_expenses(p_order_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.guard_reverse_production_with_shared_expenses(p_order_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.guard_reverse_production_with_shared_expenses(p_order_id uuid) TO service_role;


--
-- Name: FUNCTION production_allocate_joint_cost(p_order_id uuid, p_total_allocatable numeric); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.production_allocate_joint_cost(p_order_id uuid, p_total_allocatable numeric) FROM PUBLIC;

GRANT ALL ON FUNCTION public.production_allocate_joint_cost(p_order_id uuid, p_total_allocatable numeric) TO service_role;


--
-- Name: FUNCTION production_cost_sources(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.production_cost_sources() FROM PUBLIC;

GRANT ALL ON FUNCTION public.production_cost_sources() TO authenticated;

GRANT ALL ON FUNCTION public.production_cost_sources() TO service_role;


--
-- Name: FUNCTION production_guard_posted_void_output(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.production_guard_posted_void_output() FROM PUBLIC;


--
-- Name: stock_movements stock_movements_link_production_order; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER stock_movements_link_production_order BEFORE INSERT ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.production_link_movement_to_order();

--
-- Name: FUNCTION production_link_movement_to_order(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.production_link_movement_to_order() FROM PUBLIC;


--
-- Name: FUNCTION production_order_history(p_limit integer); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.production_order_history(p_limit integer) IS 'سجل أوامر الإنتاج للعرض: الأعمدة الأساسية فقط بحد أقصى 500 سطر. التفاصيل عبر production_order_cost_detail.';

--
-- Name: FUNCTION production_order_history(p_limit integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.production_order_history(p_limit integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.production_order_history(p_limit integer) TO authenticated;

GRANT ALL ON FUNCTION public.production_order_history(p_limit integer) TO service_role;


--
-- Name: FUNCTION smart_manufacture(p_payload jsonb); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.smart_manufacture(p_payload jsonb) IS 'مغلّف PostgREST لمسار التصنيع القديم يستقبل الحمولة بمفاتيح الواجهة (_warehouse_id/_grain_item_id/_grain_qty/_outputs/_notes/_grain_uom_id) ويحيل إلى المصدر الموسّع.';



--
-- Name: FUNCTION smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text, _grain_uom_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text, _grain_uom_id uuid) IS 'مسار تصنيع قديم للتوافق فقط؛ يطبّع كل كمية إلى وحدة أساس الصنف ويشتق الفاقد من مكافئ الكتلة. الأمر الحديث create_and_post_production_order هو المسار المعتمد.';


--
-- Name: FUNCTION smart_manufacture(p_payload jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.smart_manufacture(p_payload jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.smart_manufacture(p_payload jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.smart_manufacture(p_payload jsonb) TO service_role;

--
-- Name: FUNCTION smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text) TO authenticated;

GRANT ALL ON FUNCTION public.smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text) TO service_role;

--
-- Name: FUNCTION smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text, _grain_uom_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text, _grain_uom_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text, _grain_uom_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text, _grain_uom_id uuid) TO service_role;

--
-- Name: FUNCTION smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text, _grain_uom_id uuid, _output_uom_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text, _grain_uom_id uuid, _output_uom_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text, _grain_uom_id uuid, _output_uom_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text, _grain_uom_id uuid, _output_uom_id uuid) TO service_role;


--
-- Name: production_order_batch_allocations production_order_batch_allocations_material_id_batch_id_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_batch_allocations
    ADD CONSTRAINT production_order_batch_allocations_material_id_batch_id_key UNIQUE (material_id, batch_id);

--
-- Name: production_order_batch_allocations production_order_batch_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_batch_allocations
    ADD CONSTRAINT production_order_batch_allocations_pkey PRIMARY KEY (id);

--
-- Name: production_order_batch_allocations production_batch_allocations_finance_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY production_batch_allocations_finance_read ON public.production_order_batch_allocations FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: production_order_batch_allocations; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.production_order_batch_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE production_order_batch_allocations; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.production_order_batch_allocations TO authenticated;

GRANT ALL ON TABLE public.production_order_batch_allocations TO service_role;

--
-- Name: production_expense_line_available(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.production_expense_line_available(p_expense_line_id uuid) RETURNS TABLE(expense_line_id uuid, expense_entry_id uuid, entry_reference text, expense_date date, net_amount numeric, tax_amount numeric, tax_recoverable boolean, eligible_amount numeric, allocated_amount numeric, available_amount numeric, expense_account_code text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    l.id,
    e.id,
    e.reference,
    e.expense_date,
    l.net_amount,
    l.tax_amount,
    coalesce(e.tax_recoverable, false),
    public.expense_line_production_base_amount(l.net_amount, l.tax_amount, e.tax_recoverable),
    coalesce((
      SELECT sum(a.amount) FROM public.production_order_cost_allocations a
       WHERE a.expense_line_id = l.id
    ), 0),
    public.expense_round(
      public.expense_line_production_base_amount(l.net_amount, l.tax_amount, e.tax_recoverable)
      - coalesce((
          SELECT sum(a.amount) FROM public.production_order_cost_allocations a
           WHERE a.expense_line_id = l.id
        ), 0)
    ),
    acct.code::text
  FROM public.expense_lines l
  JOIN public.expense_entries e ON e.id = l.entry_id
  JOIN public.expense_categories c ON c.id = l.category_id
  JOIN public.accounts acct ON acct.id = c.account_id
  WHERE l.id = p_expense_line_id
    AND acct.account_type::text = 'EXPENSE'
    AND acct.is_active
    AND acct.is_postable
$$;


--
-- Name: TABLE production_order_cost_allocations; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.production_order_cost_allocations IS 'Net-of-input-tax allocations from posted expense lines to a production order; these reclassify expense to WIP.';

--
-- Name: production_order_cost_allocations production_order_cost_allocat_production_order_id_expense_l_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_cost_allocations
    ADD CONSTRAINT production_order_cost_allocat_production_order_id_expense_l_key UNIQUE (production_order_id, expense_line_id);

--
-- Name: production_order_cost_allocations production_order_cost_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_cost_allocations
    ADD CONSTRAINT production_order_cost_allocations_pkey PRIMARY KEY (id);

--
-- Name: production_cost_allocations_line_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX production_cost_allocations_line_idx ON public.production_order_cost_allocations USING btree (expense_line_id);

--
-- Name: production_order_cost_allocations production_cost_allocations_no_delete; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER production_cost_allocations_no_delete BEFORE DELETE ON public.production_order_cost_allocations FOR EACH ROW EXECUTE FUNCTION public.production_guard_cost_allocation_write();

--
-- Name: production_order_cost_allocations production_cost_allocations_finance_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY production_cost_allocations_finance_read ON public.production_order_cost_allocations FOR SELECT TO authenticated USING (public.can_read_finance(auth.uid()));

--
-- Name: production_order_cost_allocations; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.production_order_cost_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE production_order_cost_allocations; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.production_order_cost_allocations TO authenticated;

GRANT ALL ON TABLE public.production_order_cost_allocations TO service_role;


--
-- Name: production_order_losses production_order_losses_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_losses
    ADD CONSTRAINT production_order_losses_pkey PRIMARY KEY (id);

--
-- Name: production_order_losses production_losses_locked_after_post; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER production_losses_locked_after_post BEFORE DELETE OR UPDATE ON public.production_order_losses FOR EACH ROW EXECUTE FUNCTION public.production_guard_posted_void_output();

--
-- Name: production_order_losses production_losses_finance_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY production_losses_finance_read ON public.production_order_losses FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: production_order_losses; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.production_order_losses ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE production_order_losses; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.production_order_losses TO authenticated;

GRANT ALL ON TABLE public.production_order_losses TO service_role;


--
-- Name: COLUMN production_order_materials.base_quantity; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.production_order_materials.base_quantity IS 'Material quantity in the product base UOM as captured at posting; stock and cost are valued in this UOM.';

--
-- Name: production_order_materials production_order_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_materials
    ADD CONSTRAINT production_order_materials_pkey PRIMARY KEY (id);

--
-- Name: production_materials_order_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX production_materials_order_idx ON public.production_order_materials USING btree (production_order_id);

--
-- Name: production_order_materials production_materials_locked_after_post; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER production_materials_locked_after_post BEFORE DELETE OR UPDATE ON public.production_order_materials FOR EACH ROW EXECUTE FUNCTION public.production_guard_posted_void_output();

--
-- Name: production_order_materials trg_guard_company_production_material_scope; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_guard_company_production_material_scope BEFORE INSERT OR UPDATE ON public.production_order_materials FOR EACH ROW EXECUTE FUNCTION public.guard_company_production_material_scope();

--
-- Name: production_order_materials production_materials_finance_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY production_materials_finance_read ON public.production_order_materials FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: production_order_materials; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.production_order_materials ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE production_order_materials; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.production_order_materials TO authenticated;

GRANT ALL ON TABLE public.production_order_materials TO service_role;



--
-- Name: COLUMN production_order_outputs.allocation_value_per_base; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.production_order_outputs.allocation_value_per_base IS 'Estimated sales value per base UOM used only to allocate joint production cost among multiple outputs.';

--
-- Name: production_order_outputs production_order_outputs_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_order_outputs
    ADD CONSTRAINT production_order_outputs_pkey PRIMARY KEY (id);

--
-- Name: production_outputs_order_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX production_outputs_order_idx ON public.production_order_outputs USING btree (production_order_id);

--
-- Name: production_order_outputs production_outputs_locked_after_post; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER production_outputs_locked_after_post BEFORE DELETE OR UPDATE ON public.production_order_outputs FOR EACH ROW EXECUTE FUNCTION public.production_guard_posted_void_output();

--
-- Name: production_order_outputs; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.production_order_outputs ENABLE ROW LEVEL SECURITY;

--
-- Name: production_order_outputs production_outputs_finance_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY production_outputs_finance_read ON public.production_order_outputs FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: TABLE production_order_outputs; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.production_order_outputs TO authenticated;

GRANT ALL ON TABLE public.production_order_outputs TO service_role;

--
-- Name: complete_production_order(uuid, jsonb, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.complete_production_order(p_order_id uuid, p_materials jsonb, p_outputs jsonb, p_expenses jsonb DEFAULT '[]'::jsonb, p_losses jsonb DEFAULT '[]'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order public.production_orders%ROWTYPE;
  v_input jsonb;
  v_output jsonb;
  v_expense jsonb;
  v_loss jsonb;
  v_product public.products%ROWTYPE;
  v_expense_line public.expense_lines%ROWTYPE;
  v_expense_entry public.expense_entries%ROWTYPE;
  v_expense_category_eligible boolean;
  v_eligible_amount numeric;
  v_batch public.product_batches%ROWTYPE;
  v_material_id uuid;
  v_output_id uuid;
  v_allocation_id uuid;
  v_journal_id uuid;
  v_movement_id uuid;
  v_batch_id uuid;
  v_base_uom_id uuid;
  v_uom_id uuid;
  v_base_qty numeric;
  v_factor numeric;
  v_mass numeric;
  v_total_input_mass numeric := 0;
  v_total_output_mass numeric := 0;
  v_normal_loss_mass numeric := 0;
  v_abnormal_loss_mass numeric := 0;
  v_input_mass_complete boolean := true;
  v_output_mass_complete boolean := true;
  v_expected_mass numeric;
  v_total_material_cost numeric := 0;
  v_total_conversion_cost numeric := 0;
  v_total_wip numeric := 0;
  v_abnormal_cost numeric := 0;
  v_allocated numeric := 0;
  v_remaining_wip numeric := 0;
  v_actual_output_total numeric := 0;
  v_line_cost numeric := 0;
  v_available numeric := 0;
  v_already_allocated numeric := 0;
  v_currency_account text;
  v_stock_account text;
  v_journal_lines jsonb;
  v_batch_settings jsonb := '{}'::jsonb;
  v_company_strategy text := 'FEFO';
  v_strategy text := 'FEFO';
  v_prevent_expired boolean := true;
  v_remaining numeric;
  v_take numeric;
  v_batch_line record;
  v_unit record;
  v_output_count integer;
  v_output_index integer := 0;
  v_batch_number text;
  v_expiry date;
  v_loss_factor numeric;
  v_kg_factor numeric;
  v_variance numeric;
  v_material_journal uuid;
BEGIN
  IF v_user IS NULL OR NOT public.is_staff(v_user) OR NOT (
    public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
    OR public.has_role(v_user,'warehouse') OR public.has_role(v_user,'accountant')
  ) THEN RAISE EXCEPTION 'ليس لديك صلاحية ترحيل تشغيلة الإنتاج'; END IF;
  IF p_materials IS NULL OR jsonb_typeof(p_materials)<>'array' OR jsonb_array_length(p_materials)=0
     OR p_outputs IS NULL OR jsonb_typeof(p_outputs)<>'array' OR jsonb_array_length(p_outputs)=0 THEN
    RAISE EXCEPTION 'أضف مادة واحدة وناتجاً واحداً على الأقل' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(coalesce(p_expenses,'[]'::jsonb))<>'array'
     OR jsonb_typeof(coalesce(p_losses,'[]'::jsonb))<>'array' THEN
    RAISE EXCEPTION 'بيانات المصروفات أو الفاقد غير صحيحة' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_order FROM public.production_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تشغيلة الإنتاج غير موجودة' USING ERRCODE='P0002'; END IF;
  IF v_order.status<>'DRAFT' THEN RAISE EXCEPTION 'لا يمكن ترحيل تشغيلة ليست مسودة'; END IF;
  IF jsonb_array_length(coalesce(p_expenses,'[]'::jsonb))>0 AND NOT public.can_read_finance(v_user) THEN
    RAISE EXCEPTION 'تخصيص المصروفات يتطلب صلاحية مالية';
  END IF;

  SELECT coalesce(cs.batch_settings,'{}'::jsonb) INTO v_batch_settings
    FROM public.company_settings cs LIMIT 1;
  v_strategy := coalesce(v_batch_settings->>'dispatch_strategy','FEFO');
  IF v_strategy NOT IN ('FEFO','FIFO','MANUAL') THEN v_strategy:='FEFO'; END IF;
  v_company_strategy:=v_strategy;
  v_prevent_expired := coalesce((v_batch_settings->>'prevent_selling_expired')::boolean,true);

  -- Materials: normalize entered units, issue company stock once, and capture
  -- the actual moving-average amount created by the stock-cost engine.
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    SELECT * INTO v_product FROM public.products WHERE id=(v_input->>'product_id')::uuid FOR SHARE;
    IF NOT FOUND OR v_product.item_class IS NULL OR v_product.item_class IN ('SERVICE','NON_STOCK_ITEM')
       OR v_product.item_nature='SERVICE' OR public.item_effective_policy(v_product.id)<>'TRACKED' THEN
      RAISE EXCEPTION 'المادة % لا تدار كمخزون مملوك للمنشأة',coalesce(v_input->>'product_id','?')
        USING ERRCODE='check_violation';
    END IF;
    IF v_product.tracking='SERIAL' THEN
      RAISE EXCEPTION 'التصنيع لا يدعم حالياً الصرف التسلسلي للصنف %',v_product.name_ar USING ERRCODE='check_violation';
    END IF;
    v_uom_id := nullif(v_input->>'uom_id','')::uuid;
    v_base_uom_id := coalesce(v_product.base_uom_id,v_product.unit_id);
    v_base_qty := public.production_quantity_in_base(v_product.id,(v_input->>'quantity')::numeric,v_uom_id);
    v_factor := v_base_qty/(v_input->>'quantity')::numeric;
    IF v_base_qty<>round(v_base_qty,3) THEN RAISE EXCEPTION 'كمية المادة تتجاوز دقة المخزون 0.001'; END IF;
    v_mass := public.production_mass_in_kg(v_product.id,v_base_qty);
    IF v_product.item_class='RAW_MATERIAL' THEN
      IF v_mass IS NULL THEN v_input_mass_complete:=false; ELSE v_total_input_mass:=v_total_input_mass+v_mass; END IF;
    END IF;

    INSERT INTO public.production_order_materials(
      production_order_id,product_id,entered_quantity,uom_id,base_uom_id,uom_conversion_factor,
      base_quantity,mass_kg,inventory_account_code)
    VALUES (v_order.id,v_product.id,(v_input->>'quantity')::numeric,v_uom_id,v_base_uom_id,v_factor,
      v_base_qty,v_mass,public.production_inventory_account_code(v_product.item_class))
    RETURNING id INTO v_material_id;

    IF v_product.tracking='BATCH' THEN
      v_remaining:=v_base_qty;
      IF nullif(v_input->>'batch_id','') IS NOT NULL THEN
        SELECT * INTO v_batch FROM public.product_batches
         WHERE id=(v_input->>'batch_id')::uuid AND product_id=v_product.id AND warehouse_id=v_order.warehouse_id
         FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'الدفعة المحددة لا تخص المادة أو المستودع'; END IF;
        IF v_prevent_expired AND v_batch.expiry_date IS NOT NULL AND v_batch.expiry_date<=current_date THEN
          RAISE EXCEPTION 'لا يمكن صرف دفعة منتهية الصلاحية: %',v_batch.batch_number;
        END IF;
        IF v_batch.quantity<v_remaining THEN RAISE EXCEPTION 'رصيد الدفعة % غير كافٍ',v_batch.batch_number; END IF;
        UPDATE public.product_batches SET quantity=round(quantity-v_remaining,3),updated_at=now() WHERE id=v_batch.id;
        INSERT INTO public.production_order_batch_allocations(material_id,batch_id,base_quantity)
        VALUES(v_material_id,v_batch.id,v_remaining);
      ELSE
        v_strategy:=coalesce(v_product.batch_dispatch_strategy,v_company_strategy);
        IF v_strategy='MANUAL' THEN RAISE EXCEPTION 'حدد دفعة المادة % للصرف اليدوي',v_product.name_ar; END IF;
        FOR v_batch_line IN
          SELECT pb.id,pb.batch_number,pb.expiry_date,pb.quantity
            FROM public.product_batches pb
           WHERE pb.product_id=v_product.id AND pb.warehouse_id=v_order.warehouse_id AND pb.quantity>0
             AND (NOT v_prevent_expired OR pb.expiry_date IS NULL OR pb.expiry_date>current_date)
           ORDER BY CASE WHEN v_strategy='FIFO' THEN pb.created_at END ASC,
                    CASE WHEN v_strategy='FIFO' THEN pb.id END ASC,
                    CASE WHEN v_strategy='FEFO' THEN pb.expiry_date END ASC NULLS LAST,
                    CASE WHEN v_strategy='FEFO' THEN pb.created_at END ASC,pb.id
           FOR UPDATE
        LOOP
          EXIT WHEN v_remaining<=0;
          v_take:=least(v_batch_line.quantity,v_remaining);
          UPDATE public.product_batches SET quantity=round(quantity-v_take,3),updated_at=now() WHERE id=v_batch_line.id;
          INSERT INTO public.production_order_batch_allocations(material_id,batch_id,base_quantity)
          VALUES(v_material_id,v_batch_line.id,v_take);
          v_remaining:=v_remaining-v_take;
        END LOOP;
        IF v_remaining>0 THEN RAISE EXCEPTION 'رصيد الدفعات الصالحة غير كافٍ للمادة %',v_product.name_ar; END IF;
      END IF;
    ELSIF nullif(v_input->>'batch_id','') IS NOT NULL THEN
      RAISE EXCEPTION 'لا تقبل دفعة لصنف غير متتبع بالدفعات';
    END IF;

    PERFORM public.post_stock_delta(v_product.id,v_order.warehouse_id,-v_base_qty,NULL,
      'PRODUCTION','production_material',v_material_id,'صرف مواد لتشغيلة '||v_order.order_number,
      'COMPANY',NULL,'production_out');
    SELECT sm.id,sm.total_cost,sm.unit_cost INTO v_movement_id,v_line_cost,v_factor
      FROM public.stock_movements sm
     WHERE sm.source_type='production_material' AND sm.source_id=v_material_id
     ORDER BY sm.created_at DESC,sm.id DESC LIMIT 1;
    IF v_movement_id IS NULL THEN RAISE EXCEPTION 'لم تُسجل حركة صرف المادة'; END IF;
    UPDATE public.production_order_materials SET stock_movement_id=v_movement_id,
      total_cost=coalesce(v_line_cost,0),unit_cost=coalesce(v_factor,0)
     WHERE id=v_material_id;
    v_total_material_cost:=v_total_material_cost+coalesce(v_line_cost,0);
  END LOOP;

  -- Journal the material issue: debit WIP, credit the appropriate inventory.
  IF v_total_material_cost>0 THEN
    v_journal_lines:=jsonb_build_array(jsonb_build_object(
      'account_code','1312','debit',round(v_total_material_cost,2),'memo','مواد مصروفة للتشغيلة '||v_order.order_number));
    FOR v_batch_line IN
      SELECT inventory_account_code AS code,round(sum(total_cost),2) AS amount
        FROM public.production_order_materials WHERE production_order_id=v_order.id
       GROUP BY inventory_account_code HAVING sum(total_cost)>0
    LOOP
      v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
        'account_code',v_batch_line.code,'credit',v_batch_line.amount,'memo','صرف مخزون للتشغيلة '||v_order.order_number));
    END LOOP;
    v_material_journal:=public.post_journal_entry(v_order.production_date,
      'صرف مواد لتشغيلة إنتاج '||v_order.order_number,v_journal_lines,
      'production_material_issue',v_order.id,'JE-PM-'||v_order.order_number);
  END IF;

  -- Eligible, already-posted expense lines are reclassified net of input VAT.
  FOR v_expense IN SELECT value FROM jsonb_array_elements(coalesce(p_expenses,'[]'::jsonb))
  LOOP
    SELECT * INTO v_expense_line FROM public.expense_lines
     WHERE id=(v_expense->>'expense_line_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'بند المصروف المحدد غير موجود'; END IF;
    SELECT * INTO v_expense_entry FROM public.expense_entries WHERE id=v_expense_line.entry_id FOR SHARE;
    IF v_expense_entry.status::text NOT IN ('POSTED','PARTIALLY_PAID','PAID','CLOSED') THEN
      RAISE EXCEPTION 'لا يمكن تحميل مصروف غير مرحّل على الإنتاج';
    END IF;
    IF v_expense_entry.expense_date>v_order.production_date THEN
      RAISE EXCEPTION 'تاريخ المصروف % بعد تاريخ التشغيلة %',v_expense_entry.expense_date,v_order.production_date;
    END IF;
    IF coalesce(v_expense_line.cost_center_id,v_expense_entry.cost_center_id)
       IS DISTINCT FROM v_order.cost_center_id THEN
      RAISE EXCEPTION 'مركز تكلفة المصروف لا يطابق مركز تكلفة التشغيلة';
    END IF;
    SELECT c.production_cost_eligible,a.code,a.account_type::text
      INTO v_expense_category_eligible,v_currency_account,v_stock_account
      FROM public.expense_categories c JOIN public.accounts a ON a.id=c.account_id
       AND a.is_active AND a.is_postable
     WHERE c.id=v_expense_line.category_id;
    IF NOT FOUND OR v_stock_account<>'EXPENSE' THEN
      RAISE EXCEPTION 'تصنيف المصروف غير مرتبط بحساب مصروف صالح للرسملة';
    END IF;
    IF v_expense_category_eligible IS NOT TRUE THEN
      RAISE EXCEPTION 'تصنيف المصروف غير مؤهل للرسملة على الإنتاج';
    END IF;
    v_line_cost:=round((v_expense->>'amount')::numeric,2);
    IF v_line_cost<=0 THEN RAISE EXCEPTION 'قيمة تحميل المصروف يجب أن تكون موجبة'; END IF;
    SELECT coalesce(sum(amount),0) INTO v_already_allocated
      FROM public.production_order_cost_allocations WHERE expense_line_id=v_expense_line.id;
    -- المتاح = الصافي + الضريبة غير القابلة للاسترداد − المحمَّل سابقاً.
    -- الضريبة القابلة للاسترداد لم تُحمَّل على المصروف عند الترحيل (9913)،
    -- فلا تُرسمل؛ وغير المستردة جزء من تكلفة التحويل المؤهلة (IAS 2).
    SELECT r.eligible_amount, r.allocated_amount, r.available_amount,
           r.expense_account_code
      INTO v_eligible_amount, v_already_allocated, v_available, v_currency_account
      FROM public.production_expense_line_available(v_expense_line.id) r;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'بند المصروف غير مرتبط بحساب مصروف نشط وقابل للترحيل';
    END IF;
    IF v_line_cost>v_available THEN
      RAISE EXCEPTION 'قيمة تحميل المصروف % تتجاوز المتاح %',v_line_cost,v_available;
    END IF;
    IF length(btrim(coalesce(v_expense->>'basis','')))<3 THEN
      RAISE EXCEPTION 'اذكر أساس توزيع تكلفة المصروف على التشغيلة';
    END IF;
    INSERT INTO public.production_order_cost_allocations(
      production_order_id,expense_line_id,expense_entry_id,cost_center_id,expense_account_code,
      amount,allocation_basis,note,created_by)
    VALUES(v_order.id,v_expense_line.id,v_expense_entry.id,v_order.cost_center_id,v_currency_account,
      v_line_cost,btrim(v_expense->>'basis'),nullif(btrim(coalesce(v_expense->>'note','')),''),v_user)
    RETURNING id INTO v_allocation_id;
    v_journal_id:=public.post_journal_entry(v_order.production_date,
      'رسملة تكلفة إنتاج من المصروف '||v_expense_entry.reference,
      jsonb_build_array(
        jsonb_build_object('account_code','1312','debit',v_line_cost,'memo','تحميل على تشغيلة '||v_order.order_number),
        jsonb_build_object('account_code',v_currency_account,'credit',v_line_cost,'memo','إعادة تصنيف مصروف إلى إنتاج')),
      'production_expense_allocation',v_allocation_id,'JE-PEX-'||replace(v_allocation_id::text,'-',''));
    UPDATE public.production_order_cost_allocations SET journal_entry_id=v_journal_id WHERE id=v_allocation_id;
    v_total_conversion_cost:=v_total_conversion_cost+v_line_cost;
  END LOOP;

  -- Loss is recorded in mass units, normalized to kg. Unit counts are never
  -- compared across unrelated products.
  SELECT factor_to_reference INTO v_kg_factor FROM public.units
   WHERE dimension_code='MASS' AND lower(short_name) IN ('kg','كجم','كيلوجرام')
   ORDER BY CASE WHEN lower(short_name)='kg' THEN 0 ELSE 1 END LIMIT 1;
  FOR v_loss IN SELECT value FROM jsonb_array_elements(coalesce(p_losses,'[]'::jsonb))
  LOOP
    SELECT dimension_code,factor_to_reference INTO v_unit FROM public.units
     WHERE id=(v_loss->>'uom_id')::uuid;
    IF NOT FOUND OR v_unit.dimension_code<>'MASS' OR v_unit.factor_to_reference IS NULL OR v_kg_factor IS NULL THEN
      RAISE EXCEPTION 'وحدة الفاقد يجب أن تكون وحدة كتلة معرفة مثل كجم أو جرام';
    END IF;
    v_mass:=round((v_loss->>'quantity')::numeric*v_unit.factor_to_reference/v_kg_factor,6);
    IF v_mass<=0 THEN RAISE EXCEPTION 'كمية الفاقد يجب أن تكون موجبة'; END IF;
    IF upper(v_loss->>'loss_type')='NORMAL' THEN v_normal_loss_mass:=v_normal_loss_mass+v_mass;
    ELSIF upper(v_loss->>'loss_type')='ABNORMAL' THEN v_abnormal_loss_mass:=v_abnormal_loss_mass+v_mass;
    ELSE RAISE EXCEPTION 'نوع الفاقد غير معروف'; END IF;
    INSERT INTO public.production_order_losses(production_order_id,loss_type,quantity,uom_id,mass_kg,reason)
    VALUES(v_order.id,upper(v_loss->>'loss_type'),(v_loss->>'quantity')::numeric,(v_loss->>'uom_id')::uuid,
      v_mass,btrim(coalesce(v_loss->>'reason','')));
  END LOOP;

  SELECT count(*) INTO v_output_count FROM jsonb_array_elements(p_outputs);
  -- Outputs: only inventory goods that may be sold or used as a by-product.
  FOR v_output IN SELECT value FROM jsonb_array_elements(p_outputs)
  LOOP
    v_output_index:=v_output_index+1;
    SELECT * INTO v_product FROM public.products WHERE id=(v_output->>'product_id')::uuid FOR SHARE;
    IF NOT FOUND OR v_product.item_class IS NULL OR v_product.item_class NOT IN ('FINISHED_GOOD','BY_PRODUCT')
       OR v_product.item_nature='SERVICE' OR public.item_effective_policy(v_product.id)<>'TRACKED'
       OR NOT v_product.is_sellable THEN
      RAISE EXCEPTION 'الناتج يجب أن يكون منتجاً تاماً أو ناتجاً جانبياً مملوكاً ومخزونياً ومتاحاً للبيع';
    END IF;
    IF v_product.tracking='SERIAL' THEN RAISE EXCEPTION 'لا يدعم مسار الإنتاج حالياً تتبع الناتج التسلسلي'; END IF;
    v_uom_id:=nullif(v_output->>'uom_id','')::uuid;
    v_base_uom_id:=coalesce(v_product.base_uom_id,v_product.unit_id);
    v_base_qty:=public.production_quantity_in_base(v_product.id,(v_output->>'quantity')::numeric,v_uom_id);
    v_factor:=v_base_qty/(v_output->>'quantity')::numeric;
    IF v_base_qty<>round(v_base_qty,3) THEN RAISE EXCEPTION 'كمية الناتج تتجاوز دقة المخزون 0.001'; END IF;
    v_mass:=public.production_mass_in_kg(v_product.id,v_base_qty);
    IF v_mass IS NULL THEN v_output_mass_complete:=false; ELSE v_total_output_mass:=v_total_output_mass+v_mass; END IF;
    v_batch_number:=nullif(btrim(coalesce(v_output->>'batch_number','')),'');
    v_expiry:=nullif(v_output->>'expiry_date','')::date;
    IF v_product.tracking='BATCH' THEN
      IF v_batch_number IS NULL THEN v_batch_number:=v_order.order_number||'-'||lpad(v_output_index::text,2,'0'); END IF;
      IF v_product.track_expiry AND v_expiry IS NULL THEN
        RAISE EXCEPTION 'تاريخ الانتهاء مطلوب للناتج %',v_product.name_ar;
      END IF;
    ELSIF v_batch_number IS NOT NULL OR v_expiry IS NOT NULL THEN
      RAISE EXCEPTION 'بيانات الدفعة لا تقبل لناتج غير متتبع بالدفعات';
    END IF;
    INSERT INTO public.production_order_outputs(
      production_order_id,product_id,entered_quantity,uom_id,base_uom_id,uom_conversion_factor,
      base_quantity,mass_kg,allocation_value_per_base,inventory_account_code,batch_number,expiry_date)
    VALUES(v_order.id,v_product.id,(v_output->>'quantity')::numeric,v_uom_id,v_base_uom_id,v_factor,
      v_base_qty,v_mass,greatest(coalesce((v_output->>'allocation_value_per_base')::numeric,0),0),
      public.production_inventory_account_code(v_product.item_class),v_batch_number,v_expiry)
    RETURNING id INTO v_output_id;
  END LOOP;

  -- Enforce a physical mass balance when all raw inputs and outputs have a
  -- meaningful product-level mass conversion. Otherwise retain exact base-UOM
  -- snapshots and do not invent a conversion between unrelated count units.
  IF v_input_mass_complete AND v_output_mass_complete AND v_total_input_mass>0 THEN
    v_expected_mass:=v_total_output_mass+v_normal_loss_mass+v_abnormal_loss_mass;
    IF abs(v_total_input_mass-v_expected_mass)>0.01 THEN
      RAISE EXCEPTION 'ميزان الكتلة غير متزن: مواد خام % كجم مقابل نواتج وفاقد % كجم',
        round(v_total_input_mass,3),round(v_expected_mass,3) USING ERRCODE='check_violation';
    END IF;
  END IF;
  IF v_abnormal_loss_mass>0 AND (NOT v_input_mass_complete OR v_total_input_mass<=0) THEN
    RAISE EXCEPTION 'يجب تعريف مكافئ كتلي للمواد الخام قبل تحميل الفاقد غير الطبيعي';
  END IF;

  v_total_wip:=round(v_total_material_cost+v_total_conversion_cost,2);
  IF v_total_wip<=0 THEN RAISE EXCEPTION 'لا يمكن إقفال تشغيلة بلا تكلفة مواد أو تحويل مسجلة'; END IF;
  IF v_abnormal_loss_mass>0 THEN
    IF v_abnormal_loss_mass>v_total_input_mass THEN RAISE EXCEPTION 'الفاقد غير الطبيعي يتجاوز كتلة المواد الخام'; END IF;
    v_abnormal_cost:=round(v_total_wip*v_abnormal_loss_mass/v_total_input_mass,2);
  END IF;

  -- Allocate joint conversion cost by estimated sales value per base unit.
  IF v_output_count>1 AND EXISTS(
    SELECT 1 FROM public.production_order_outputs
     WHERE production_order_id=v_order.id AND allocation_value_per_base<=0
  ) THEN
    RAISE EXCEPTION 'أدخل قيمة بيع تقديرية لوحدة الأساس لكل ناتج لتوزيع تكلفة التشغيل';
  END IF;
  v_remaining_wip:=round(v_total_wip-v_abnormal_cost,2);
  FOR v_batch_line IN
    SELECT id,base_quantity,allocation_value_per_base,
           base_quantity*allocation_value_per_base AS allocation_weight,
           row_number() OVER (ORDER BY created_at,id) AS rn
      FROM public.production_order_outputs WHERE production_order_id=v_order.id ORDER BY created_at,id
  LOOP
    IF v_batch_line.rn=v_output_count THEN
      v_allocated:=v_remaining_wip;
    ELSIF v_output_count=1 THEN
      v_allocated:=v_remaining_wip;
    ELSE
      SELECT sum(base_quantity*allocation_value_per_base) INTO v_expected_mass
        FROM public.production_order_outputs WHERE production_order_id=v_order.id;
      v_allocated:=round((v_total_wip-v_abnormal_cost)*v_batch_line.allocation_weight/v_expected_mass,2);
    END IF;
    UPDATE public.production_order_outputs SET allocated_cost=v_allocated,
      unit_cost=CASE WHEN base_quantity>0 THEN v_allocated/base_quantity ELSE 0 END
     WHERE id=v_batch_line.id;
    v_remaining_wip:=round(v_remaining_wip-v_allocated,2);
  END LOOP;

  -- Receive each output through the same valuation engine used by purchases.
  FOR v_output IN SELECT to_jsonb(o) FROM public.production_order_outputs o
    WHERE o.production_order_id=v_order.id ORDER BY o.created_at,o.id
  LOOP
    v_output_id:=(v_output->>'id')::uuid;
    SELECT p.* INTO v_product FROM public.products p
      JOIN public.production_order_outputs o ON o.product_id=p.id WHERE o.id=v_output_id;
    SELECT o.base_quantity,o.allocated_cost,o.inventory_account_code,o.batch_number,o.expiry_date,
           o.allocated_cost/NULLIF(o.base_quantity,0)
      INTO v_base_qty,v_line_cost,v_stock_account,v_batch_number,v_expiry,v_factor
      FROM public.production_order_outputs o WHERE o.id=v_output_id;
    PERFORM public.post_stock_delta(v_product.id,v_order.warehouse_id,v_base_qty,v_factor,
      'PRODUCTION','production_output',v_output_id,'استلام ناتج تشغيلة '||v_order.order_number,
      'COMPANY',NULL,'production_in');
    SELECT sm.id,sm.total_cost INTO v_movement_id,v_available FROM public.stock_movements sm
     WHERE sm.source_type='production_output' AND sm.source_id=v_output_id
     ORDER BY sm.created_at DESC,sm.id DESC LIMIT 1;
    IF v_movement_id IS NULL THEN RAISE EXCEPTION 'لم تُسجل حركة استلام الناتج'; END IF;
    v_batch_id:=NULL;
    IF v_product.tracking='BATCH' THEN
      INSERT INTO public.product_batches(product_id,warehouse_id,batch_number,expiry_date,quantity,unit_cost,note,created_by)
      VALUES(v_product.id,v_order.warehouse_id,v_batch_number,v_expiry,v_base_qty,
        CASE WHEN v_base_qty>0 THEN round(v_available/v_base_qty,4) ELSE 0 END,
        'ناتج تشغيلة '||v_order.order_number,v_user)
      RETURNING id INTO v_batch_id;
    END IF;
    UPDATE public.production_order_outputs SET stock_movement_id=v_movement_id,batch_id=v_batch_id,
      actual_stock_cost=coalesce(v_available,0),unit_cost=CASE WHEN base_quantity>0 THEN coalesce(v_available,0)/base_quantity ELSE 0 END
     WHERE id=v_output_id;
    v_actual_output_total:=v_actual_output_total+coalesce(v_available,0);
  END LOOP;

  -- Complete WIP clearing and finished/by-product inventory recognition.
  v_journal_lines:='[]'::jsonb;
  FOR v_batch_line IN
    SELECT inventory_account_code AS code,round(sum(actual_stock_cost),2) AS amount
      FROM public.production_order_outputs WHERE production_order_id=v_order.id
     GROUP BY inventory_account_code HAVING sum(actual_stock_cost)>0
  LOOP
    v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
      'account_code',v_batch_line.code,'debit',v_batch_line.amount,'memo','استلام ناتج تشغيلة '||v_order.order_number));
  END LOOP;
  IF v_abnormal_cost>0 THEN
    v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
      'account_code','5911','debit',v_abnormal_cost,'memo','فاقد إنتاج غير طبيعي - '||v_order.order_number));
  END IF;
  v_variance:=round(v_total_wip-v_actual_output_total-v_abnormal_cost,2);
  IF v_variance>0 THEN
    v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
      'account_code','5911','debit',v_variance,'memo','فرق تقريب تكلفة استلام الإنتاج - '||v_order.order_number));
  ELSIF v_variance<0 THEN
    v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
      'account_code','5911','credit',abs(v_variance),'memo','فرق تقريب تكلفة استلام الإنتاج - '||v_order.order_number));
  END IF;
  v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
    'account_code','1312','credit',v_total_wip,'memo','إقفال الإنتاج تحت التنفيذ - '||v_order.order_number));
  v_journal_id:=public.post_journal_entry(v_order.production_date,
    'إقفال تشغيلة إنتاج '||v_order.order_number,v_journal_lines,
    'production_completion',v_order.id,'JE-PO-'||v_order.order_number);

  UPDATE public.production_orders SET status='POSTED',material_cost=round(v_total_material_cost,2),
    conversion_cost=round(v_total_conversion_cost,2),total_cost=v_total_wip,
    output_cost=round(v_actual_output_total,2),abnormal_loss_cost=v_abnormal_cost,
    completed_by=v_user,completed_at=now(),updated_at=now()
   WHERE id=v_order.id;
  RETURN v_journal_id;
END;
$$;

--
-- Name: production_order_cost_check(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.production_order_cost_check(p_order_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'order_id', o.id,
    'status', o.status,
    'material_cost', o.material_cost,
    'conversion_cost', o.conversion_cost,
    'wip_total', o.total_cost,
    'wip_from_parts', round(o.material_cost + o.conversion_cost, 2),
    'actual_output_cost', o.output_cost,
    'abnormal_loss_cost', o.abnormal_loss_cost,
    'rounding_variance', round(o.total_cost - o.output_cost - o.abnormal_loss_cost, 2),
    'wip_balanced',
      round(o.material_cost + o.conversion_cost, 2) = o.total_cost
      AND abs(round(o.total_cost - o.output_cost - o.abnormal_loss_cost, 2)) < 0.01
  )
  FROM public.production_orders o
 WHERE o.id = p_order_id
$$;

--
-- Name: production_order_cost_detail(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.production_order_cost_detail(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order public.production_orders%ROWTYPE;
  v_result jsonb;
  v_subtotal_material numeric;
  v_subtotal_conversion numeric;
  v_total_wip numeric;
  v_variance numeric;
BEGIN
  IF v_user IS NULL OR NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية قراءة أمر الإنتاج';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'معرّف أمر الإنتاج مطلوب' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.production_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الإنتاج غير موجود' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(sum(total_cost), 0) INTO v_subtotal_material
    FROM public.production_order_materials
   WHERE production_order_id = v_order.id;
  SELECT coalesce(sum(amount), 0) INTO v_subtotal_conversion
    FROM public.production_order_cost_allocations
   WHERE production_order_id = v_order.id;
  v_total_wip := round(v_subtotal_material + v_subtotal_conversion, 2);
  v_variance := round(v_total_wip - v_order.output_cost - v_order.abnormal_loss_cost, 2);

  SELECT jsonb_build_object(
    'order', jsonb_build_object(
      'id', v_order.id,
      'order_number', v_order.order_number,
      'production_date', v_order.production_date,
      'status', v_order.status,
      'warehouse_id', v_order.warehouse_id,
      'cost_center_id', v_order.cost_center_id,
      'material_cost', v_order.material_cost,
      'conversion_cost', v_order.conversion_cost,
      'total_cost', v_order.total_cost,
      'output_cost', v_order.output_cost,
      'abnormal_loss_cost', v_order.abnormal_loss_cost,
      'reversed_at', v_order.reversed_at,
      'reversal_reason', v_order.reversal_reason,
      'completed_at', v_order.completed_at,
      'notes', v_order.notes),
    'materials', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'product_id', m.product_id,
        'product_name', coalesce(p.name_ar, p.name),
        'entered_quantity', m.entered_quantity,
        'entered_uom', eu.short_name,
        'base_quantity', m.base_quantity,
        'base_uom', bu.short_name,
        'uom_conversion_factor', m.uom_conversion_factor,
        'mass_kg', m.mass_kg,
        'unit_cost', m.unit_cost,
        'total_cost', m.total_cost,
        'inventory_account_code', m.inventory_account_code,
        'stock_movement_id', m.stock_movement_id,
        'batches', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'batch_id', a.batch_id,
            'batch_number', pb.batch_number,
            'base_quantity', a.base_quantity))
            FROM public.production_order_batch_allocations a
            JOIN public.product_batches pb ON pb.id = a.batch_id
           WHERE a.material_id = m.id), '[]'::jsonb))
        ORDER BY m.created_at, m.id)
        FROM public.production_order_materials m
        JOIN public.products p ON p.id = m.product_id
        LEFT JOIN public.units eu ON eu.id = m.uom_id
        LEFT JOIN public.units bu ON bu.id = m.base_uom_id
       WHERE m.production_order_id = v_order.id), '[]'::jsonb),
    'cost_sources', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'expense_line_id', a.expense_line_id,
        'expense_entry_id', a.expense_entry_id,
        'reference', e.reference,
        'expense_date', e.expense_date,
        'category', coalesce(c.name_ar, c.name),
        'expense_account_code', a.expense_account_code,
        'amount', a.amount,
        'allocation_basis', a.allocation_basis,
        'note', a.note,
        'journal_entry_id', a.journal_entry_id)
        ORDER BY a.created_at, a.id)
        FROM public.production_order_cost_allocations a
        JOIN public.expense_entries e ON e.id = a.expense_entry_id
        LEFT JOIN public.expense_lines el ON el.id = a.expense_line_id
        LEFT JOIN public.expense_categories c ON c.id = el.category_id
       WHERE a.production_order_id = v_order.id), '[]'::jsonb),
    'outputs', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', o.id,
        'product_id', o.product_id,
        'product_name', coalesce(p.name_ar, p.name),
        'item_class', p.item_class,
        'entered_quantity', o.entered_quantity,
        'entered_uom', eu.short_name,
        'base_quantity', o.base_quantity,
        'base_uom', bu.short_name,
        'mass_kg', o.mass_kg,
        'allocation_value_per_base', o.allocation_value_per_base,
        'allocation_weight', round(o.base_quantity * o.allocation_value_per_base, 6),
        'allocated_cost', o.allocated_cost,
        'actual_stock_cost', o.actual_stock_cost,
        'unit_cost', o.unit_cost,
        'inventory_account_code', o.inventory_account_code,
        'batch_id', o.batch_id,
        'batch_number', o.batch_number,
        'expiry_date', o.expiry_date,
        'stock_movement_id', o.stock_movement_id)
        ORDER BY o.created_at, o.id)
        FROM public.production_order_outputs o
        JOIN public.products p ON p.id = o.product_id
        LEFT JOIN public.units eu ON eu.id = o.uom_id
        LEFT JOIN public.units bu ON bu.id = o.base_uom_id
       WHERE o.production_order_id = v_order.id), '[]'::jsonb),
    'losses', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'loss_type', l.loss_type,
        'quantity', l.quantity,
        'uom', u.short_name,
        'mass_kg', l.mass_kg,
        'reason', l.reason,
        'charged_cost', CASE
          WHEN l.loss_type = 'ABNORMAL' AND v_order.abnormal_loss_cost > 0
          THEN round(v_order.abnormal_loss_cost * l.mass_kg / nullif((
            SELECT sum(x.mass_kg) FROM public.production_order_losses x
             WHERE x.production_order_id = v_order.id AND x.loss_type = 'ABNORMAL'), 0), 2)
          ELSE 0 END)
        ORDER BY l.created_at, l.id)
        FROM public.production_order_losses l
        LEFT JOIN public.units u ON u.id = l.uom_id
       WHERE l.production_order_id = v_order.id), '[]'::jsonb),
    'journals', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', je.id,
        'entry_number', je.entry_number,
        'entry_date', je.entry_date,
        'memo', je.memo,
        'source_type', je.source_type,
        'status', je.status)
        ORDER BY je.created_at, je.id)
        FROM public.journal_entries je
       WHERE (je.source_type IN ('production_material_issue', 'production_completion')
              AND je.source_id = v_order.id)
          OR je.id IN (
            SELECT a.journal_entry_id FROM public.production_order_cost_allocations a
             WHERE a.production_order_id = v_order.id AND a.journal_entry_id IS NOT NULL)), '[]'::jsonb),
    'excluded_expenses', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'expense_line_id', l.id,
        'expense_entry_id', e.id,
        'reference', e.reference,
        'expense_date', e.expense_date,
        'category', coalesce(c.name_ar, c.name),
        'net_amount', l.net_amount,
        'tax_amount', l.tax_amount,
        'tax_recoverable', coalesce(e.tax_recoverable, false),
        'cost_center_matches', coalesce(l.cost_center_id, e.cost_center_id) = v_order.cost_center_id,
        'category_eligible', coalesce(c.production_cost_eligible, false),
        'reason',
          CASE
            WHEN coalesce(c.production_cost_eligible, false) IS NOT TRUE THEN 'تصنيف غير مؤهل للرسملة'
            WHEN e.status::text NOT IN ('POSTED','PARTIALLY_PAID','PAID','CLOSED') THEN 'المصروف غير مرحّل'
            WHEN e.expense_date > v_order.production_date THEN 'تاريخ المصروف بعد تاريخ التشغيلة'
            WHEN coalesce(l.cost_center_id, e.cost_center_id) IS DISTINCT FROM v_order.cost_center_id
              THEN 'مركز تكلفة مختلف'
            WHEN l.net_amount <= 0 THEN 'صافي السطر غير موجب'
            WHEN NOT EXISTS (
              SELECT 1 FROM public.production_order_cost_allocations x
               WHERE x.expense_line_id = l.id)
             AND coalesce(public.expense_line_production_base_amount(
                     l.net_amount, l.tax_amount, e.tax_recoverable), 0)
                 - coalesce((SELECT sum(x.amount) FROM public.production_order_cost_allocations x
                              WHERE x.expense_line_id = l.id), 0) <= 0
              THEN 'المتاح صفر بعد التحميل السابق'
            ELSE NULL
          END)
        ORDER BY e.expense_date DESC, e.reference)
        FROM public.expense_lines l
        JOIN public.expense_entries e ON e.id = l.entry_id
        LEFT JOIN public.expense_categories c ON c.id = l.category_id
       WHERE e.expense_date <= v_order.production_date
         AND (coalesce(c.production_cost_eligible, false) IS FALSE
              OR coalesce(l.cost_center_id, e.cost_center_id) = v_order.cost_center_id)
      ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'wip_debit', round(coalesce((
        SELECT coalesce(sum(jl.debit), 0) FROM public.journal_lines jl
         JOIN public.journal_entries je ON je.id = jl.entry_id
        WHERE je.source_type IN ('production_material_issue', 'production_completion')
          AND je.source_id = v_order.id
          AND jl.account_id = (SELECT id FROM public.accounts WHERE code = '1312')), 0), 2),
      'wip_credit', round(coalesce((
        SELECT coalesce(sum(jl.credit), 0) FROM public.journal_lines jl
         JOIN public.journal_entries je ON je.id = jl.entry_id
        WHERE je.source_type IN ('production_material_issue', 'production_completion')
          AND je.source_id = v_order.id
          AND jl.account_id = (SELECT id FROM public.accounts WHERE code = '1312')), 0), 2),
      'conversion_from_expenses', round(coalesce((
        SELECT sum(a.amount) FROM public.production_order_cost_allocations a
         WHERE a.production_order_id = v_order.id), 0), 2),
      'unallocated_conversion', round(coalesce(v_order.conversion_cost, 0) - coalesce((
        SELECT sum(a.amount) FROM public.production_order_cost_allocations a
         WHERE a.production_order_id = v_order.id), 0), 2),
      'material_subtotal', round(v_subtotal_material, 2),
      'conversion_subtotal', round(v_subtotal_conversion, 2),
      'wip_total_from_parts', v_total_wip,
      'rounding_variance', v_variance,
      'wip_balanced',
        (round(v_subtotal_material + v_subtotal_conversion, 2) = v_order.total_cost)
        AND abs(v_variance) < 0.01,
      'allocation_basis', 'RELATIVE_SALES_VALUE'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

--
-- Name: production_output_has_downstream_use(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.production_output_has_downstream_use(p_output_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.production_order_outputs o
      JOIN public.production_orders ord ON ord.id = o.production_order_id
     WHERE o.id = p_output_id
       AND EXISTS (
         SELECT 1 FROM public.stock_movements sm
          WHERE sm.product_id = o.product_id
            AND sm.warehouse_id = ord.warehouse_id
            AND sm.owner_type = 'COMPANY'
            AND sm.owner_id IS NULL
            AND sm.created_at > ord.completed_at
            AND NOT (sm.source_type IN ('production_output','production_reversal_output')
                     AND sm.source_id = o.id)
       )
  )
$$;

--
-- Name: reverse_production_order(uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.reverse_production_order(p_order_id uuid, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order public.production_orders%ROWTYPE;
  v_output record;
  v_material record;
  v_first_tx record;
  v_inventory_qty numeric;
  v_layer_qty numeric;
  v_layer_value numeric;
  v_expected_qty numeric;
  v_expected_value numeric;
  v_journal record;
  v_reversal_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_user IS NULL OR NOT public.is_staff(v_user) OR NOT (
    public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
    OR public.has_role(v_user,'accountant')
  ) THEN
    RAISE EXCEPTION 'عكس تشغيلة الإنتاج يتطلب صلاحية المالك أو المدير أو المحاسب';
  END IF;
  IF length(btrim(coalesce(p_reason,''))) < 3 THEN
    RAISE EXCEPTION 'اكتب سببًا واضحًا لعكس التشغيلة' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_order FROM public.production_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تشغيلة الإنتاج غير موجودة' USING ERRCODE='P0002'; END IF;
  IF v_order.status <> 'POSTED' OR v_order.completed_at IS NULL THEN
    RAISE EXCEPTION 'لا يمكن عكس إلا تشغيلة إنتاج مرحلة وغير معكوسة';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.production_order_materials m
      JOIN public.production_order_outputs o
        ON o.production_order_id=m.production_order_id AND o.product_id=m.product_id
     WHERE m.production_order_id=v_order.id
  ) THEN
    RAISE EXCEPTION 'لا يمكن عكس تشغيلة تعيد إنتاج الصنف نفسه المستخدم كمدخل';
  END IF;

  -- بوّابة الأثر اللاحق: قبل أي عكس مادي، لا يجوز أن يكون أي ناتج قد شارك
  -- في حركة مخزون لاحقة (بيع، تحويل، تسوية، استلام أمر آخر) حتى لا تُفسد
  -- الأرصدة باسترداد/رد على قيمة تغيّرت بعد الترحيل.
  FOR v_output IN
    SELECT o.id,o.product_id,o.stock_movement_id
      FROM public.production_order_outputs o
     WHERE o.production_order_id=v_order.id
     ORDER BY o.created_at,o.id
  LOOP
    IF public.production_output_has_downstream_use(v_output.id) THEN
      RAISE EXCEPTION 'لا يمكن عكس التشغيلة %: الناتج % استُخدم في حركة لاحقة',
        v_order.order_number, v_output.product_id USING ERRCODE='check_violation';
    END IF;
  END LOOP;

  -- Require each output to have started at zero stock and still be the only
  -- stock movement for that product since completion. This makes its issue
  -- value exactly equal to the posted receipt value under moving average.
  FOR v_output IN
    SELECT o.*,p.tracking
      FROM public.production_order_outputs o
      JOIN public.products p ON p.id=o.product_id
     WHERE o.production_order_id=v_order.id
     ORDER BY o.created_at,o.id
  LOOP
    IF v_output.stock_movement_id IS NULL THEN
      RAISE EXCEPTION 'حركة ناتج التشغيلة % غير موجودة؛ لا يمكن العكس بأمان',v_output.product_id;
    END IF;

    SELECT ict.quantity_before,ict.value_before,ict.created_at
      INTO v_first_tx
      FROM public.item_cost_transactions ict
      JOIN public.production_order_outputs o
        ON ict.source_type='production_output' AND ict.source_id=o.id
     WHERE o.production_order_id=v_order.id AND o.product_id=v_output.product_id
       AND ict.warehouse_id=v_order.warehouse_id
       AND ict.owner_type='COMPANY' AND ict.owner_id IS NULL
     ORDER BY ict.created_at,ict.id LIMIT 1;
    IF NOT FOUND OR v_first_tx.quantity_before<>0 OR v_first_tx.value_before<>0 THEN
      RAISE EXCEPTION 'لا يمكن عكس الناتج % لأن له رصيدًا سابقًا عند الترحيل',v_output.product_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.stock_movements sm
       WHERE sm.product_id=v_output.product_id AND sm.warehouse_id=v_order.warehouse_id
         AND sm.owner_type='COMPANY' AND sm.owner_id IS NULL
         AND sm.created_at>v_order.completed_at
         AND NOT (sm.source_type='production_output' AND sm.source_id IN (
           SELECT o.id FROM public.production_order_outputs o
            WHERE o.production_order_id=v_order.id AND o.product_id=v_output.product_id
         ))
    ) THEN
      RAISE EXCEPTION 'تعذر عكس الناتج % لوجود حركة مخزون لاحقة؛ عالج الحركة اللاحقة أولًا',v_output.product_id;
    END IF;

    SELECT i.quantity INTO v_inventory_qty FROM public.inventory i
     WHERE i.product_id=v_output.product_id AND i.warehouse_id=v_order.warehouse_id
       AND i.owner_type='COMPANY' AND i.owner_id IS NULL FOR UPDATE;
    v_inventory_qty:=coalesce(v_inventory_qty,0);
    SELECT coalesce(sum(o.base_quantity),0),coalesce(sum(o.actual_stock_cost),0)
      INTO v_expected_qty,v_expected_value
      FROM public.production_order_outputs o
     WHERE o.production_order_id=v_order.id AND o.product_id=v_output.product_id;
    IF abs(v_inventory_qty-v_expected_qty)>0.001 THEN
      RAISE EXCEPTION 'رصيد الناتج % تغير بعد التشغيلة؛ لا يمكن العكس بأمان',v_output.product_id;
    END IF;

    SELECT cl.quantity,cl.total_value INTO v_layer_qty,v_layer_value
      FROM public.item_cost_layers cl
     WHERE cl.product_id=v_output.product_id AND cl.warehouse_id=v_order.warehouse_id
       AND cl.owner_type='COMPANY' AND cl.owner_id IS NULL
     FOR UPDATE;
    IF abs(coalesce(v_layer_qty,0)-v_expected_qty)>0.001
       OR abs(coalesce(v_layer_value,0)-v_expected_value)>0.011 THEN
      RAISE EXCEPTION 'طبقة تكلفة الناتج % تغيرت؛ لا يمكن العكس بأمان',v_output.product_id;
    END IF;

    IF v_output.tracking='BATCH' THEN
      IF v_output.batch_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.product_batches pb
         WHERE pb.id=v_output.batch_id AND pb.quantity=v_output.base_quantity
           AND pb.updated_at<=v_order.completed_at
      ) THEN
        RAISE EXCEPTION 'دفعة الناتج % تغيرت بعد الترحيل؛ لا يمكن العكس بأمان',v_output.product_id;
      END IF;
    END IF;
  END LOOP;

  -- Inputs must also be untouched since posting, so returning their saved
  -- issue cost reconstructs the original moving-average layer exactly.
  FOR v_material IN
    SELECT m.* FROM public.production_order_materials m
     WHERE m.production_order_id=v_order.id ORDER BY m.created_at,m.id
  LOOP
    IF v_material.stock_movement_id IS NULL THEN
      RAISE EXCEPTION 'حركة صرف المادة % غير موجودة؛ لا يمكن العكس بأمان',v_material.product_id;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.stock_movements sm
       WHERE sm.product_id=v_material.product_id AND sm.warehouse_id=v_order.warehouse_id
         AND sm.owner_type='COMPANY' AND sm.owner_id IS NULL
         AND sm.created_at>v_order.completed_at
         AND NOT (sm.source_type='production_material' AND sm.source_id IN (
           SELECT m.id FROM public.production_order_materials m WHERE m.production_order_id=v_order.id
         ))
    ) THEN
      RAISE EXCEPTION 'تعذر رد المادة % لوجود حركة مخزون لاحقة؛ عالج الحركة اللاحقة أولًا',v_material.product_id;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.production_order_batch_allocations a
      JOIN public.product_batches pb ON pb.id=a.batch_id
       WHERE a.material_id=v_material.id AND pb.updated_at>v_order.completed_at
    ) THEN
      RAISE EXCEPTION 'دفعة المادة % تغيرت بعد الترحيل؛ لا يمكن العكس بأمان',v_material.product_id;
    END IF;
    PERFORM 1 FROM public.inventory i
     WHERE i.product_id=v_material.product_id AND i.warehouse_id=v_order.warehouse_id
       AND i.owner_type='COMPANY' AND i.owner_id IS NULL FOR UPDATE;
  END LOOP;

  -- Reverse finished-goods receipts first, then restore consumed raw inputs.
  FOR v_output IN
    SELECT o.* FROM public.production_order_outputs o
     WHERE o.production_order_id=v_order.id ORDER BY o.created_at DESC,o.id DESC
  LOOP
    PERFORM public.post_stock_delta(
      v_output.product_id,v_order.warehouse_id,-v_output.base_quantity,NULL,
      'PRODUCTION','production_reversal_output',v_output.id,
      'عكس ناتج تشغيلة '||v_order.order_number||': '||btrim(p_reason),
      'COMPANY',NULL,'production_out');
    IF v_output.batch_id IS NOT NULL THEN
      UPDATE public.product_batches SET quantity=0,updated_at=now(),
        note=concat_ws(E'\n',nullif(note,''),'عكس تشغيلة '||v_order.order_number||': '||btrim(p_reason))
       WHERE id=v_output.batch_id;
    END IF;
  END LOOP;

  FOR v_material IN
    SELECT m.* FROM public.production_order_materials m
     WHERE m.production_order_id=v_order.id ORDER BY m.created_at,m.id
  LOOP
    PERFORM public.post_stock_delta(
      v_material.product_id,v_order.warehouse_id,v_material.base_quantity,
      CASE WHEN v_material.base_quantity>0 THEN v_material.total_cost/v_material.base_quantity ELSE 0 END,
      'PRODUCTION','production_reversal_material',v_material.id,
      'رد مادة تشغيلة '||v_order.order_number||': '||btrim(p_reason),
      'COMPANY',NULL,'production_in');
  END LOOP;

  -- Restore lot quantities only after confirming no later lot-level changes.
  UPDATE public.product_batches pb
     SET quantity=round(pb.quantity+a.return_quantity,3),updated_at=now()
    FROM (
      SELECT a.batch_id,sum(a.base_quantity) AS return_quantity
        FROM public.production_order_batch_allocations a
        JOIN public.production_order_materials m ON m.id=a.material_id
       WHERE m.production_order_id=v_order.id
       GROUP BY a.batch_id
    ) a
   WHERE pb.id=a.batch_id;

  -- Reverse the source journals through the established audit-safe accounting
  -- RPC. Each reversal and stock return is atomic with the order status change.
  FOR v_journal IN
    SELECT je.id
      FROM public.journal_entries je
     WHERE je.status='POSTED' AND (
       (je.source_type='production_completion' AND je.source_id=v_order.id)
       OR (je.source_type='production_material_issue' AND je.source_id=v_order.id)
       OR je.id IN (
         SELECT a.journal_entry_id FROM public.production_order_cost_allocations a
          WHERE a.production_order_id=v_order.id AND a.journal_entry_id IS NOT NULL
       )
     )
     ORDER BY CASE je.source_type WHEN 'production_completion' THEN 1
                                  WHEN 'production_material_issue' THEN 3 ELSE 2 END,
              je.created_at DESC,je.id DESC
  LOOP
    v_reversal_ids:=array_append(v_reversal_ids,public.reverse_journal_entry(
      v_journal.id,'عكس تشغيلة '||v_order.order_number||': '||btrim(p_reason)));
  END LOOP;

  -- التحديث الوحيد المسموح على بيانات أمر قائم هو تغيير الحالة بعد نجاح العكس بالكامل.
  UPDATE public.production_orders SET status='REVERSED',reversed_at=now(),reversed_by=v_user,
         reversal_reason=btrim(p_reason),updated_at=now()
   WHERE id=v_order.id;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,payload)
  VALUES(v_user,'production.order_reversed','production_order',v_order.id,
    jsonb_build_object('order_number',v_order.order_number,'reason',btrim(p_reason),
                       'reversal_journal_ids',to_jsonb(v_reversal_ids)));
  RETURN v_order.id;
END;
$$;


--
-- Name: TABLE production_orders; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.production_orders IS 'Company-owned production work orders. Customer-owned goods remain in milling custody documents.';

--
-- Name: production_orders production_orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_order_number_key UNIQUE (order_number);

--
-- Name: production_orders production_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_pkey PRIMARY KEY (id);

--
-- Name: production_orders_center_date_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX production_orders_center_date_idx ON public.production_orders USING btree (cost_center_id, production_date DESC);

--
-- Name: production_orders_status_date_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX production_orders_status_date_idx ON public.production_orders USING btree (status, production_date DESC);

--
-- Name: production_orders; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: production_orders production_orders_finance_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY production_orders_finance_read ON public.production_orders FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: TABLE production_orders; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.production_orders TO authenticated;

GRANT ALL ON TABLE public.production_orders TO service_role;


--
-- Name: FUNCTION production_expense_line_available(p_expense_line_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.production_expense_line_available(p_expense_line_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.production_expense_line_available(p_expense_line_id uuid) TO service_role;


--
-- Name: FUNCTION complete_production_order(p_order_id uuid, p_materials jsonb, p_outputs jsonb, p_expenses jsonb, p_losses jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.complete_production_order(p_order_id uuid, p_materials jsonb, p_outputs jsonb, p_expenses jsonb, p_losses jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.complete_production_order(p_order_id uuid, p_materials jsonb, p_outputs jsonb, p_expenses jsonb, p_losses jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.complete_production_order(p_order_id uuid, p_materials jsonb, p_outputs jsonb, p_expenses jsonb, p_losses jsonb) TO service_role;


--
-- Name: FUNCTION production_order_cost_check(p_order_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.production_order_cost_check(p_order_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.production_order_cost_check(p_order_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.production_order_cost_check(p_order_id uuid) TO service_role;


--
-- Name: FUNCTION production_order_cost_detail(p_order_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.production_order_cost_detail(p_order_id uuid) IS 'تفاصيل تكلفة أمر الإنتاج: مصادر المواد والمصروفات، توزيع التكلفة على المخرجات، الفاقد، القيود والمصروفات غير المؤهلة.';

--
-- Name: FUNCTION production_order_cost_detail(p_order_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.production_order_cost_detail(p_order_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.production_order_cost_detail(p_order_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.production_order_cost_detail(p_order_id uuid) TO service_role;


--
-- Name: FUNCTION production_output_has_downstream_use(p_output_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.production_output_has_downstream_use(p_output_id uuid) IS 'هل لُناتج أمر إنتاج مُرحّل أي حركة مخزون لاحقة خارج الأمر؟ عكس الأمر ممنوع في هذه الحالة.';

--
-- Name: FUNCTION production_output_has_downstream_use(p_output_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.production_output_has_downstream_use(p_output_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.production_output_has_downstream_use(p_output_id uuid) TO service_role;


--
-- Name: FUNCTION reverse_production_order(p_order_id uuid, p_reason text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.reverse_production_order(p_order_id uuid, p_reason text) IS 'Audit-safe reversal for a posted production order only when no later inventory or batch movement has touched its inputs or outputs.';

--
-- Name: FUNCTION reverse_production_order(p_order_id uuid, p_reason text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.reverse_production_order(p_order_id uuid, p_reason text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.reverse_production_order(p_order_id uuid, p_reason text) TO authenticated;

GRANT ALL ON FUNCTION public.reverse_production_order(p_order_id uuid, p_reason text) TO service_role;
