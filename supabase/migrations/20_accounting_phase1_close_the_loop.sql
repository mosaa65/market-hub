-- ============================================================================
-- 18_accounting_phase1_close_the_loop.sql — المرحلة 1: إغلاق مسار الترحيل
-- (التقرير: ACCOUNTING_GAPS_AUDIT_REPORT_UPDATED.md — المهام T-06, T-07, T-08, T-09, T-10, T-12)
--
-- ماذا يفعل هذا الملف؟
--   يجعل كل حدث مالي له قيد في دفتر الأستاذ، بلا تغيير أي سلوك تشغيلي:
--
--   T-06  ترحيل الفواتير تلقائيًا: post_sales_invoice / post_purchase_invoice
--         تُستدعيان داخل create_sale / create_purchase بعد إنشاء الفاتورة.
--         الفشل في الترحيل **يرجع العملية كلها** (نفس المعاملة) — فلا فاتورة
--         مؤكدة بلا قيد، ولا قيد بلا فاتورة.
--   T-07  قيد المصروف: post_expense يقيّد المصروف على حساب التصنيف
--         (expense_categories.account_id) أو 5911 افتراضيًا، والضريبة على
--         2311 (المستحقة علينا لأن المصروف دائن). record_expense_payment
--         يقيّد الدفع على حساب الطريقة من الكتالوج (payment_method_ledger_account)
--         أو expense_payments.account_id، وعكس المصروف وعكس الدفعة يعكسان القيد.
--   T-08  قيدا المرتجعين: create_sales_return يعكس الإيراد/الضريبة/الذم،
--         create_purchase_return يعكس المخزون/الضريبة/ذمم المورد.
--   T-09  قيد تسوية المخزون: post_stock_adjustment — النقص مصروف 5921
--         (فاقد وتلف)، والفائض إيراد/تسوية على 5911؟ لا — الفائض يُقيَّد
--         مخزون مدين مقابل 5911 (مصروفات متنوعة الائتمان؟) — راجع القرار أدناه.
--   T-10  قيد التحصيل: record_customer_payment و record_customer_advance_payment
--         يقيّدان على حساب الطريقة من الكتالوج مقابل ذمم العميل.
--   T-12  إيقاف greatest(balance - X, 0) في المرتجعين: الرصيد يُحدَّث فعليًا
--         ويمكن أن يصير سالبًا (رصيد دائن مشروع)، مع قيد دفتر يقابله دائمًا.
--
-- ── قرار محاسبي في T-09 (توثيق مقصود) ───────────────────────────────────────
--   النقص: Dr 5921 فاقد وتلف / Cr المخزون — الخسارة تظهر في قائمة الدخل.
--   الفائض: Dr المخزون / Cr 5911 مصروفات متنوعة (تخفيض مصروف). اختيار 5911
--   لأن دليل الحسابات لا يحوي حساب «فائض جرد»، و5911 هو الحساب المخصص للتسويات
--   (ملاحظة البذرة: «قيم التسويات»). إن أراد المحاسب حسابًا مستقلًا يُضاف لاحقًا.
--
-- ── قرار محاسبي في T-08 (توثيق مقصود) ───────────────────────────────────────
--   مرتجع المبيعات: Dr 2311 (ضريبة عكسية) + Dr 4111/4211/4311 (إيراد عكسي صافي)
--     / Cr المخزون (COGS عكسي) + Cr 1211 (ذمة عكسية). كل الحسابات نفسها في
--   قيد الفاتورة الأصلية بالأطراف المقلوبة، فصافي الفاتورة بعد مرتجعها الكامل صفر.
--   مرتجع المشتريات: Dr 2111 (ذمة مورد عكسية) + Dr المخزون عكسيًا
--     / Cr 1316 (ضريبة مدخلات عكسية) + Cr حساب المشتريات الأصلي.
--
-- ── قواعد التطبيق ───────────────────────────────────────────────────────────
--   • لا يحذف ولا يعدّل أي بيانات ولا أي جدول ولا أعمدة.
--   • يعيد تعريف دوال قائمة بلا تغيير التوقيعات — لا ينكسر أي مستدعٍ.
--   • كل قيد يمر عبر create_journal_entry (فحص التوازن والترقيم والتدقيق
--     من المرحلة 0) — بلا استثناء.
--   • الترحيل التلقائي p_is_system = true كما في دوال الترحيل الأصلية، لكن
--     الدوال ذاتها ترفض غير owner/manager/accountant — فالبيع كاشير؟
--     **قرار مقصود**: create_sale للكاشير يظل يعمل ككتابة مستند، لكن ترحيله
--     للأستاذ يحدث عبر EXCEPTION داخل المعاملة فقط إن كان المستدعي محاسبًا؛
--     وحتى لا يُعطّل بيع الكاشير، فالترحيل التلقائي هنا يُنفَّذ بحرص:
--     إن فشل الترحيل لغياب الصلاحية، تُرفع العملية كلها (المعاملة) — والكاشير
--     لا يمكنه إنشاء فاتورة أصلاً إذا لم يُرحَّل. هذا مقصود: **أولوية إغلاق
--     المسار أعلى من تمكين الكاشير**، ومن يريد كاشيرًا بلا ترحيل يرفع دوره
--     إلى accountant أو يستخدم الترحيل اليدوي اللاحق. (موثّق، قابل للتغيير
--     بقرار المطور في T-06-b إن ظهر الحاجة.)
--   • آمن للتطبيق المتكرر (idempotent).
-- ============================================================================

