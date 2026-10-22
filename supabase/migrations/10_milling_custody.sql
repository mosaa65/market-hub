-- ============================================================================
-- 10_milling_custody.sql
--
-- طبقة الأمانات المبسطة: جدول واحد custody_ledger — سطر لكل حركة، والرصيد مشتق.
--
-- التصميم المعتمد: docs/milling/00_خطة_التبسيط_المعتمدة.md
--   - لا أوامر طحن، لا فاقد مدخل، لا صوامع، لا أوزان عبوات، لا عقود.
--   - حبوب العميل أمانة: صفر أثر على مخزون المطحنة (بلا حركات مخزون إطلاقاً).
--   - الرصيد = sum(bags_in - bags_out) / sum(kg_in - kg_out) — لا رصيد مخزَّن.
--   - الكتابة عبر RPC فقط (R-23). راجع supabase/MIGRATIONS_RULES.md
-- ============================================================================

-- ── TYPES ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.custody_entry_type AS ENUM ('INTAKE', 'MILLING', 'DELIVERY', 'ADJUSTMENT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ── SEQUENCES ─────────────────────────────────────────────────────────────
-- أرقام المستندات. مملوكة هنا (أُزيلت من 11 و14 حتى لا تتكرر — R-13).
CREATE SEQUENCE IF NOT EXISTS public.milling_intake_seq   START 1;
CREATE SEQUENCE IF NOT EXISTS public.milling_service_seq  START 1;
CREATE SEQUENCE IF NOT EXISTS public.milling_delivery_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.milling_document_seq START 1;

-- ── TABLES ────────────────────────────────────────────────────────────────
-- رأس مستند خدمة خفيف: يجمع أمانة العميل والفاتورة الرسمية تحت عملية واحدة.
-- ليس أمر إنتاج، ولا يحتفظ برصيد أو فاقد أو تكلفة تصنيع.
CREATE TABLE public.milling_service_documents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  document_number varchar(50) NOT NULL,
  customer_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  sales_invoice_id uuid NOT NULL,
  status varchar(20) DEFAULT 'RECEIVED' NOT NULL,
  received_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  processed_at timestamp with time zone,
  delivered_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT milling_service_documents_pkey PRIMARY KEY (id),
  CONSTRAINT milling_service_documents_number_key UNIQUE (document_number),
  CONSTRAINT milling_service_documents_invoice_key UNIQUE (sales_invoice_id),
  CONSTRAINT milling_service_documents_status_check CHECK (
    status IN ('RECEIVED', 'PROCESSED', 'DELIVERED')
  )
);

CREATE TABLE public.custody_ledger (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  customer_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  entry_type public.custody_entry_type NOT NULL,
  item_id uuid NOT NULL,
  doc_number varchar(50),
  bags_in numeric(12,3) DEFAULT 0 NOT NULL,
  bags_out numeric(12,3) DEFAULT 0 NOT NULL,
  kg_in numeric(12,3) DEFAULT 0 NOT NULL,
  kg_out numeric(12,3) DEFAULT 0 NOT NULL,
  unit_price numeric(14,2) DEFAULT 0 NOT NULL,
  amount numeric(14,2) DEFAULT 0 NOT NULL,
  -- رابط اختياري للرأس الموحد؛ تبقى الحركات التاريخية القديمة قابلة للقراءة.
  milling_document_id uuid,
  service_invoice_id uuid,
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT custody_ledger_pkey PRIMARY KEY (id),
  CONSTRAINT custody_ledger_quantities_check CHECK (
    bags_in >= 0 AND bags_out >= 0 AND kg_in >= 0 AND kg_out >= 0
  ),
  CONSTRAINT custody_ledger_movement_check CHECK (
    (bags_in + bags_out + kg_in + kg_out) > 0
  ),
  CONSTRAINT custody_ledger_one_side_check CHECK (
    (bags_in = 0 OR bags_out = 0) AND (kg_in = 0 OR kg_out = 0)
  ),
  CONSTRAINT custody_ledger_invoice_only_money_check CHECK (
    service_invoice_id IS NULL OR (unit_price = 0 AND amount = 0)
  )
);

