-- ============================================================================
-- 9924_phase3_business_date_and_phase4_item_defaults.sql
--
-- المرحلة الثالثة: حرية تحديد تاريخ الكشف والحساب
-- المرحلة الرابعة: ثوابت الأصناف والموردين (مورد افتراضي، موقع افتراضي، وحدة افتراضية)
--
-- القيود المتّبعة:
--   • لا حذف بيانات، لا backfill، لا Reset.
--   • كل عمود جديد nullable أو NOT NULL DEFAULT ⟹ آمن على البيانات القائمة.
--   • الدوال تُعاد تعريفها بنفس التوقيع والإذن السابقين.
--   • لا تغيير في العلاقات القائمة؛ الأعمدة الجديدة مراجع اختيارية.
-- ============================================================================
BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- (1) المرحلة الثالثة — فصل تاريخ المعاملة عن تاريخ الإنشاء
--
--   created_at  : لحظة إنشاء السجل في قاعدة البيانات (لا تتغير أبداً)
--   business_date: تاريخ المعاملة الذي اختاره المستخدم (يُستخدم في التقارير)
--   updated_at  : تاريخ آخر تعديل
--
--   الأعمدة الجديدة nullable: السجلات القديمة تعود إلى created_at عند القراءة
--   عبر الدالة business_date_of()، فلا حاجة لأي backfill.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.sales_invoices
  ADD COLUMN IF NOT EXISTS business_date date;
ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS business_date date;

COMMENT ON COLUMN public.sales_invoices.business_date IS
  'تاريخ المعاملة الذي اختاره المستخدم (كشف يوم سابق). NULL = استخدم created_at.';
COMMENT ON COLUMN public.purchase_invoices.business_date IS
  'تاريخ المعاملة الذي اختاره المستخدم (كشف يوم سابق). NULL = استخدم created_at.';

CREATE INDEX IF NOT EXISTS sales_invoices_business_date_idx
  ON public.sales_invoices (business_date)
  WHERE business_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_invoices_business_date_idx
  ON public.purchase_invoices (business_date)
  WHERE business_date IS NOT NULL;

-- التاريخ الفعلي للمعاملة: business_date إن وُجد، وإلا تاريخ created_at
-- بتوقيت المنشأة (Asia/Aden) لا بتوقيت الخادم.
CREATE OR REPLACE FUNCTION public.business_date_of(
  p_business_date date,
  p_created_at timestamptz
)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT coalesce(
    p_business_date,
    (p_created_at AT TIME ZONE public.business_timezone())::date
  );
$function$;

COMMENT ON FUNCTION public.business_date_of(date, timestamptz) IS
  'تاريخ المعاملة الفعلي: التاريخ المختار يدوياً إن وُجد، وإلا تاريخ الإنشاء بتوقيت المنشأة.';