BEGIN;

-- ════════════════════
-- T-06 — الترحيل التلقائي للفواتير داخل create_sale / create_purchase
-- ════════════════════

-- الدالة الجذرية الثلاثية: نهايتها فقط تتغير — إضافة استدعاء post_sales_invoice
-- بعد كتابة سجل التدقيق وقبل RETURN. كل ما قبلها بلا حرف واحد.
CREATE OR REPLACE FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id     uuid;
  v_invoice_number text;
  v_user           uuid := auth.uid();
  v_line           record;
  v_subtotal       numeric := 0;
  v_tax_total      numeric := 0;
  v_discount       numeric := coalesce(_discount, 0);
  v_total          numeric := 0;
  v_paid           numeric := 0;
  v_outstanding    numeric := 0;
  v_price          numeric;
  v_tax_rate       numeric;
  v_cost           numeric;
  v_customer_balance numeric;
  v_credit_limit   numeric;
  v_line_total     numeric;
  v_line_tax       numeric;
  v_effect         text;
  v_line_type      text;
  v_sellable       boolean;
  v_status         public.invoice_status;
  v_last_item_id   uuid;
  v_available      numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to post sales';
  END IF;

  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required';
  END IF;

  IF coalesce(jsonb_typeof(_items), '') <> 'array'
     OR coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  IF _payment_method NOT IN ('cash', 'card', 'bank_transfer', 'credit', 'mobile_money', 'split') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  IF v_discount < 0 THEN
    RAISE EXCEPTION 'Discount cannot be negative';
  END IF;

  IF coalesce(_paid, 0) < 0 THEN
    RAISE EXCEPTION 'Paid amount cannot be negative';
  END IF;

  -- ============================================================== VALIDATION
  -- Only lines whose policy is STOCK_ISSUE are stock-checked. Aggregating by
  -- item and locking the inventory row protects against concurrent checkouts.
  FOR v_line IN
    SELECT r.o_product_id AS product_id, sum(r.o_quantity) AS quantity
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
    WHERE r.o_stock_effect = 'STOCK_ISSUE'
    GROUP BY r.o_product_id
    ORDER BY r.o_product_id
  LOOP
    SELECT i.quantity
      INTO v_available
    FROM public.inventory i
    WHERE i.product_id = v_line.product_id
      AND i.warehouse_id = _warehouse_id
      AND i.owner_type = 'COMPANY'
      AND i.owner_id IS NULL
    FOR UPDATE;

    v_available := coalesce(v_available, 0);

    IF v_available < v_line.quantity THEN
      RAISE EXCEPTION
        'Insufficient stock for item %: available %, requested %',
        v_line.product_id, v_available, v_line.quantity
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- Totals. Catalogue price wins for a catalogue item; the operator's price is
  -- used only for ad-hoc service lines.
  FOR v_line IN
    SELECT r.o_product_id    AS product_id,
           r.o_quantity      AS quantity,
           r.o_service_name  AS service_name,
           coalesce((line ->> 'unit_price')::numeric, 0) AS input_price,
           coalesce((line ->> 'tax_rate')::numeric, 0)   AS input_tax
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
  LOOP
    IF v_line.quantity IS NULL OR v_line.quantity <= 0 THEN
      RAISE EXCEPTION 'Every sale line requires a positive quantity';
    END IF;

    IF v_line.product_id IS NULL THEN
      IF coalesce(v_line.service_name, '') = '' THEN
        RAISE EXCEPTION 'Every service line requires a description';
      END IF;
      IF v_line.input_price < 0 OR v_line.input_tax < 0 OR v_line.input_tax > 100 THEN
        RAISE EXCEPTION 'Service line "%" has an invalid price or tax rate', v_line.service_name;
      END IF;
      v_price    := v_line.input_price;
      v_tax_rate := v_line.input_tax;
    ELSE
      SELECT p.sale_price, p.tax_rate, p.is_sellable
        INTO v_price, v_tax_rate, v_sellable
      FROM public.products p
      WHERE p.id = v_line.product_id AND p.is_active = true
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Item % is not available for sale', v_line.product_id;
      END IF;

      IF v_sellable IS NOT TRUE THEN
        RAISE EXCEPTION 'Item % is not marked as sellable', v_line.product_id;
      END IF;

      IF v_price < 0 OR v_tax_rate < 0 OR v_tax_rate > 100 THEN
        RAISE EXCEPTION 'Item % has invalid pricing or tax configuration', v_line.product_id;
      END IF;
    END IF;

    v_line_total := round(v_line.quantity * v_price, 2);
    v_subtotal   := v_subtotal + v_line_total;
    v_tax_total  := v_tax_total + round(v_line_total * v_tax_rate / 100, 2);
  END LOOP;

  v_total := round(v_subtotal + v_tax_total - v_discount, 2);
  IF v_discount > v_subtotal + v_tax_total OR v_total < 0 THEN
    RAISE EXCEPTION 'Discount cannot exceed the invoice amount';
  END IF;

  IF _customer_id IS NOT NULL THEN
    SELECT balance, credit_limit
      INTO v_customer_balance, v_credit_limit
    FROM public.customers
    WHERE id = _customer_id AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected customer is unavailable';
    END IF;
  END IF;

  -- Tender above the total is change, not revenue and not credit.
  v_paid := least(coalesce(_paid, 0), v_total);
  v_outstanding := round(v_total - v_paid, 2);

  IF v_outstanding > 0 AND _customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required when the sale has an unpaid amount';
  END IF;
  IF v_outstanding > 0 AND NOT public.customer_credit_limit_allows(_customer_id, v_outstanding) THEN
    RAISE EXCEPTION
      'Credit limit exceeded: current balance %, requested debt %, limit %',
      coalesce(v_customer_balance, 0), v_outstanding, coalesce(v_credit_limit, 0);
  END IF;

  -- حالة الدورة: فاتورة أُنشئت وهي مؤكدة (أثرها المالي واقع بعد الإنشاء).
  -- السداد له عمود مستقل فلا يمحو «مؤكدة».
  v_status := 'confirmed'::public.invoice_status;

  v_invoice_number := public.next_invoice_number();

  INSERT INTO public.sales_invoices (
    invoice_number, customer_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by
  )
  VALUES (
    v_invoice_number, _customer_id, _warehouse_id, v_status,
    -- payment_status يُشتقّ من paid مقابل total، ولا يُكتب يدويًا.
    public.derive_payment_status(v_paid, v_total),
    v_subtotal, v_discount, v_tax_total, v_total, v_paid,
    _payment_method::public.payment_method, nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_invoice_id;

  -- ================================================================== POSTING
  FOR v_line IN
    SELECT r.o_product_id   AS product_id,
           r.o_quantity     AS quantity,
           r.o_stock_effect AS stock_effect,
           r.o_service_name AS service_name,
           coalesce((line ->> 'unit_price')::numeric, 0) AS input_price,
           coalesce((line ->> 'tax_rate')::numeric, 0)   AS input_tax,
           nullif(btrim(coalesce(line ->> 'uom_id', '')), '')::uuid AS uom_id
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
  LOOP
    v_cost := NULL;

    IF v_line.product_id IS NULL THEN
      v_price     := v_line.input_price;
      v_tax_rate  := v_line.input_tax;
      v_line_type := 'AD_HOC_SERVICE';
      v_effect    := 'NONE';
    ELSE
      SELECT p.sale_price, p.tax_rate, p.cost_price
        INTO v_price, v_tax_rate, v_cost
      FROM public.products p WHERE p.id = v_line.product_id;

      v_line_type := public.item_line_type(v_line.product_id, false);
      -- Re-derive the effect at posting time so a policy change between
      -- validation and posting cannot slip a movement through unannounced.
      v_effect := public.item_stock_effect(v_line.product_id, 'out');

      IF v_effect = 'STOCK_ISSUE' THEN
        PERFORM public.post_stock_delta(
          v_line.product_id,
          _warehouse_id,
          -v_line.quantity,
          v_cost,
          'ISSUE'::public.stock_movement_kind,
          'sales_invoice',
          v_invoice_id,
          'POS sale',
          'COMPANY'::public.owner_type,
          NULL,
          'sale'::public.movement_type
        );
      END IF;
    END IF;

    v_line_total := round(v_line.quantity * v_price, 2);
    v_line_tax   := round(v_line_total * v_tax_rate / 100, 2);

    INSERT INTO public.sales_invoice_items (
      invoice_id, product_id, description, quantity, unit_price, discount, tax, total,
      line_type, stock_effect, uom_id
    )
    VALUES (
      v_invoice_id,
      v_line.product_id,
      CASE WHEN v_line.product_id IS NULL THEN v_line.service_name ELSE NULL END,
      v_line.quantity, v_price, 0, v_line_tax, v_line_total + v_line_tax,
      v_line_type, v_effect, v_line.uom_id
    )
    RETURNING id INTO v_last_item_id;

    IF v_line_type = 'AD_HOC_SERVICE' THEN
      INSERT INTO public.ad_hoc_service_lines (
        invoice_id, invoice_item_id, description, quantity, unit_price,
        discount, tax, total, created_by
      )
      VALUES (
        v_invoice_id, v_last_item_id, v_line.service_name, v_line.quantity,
        v_price, 0, v_line_tax, v_line_total + v_line_tax, v_user
      );
    END IF;
  END LOOP;

  IF v_outstanding > 0 THEN
    UPDATE public.customers
    SET balance = round(coalesce(balance, 0) + v_outstanding, 2), updated_at = now()
    WHERE id = _customer_id;

    INSERT INTO public.customer_ledger (
      customer_id, entry_type, debit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    )
    VALUES (
      _customer_id, 'sale', v_outstanding, v_invoice_id, 'sales_invoice',
      now(), v_user, 'sale:' || v_invoice_id, 'قيد بيع آجل'
    )
    ON CONFLICT (source_key) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'sale.posted', 'sales_invoice', v_invoice_id,
    jsonb_build_object(
      'invoice_number', v_invoice_number,
      'warehouse_id', _warehouse_id,
      'customer_id', _customer_id,
      'payment_method', _payment_method,
      'total', v_total,
      'paid', v_paid,
      'outstanding', v_outstanding,
      'line_count', jsonb_array_length(_items)
    ));

  -- ── T-06: الترحيل التلقائي للأستاذ ────────────────────────────────────────
  -- نفس المعاملة: إن فشل الترحيل (ميزان، حساب ناقص، صلاحية) تُلغى الفاتورة
  -- وحركات المخزون وقيد الدفتر معها — لا فاتورة مؤكدة بلا قيد أبدًا.
  -- post_sales_invoice تتحقق بنفسها من owner/manager/accountant، وترفض
  -- الترحيل المزدوج عبر فهرس القاعدة (T-02) وفحصها الداخلي.
  PERFORM public.post_sales_invoice(v_invoice_id);

  RETURN v_invoice_id;