-- ── INDEXES ───────────────────────────────────────────────────────────────
CREATE INDEX idx_custody_customer_item ON public.custody_ledger USING btree (customer_id, item_id);
CREATE INDEX idx_custody_warehouse ON public.custody_ledger USING btree (warehouse_id, created_at DESC);
CREATE INDEX idx_custody_invoice ON public.custody_ledger USING btree (service_invoice_id) WHERE (service_invoice_id IS NOT NULL);
CREATE INDEX idx_custody_entry_type ON public.custody_ledger USING btree (entry_type, created_at DESC);
CREATE INDEX idx_custody_milling_document ON public.custody_ledger USING btree (milling_document_id, created_at DESC) WHERE (milling_document_id IS NOT NULL);
CREATE INDEX idx_milling_service_documents_customer ON public.milling_service_documents USING btree (customer_id, received_at DESC);

-- ── VIEW: الأرصدة — مشتقة دائماً، لا رصيد مخزَّن ─────────────────────────
CREATE OR REPLACE VIEW public.custody_balances AS
 SELECT l.customer_id,
    l.warehouse_id,
    l.item_id,
    p.sku,
    p.name_ar,
    p.item_class,
    sum((l.bags_in - l.bags_out)) AS bags_balance,
    sum((l.kg_in - l.kg_out)) AS kg_balance
   FROM (public.custody_ledger l
     JOIN public.products p ON ((p.id = l.item_id)))
  GROUP BY l.customer_id, l.warehouse_id, l.item_id, p.sku, p.name_ar, p.item_class;