REVOKE ALL ON FUNCTION public.business_date_of(date, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_date_of(date, timestamptz) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) المرحلة الرابعة — ثوابت الصنف
--
--   default_supplier_id : المورد الافتراضي للصنف (يُقترح عند إضافته للكشف)
--   shelf_location      : موجود مسبقاً في products (موقع الرف/المخزن)
--   default_uom_id      : الوحدة الافتراضية للصنف (إن كان النظام يدعم الوحدات)
--
--   كلها إعدادات افتراضية قابلة للتعديل من شاشة الصنف، ولا تُغيّر أي معاملة
--   سابقة: المعاملات تحتفظ بلقطة قيمها وقت الحفظ.
-- ════════════════════════════════════════════
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS default_supplier_id uuid
    REFERENCES public.suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS default_uom_id uuid
    REFERENCES public.units(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.products.default_supplier_id IS
  'المورد الافتراضي للصنف — يُقترح تلقائياً في كشوف المشتريات، ويمكن تغييره لكل معاملة.';
COMMENT ON COLUMN public.products.default_uom_id IS
  'الوحدة الافتراضية للصنف — تُقترح تلقائياً عند إضافته للكشف، ويمكن تغييرها لكل معاملة.';

CREATE INDEX IF NOT EXISTS products_default_supplier_idx
  ON public.products (default_supplier_id)
  WHERE default_supplier_id IS NOT NULL;

-- ════════════════════════════════════════════
-- (3) منع الموردين المكررين
--
--   المفتاح: الاسم بعد التطبيع (trim + lowercase + توحيد المسافات + إزالة
--   التشكيل العربي). فهرس فريد جزئي على الموردين غير النظاميين فقط، حتى لا
--   يتعارض مع المورد النقدي النظامي.
--
--   لا نحذف أي مورد قائم: إن وُجد تكرار تاريخي يفشل إنشاء الفهرس، ويُترك
--   القرار للمشرف (التقرير يوضح ذلك). لذلك نُنشئ الفهرس داخل كتلة آمنة.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.normalize_party_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          lower(coalesce(p_name, '')),
          '[\u064B-\u0652\u0670\u0640]', '', 'g'   -- تشكيل عربي + تطويل
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$function$;

COMMENT ON FUNCTION public.normalize_party_name(text) IS
  'تطبيع اسم الطرف لمقارنة التكرار: trim + lowercase + توحيد المسافات + إزالة التشكيل.';

REVOKE ALL ON FUNCTION public.normalize_party_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_party_name(text) TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'suppliers_normalized_name_uniq'
  ) THEN
    BEGIN
      CREATE UNIQUE INDEX suppliers_normalized_name_uniq
        ON public.suppliers (public.normalize_party_name(name))
        WHERE is_system = false;
    EXCEPTION WHEN unique_violation THEN
      -- تكرار تاريخي قائم: لا نحذف شيئاً. الفهرس يُنشأ لاحقاً بعد تنظيف
      -- يدوي من المشرف. الحماية على مستوى التطبيق تبقى فعّالة.
      RAISE NOTICE 'suppliers_normalized_name_uniq skipped: existing duplicate supplier names need manual review';
    END;
  END IF;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) create_sale — اعتماد business_date فعلياً
--
--   التوقيع لم يتغير (نفس 9 معاملات). التغيير الوحيد: كتابة business_date
--   صراحةً، وضمان أن v_posted_at يُحسب بتوقيت المنشأة لا بتوقيت الجلسة.
-- ════════════════════════════════════════════
DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.create_sale(uuid,uuid,text,numeric,numeric,text,jsonb,date,jsonb)'::regprocedure
  ) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'create_sale signature not found — check migration order';
  END IF;

  -- 1) حساب لحظة الترحيل بتوقيت المنشأة بدل localtime (توقيت الجلسة).
  v_definition := replace(
    v_definition,
    'v_posted_at := coalesce(_sale_date, current_date)::timestamp + localtime;',
    'v_posted_at := public.business_timestamp(coalesce(_sale_date, public.business_today()), localtime);'
  );

  -- 2) كتابة business_date في رأس الفاتورة.
  v_definition := replace(
    v_definition,
    'subtotal, discount, tax, total, paid, payment_method, note, created_by,
    created_at, updated_at
  )',
    'subtotal, discount, tax, total, paid, payment_method, note, created_by,
    created_at, updated_at, business_date
  )'
  );
  v_definition := replace(
    v_definition,
    'v_recorded_method::public.payment_method, nullif(btrim(_note), ''''), v_user,
    v_posted_at, now()
  )',
    'v_recorded_method::public.payment_method, nullif(btrim(_note), ''''), v_user,
    v_posted_at, now(), coalesce(_sale_date, public.business_today())
  )'
  );

  EXECUTE v_definition;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- (5) create_purchase — إضافة تاريخ المعاملة