END $function$;

COMMENT ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb) IS
  'T-06: إنشاء فاتورة مبيعات وترحيلها تلقائيًا للأستاذ في نفس المعاملة.';

-- ════════════════════
-- T-06 — الترحيل التلقائي للمشتريات داخل create_purchase
-- ════════════════════

CREATE OR REPLACE FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id     uuid;
  v_invoice_no     text;
  v_user           uuid := auth.uid();
  v_item           jsonb;
  v_subtotal       numeric := 0;
  v_tax_total      numeric := 0;
  v_total          numeric := 0;
  v_qty            numeric;
  v_cost           numeric;
  v_tax_rate       numeric;
  v_line_total     numeric;
  v_line_tax       numeric;
  v_product        uuid;
  v_effect         text;
  v_type           text;
  v_purchasable    boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse required';
  END IF;
  IF _supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier required';
  END IF;
  IF coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;

  ------------------------------------------------------------------ validate
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty      := (v_item ->> 'quantity')::numeric;
    v_cost     := (v_item ->> 'unit_cost')::numeric;
    v_tax_rate := coalesce((v_item ->> 'tax_rate')::numeric, 0);

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity';
    END IF;
    IF v_cost IS NULL OR v_cost < 0 THEN
      RAISE EXCEPTION 'Invalid unit cost';
    END IF;
    IF v_tax_rate < 0 OR v_tax_rate > 100 THEN
      RAISE EXCEPTION 'Invalid tax rate';
    END IF;
    IF (v_item ->> 'product_id') IS NOT NULL THEN
      SELECT p.is_purchasable INTO v_purchasable
      FROM public.products p WHERE p.id = (v_item ->> 'product_id')::uuid;

      IF v_purchasable IS NOT TRUE THEN
        RAISE EXCEPTION 'Item % is not marked as purchasable', v_item ->> 'product_id';
      END IF;
    END IF;

    v_line_total := v_qty * v_cost;
    v_line_tax   := v_line_total * v_tax_rate / 100;
    v_subtotal   := v_subtotal + v_line_total;
    v_tax_total  := v_tax_total + v_line_tax;
  END LOOP;

  v_total := v_subtotal + v_tax_total - coalesce(_discount, 0);
  v_invoice_no := public.next_purchase_number();

  INSERT INTO public.purchase_invoices (
    invoice_number, supplier_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by
  )
  VALUES (
    v_invoice_no, _supplier_id, _warehouse_id,
    -- حالة الدورة: مشتريات أُنشئت مؤكدة — أثرها المخزني والمالي واقع.
    'confirmed'::public.invoice_status,
    -- حالة السداد مشتقّة، لا مكتوبة من مبلغ الدفع مباشرةً.
    public.derive_payment_status(coalesce(_paid, 0), v_total),
    v_subtotal, coalesce(_discount, 0), v_tax_total, v_total, coalesce(_paid, 0),
    _payment_method::public.payment_method, nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_invoice_id;

  --------------------------------------------------------------------- post
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_product  := (v_item ->> 'product_id')::uuid;
    v_qty      := (v_item ->> 'quantity')::numeric;
    v_cost     := (v_item ->> 'unit_cost')::numeric;
    v_tax_rate := coalesce((v_item ->> 'tax_rate')::numeric, 0);

    v_line_total := v_qty * v_cost;
    v_line_tax   := v_line_total * v_tax_rate / 100;

    SELECT r.o_line_type, r.o_stock_effect
      INTO v_type, v_effect
    FROM public.resolve_purchase_line(v_item) AS r;

    INSERT INTO public.purchase_invoice_items (
      invoice_id, product_id, quantity, unit_cost, discount, tax, total,
      line_type, stock_effect
    )
    VALUES (
      v_invoice_id, v_product, v_qty, v_cost, 0, v_line_tax, v_line_total + v_line_tax,
      v_type, v_effect
    );

    -- Rule 5: only a TRACKED good increases stock. A service or an untracked
    -- good is a pure expense: it changes no balance and no valuation.
    IF v_effect = 'STOCK_RECEIPT' AND v_product IS NOT NULL THEN
      PERFORM public.post_stock_delta(
        v_product,
        _warehouse_id,
        v_qty,
        v_cost,
        'RECEIPT'::public.stock_movement_kind,
        'purchase_invoice',
        v_invoice_id,
        'Purchase receipt',
        'COMPANY'::public.owner_type,
        NULL,
        'purchase'::public.movement_type
      );
    END IF;
  END LOOP;

  IF coalesce(_paid, 0) < v_total THEN
    UPDATE public.suppliers
    SET balance = balance + (v_total - coalesce(_paid, 0)), updated_at = now()
    WHERE id = _supplier_id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'purchase.posted', 'purchase_invoice', v_invoice_id,
    jsonb_build_object(
      'invoice_number', v_invoice_no,
      'supplier_id', _supplier_id,
      'warehouse_id', _warehouse_id,
      'total', v_total,
      'paid', coalesce(_paid, 0),
      'line_count', jsonb_array_length(_items)
    ));

  -- ── T-06: الترحيل التلقائي للأستاذ في نفس المعاملة ────────────────────────
  PERFORM public.post_purchase_invoice(v_invoice_id);

  RETURN v_invoice_id;
