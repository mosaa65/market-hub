-- ════════════════════════════
-- 60_milling_custody_multiline.sql
--
-- طحن أمانات الغير — أسطر متعددة (طلب مالك المطحنة):
--   1. الاستلام: قد يستلم العميل أكثر من نوع حبوب في عملية واحدة
--      (مثال: «حبوب بر الخريف كيس 50 كجم» ×10 + «حبوب بر الخريف كيس 25 كجم» ×10).
--   2. الطحن: قد يطحن أكثر من نوع حبوب في عملية واحدة ويُنتج أكثر من ناتج.
--
-- ◆ فصل منتجات الأمانات عن منتجات النظام التجاري:
--   عمود is_custody_item على products — المنتجات المعلّمة به=true تظهر فقط
--   في قوائم أمانات المطحنة (استلام/طحن/تسليم)، والمنتجات التجارية العادية
--   لا تظهر فيها أبداً، والعكس صحيح. تعليم المنتجات يتم من واجهة المنتجات.
-- ════════════════════════════

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_custody_item boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.products.is_custody_item IS 'منتج أمانات مطحنة (حبوب/نواتج) — يظهر في قوائم الطحن فقط وليس في المبيعات والمشتريات';

CREATE INDEX IF NOT EXISTS idx_products_custody ON public.products (item_class, is_custody_item) WHERE is_custody_item;