--
--   نضيف معاملاً اختيارياً _purchase_date في نهاية التوقيع. المعاملات
--   الاختيارية تحافظ على توافق النداءات القديمة (8 معاملات) عبر overload
--   صريح أدناه.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.create_purchase(uuid,uuid,text,numeric,numeric,text,jsonb,jsonb)'::regprocedure
  ) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'create_purchase signature not found — check migration order';
  END IF;

  -- 1) إضافة المعامل الجديد في نهاية قائمة المعاملات.
  v_definition := replace(
    v_definition,
    '_items jsonb,
  _payment_splits jsonb
)',
    '_items jsonb,
  _payment_splits jsonb,
  _purchase_date date DEFAULT NULL
)'
  );

  -- 2) إضافة متغير لحظة الترحيل.
  v_definition := replace(
    v_definition,
    'v_recorded_method  text := coalesce(_payment_method, ''cash'');',
    'v_recorded_method  text := coalesce(_payment_method, ''cash'');
  v_posted_at        timestamptz;'
  );

  -- 3) حساب لحظة الترحيل بتوقيت المنشأة قبل الإدراج.
  v_definition := replace(
    v_definition,
    'v_invoice_no := public.next_purchase_number();',
    'v_invoice_no := public.next_purchase_number();
  v_posted_at := public.business_timestamp(coalesce(_purchase_date, public.business_today()), localtime);'
  );

  -- 4) كتابة created_at و business_date في رأس الفاتورة.
  v_definition := replace(
    v_definition,
    'subtotal, discount, tax, total, paid, payment_method, note, created_by
  )',
    'subtotal, discount, tax, total, paid, payment_method, note, created_by,
    created_at, updated_at, business_date
  )'
  );
  v_definition := replace(
    v_definition,
    'v_recorded_method::public.payment_method, nullif(btrim(_note), ''''), v_user
  )',
    'v_recorded_method::public.payment_method, nullif(btrim(_note), ''''), v_user,
    v_posted_at, now(), coalesce(_purchase_date, public.business_today())
  )'
  );

  -- 5) مزامنة تواريخ حركات المخزون مع تاريخ المعاملة.
  v_definition := replace(
    v_definition,
    '  PERFORM set_config(''app.payment_split_internal_post'', ''on'', true);
  PERFORM public.post_purchase_invoice(v_invoice_id);',
    '  PERFORM set_config(''app.stock_engine'', ''on'', true);
  UPDATE public.stock_movements
     SET created_at = v_posted_at
   WHERE source_type = ''purchase_invoice'' AND source_id = v_invoice_id;
  PERFORM set_config(''app.stock_engine'', ''off'', true);

  PERFORM set_config(''app.payment_split_internal_post'', ''on'', true);
  PERFORM public.post_purchase_invoice(v_invoice_id);'
  );

  EXECUTE v_definition;
END;
$$;