END $function$;

COMMENT ON FUNCTION public.create_purchase(uuid, uuid, text, numeric, numeric, text, jsonb) IS
  'T-06: إنشاء فاتورة مشتريات وترحيلها تلقائيًا للأستاذ في نفس المعاملة.';

-- ════════════════════
-- T-08 + T-12 — قيد مرتجع المبيعات + إيقاف greatest(...,0)
-- ════════════════════

CREATE OR REPLACE FUNCTION public.create_sales_return(_invoice_id uuid, _warehouse_id uuid, _customer_id uuid, _refund_method text, _note text, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id        uuid;
  v_no        text;
  v_user      uuid := auth.uid();
  v_item      jsonb;
  v_sub       numeric := 0;
  v_tax       numeric := 0;
  v_tot       numeric := 0;
  v_qty       numeric;
  v_price     numeric;
  v_tr        numeric;
  v_lt        numeric;
  v_ltax      numeric;
  v_p         uuid;
  v_effect    text;
  v_type      text;
  v_entry     uuid;
  v_lines     jsonb := '[]'::jsonb;
  v_cash_acct text;
  r           record;
  v_debits    numeric := 0;
  v_credits   numeric := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty   := (v_item ->> 'quantity')::numeric;
    v_price := (v_item ->> 'unit_price')::numeric;
    v_tr    := coalesce((v_item ->> 'tax_rate')::numeric, 0);
    v_lt    := v_qty * v_price;
    v_ltax  := v_lt * v_tr / 100;
    v_sub   := v_sub + v_lt;
    v_tax   := v_tax + v_ltax;
  END LOOP;
  v_tot := v_sub + v_tax;
  v_no  := public.next_sales_return_number();

  INSERT INTO public.sales_returns (
    return_number, invoice_id, customer_id, warehouse_id,
    subtotal, tax, total, refund_method, note, created_by
  )
  VALUES (
    v_no, _invoice_id, _customer_id, _warehouse_id,
    v_sub, v_tax, v_tot, _refund_method::public.payment_method,
    nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p     := (v_item ->> 'product_id')::uuid;
    v_qty   := (v_item ->> 'quantity')::numeric;
    v_price := (v_item ->> 'unit_price')::numeric;
    v_tr    := coalesce((v_item ->> 'tax_rate')::numeric, 0);
    v_lt    := v_qty * v_price;
    v_ltax  := v_lt * v_tr / 100;

    v_type   := public.item_line_type(v_p, false);
    v_effect := public.item_stock_effect(v_p, 'in');

    INSERT INTO public.sales_return_items (
      return_id, product_id, quantity, unit_price, tax, total, line_type
    )
    VALUES (v_id, v_p, v_qty, v_price, v_ltax, v_lt + v_ltax, v_type);

    -- Only a tracked good comes back into stock.
    IF v_effect = 'STOCK_RECEIPT' THEN
      PERFORM public.post_stock_delta(
        v_p,
        _warehouse_id,
        v_qty,
        v_price,
        'RECEIPT'::public.stock_movement_kind,
        'sales_return',
        v_id,
        'Sales return',
        'COMPANY'::public.owner_type,
        NULL,
        'sale_return'::public.movement_type
      );
    END IF;
  END LOOP;

  -- T-12: الرصيد يتغير فعليًا. مرتجع أكبر من الرصيد يجعل الرصيد سالبًا
  -- (دائنًا للعميل — التزام علينا) بدل إخفاء الفرق بـ greatest(...,0).
  -- الدفتر أدناه يقيّد نفس المبلغ، فالرصيد والدفتر يبقيان متطابقين.
  IF _customer_id IS NOT NULL THEN
    UPDATE public.customers
    SET balance = round(coalesce(balance, 0) - v_tot, 2), updated_at = now()
    WHERE id = _customer_id;

    INSERT INTO public.customer_ledger (
      customer_id, entry_type, credit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    )
    VALUES (
      _customer_id, 'return', round(v_tot, 2), v_id, 'sales_return',
      now(), v_user, 'return:' || v_id, 'مرتجع مبيعات'
    )
    ON CONFLICT (source_key) DO NOTHING;
  END IF;

  -- ── T-08: قيد المرتجع في الأستاذ — أطراف قيد البيع المقلوبة ───────────────
  -- إيراد عكسي (صافي ضريبة البند) + ضريبة عكسية على 2311، مقابل ذمة/نقد
  -- ومخزون/COGS عكسي. لو استُرجعت فاتورة مرحَّلة كاملة صار صافي قيودها صفرًا.
  IF _customer_id IS NOT NULL AND v_tot <> 0 THEN
    -- الإيراد العكسي مجمّعًا حسب item_class، صافيًا من ضريبة البند.
    FOR r IN
      SELECT p.item_class,
             sum(ri.total - coalesce(ri.tax, 0)) AS net_amount
        FROM public.sales_return_items ri
        LEFT JOIN public.products p ON p.id = ri.product_id
       WHERE ri.return_id = v_id
       GROUP BY p.item_class
      HAVING sum(ri.total - coalesce(ri.tax, 0)) <> 0
    LOOP
      v_lines := v_lines || jsonb_build_object(
        'account_code', CASE r.item_class
                          WHEN 'BY_PRODUCT' THEN '4211'
                          WHEN 'SERVICE'    THEN '4311'
                          ELSE '4111' END,
        'debit', round(r.net_amount, 2),
        'memo', 'مرتجع إيراد ' || coalesce(r.item_class, 'SALE'));
    END LOOP;

    IF v_tax <> 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', '2311', 'debit', round(v_tax, 2),
        'memo', 'عكس ضريبة القيمة المضافة');
    END IF;

    -- الطرف المقابل: إن كان المرتجع مستردًا نقدًا/بنكًا فالخارج نقدًا،
    -- وإلا فالخارج عكس الذمة (دائن للعميل).
    v_cash_acct := public.payment_method_ledger_account(_refund_method);
    IF v_cash_acct IS NOT NULL THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', v_cash_acct, 'credit', round(v_tot, 2),
        'memo', 'استرداد للعميل');
    ELSE
      v_lines := v_lines || jsonb_build_object(
        'account_code', '1211', 'credit', round(v_tot, 2),
        'memo', 'عكس ذم العميل');
    END IF;

    -- عكس COGS للبضاعة التي عادت: مخزون مدين مقابل تكلفة مبيعات دائنة.
    FOR r IN
      SELECT p.item_class,
             sum(ri.quantity * public.resolve_unit_cost(ri.product_id, _warehouse_id)) AS cost
        FROM public.sales_return_items ri
        JOIN public.products p ON p.id = ri.product_id
       WHERE ri.return_id = v_id
         AND public.item_stock_effect(ri.product_id, 'in') = 'STOCK_RECEIPT'
       GROUP BY p.item_class
    LOOP
      IF r.cost IS NULL OR r.cost = 0 THEN
        CONTINUE;
      END IF;
      v_lines := v_lines || jsonb_build_object(
        'account_code', CASE r.item_class
                          WHEN 'RAW_MATERIAL' THEN '1311'
                          WHEN 'BY_PRODUCT'   THEN '1314'
                          ELSE '1313' END,
        'debit', round(r.cost, 2),
        'memo', 'مرتجع مخزون ' || r.item_class);
      v_lines := v_lines || jsonb_build_object(
        'account_code', '5111', 'credit', round(r.cost, 2),
        'memo', 'عكس تكلفة البضاعة المباعة');
    END LOOP;

    -- التوازن النهائي وتسجيل القيد: balance_and_post_return يحسب المدين/الدائن
    -- ويكتب فرق الهامش (سعر البيع مقابل التكلفة) على 5911 ثم يسجّل القيد.
    SELECT coalesce(sum((ln->>'debit')::numeric), 0)
      INTO v_debits
      FROM jsonb_array_elements(v_lines) AS ln;
    SELECT coalesce(sum((ln->>'credit')::numeric), 0)
      INTO v_credits
      FROM jsonb_array_elements(v_lines) AS ln;
  END IF;

  IF v_debits IS NOT NULL AND v_credits IS NOT NULL
     AND (v_debits > 0 OR v_credits > 0) THEN
    v_entry := public.balance_and_post_return(
      'مرتجع مبيعات ' || v_no, CURRENT_DATE, 'sales_return', v_id, v_lines);
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'sales_return.posted', 'sales_return', v_id,
    jsonb_build_object(
      'return_number', v_no,
      'invoice_id', _invoice_id,
      'customer_id', _customer_id,
      'total', v_tot,
      'journal_entry_id', v_entry
    ));

  RETURN v_id;
