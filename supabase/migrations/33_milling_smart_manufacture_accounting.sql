-- ============================================================================
-- 30_milling_smart_manufacture_accounting.sql — الربط المحاسبي الآلي لعمليات المطحنة
-- المرجع: DOC-MILLING-ERP-MASTER-2026-V2-AUDITED (المحور 4)
-- ============================================================================
-- 1. قيد التصنيع الذكي (smart_manufacture):
--    Dr 1313 مخزون منتجات تامة (دقيق)
--    Dr 1314 مخزون نواتج ثانوية (نخالة)
--    Dr 5921 فاقد وتلف (إن وجد فاقد تشغيلي)
--    Cr 1311 مخزون مواد أولية (القمح المسحوب بتكلفته الفعلية)
--
-- 2. قيد صرف المستهلكات التشغيلية (consume_internal_supplies):
--    Dr 5316 مواد تعبئة وتغليف
--    Cr 1315 مخزون مواد التعبئة
--
-- 3. ترحيل قيد إيراد خدمات الطحن (create_milling_service_document):
--    استدعاء post_sales_invoice لترحيل أجور الطحن تلقائياً:
--    Dr 1101 النقدية بالصندوق (أو 1211 ذمم العملاء)
--    Cr 4311 إيراد الخدمات
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. smart_manufacture مع الترحيل المحاسبي المتوازن إلى journal_entries
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.smart_manufacture(
  _warehouse_id uuid,
  _grain_item_id uuid,
  _grain_qty numeric,
  _outputs jsonb,
  _notes text
)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_ref text;
  v_output_value numeric := 0;
  v_grain_cost numeric;
  v_total_input_cost numeric;
  v_total_output_qty numeric := 0;
  v_waste_qty numeric := 0;
  v_waste_cost numeric := 0;
  v_allocatable_cost numeric := 0;
  v_total_allocated numeric := 0;
  v_line_allocated numeric;
  v_line_idx int := 0;
  v_outputs_count int;
  r record;
  v_last_out numeric;
  v_journal_lines jsonb := '[]'::jsonb;
  v_acct_code text;
  v_item_name text;
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

  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _grain_item_id AND item_class = 'RAW_MATERIAL' AND is_active
  ) THEN
    RAISE EXCEPTION 'Input must be an active RAW_MATERIAL grain';
  END IF;

  v_outputs_count := jsonb_array_length(_outputs);

  -- التحقق من الأصناف واحتساب إجمالي القيمة البيعية والوزن
  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs) AS o(item_id uuid, qty numeric)
  LOOP
    IF r.item_id IS NULL OR coalesce(r.qty, 0) <= 0 THEN
      RAISE EXCEPTION 'Every output line needs an item and a positive quantity';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = r.item_id AND item_class IN ('FINISHED_GOOD', 'BY_PRODUCT') AND is_active
    ) THEN
      RAISE EXCEPTION 'Outputs must be FINISHED_GOOD or BY_PRODUCT items';
    END IF;

    SELECT coalesce(r.qty, 0) * coalesce(sale_price, 0)
      INTO v_last_out
    FROM public.products WHERE id = r.item_id;

    v_output_value := v_output_value + coalesce(v_last_out, 0);
    v_total_output_qty := v_total_output_qty + coalesce(r.qty, 0);
  END LOOP;

  IF v_output_value <= 0 THEN
    RAISE EXCEPTION 'Outputs must have sale prices to allocate cost by relative value';
  END IF;

  IF v_total_output_qty > _grain_qty THEN
    RAISE EXCEPTION 'Total output weight (%) cannot exceed input grain weight (%)',
      v_total_output_qty, _grain_qty;
  END IF;

  -- تكلفة القمح من طبقات التكلفة الفعلية أو كتالوج التكلفة
  SELECT coalesce(
    (SELECT sum(cl.quantity * cl.unit_cost) / nullif(sum(cl.quantity), 0)
       FROM public.item_cost_layers cl
      WHERE cl.product_id = _grain_item_id AND cl.quantity > 0
        AND cl.owner_type = 'COMPANY'),
    (SELECT cost_price FROM public.products WHERE id = _grain_item_id),
    0
  ) INTO v_grain_cost;

  v_total_input_cost := round(coalesce(_grain_qty, 0) * coalesce(v_grain_cost, 0), 2);
  v_ref := 'SM-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_service_seq')::text, 4, '0');

  -- احتساب الفاقد التشغيلي وتكلفته إن وجد
  v_waste_qty := greatest(0, coalesce(_grain_qty, 0) - v_total_output_qty);
  IF v_waste_qty > 0 AND v_grain_cost > 0 THEN
    v_waste_cost := round(v_waste_qty * v_grain_cost, 2);
  ELSE
    v_waste_cost := 0;
  END IF;

  -- التكلفة الصافية الموزعة على النواتج
  v_allocatable_cost := greatest(0, v_total_input_cost - v_waste_cost);

  -- 1) صادر القمح (ينقص المخزون بتكلفته)
  PERFORM public.post_stock_delta(
    _grain_item_id, _warehouse_id, -coalesce(_grain_qty, 0), v_grain_cost,
    'ISSUE'::public.stock_movement_kind, 'smart_manufacture', _grain_item_id,
    'تصنيع ذكي ' || v_ref || coalesce(' — ' || _notes, ''),
    'COMPANY'::public.owner_type, NULL, 'production_out'::public.movement_type);

  -- 2) وارد النواتج بتكلفة موزعة وبناء أطراف القيد المدين للنواتج
  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs) AS o(item_id uuid, qty numeric)
  LOOP
    DECLARE
      v_line_value numeric;
      v_unit_cost numeric;
      v_item_class text;
    BEGIN
      v_line_idx := v_line_idx + 1;
      SELECT coalesce(r.qty, 0) * coalesce(sale_price, 0), item_class, coalesce(name_ar, name)
        INTO v_line_value, v_item_class, v_item_name
      FROM public.products WHERE id = r.item_id;

      IF v_line_idx = v_outputs_count THEN
        -- آخر ناتج يحمل المتبقي بالضبط لضمان توازن التكلفة
        v_line_allocated := v_allocatable_cost - v_total_allocated;
      ELSE
        v_line_allocated := round(v_allocatable_cost * (coalesce(v_line_value, 0) / v_output_value), 2);
        v_total_allocated := v_total_allocated + v_line_allocated;
      END IF;

      v_unit_cost := round(v_line_allocated / nullif(coalesce(r.qty, 0), 0), 4);

      PERFORM public.post_stock_delta(
        r.item_id, _warehouse_id, coalesce(r.qty, 0), v_unit_cost,
        'RECEIPT'::public.stock_movement_kind, 'smart_manufacture', _grain_item_id,
        'تصنيع ذكي ' || v_ref || coalesce(' — ' || _notes, ''),
        'COMPANY'::public.owner_type, NULL, 'production_in'::public.movement_type);

      -- الحساب المحاسبي للناتج: 1314 للنخالة والنواتج العرضية، و1313 للمنتجات التامة (الدقيق)
      IF v_item_class = 'BY_PRODUCT' THEN
        v_acct_code := '1314';
      ELSE
        v_acct_code := '1313';
      END IF;

      IF v_line_allocated > 0 THEN
        v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_code', v_acct_code,
          'debit', v_line_allocated,
          'credit', 0,
          'memo', 'إنتاج مخزون ' || v_item_name || ' (' || v_ref || ')'
        );
      END IF;
    END;
  END LOOP;

  -- 3) طرف قيد الفاقد والهدر التشغيلي إن وجد (حـ/ 5921)
  IF v_waste_cost > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_object(
      'account_code', '5921',
      'debit', v_waste_cost,
      'credit', 0,
      'memo', 'فاقد وتلف تشغيلي مطحنة (' || v_ref || ')'
    );
  END IF;

  -- 4) طرف القيد الدائن لمخزون المواد الأولية (حـ/ 1311) بإجمالي تكلفة القمح
  IF v_total_input_cost > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_object(
      'account_code', '1311',
      'debit', 0,
      'credit', v_total_input_cost,
      'memo', 'سحب قمح خام للتصنيع (' || v_ref || ')'
    );

    -- ترحيل القيد لدفتر الأستاذ العام
    PERFORM public.create_journal_entry(
      'تصنيع ذكي ' || v_ref || coalesce(' — ' || _notes, ''),
      CURRENT_DATE,
      'smart_manufacture',
      _grain_item_id,
      true,
      v_journal_lines
    );
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'manufacture.smart', 'stock_movements', _grain_item_id,
    jsonb_build_object(
      'ref', v_ref,
      'warehouse_id', _warehouse_id,
      'grain_item_id', _grain_item_id,
      'grain_qty', coalesce(_grain_qty, 0),
      'grain_unit_cost', v_grain_cost,
      'waste_qty', v_waste_qty,
      'waste_cost', v_waste_cost,
      'total_cost', v_total_input_cost,
      'outputs', _outputs,
      'allocation', 'RELATIVE_SALES_VALUE'
    ));

  RETURN v_ref;