-- توافق النداءات القديمة (8 معاملات) — تُمرَّر إلى النسخة الجديدة بتاريخ NULL.
CREATE OR REPLACE FUNCTION public.create_purchase(
  _warehouse_id uuid,
  _supplier_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb,
  _payment_splits jsonb
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.create_purchase(
    _warehouse_id, _supplier_id, _payment_method, _paid, _discount,
    _note, _items, _payment_splits, NULL::date
  );
$function$;

REVOKE ALL ON FUNCTION public.create_purchase(uuid,uuid,text,numeric,numeric,text,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase(uuid,uuid,text,numeric,numeric,text,jsonb,jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_purchase(uuid,uuid,text,numeric,numeric,text,jsonb,jsonb,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase(uuid,uuid,text,numeric,numeric,text,jsonb,jsonb,date) TO authenticated, service_role;

-- ════════════════════════════════════════════
-- (6) الترحيل المحاسبي يقرأ business_date
--
--   post_sales_invoice / post_purchase_invoice كانت تستخدم
--   v_inv.created_at::date. نستبدلها بـ business_date_of() حتى يقع القيد في
--   الفترة المالية الصحيحة عند تسجيل كشف بتاريخ سابق.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.post_sales_invoice(uuid)'::regprocedure)
    INTO v_definition;
  IF v_definition IS NOT NULL THEN
    v_definition := replace(
      v_definition,
      'v_inv.created_at::date',
      'public.business_date_of(v_inv.business_date, v_inv.created_at)'
    );
    EXECUTE v_definition;
  END IF;

  SELECT pg_get_functiondef('public.post_purchase_invoice(uuid)'::regprocedure)
    INTO v_definition;
  IF v_definition IS NOT NULL THEN
    v_definition := replace(
      v_definition,
      'v_inv.created_at::date',
      'public.business_date_of(v_inv.business_date, v_inv.created_at)'
    );
    EXECUTE v_definition;
  END IF;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- (7) كشف حساب المورد — تاريخ المعاملة لا تاريخ الإنشاء
-- ════════════════════════════════════════════
CREATE OR REPLACE VIEW public.supplier_ledger_entries AS
SELECT
  pi.id                                   AS id,
  pi.supplier_id                          AS supplier_id,
  'purchase'::text                        AS entry_type,
  pi.total                                AS debit,
  0::numeric                              AS credit,
  public.business_date_of(pi.business_date, pi.created_at) AS occurred_on,
  pi.created_at                           AS created_at,
  pi.invoice_number                       AS reference,
  pi.note                                 AS note
FROM public.purchase_invoices pi
WHERE pi.status NOT IN ('draft'::public.invoice_status, 'cancelled'::public.invoice_status)
UNION ALL
SELECT
  sp.id,
  sp.supplier_id,
  'payment'::text,
  0::numeric,
  sp.amount,
  public.business_date_of(sp.payment_date, sp.created_at),
  sp.created_at,
  sp.voucher_number,
  sp.notes
FROM public.supplier_payments sp;

COMMENT ON VIEW public.supplier_ledger_entries IS
  'حركات المورد بتاريخ المعاملة (business_date) لا تاريخ الإنشاء — مصدر كشف حساب المورد.';

GRANT SELECT ON public.supplier_ledger_entries TO authenticated, service_role;

-- ════════════════════════════════════════════
-- (8) سجل المبيعات والمشتريات — إضافة business_date للتقارير
-- ════════════════════════════════════════════
CREATE OR REPLACE VIEW public.sales_register AS
 SELECT i.id AS invoice_item_id,
    i.invoice_id,
    s.invoice_number,
    s.created_at,
    public.business_date_of(s.business_date, s.created_at) AS business_date,
    s.customer_id,
    s.status,
    s.payment_method,
    i.product_id,
    i.description,
    p.name AS item_name,
    p.name_ar AS item_name_ar,
    p.sku,
    i.quantity,
    i.unit_price,
    i.discount,
    i.tax,
    i.total,
    COALESCE(i.line_type,
        CASE
            WHEN (i.product_id IS NULL) THEN 'AD_HOC_SERVICE'::text
            ELSE item_line_type(i.product_id, false)
        END) AS line_type,
    COALESCE(i.stock_effect, 'NONE'::text) AS stock_effect,
    i.uom_id,
    sales_line_cost(i.product_id, i.invoice_id, i.quantity, i.line_type) AS line_cost
   FROM ((sales_invoice_items i
     JOIN sales_invoices s ON ((s.id = i.invoice_id)))
     LEFT JOIN products p ON ((p.id = i.product_id)));

CREATE OR REPLACE VIEW public.purchase_register AS
 SELECT i.id AS purchase_item_id,
    i.invoice_id,
    s.invoice_number,
    s.created_at,
    public.business_date_of(s.business_date, s.created_at) AS business_date,
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
            ELSE item_line_type(i.product_id, false)
        END) AS line_type,
    COALESCE(i.stock_effect, 'NONE'::text) AS stock_effect,
    (COALESCE(i.stock_effect, 'NONE'::text) = 'STOCK_RECEIPT'::text) AS increases_inventory
   FROM ((purchase_invoice_items i
     JOIN purchase_invoices s ON ((s.id = i.invoice_id)))
     LEFT JOIN products p ON ((p.id = i.product_id)));

-- ════════════════════════════════════════════════════════════════════════════
-- (9) كشف الطحن — تاريخ المعاملة
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.milling_service_documents
  ADD COLUMN IF NOT EXISTS business_date date;

COMMENT ON COLUMN public.milling_service_documents.business_date IS
  'تاريخ كشف الطحن الذي اختاره المستخدم. NULL = تاريخ الإنشاء.';

-- ════════════════════════════════════════════
-- (10) create_milling_service_document_multi — تاريخ المعاملة
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.create_milling_service_document_multi(uuid,uuid,jsonb,uuid,numeric,numeric,text,numeric,text,jsonb)'::regprocedure
  ) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'create_milling_service_document_multi signature not found';
  END IF;

  v_definition := replace(
    v_definition,
    '_notes text,
  _payment_splits jsonb
)',
    '_notes text,
  _payment_splits jsonb,
  _business_date date DEFAULT NULL
)'
  );

  v_definition := replace(
    v_definition,
    'v_recorded_method text := coalesce(_payment_method, ''cash'');',
    'v_recorded_method text := coalesce(_payment_method, ''cash'');
  v_posted_at timestamptz;'
  );

  v_definition := replace(
    v_definition,
    'v_invoice_number := public.next_invoice_number();',
    'v_invoice_number := public.next_invoice_number();
  v_posted_at := public.business_timestamp(coalesce(_business_date, public.business_today()), localtime);'
  );

  v_definition := replace(
    v_definition,
    'subtotal, discount, tax, total, paid, payment_method, note, created_by
  ) VALUES (',
    'subtotal, discount, tax, total, paid, payment_method, note, created_by,
    created_at, updated_at, business_date
  ) VALUES ('
  );
  v_definition := replace(
    v_definition,
    'v_recorded_method::public.payment_method, nullif(btrim(_notes), ''''), v_user
  ) RETURNING id INTO v_invoice_id;',
    'v_recorded_method::public.payment_method, nullif(btrim(_notes), ''''), v_user,
    v_posted_at, now(), coalesce(_business_date, public.business_today())
  ) RETURNING id INTO v_invoice_id;'
  );

  v_definition := replace(
    v_definition,
    'document_number, customer_id, warehouse_id, sales_invoice_id, created_by
  ) VALUES (
    v_document_number, _customer_id, _warehouse_id, v_invoice_id, v_user
  )',
    'document_number, customer_id, warehouse_id, sales_invoice_id, created_by,
    business_date
  ) VALUES (
    v_document_number, _customer_id, _warehouse_id, v_invoice_id, v_user,
    coalesce(_business_date, public.business_today())
  )'
  );

  EXECUTE v_definition;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- (10-b) الغلاف المسعّر يمرّر تاريخ المعاملة إلى الدالة الأساسية
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.create_milling_service_document_multi_priced(uuid,uuid,jsonb,uuid,numeric,numeric,text,numeric,text,jsonb,text,numeric)'::regprocedure
  ) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'create_milling_service_document_multi_priced signature not found';
  END IF;

  v_definition := replace(
    v_definition,
    '  p_billing_basis text,
  p_fee_quantity numeric
)',
    '  p_billing_basis text,
  p_fee_quantity numeric,
  p_business_date date DEFAULT NULL
)'
  );

  v_definition := replace(
    v_definition,
    'v_net, 0, p_payment_method, p_paid, p_notes, coalesce(p_payment_splits, ''[]''::jsonb)
  );',
    'v_net, 0, p_payment_method, p_paid, p_notes, coalesce(p_payment_splits, ''[]''::jsonb),
    p_business_date
  );'
  );

  EXECUTE v_definition;