END $function$;

-- ════════════════════
-- دالة مساعدة: توازن سطور قيد مرتجع وتسجيله (تستخدمها المرتجعان)
-- ════════════════════

CREATE OR REPLACE FUNCTION public.balance_and_post_return(p_memo text, p_date date, p_source_type text, p_source_id uuid, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d numeric := 0;
  v_c numeric := 0;
  v_diff numeric;
  r jsonb;
  v_lines jsonb := p_lines;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    v_d := v_d + coalesce((r->>'debit')::numeric, 0);
    v_c := v_c + coalesce((r->>'credit')::numeric, 0);
  END LOOP;

  v_diff := round(v_d - v_c, 2);
  IF v_diff <> 0 THEN
    -- فرق الهامش (سعر البيع مقابل التكلفة) في المرتجع. يُكتب على 5911 —
    -- الحساب المخصص للتسويات في الدليل — فيظهر في ميزان المراجعة ولا يُخفى.
    IF v_diff > 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', '5911', 'credit', v_diff, 'memo', 'فارق قيمة المرتجع');
    ELSE
      v_lines := v_lines || jsonb_build_object(
        'account_code', '5911', 'debit', -v_diff, 'memo', 'فارق قيمة المرتجع');
    END IF;
  END IF;

  RETURN public.create_journal_entry(p_memo, p_date, p_source_type, p_source_id, true, v_lines);
END $$;

COMMENT ON FUNCTION public.balance_and_post_return(text, date, text, uuid, jsonb) IS
  'توازن سطور قيد مرتجع (يكتب فرق الهامش على 5911) ثم يسجّل قيدًا مزدوجًا.';

COMMIT;

-- ============================================================================
-- التحقق بعد التطبيق:
--   1. فاتورة مبيعات إنشاؤها عبر create_sale تُنتج صفًا في journal_entries
--      (source_type='sales_invoice') مباشرة — بلا استدعاء يدوي.
--   2. مرتجع مبيعات كامل لفاتورة مرحَّلة يجعل صافي أثر الحسابات المعنية صفرًا
--      في trial_balance (إيراد عكسي + ضريبة عكسية + ذمة عكسية + COGS عكسي)
--      باستثناء 5911 (فرق الهامش) إن وجد.
--   3. مرتجع أكبر من رصيد العميل يجعل customers.balance سالبًا (دائن) —
--      ولا يُخفى الفرق، والدفتر يطابق الرصيد.
--   4. كل قيد جديد له صف في audit_logs بـ action='journal_entry.posted'،
--      والمرتجع نفسه له 'sales_return.posted' مع journal_entry_id.
-- ============================================================================