-- ── 1. الاستلام متعدد الأصناف (بدون فاتورة) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.custody_intake_multi(
  _customer_id uuid,
  _warehouse_id uuid,
  _lines jsonb,   -- [{item_id, bags, kg}]
  _notes text
)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_doc text;
  r record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to record custody intakes';
  END IF;
  IF _customer_id IS NULL OR _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Customer and warehouse are required';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'At least one intake line is required';
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(_lines) AS l(item_id uuid, bags numeric, kg numeric)
  LOOP
    IF r.item_id IS NULL THEN
      RAISE EXCEPTION 'Every intake line needs an item';
    END IF;
    IF coalesce(r.bags, 0) <= 0 AND coalesce(r.kg, 0) <= 0 THEN
      RAISE EXCEPTION 'Every intake line needs bags or a positive weight';
    END IF;
    IF coalesce(r.bags, 0) < 0 OR coalesce(r.kg, 0) < 0 THEN
      RAISE EXCEPTION 'Quantities cannot be negative';
    END IF;
    -- صنف الاستلام حبوب خام فقط — منتجات الأمانات (is_custody_item).
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = r.item_id AND item_class = 'RAW_MATERIAL' AND is_active AND is_custody_item
    ) THEN
      RAISE EXCEPTION 'Intake items must be active custody grain products (is_custody_item)';
    END IF;
  END LOOP;

  v_doc := 'CI-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_intake_seq')::text, 4, '0');

  FOR r IN SELECT * FROM jsonb_to_recordset(_lines) AS l(item_id uuid, bags numeric, kg numeric)
  LOOP
    INSERT INTO public.custody_ledger
      (customer_id, warehouse_id, entry_type, item_id, doc_number,
       bags_in, kg_in, notes, created_by)
    VALUES
      (_customer_id, _warehouse_id, 'INTAKE', r.item_id, v_doc,
       coalesce(r.bags, 0), coalesce(r.kg, 0), _notes, v_user);
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'custody.intake', 'custody_ledger', _customer_id,
    jsonb_build_object(
      'doc_number', v_doc,
      'customer_id', _customer_id,
      'lines', _lines,
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN v_doc;
END $function$;

-- ── 2. الطحن متعدد الأصناف: أسطر حبوب صادرة + أسطر نواتج واردة ────────────
CREATE OR REPLACE FUNCTION public.custody_milling_multi(
  _customer_id uuid,
  _warehouse_id uuid,
  _grains jsonb,   -- [{item_id, bags, kg}]
  _outputs jsonb,  -- [{item_id, bags, kg}]
  _notes text
)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_doc text;
  v_balance_bags numeric;
  v_balance_kg numeric;
  v_total_out_bags numeric := 0;
  v_total_out_kg numeric := 0;
  r record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to record custody milling';
  END IF;
  IF _customer_id IS NULL OR _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Customer and warehouse are required';
  END IF;
  IF _grains IS NULL OR jsonb_typeof(_grains) <> 'array' OR jsonb_array_length(_grains) = 0 THEN
    RAISE EXCEPTION 'At least one grain line is required';
  END IF;
  IF _outputs IS NULL OR jsonb_typeof(_outputs) <> 'array' OR jsonb_array_length(_outputs) = 0 THEN
    RAISE EXCEPTION 'At least one output line is required';
  END IF;

  -- تحقق أسطر الحبوب: صنف خام + رصيد كافٍ
  FOR r IN SELECT * FROM jsonb_to_recordset(_grains) AS g(item_id uuid, bags numeric, kg numeric)
  LOOP
    IF r.item_id IS NULL THEN
      RAISE EXCEPTION 'Every grain line needs an item';
    END IF;
    IF coalesce(r.bags, 0) <= 0 AND coalesce(r.kg, 0) <= 0 THEN
      RAISE EXCEPTION 'Every grain line needs bags or a positive weight';
    END IF;
    IF coalesce(r.bags, 0) < 0 OR coalesce(r.kg, 0) < 0 THEN
      RAISE EXCEPTION 'Quantities cannot be negative';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = r.item_id AND item_class = 'RAW_MATERIAL' AND is_active AND is_custody_item
    ) THEN
      RAISE EXCEPTION 'Milling input must be active custody grain products (is_custody_item)';
    END IF;

    SELECT * FROM public.custody_balance(_customer_id, _warehouse_id, r.item_id)
      INTO v_balance_bags, v_balance_kg;
    IF coalesce(r.bags, 0) > v_balance_bags THEN
      RAISE EXCEPTION 'Grain bags balance (%) is less than the requested milling amount (%)',
        v_balance_bags, coalesce(r.bags, 0);
    END IF;
    IF coalesce(r.kg, 0) > v_balance_kg THEN
      RAISE EXCEPTION 'Grain kg balance (%) is less than the requested milling amount (%)',
        v_balance_kg, coalesce(r.kg, 0);
    END IF;
  END LOOP;

  -- تحقق أسطر النواتج
  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs) AS o(item_id uuid, bags numeric, kg numeric)
  LOOP
    IF r.item_id IS NULL THEN
      RAISE EXCEPTION 'Every output line needs an item';
    END IF;
    IF coalesce(r.bags, 0) <= 0 AND coalesce(r.kg, 0) <= 0 THEN
      RAISE EXCEPTION 'Every output line needs bags or a positive weight';
    END IF;
    IF coalesce(r.bags, 0) < 0 OR coalesce(r.kg, 0) < 0 THEN
      RAISE EXCEPTION 'Output quantities cannot be negative';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = r.item_id AND item_class IN ('FINISHED_GOOD', 'BY_PRODUCT')
        AND is_active AND is_custody_item
    ) THEN
      RAISE EXCEPTION 'Milling outputs must be active custody output products (is_custody_item)';
    END IF;
    v_total_out_bags := v_total_out_bags + coalesce(r.bags, 0);
    v_total_out_kg   := v_total_out_kg + coalesce(r.kg, 0);
  END LOOP;

  v_doc := 'CM-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_service_seq')::text, 4, '0');

  -- صادر الحبوب: سطر لكل صنف
  FOR r IN SELECT * FROM jsonb_to_recordset(_grains) AS g(item_id uuid, bags numeric, kg numeric)
  LOOP
    INSERT INTO public.custody_ledger
      (customer_id, warehouse_id, entry_type, item_id, doc_number,
       bags_out, kg_out, notes, created_by)
    VALUES
      (_customer_id, _warehouse_id, 'MILLING', r.item_id, v_doc,
       coalesce(r.bags, 0), coalesce(r.kg, 0), _notes, v_user);
  END LOOP;

  -- وارد النواتج: سطر لكل ناتج
  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs) AS o(item_id uuid, bags numeric, kg numeric)
  LOOP
    INSERT INTO public.custody_ledger
      (customer_id, warehouse_id, entry_type, item_id, doc_number,
       bags_in, kg_in, notes, created_by)
    VALUES
      (_customer_id, _warehouse_id, 'MILLING', r.item_id, v_doc,
       coalesce(r.bags, 0), coalesce(r.kg, 0), _notes, v_user);
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'custody.milling', 'custody_ledger', _customer_id,
    jsonb_build_object(
      'doc_number', v_doc,
      'grains', _grains,
      'outputs', _outputs,
      'output_bags', v_total_out_bags,
      'output_kg', v_total_out_kg,
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN v_doc;
END $function$;

-- ─ 3. منتجات الأمانات — قراءة قوائم مخصصة معزولة عن منتجات النظام ─
-- حبوب الأمانات: خام + معلّم كمنتج أمانات.
CREATE OR REPLACE FUNCTION public.custody_grain_items()
 RETURNS TABLE(id uuid, sku text, name text, name_ar text, item_class public.item_class,
               sale_price numeric, cost_price numeric, package_weight_kg numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.sku, p.name, p.name_ar, p.item_class, p.sale_price, p.cost_price, p.package_weight_kg
  FROM public.products p
  WHERE p.item_class = 'RAW_MATERIAL' AND p.is_active AND p.is_custody_item
  ORDER BY p.name_ar NULLS LAST, p.name;
$function$;

-- نواتج الأمانات: منتجات تامة + نواتج جانبية + معلّمة كمنتجات أمانات.
CREATE OR REPLACE FUNCTION public.custody_output_items()
 RETURNS TABLE(id uuid, sku text, name text, name_ar text, item_class public.item_class,
               sale_price numeric, cost_price numeric, package_weight_kg numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.sku, p.name, p.name_ar, p.item_class, p.sale_price, p.cost_price, p.package_weight_kg
  FROM public.products p
  WHERE p.item_class IN ('FINISHED_GOOD', 'BY_PRODUCT') AND p.is_active AND p.is_custody_item
  ORDER BY p.name_ar NULLS LAST, p.name;
$function$;

GRANT EXECUTE ON FUNCTION public.custody_grain_items() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.custody_output_items() TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.custody_intake_multi(uuid, uuid, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.custody_milling_multi(uuid, uuid, jsonb, jsonb, text) TO authenticated, service_role;

-- ── 4. مستند خدمة استلام متعدد الأصناف: فاتورة أجور واحدة + N سطر استلام ──
CREATE OR REPLACE FUNCTION public.create_milling_service_document_multi(
  _customer_id uuid,
  _warehouse_id uuid,
  _grains jsonb,        -- [{item_id, bags, kg}]
  _service_item_id uuid,
  _service_unit_price numeric,  -- الإجمالي المفوتر للعملية كلها (من الواجهة)
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
  r record;
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
  IF _customer_id IS NULL OR _warehouse_id IS NULL OR _service_item_id IS NULL THEN
    RAISE EXCEPTION 'Customer, warehouse and service are required';
  END IF;
  IF _grains IS NULL OR jsonb_typeof(_grains) <> 'array' OR jsonb_array_length(_grains) = 0 THEN
    RAISE EXCEPTION 'At least one grain line is required';
  END IF;
  IF coalesce(_service_unit_price, 0) < 0 OR coalesce(_discount, 0) < 0
     OR coalesce(_paid, 0) < 0 THEN
    RAISE EXCEPTION 'Service price, discount and paid amount cannot be negative';
  END IF;
  IF _payment_method NOT IN ('cash', 'card', 'bank_transfer', 'credit', 'mobile_money', 'split') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  -- تحقق أسطر الحبوب: خام + منتج أمانات + كمية موجبة
  FOR r IN SELECT * FROM jsonb_to_recordset(_grains) AS g(item_id uuid, bags numeric, kg numeric)
  LOOP
    IF r.item_id IS NULL THEN
      RAISE EXCEPTION 'Every grain line needs an item';
    END IF;
    IF coalesce(r.bags, 0) <= 0 AND coalesce(r.kg, 0) <= 0 THEN
      RAISE EXCEPTION 'Every grain line needs bags or a positive weight';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = r.item_id AND item_class = 'RAW_MATERIAL' AND is_active AND is_custody_item
    ) THEN
      RAISE EXCEPTION 'Intake items must be active custody grain products (is_custody_item)';
    END IF;
  END LOOP;

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

  PERFORM public.post_sales_invoice(v_invoice_id);

  v_document_number := 'MT-' || to_char(now(), 'YYYYMM') || '-' ||
    lpad(nextval('public.milling_document_seq')::text, 4, '0');
  INSERT INTO public.milling_service_documents (
    document_number, customer_id, warehouse_id, sales_invoice_id, created_by
  ) VALUES (
    v_document_number, _customer_id, _warehouse_id, v_invoice_id, v_user
  ) RETURNING id INTO v_document_id;

  FOR r IN SELECT * FROM jsonb_to_recordset(_grains) AS g(item_id uuid, bags numeric, kg numeric)
  LOOP
    INSERT INTO public.custody_ledger (
      customer_id, warehouse_id, entry_type, item_id, doc_number,
      bags_in, kg_in, milling_document_id, notes, created_by
    ) VALUES (
      _customer_id, _warehouse_id, 'INTAKE', r.item_id, v_document_number,
      coalesce(r.bags, 0), coalesce(r.kg, 0), v_document_id, _notes, v_user
    );
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'milling.service_document.created', 'milling_service_documents', v_document_id,
    jsonb_build_object(
      'document_number', v_document_number,
      'invoice_id', v_invoice_id,
      'grains', _grains,
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

GRANT EXECUTE ON FUNCTION public.create_milling_service_document_multi(uuid, uuid, jsonb, uuid, numeric, numeric, text, numeric, text) TO authenticated, service_role;