END;
$$;

-- توافق النداءات القديمة (12 معاملاً للغلاف المسعّر).
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.create_milling_service_document_multi_priced(
    p_customer_id, p_warehouse_id, p_grains, p_service_item_id, p_service_gross,
    p_discount, p_payment_method, p_paid, p_notes, p_payment_splits,
    p_billing_basis, p_fee_quantity, NULL::date
  );
$function$;

REVOKE ALL ON FUNCTION public.create_milling_service_document_multi_priced(uuid,uuid,jsonb,uuid,numeric,numeric,text,numeric,text,jsonb,text,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_milling_service_document_multi_priced(uuid,uuid,jsonb,uuid,numeric,numeric,text,numeric,text,jsonb,text,numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_milling_service_document_multi_priced(uuid,uuid,jsonb,uuid,numeric,numeric,text,numeric,text,jsonb,text,numeric,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_milling_service_document_multi_priced(uuid,uuid,jsonb,uuid,numeric,numeric,text,numeric,text,jsonb,text,numeric,date) TO authenticated, service_role;

-- توافق النداءات القديمة (10 معاملات).
CREATE OR REPLACE FUNCTION public.create_milling_service_document_multi(
  _customer_id uuid,
  _warehouse_id uuid,
  _grains jsonb,
  _service_item_id uuid,
  _service_unit_price numeric,
  _discount numeric,
  _payment_method text,
  _paid numeric,
  _notes text,
  _payment_splits jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.create_milling_service_document_multi(
    _customer_id, _warehouse_id, _grains, _service_item_id, _service_unit_price,
    _discount, _payment_method, _paid, _notes, _payment_splits, NULL::date
  );
$function$;

REVOKE ALL ON FUNCTION public.create_milling_service_document_multi(uuid,uuid,jsonb,uuid,numeric,numeric,text,numeric,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_milling_service_document_multi(uuid,uuid,jsonb,uuid,numeric,numeric,text,numeric,text,jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_milling_service_document_multi(uuid,uuid,jsonb,uuid,numeric,numeric,text,numeric,text,jsonb,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_milling_service_document_multi(uuid,uuid,jsonb,uuid,numeric,numeric,text,numeric,text,jsonb,date) TO authenticated, service_role;

COMMIT;