END $function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. consume_internal_supplies مع الترحيل المحاسبي (5316 مدين / 1315 دائن)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.consume_internal_supplies(
  _warehouse_id uuid,
  _lines jsonb,
  _notes text
)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_ref text;
  r record;
  v_unit_cost numeric;
  v_line_cost numeric;
  v_total_cost numeric := 0;
  v_journal_lines jsonb := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to issue internal consumables';
  END IF;
  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'At least one consumable line is required';
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(_lines) AS l(item_id uuid, qty numeric)
  LOOP
    IF r.item_id IS NULL OR coalesce(r.qty, 0) <= 0 THEN
      RAISE EXCEPTION 'Every line needs an item and a positive quantity';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = r.item_id AND item_class IN ('NON_STOCK_ITEM', 'PACKAGING') AND is_active
    ) THEN
      RAISE EXCEPTION 'Only consumable (NON_STOCK_ITEM / PACKAGING) items may be issued here';
    END IF;
  END LOOP;

  v_ref := 'CS-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_service_seq')::text, 4, '0');

  FOR r IN SELECT * FROM jsonb_to_recordset(_lines) AS l(item_id uuid, qty numeric)
  LOOP
    -- احتساب تكلفة المستهلك من طبقات التكلفة أو الكتالوج
    SELECT coalesce(
      (SELECT sum(cl.quantity * cl.unit_cost) / nullif(sum(cl.quantity), 0)
         FROM public.item_cost_layers cl
        WHERE cl.product_id = r.item_id AND cl.quantity > 0
          AND cl.owner_type = 'COMPANY'),
      (SELECT cost_price FROM public.products WHERE id = r.item_id),
      0
    ) INTO v_unit_cost;

    v_line_cost := round(coalesce(r.qty, 0) * coalesce(v_unit_cost, 0), 2);
    v_total_cost := v_total_cost + v_line_cost;

    PERFORM public.post_stock_delta(
      r.item_id, _warehouse_id, -coalesce(r.qty, 0), v_unit_cost,
      'ISSUE'::public.stock_movement_kind, 'internal_consumables', _warehouse_id,
      'صرف مستهلكات داخلي ' || v_ref || coalesce(' — ' || _notes, ''),
      'COMPANY'::public.owner_type, NULL, 'adjustment'::public.movement_type);
  END LOOP;

  -- ترحيل قيد صرف مواد التعبئة والتغليف (5316 مواد تعبئة / 1315 مخزون مواد التعبئة)
  IF v_total_cost > 0 THEN
    v_journal_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', '5316',
        'debit', v_total_cost,
        'credit', 0,
        'memo', 'مصروف مواد تعبئة وتغليف مستهلكة (' || v_ref || ')'
      ),
      jsonb_build_object(
        'account_code', '1315',
        'debit', 0,
        'credit', v_total_cost,
        'memo', 'منصرف مخزون مواد التعبئة (' || v_ref || ')'
      )
    );

    PERFORM public.create_journal_entry(
      'صرف مستهلكات تعبئة وتشغيل ' || v_ref || coalesce(' — ' || _notes, ''),
      CURRENT_DATE,
      'consume_internal_supplies',
      _warehouse_id,
      true,
      v_journal_lines
    );
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'consumables.issued', 'stock_movements', _warehouse_id,
    jsonb_build_object(
      'ref', v_ref,
      'warehouse_id', _warehouse_id,
      'lines', _lines,
      'total_cost', v_total_cost,
      'notes', _notes
    ));

  RETURN v_ref;