-- ── FUNCTIONS ─────────────────────────────────────────────────────────────
-- مساعد داخلي: رصيد العميل (أكياس، كجم) لصنف ومخزن — يُقرأ دائماً من السجل.
CREATE OR REPLACE FUNCTION public.custody_balance(_customer_id uuid, _warehouse_id uuid, _item_id uuid)
 RETURNS TABLE(bags numeric, kg numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(sum(bags_in - bags_out), 0) AS bags,
         coalesce(sum(kg_in - kg_out), 0) AS kg
  FROM public.custody_ledger
  WHERE customer_id = _customer_id
    AND warehouse_id = _warehouse_id
    AND item_id = _item_id
$function$;

-- ── 0. كاونتر المطحنة: استلام + فاتورة أجور رسمية في معاملة واحدة ───────
-- حبوب العميل تبقى أمانة بلا أثر مخزني، أما الأجرة فهي فاتورة مبيعات فعلية.
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
  -- إصدار الفاتورة عمل نقدي؛ لا يُفتح لمستخدم مستودع فقط.
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

-- ── 1. الاستلام ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.custody_intake(_customer_id uuid, _warehouse_id uuid, _item_id uuid, _bags numeric, _kg numeric, _notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
  v_doc text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to record custody intakes';
  END IF;
  IF _customer_id IS NULL OR _warehouse_id IS NULL OR _item_id IS NULL THEN
    RAISE EXCEPTION 'Customer, warehouse and item are required';
  END IF;
  IF coalesce(_bags, 0) <= 0 AND coalesce(_kg, 0) <= 0 THEN
    RAISE EXCEPTION 'Record at least one bag or a positive weight';
  END IF;
  IF coalesce(_bags, 0) < 0 OR coalesce(_kg, 0) < 0 THEN
    RAISE EXCEPTION 'Quantities cannot be negative';
  END IF;

  -- صنف الاستلام حبوب خام فقط — من القاعدة لا من الواجهة.
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _item_id AND item_class = 'RAW_MATERIAL' AND is_active
  ) THEN
    RAISE EXCEPTION 'Intake item must be an active RAW_MATERIAL grain';
  END IF;

  v_doc := 'CI-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_intake_seq')::text, 4, '0');

  INSERT INTO public.custody_ledger
    (customer_id, warehouse_id, entry_type, item_id, doc_number,
     bags_in, kg_in, notes, created_by)
  VALUES
    (_customer_id, _warehouse_id, 'INTAKE', _item_id, v_doc,
     coalesce(_bags, 0), coalesce(_kg, 0), _notes, v_user)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'custody.intake', 'custody_ledger', v_id,
    jsonb_build_object(
      'doc_number', v_doc,
      'customer_id', _customer_id,
      'item_id', _item_id,
      'bags', coalesce(_bags, 0),
      'kg', coalesce(_kg, 0),
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN v_id;
END $function$;

-- ── 2. الطحن ──────────────────────────────────────────────────────────────
-- سطر صادر حبوب + سطر وارد لكل ناتج، في معاملة واحدة.
-- الفاقد لا يُدخل: هو الفرق الذي يظهر تلقائياً في الكشف.
CREATE OR REPLACE FUNCTION public.custody_milling(_customer_id uuid, _warehouse_id uuid, _grain_item_id uuid, _bags_out numeric, _kg_out numeric, _outputs jsonb, _notes text)
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
  IF _customer_id IS NULL OR _warehouse_id IS NULL OR _grain_item_id IS NULL THEN
    RAISE EXCEPTION 'Customer, warehouse and grain item are required';
  END IF;
  IF coalesce(_bags_out, 0) <= 0 AND coalesce(_kg_out, 0) <= 0 THEN
    RAISE EXCEPTION 'Milling must consume at least one bag or a positive weight of grain';
  END IF;
  IF _outputs IS NULL OR jsonb_typeof(_outputs) <> 'array' OR jsonb_array_length(_outputs) = 0 THEN
    RAISE EXCEPTION 'At least one output line is required';
  END IF;

  -- صنف الحبوب خام، وأصناف النواتج منتجات/نواتج جانبية — من القاعدة.
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _grain_item_id AND item_class = 'RAW_MATERIAL' AND is_active
  ) THEN
    RAISE EXCEPTION 'Milling input must be an active RAW_MATERIAL grain';
  END IF;

  SELECT * FROM public.custody_balance(_customer_id, _warehouse_id, _grain_item_id)
    INTO v_balance_bags, v_balance_kg;

  IF coalesce(_bags_out, 0) > v_balance_bags THEN
    RAISE EXCEPTION 'Grain bags balance (%) is less than the requested milling amount (%)',
      v_balance_bags, coalesce(_bags_out, 0);
  END IF;
  IF coalesce(_kg_out, 0) > v_balance_kg THEN
    RAISE EXCEPTION 'Grain kg balance (%) is less than the requested milling amount (%)',
      v_balance_kg, coalesce(_kg_out, 0);
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs)
             AS o(item_id uuid, bags numeric, kg numeric)
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
      WHERE id = r.item_id AND item_class IN ('FINISHED_GOOD', 'BY_PRODUCT') AND is_active
    ) THEN
      RAISE EXCEPTION 'Milling outputs must be FINISHED_GOOD or BY_PRODUCT items';
    END IF;
    v_total_out_bags := v_total_out_bags + coalesce(r.bags, 0);
    v_total_out_kg   := v_total_out_kg + coalesce(r.kg, 0);
  END LOOP;

  v_doc := 'CM-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_service_seq')::text, 4, '0');

  -- صادر الحبوب
  INSERT INTO public.custody_ledger
    (customer_id, warehouse_id, entry_type, item_id, doc_number,
     bags_out, kg_out, notes, created_by)
  VALUES
    (_customer_id, _warehouse_id, 'MILLING', _grain_item_id, v_doc,
     coalesce(_bags_out, 0), coalesce(_kg_out, 0), _notes, v_user);

  -- وارد النواتج: سطر لكل ناتج
  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs)
             AS o(item_id uuid, bags numeric, kg numeric)
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
      'grain_item_id', _grain_item_id,
      'grain_bags', coalesce(_bags_out, 0),
      'grain_kg', coalesce(_kg_out, 0),
      'outputs', _outputs,
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN v_doc;
END $function$;

-- ── 3. التسليم ────────────────────────────────────────────────────────────
-- لا يُسلَّم أكثر مما تبقى عندنا باسم العميل.
CREATE OR REPLACE FUNCTION public.custody_delivery(_customer_id uuid, _warehouse_id uuid, _lines jsonb, _notes text)
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
  v_batch_bags numeric;
  v_batch_kg numeric;
  r record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to record custody deliveries';
  END IF;
  IF _customer_id IS NULL OR _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Customer and warehouse are required';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'At least one delivery line is required';
  END IF;

  -- تحقق مسبق لكل صنف: الرصيد بعد الدفعة كاملة ≥ 0.
  FOR r IN SELECT * FROM jsonb_to_recordset(_lines)
             AS l(item_id uuid, bags numeric, kg numeric)
  LOOP
    IF r.item_id IS NULL THEN
      RAISE EXCEPTION 'Every delivery line needs an item';
    END IF;
    IF coalesce(r.bags, 0) <= 0 AND coalesce(r.kg, 0) <= 0 THEN
      RAISE EXCEPTION 'Every delivery line needs bags or a positive weight';
    END IF;
    IF coalesce(r.bags, 0) < 0 OR coalesce(r.kg, 0) < 0 THEN
      RAISE EXCEPTION 'Delivery quantities cannot be negative';
    END IF;

    SELECT * FROM public.custody_balance(_customer_id, _warehouse_id, r.item_id)
      INTO v_balance_bags, v_balance_kg;

    SELECT coalesce(sum(bags), 0), coalesce(sum(kg), 0)
      INTO v_batch_bags, v_batch_kg
    FROM jsonb_to_recordset(_lines) AS l2(item_id uuid, bags numeric, kg numeric)
    WHERE l2.item_id = r.item_id;

    IF coalesce(r.bags, 0) + (v_batch_bags - coalesce(r.bags, 0)) > v_balance_bags
       OR coalesce(r.bags, 0) > v_balance_bags THEN
      RAISE EXCEPTION 'Bags balance (%) for this item is less than the delivery (%)',
        v_balance_bags, v_batch_bags;
    END IF;
    IF coalesce(r.kg, 0) + (v_batch_kg - coalesce(r.kg, 0)) > v_balance_kg
       OR coalesce(r.kg, 0) > v_balance_kg THEN
      RAISE EXCEPTION 'Kg balance (%) for this item is less than the delivery (%)',
        v_balance_kg, v_batch_kg;
    END IF;
  END LOOP;

  v_doc := 'CD-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_delivery_seq')::text, 4, '0');

  FOR r IN SELECT * FROM jsonb_to_recordset(_lines)
             AS l(item_id uuid, bags numeric, kg numeric)
  LOOP
    INSERT INTO public.custody_ledger
      (customer_id, warehouse_id, entry_type, item_id, doc_number,
       bags_out, kg_out, notes, created_by)
    VALUES
      (_customer_id, _warehouse_id, 'DELIVERY', r.item_id, v_doc,
       coalesce(r.bags, 0), coalesce(r.kg, 0), _notes, v_user);
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'custody.delivery', 'custody_ledger', _customer_id,
    jsonb_build_object(
      'doc_number', v_doc,
      'lines', _lines,
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN v_doc;
END $function$;

-- ── 3ب. تسجيل النواتج من نفس مستند خدمة الطحن ────────────────────────────
CREATE OR REPLACE FUNCTION public.milling_document_process(
  _document_id uuid,
  _grain_item_id uuid,
  _bags_out numeric,
  _kg_out numeric,
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
  v_customer_id uuid;
  v_warehouse_id uuid;
  v_status text;
  v_doc text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to process milling documents';
  END IF;
  SELECT customer_id, warehouse_id, status
    INTO v_customer_id, v_warehouse_id, v_status
  FROM public.milling_service_documents
  WHERE id = _document_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Milling service document does not exist';
  END IF;
  IF v_status = 'DELIVERED' THEN
    RAISE EXCEPTION 'Delivered milling service documents cannot be processed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.custody_ledger
    WHERE milling_document_id = _document_id AND item_id = _grain_item_id
    GROUP BY item_id
    HAVING sum(bags_in - bags_out) >= coalesce(_bags_out, 0)
       AND sum(kg_in - kg_out) >= coalesce(_kg_out, 0)
  ) THEN
    RAISE EXCEPTION 'The selected grain quantity is not available on this milling document';
  END IF;

  v_doc := public.custody_milling(
    v_customer_id, v_warehouse_id, _grain_item_id, _bags_out, _kg_out, _outputs, _notes
  );
  UPDATE public.custody_ledger
  SET milling_document_id = _document_id
  WHERE doc_number = v_doc AND entry_type = 'MILLING';
  UPDATE public.milling_service_documents
  SET status = 'PROCESSED', processed_at = coalesce(processed_at, now())
  WHERE id = _document_id;

  RETURN v_doc;
END $function$;

-- ── 3ج. تسليم من المستند نفسه ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.milling_document_delivery(
  _document_id uuid,
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
  v_customer_id uuid;
  v_warehouse_id uuid;
  v_status text;
  v_doc text;
  v_has_remaining boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to deliver milling documents';
  END IF;
  SELECT customer_id, warehouse_id, status
    INTO v_customer_id, v_warehouse_id, v_status
  FROM public.milling_service_documents
  WHERE id = _document_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Milling service document does not exist';
  END IF;
  IF v_status <> 'PROCESSED' THEN
    RAISE EXCEPTION 'Record milling outputs before delivery';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(coalesce(_lines, '[]'::jsonb)) AS r(item_id uuid, bags numeric, kg numeric)
    LEFT JOIN LATERAL (
      SELECT sum(bags_in - bags_out) AS bags_balance, sum(kg_in - kg_out) AS kg_balance
      FROM public.custody_ledger
      WHERE milling_document_id = _document_id AND item_id = r.item_id
    ) b ON true
    WHERE coalesce(r.bags, 0) < 0 OR coalesce(r.kg, 0) < 0
       OR coalesce(b.bags_balance, 0) < coalesce(r.bags, 0)
       OR coalesce(b.kg_balance, 0) < coalesce(r.kg, 0)
  ) THEN
    RAISE EXCEPTION 'Delivery quantity is not available on this milling document';
  END IF;

  v_doc := public.custody_delivery(v_customer_id, v_warehouse_id, _lines, _notes);
  UPDATE public.custody_ledger
  SET milling_document_id = _document_id
  WHERE doc_number = v_doc AND entry_type = 'DELIVERY';

  SELECT EXISTS (
    SELECT 1
    FROM public.custody_ledger
    WHERE milling_document_id = _document_id
    GROUP BY item_id
    HAVING sum(bags_in - bags_out) > 0 OR sum(kg_in - kg_out) > 0
  ) INTO v_has_remaining;

  IF NOT v_has_remaining THEN
    UPDATE public.milling_service_documents
    SET status = 'DELIVERED', delivered_at = now()
    WHERE id = _document_id;
  END IF;
  RETURN v_doc;
END $function$;

-- ── 4. التعديل الجردي ─────────────────────────────────────────────────────
-- سبب إلزامي. الفرق الموجب وارد والسالب صادر.
CREATE OR REPLACE FUNCTION public.custody_adjustment(_customer_id uuid, _warehouse_id uuid, _item_id uuid, _bags_delta numeric, _kg_delta numeric, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
  v_doc text;
  v_balance_bags numeric;
  v_balance_kg numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to record custody adjustments';
  END IF;
  IF nullif(btrim(coalesce(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for a custody adjustment';
  END IF;
  IF coalesce(_bags_delta, 0) = 0 AND coalesce(_kg_delta, 0) = 0 THEN
    RAISE EXCEPTION 'An adjustment needs a non-zero bags or kg change';
  END IF;

  SELECT * FROM public.custody_balance(_customer_id, _warehouse_id, _item_id)
    INTO v_balance_bags, v_balance_kg;

  IF coalesce(_bags_delta, 0) < 0 AND abs(_bags_delta) > v_balance_bags THEN
    RAISE EXCEPTION 'Bags balance (%) cannot go below zero', v_balance_bags;
  END IF;
  IF coalesce(_kg_delta, 0) < 0 AND abs(_kg_delta) > v_balance_kg THEN
    RAISE EXCEPTION 'Kg balance (%) cannot go below zero', v_balance_kg;
  END IF;

  v_doc := 'CA-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_service_seq')::text, 4, '0');

  INSERT INTO public.custody_ledger
    (customer_id, warehouse_id, entry_type, item_id, doc_number,
     bags_in, bags_out, kg_in, kg_out,
     notes, created_by)
  VALUES
    (_customer_id, _warehouse_id, 'ADJUSTMENT', _item_id, v_doc,
     CASE WHEN coalesce(_bags_delta, 0) > 0 THEN _bags_delta ELSE 0 END,
     CASE WHEN coalesce(_bags_delta, 0) < 0 THEN abs(_bags_delta) ELSE 0 END,
     CASE WHEN coalesce(_kg_delta, 0) > 0 THEN _kg_delta ELSE 0 END,
     CASE WHEN coalesce(_kg_delta, 0) < 0 THEN abs(_kg_delta) ELSE 0 END,
     'سبب التعديل: ' || btrim(_reason), v_user)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'custody.adjustment', 'custody_ledger', v_id,
    jsonb_build_object(
      'doc_number', v_doc,
      'bags_delta', coalesce(_bags_delta, 0),
      'kg_delta', coalesce(_kg_delta, 0),
      'reason', btrim(_reason),
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN v_id;
END $function$;

-- ── 5. فاتورة الأجور: ربط سطر الأمانة بالفاتورة ───────────────────────────
-- الفاتورة نفسها فاتورة مبيعات عادية ببند خدمي واحد (سعره من المنتج).
-- هذه الدالة لا تنشئ الفاتورة — تُنشئها مسارات المبيعات القياسية، ثم يُربط
-- سطر الأمانة المالي بها هنا ليظهر في التبويب المالي للكشف.
CREATE OR REPLACE FUNCTION public.custody_link_invoice(_custody_entry_id uuid, _invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to link custody invoices';
  END IF;
  IF _custody_entry_id IS NULL OR _invoice_id IS NULL THEN
    RAISE EXCEPTION 'Custody entry and invoice are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales_invoices WHERE id = _invoice_id) THEN
    RAISE EXCEPTION 'Invoice does not exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.custody_ledger
    WHERE service_invoice_id = _invoice_id AND id <> _custody_entry_id
  ) THEN
    RAISE EXCEPTION 'This invoice is already linked to another custody entry';
  END IF;

  UPDATE public.custody_ledger
     SET service_invoice_id = _invoice_id
   WHERE id = _custody_entry_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'custody.invoice_linked', 'custody_ledger', _custody_entry_id,
    jsonb_build_object('invoice_id', _invoice_id, 'stock_impact', 'NONE'));
END $function$;

-- ═════════════
-- زر التصنيع الذكي (خطوة 7): من مخزوننا — وارد قمح يُنقص، صادر نواتج تزيد.
-- التكلفة توزّع على النواتج حسب أسعار البيع النسبية (لا نسبة يدوية) حتى لا
-- تُباع بضاعة بربح وهمي وخسارة حقيقية.
-- يُنفَّذ عبر post_stock_delta — بلا أي منظومة إنتاج (ق8).
-- ═════════════════════
CREATE OR REPLACE FUNCTION public.smart_manufacture(_warehouse_id uuid, _grain_item_id uuid, _grain_qty numeric, _outputs jsonb, _notes text)
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
  v_total_allocated numeric := 0;
  v_line_allocated numeric;
  v_line_idx int := 0;
  v_outputs_count int;
  r record;
  v_last_out numeric;
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
    -- قيمة الناتج بسعر البيع = أساس التوزيع النسبي.
    SELECT coalesce(r.qty, 0) * coalesce(sale_price, 0)
      INTO v_last_out
    FROM public.products WHERE id = r.item_id;
    v_output_value := v_output_value + coalesce(v_last_out, 0);
  END LOOP;

  IF v_output_value <= 0 THEN
    RAISE EXCEPTION 'Outputs must have sale prices to allocate cost by relative value';
  END IF;

  -- تكلفة القمح من طبقات التكلفة الفعلية، وإلا من كتالوج التكلفة.
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

  -- 1) صادر القمح (ينقص المخزون — المحرك يرفض لو الرصيد لا يكفي).
  PERFORM public.post_stock_delta(
    _grain_item_id, _warehouse_id, -coalesce(_grain_qty, 0), v_grain_cost,
    'ISSUE'::public.stock_movement_kind, 'smart_manufacture', _grain_item_id,
    'تصنيع ذكي ' || v_ref || coalesce(' — ' || _notes, ''),
    'COMPANY'::public.owner_type, NULL, 'production_out'::public.movement_type);

  -- 2) وارد النواتج بتكلفة موزّعة حسب أسعار البيع النسبية (ح4: تصحيح التراكم).
  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs) AS o(item_id uuid, qty numeric)
  LOOP
    DECLARE
      v_line_value numeric;
      v_unit_cost numeric;
    BEGIN
      v_line_idx := v_line_idx + 1;
      SELECT coalesce(r.qty, 0) * coalesce(sale_price, 0) INTO v_line_value
      FROM public.products WHERE id = r.item_id;

      IF v_line_idx = v_outputs_count THEN
        -- آخر ناتج يحمل المتبقي بالضبط لتطابق إجمالي التكلفة
        v_line_allocated := v_total_input_cost - v_total_allocated;
      ELSE
        v_line_allocated := round(v_total_input_cost * (coalesce(v_line_value, 0) / v_output_value), 2);
        v_total_allocated := v_total_allocated + v_line_allocated;
      END IF;

      v_unit_cost := round(v_line_allocated / coalesce(r.qty, 0), 4);

      PERFORM public.post_stock_delta(
        r.item_id, _warehouse_id, coalesce(r.qty, 0), v_unit_cost,
        'RECEIPT'::public.stock_movement_kind, 'smart_manufacture', _grain_item_id,
        'تصنيع ذكي ' || v_ref || coalesce(' — ' || _notes, ''),
        'COMPANY'::public.owner_type, NULL, 'production_in'::public.movement_type);
    END;
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'manufacture.smart', 'stock_movements', _grain_item_id,
    jsonb_build_object(
      'ref', v_ref,
      'warehouse_id', _warehouse_id,
      'grain_item_id', _grain_item_id,
      'grain_qty', coalesce(_grain_qty, 0),
      'grain_unit_cost', v_grain_cost,
      'outputs', _outputs,
      'allocation', 'RELATIVE_SALES_VALUE'
    ));

  RETURN v_ref;