END $function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. ترحيل فاتورة خدمة الطحن تلقائياً عند الإنشاء في create_milling_service_document
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_milling_service_document(
  _customer_id uuid,
  _warehouse_id uuid,
  _grain_item_id uuid,
  _bags numeric,
  _kg numeric,
  _service_item_id uuid,
  _service_unit_price numeric,
  _discount numeric,
  _payment_method text,
  _paid numeric,
  _notes text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_document_id uuid;
  v_document_number text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_subtotal numeric;
  v_total numeric;
  v_paid numeric;
  v_outstanding numeric;
  v_customer_balance numeric;
  v_credit_limit numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to create milling service documents';
  END IF;
  IF _customer_id IS NULL OR _warehouse_id IS NULL OR _grain_item_id IS NULL
     OR _service_item_id IS NULL THEN
    RAISE EXCEPTION 'Customer, warehouse, grain and service are required';
  END IF;
  IF coalesce(_bags, 0) <= 0 AND coalesce(_kg, 0) <= 0 THEN
    RAISE EXCEPTION 'Record at least one bag or a positive weight';
  END IF;
  IF coalesce(_bags, 0) < 0 OR coalesce(_kg, 0) < 0 THEN
    RAISE EXCEPTION 'Quantities cannot be negative';
  END IF;
  IF coalesce(_service_unit_price, 0) < 0 OR coalesce(_discount, 0) < 0
     OR coalesce(_paid, 0) < 0 THEN
    RAISE EXCEPTION 'Service price, discount and paid amount cannot be negative';
  END IF;
  IF _payment_method NOT IN ('cash', 'card', 'bank_transfer', 'credit', 'mobile_money', 'split') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _grain_item_id AND item_class = 'RAW_MATERIAL' AND is_active
  ) THEN
    RAISE EXCEPTION 'Intake item must be an active RAW_MATERIAL grain';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _service_item_id AND item_class = 'SERVICE' AND is_active AND is_sellable
  ) THEN
    RAISE EXCEPTION 'Milling fee item must be an active sellable SERVICE';
  END IF;

  SELECT balance, credit_limit
    INTO v_customer_balance, v_credit_limit
  FROM public.customers
  WHERE id = _customer_id AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected customer is unavailable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = _warehouse_id AND is_active) THEN
    RAISE EXCEPTION 'Selected warehouse is unavailable';
  END IF;

  v_subtotal := round(coalesce(_service_unit_price, 0), 2);
  v_total := round(v_subtotal - coalesce(_discount, 0), 2);
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Discount cannot exceed the service fee';
  END IF;
  v_paid := least(round(coalesce(_paid, 0), 2), v_total);
  v_outstanding := round(v_total - v_paid, 2);
  IF _payment_method = 'credit' AND v_paid <> 0 THEN
    RAISE EXCEPTION 'Credit payment method requires zero paid amount';
  END IF;
  IF v_outstanding > 0 AND NOT public.customer_credit_limit_allows(_customer_id, v_outstanding) THEN
    RAISE EXCEPTION
      'Credit limit exceeded: current balance %, requested debt %, limit %',
      coalesce(v_customer_balance, 0), v_outstanding, coalesce(v_credit_limit, 0);
  END IF;

  v_invoice_number := public.next_invoice_number();
  INSERT INTO public.sales_invoices (
    invoice_number, customer_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by
  ) VALUES (
    v_invoice_number, _customer_id, _warehouse_id, 'confirmed',
    public.derive_payment_status(v_paid, v_total),
    v_subtotal, round(coalesce(_discount, 0), 2), 0, v_total, v_paid,
    _payment_method::public.payment_method, nullif(btrim(_notes), ''), v_user
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.sales_invoice_items (
    invoice_id, product_id, description, quantity, unit_price, discount, tax, total,
    line_type, stock_effect
  ) VALUES (
    v_invoice_id, _service_item_id, 'أجور طحن وتجهيز', 1, v_subtotal,
    0, 0, v_subtotal, 'SERVICE', 'NONE'
  );

  IF v_outstanding > 0 THEN
    UPDATE public.customers
    SET balance = round(coalesce(balance, 0) + v_outstanding, 2), updated_at = now()
    WHERE id = _customer_id;

    INSERT INTO public.customer_ledger (
      customer_id, entry_type, debit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    ) VALUES (
      _customer_id, 'sale', v_outstanding, v_invoice_id, 'sales_invoice',
      now(), v_user, 'sale:' || v_invoice_id, 'قيد أجور طحن آجل'
    ) ON CONFLICT (source_key) DO NOTHING;
  END IF;

  -- ترحيل فاتورة خدمة الطحن تلقائياً للأستاذ العام (Dr 1101/1211 Cr 4311)
  PERFORM public.post_sales_invoice(v_invoice_id);

  v_document_number := 'MT-' || to_char(now(), 'YYYYMM') || '-' ||
    lpad(nextval('public.milling_document_seq')::text, 4, '0');
  INSERT INTO public.milling_service_documents (
    document_number, customer_id, warehouse_id, sales_invoice_id, created_by
  ) VALUES (
    v_document_number, _customer_id, _warehouse_id, v_invoice_id, v_user
  ) RETURNING id INTO v_document_id;

  INSERT INTO public.custody_ledger (
    customer_id, warehouse_id, entry_type, item_id, doc_number,
    bags_in, kg_in, milling_document_id, notes, created_by
  ) VALUES (
    _customer_id, _warehouse_id, 'INTAKE', _grain_item_id, v_document_number,
    coalesce(_bags, 0), coalesce(_kg, 0), v_document_id, _notes, v_user
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'milling.service_document.created', 'milling_service_documents', v_document_id,
    jsonb_build_object(
      'document_number', v_document_number,
      'invoice_id', v_invoice_id,
      'invoice_number', v_invoice_number,
      'customer_id', _customer_id,
      'grain_item_id', _grain_item_id,
      'bags', coalesce(_bags, 0),
      'kg', coalesce(_kg, 0),
      'service_total', v_total,
      'paid', v_paid,
      'outstanding', v_outstanding,
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN jsonb_build_object(
    'document_id', v_document_id,
    'document_number', v_document_number,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number
  );
END $function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. تنظيف expense_lookups واستبعاد حسابات مسؤولي المنصة (السوبر أدمن) من الموظفين
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.expense_lookups(p_include_archived boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'name_ar', c.name_ar,
               'is_active', c.is_active, 'sort_order', c.sort_order,
               'usage_count', (SELECT count(*) FROM public.expense_lines l WHERE l.category_id = c.id)
             ) ORDER BY c.sort_order, c.name)
      FROM public.expense_categories c
      WHERE p_include_archived OR c.is_active
    ), '[]'::jsonb),
    'warehouses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', w.id, 'name', w.name, 'name_ar', w.name_ar, 'is_default', w.is_default
             ) ORDER BY w.name)
      FROM public.warehouses w
      WHERE w.is_active IS NOT FALSE
    ), '[]'::jsonb),
    'cost_centers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', cc.id, 'code', cc.code, 'name', cc.name, 'name_ar', cc.name_ar
             ) ORDER BY cc.name)
      FROM public.expense_cost_centers cc
      WHERE cc.is_active
    ), '[]'::jsonb),
    'projects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', pj.id, 'code', pj.code, 'name', pj.name, 'name_ar', pj.name_ar
             ) ORDER BY pj.name)
      FROM public.expense_projects pj
      WHERE pj.is_active
    ), '[]'::jsonb),
    'suppliers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
      FROM public.suppliers s
      WHERE s.is_active IS NOT FALSE
    ), '[]'::jsonb),
    'employees', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) ORDER BY p.full_name)
      FROM public.profiles p
      WHERE p.is_active IS NOT FALSE
        AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p.id)
        AND p.full_name NOT ILIKE '%سوبر%'
        AND p.full_name NOT ILIKE '%superadmin%'
    ), '[]'::jsonb),
    'financial_accounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', a.id, 'code', a.code, 'name_ar', a.name_ar,
               'account_type', a.account_type,
               'requires_reconciliation', a.requires_reconciliation
             ) ORDER BY a.code)
      FROM public.accounts a
      WHERE a.is_active IS NOT FALSE
        AND (a.requires_reconciliation IS TRUE OR a.code LIKE '11%')
    ), '[]'::jsonb)
  )
$function$;

-- الصلاحيات
GRANT EXECUTE ON FUNCTION public.smart_manufacture(uuid, uuid, numeric, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_internal_supplies(uuid, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_milling_service_document(uuid, uuid, uuid, numeric, numeric, uuid, numeric, numeric, text, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expense_lookups(boolean) TO authenticated, service_role;

COMMIT;