END $function$;

-- ═════════════════════
-- فاتورة صرف مستهلكات داخلي (خطوة 7 — ق4): تُنقص كميات المستهلكات من مخزن
-- المستهلكات بدقة — نفس أدوات المخزون القياسية، بلا جدول مستهلكات خاص.
-- ═════════════════════
CREATE OR REPLACE FUNCTION public.consume_internal_supplies(_warehouse_id uuid, _lines jsonb, _notes text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_ref text;
  r record;
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

  -- م2: استخدام بادئة CS- (Consumables Supply) لتمييز صرف المستهلكات عن استلام الأمانات CI-
  v_ref := 'CS-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_service_seq')::text, 4, '0');

  FOR r IN SELECT * FROM jsonb_to_recordset(_lines) AS l(item_id uuid, qty numeric)
  LOOP
    PERFORM public.post_stock_delta(
      r.item_id, _warehouse_id, -coalesce(r.qty, 0), NULL,
      'ISSUE'::public.stock_movement_kind, 'internal_consumables', _warehouse_id,
      'صرف مستهلكات داخلي ' || v_ref || coalesce(' — ' || _notes, ''),
      'COMPANY'::public.owner_type, NULL, 'adjustment'::public.movement_type);
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'consumables.issued', 'stock_movements', _warehouse_id,
    jsonb_build_object(
      'ref', v_ref,
      'warehouse_id', _warehouse_id,
      'lines', _lines,
      'notes', _notes
    ));

  RETURN v_ref;
END $function$;

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.custody_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milling_service_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milling_service_documents_read" ON public.milling_service_documents
  FOR SELECT TO authenticated
  USING (public.can_view_milling());

CREATE POLICY "milling_service_documents_service_all" ON public.milling_service_documents
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "custody_ledger_read" ON public.custody_ledger
  FOR SELECT TO authenticated
  USING (public.can_view_milling());

CREATE POLICY "custody_ledger_service_all" ON public.custody_ledger
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- الكتابة عبر RPC فقط (R-23): ممنوع INSERT/UPDATE/DELETE من العميل.
REVOKE INSERT, UPDATE, DELETE ON public.custody_ledger FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.custody_ledger FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.milling_service_documents FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.milling_service_documents FROM anon;
REVOKE ALL ON SEQUENCE public.milling_intake_seq, public.milling_service_seq, public.milling_delivery_seq, public.milling_document_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.milling_intake_seq, public.milling_service_seq, public.milling_delivery_seq, public.milling_document_seq TO service_role;

GRANT SELECT ON public.custody_balances TO authenticated;
GRANT SELECT ON public.custody_balances TO service_role;
GRANT SELECT ON public.milling_service_documents TO authenticated;
GRANT SELECT ON public.milling_service_documents TO service_role;

GRANT EXECUTE ON FUNCTION public.custody_balance(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.custody_balance(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_milling_service_document(uuid, uuid, uuid, numeric, numeric, uuid, numeric, numeric, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_milling_service_document(uuid, uuid, uuid, numeric, numeric, uuid, numeric, numeric, text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.custody_intake(uuid, uuid, uuid, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.custody_intake(uuid, uuid, uuid, numeric, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.custody_milling(uuid, uuid, uuid, numeric, numeric, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.custody_milling(uuid, uuid, uuid, numeric, numeric, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.custody_delivery(uuid, uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.custody_delivery(uuid, uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.milling_document_process(uuid, uuid, numeric, numeric, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.milling_document_process(uuid, uuid, numeric, numeric, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.milling_document_delivery(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.milling_document_delivery(uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.custody_adjustment(uuid, uuid, uuid, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.custody_adjustment(uuid, uuid, uuid, numeric, numeric, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.custody_link_invoice(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.custody_link_invoice(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.smart_manufacture(uuid, uuid, numeric, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.smart_manufacture(uuid, uuid, numeric, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_internal_supplies(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_internal_supplies(uuid, jsonb, text) TO service_role;

-- ============================================================================
-- ROLLBACK:
--   DROP VIEW public.custody_balances;
--   DROP FUNCTION public.custody_intake, custody_milling, custody_delivery,
--                custody_adjustment, custody_link_invoice, custody_balance,
--                smart_manufacture, consume_internal_supplies;
--   DROP TABLE public.milling_service_documents, public.custody_ledger;
--   DROP TYPE public.custody_entry_type;
--   DROP SEQUENCE milling_intake_seq, milling_service_seq, milling_delivery_seq, milling_document_seq;
-- ============================================================================
