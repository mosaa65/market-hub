-- Migration 64: دعم الدفع المجزأ (أكثر من طريقة) والترحيل المحاسبي المتوازن
-- Multi-tender Split Payment & Balanced Ledger Posting Support

BEGIN;

-- ── 1. ترقية دالة ترحيل فواتير المبيعات post_sales_invoice لدعم التجزئة المحاسبية ──

CREATE OR REPLACE FUNCTION public.post_sales_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_inv     record;
  v_existing uuid;
  v_entry   uuid;
  v_lines   jsonb := '[]'::jsonb;
  v_cash_acct text;
  v_split_acct text;
  v_collectable numeric := 0;
  v_split_total numeric := 0;
  v_service_total numeric := 0;
  v_cost    record;
  r         record;
  r_split   record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
          OR public.has_role(v_user,'accountant') OR
          (public.has_role(v_user,'cashier') AND
           current_setting('app.payment_split_internal_post', true) = 'on')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may post an invoice';
  END IF;

  SELECT * INTO v_inv FROM public.sales_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_inv.status IN ('draft','cancelled') THEN
    RAISE EXCEPTION 'Invoice % is % - only confirmed, paid or partial invoices post',
      v_inv.invoice_number, v_inv.status;
  END IF;

  IF v_inv.paid < 0 THEN
    RAISE EXCEPTION 'Invoice % carries a negative payment (%). A refund is a credit note, not a negative payment.',
      v_inv.invoice_number, v_inv.paid;
  END IF;
  IF v_inv.paid > v_inv.total THEN
    RAISE EXCEPTION 'Invoice % was paid % against a total of %. Fix the invoice before posting - a payment cannot exceed the invoice.',
      v_inv.invoice_number, v_inv.paid, v_inv.total;
  END IF;
  IF v_inv.tax < 0 THEN
    RAISE EXCEPTION 'Invoice % carries a negative tax amount', v_inv.invoice_number;
  END IF;

  SELECT id INTO v_existing
    FROM public.journal_entries
   WHERE source_type = 'sales_invoice' AND source_id = p_invoice_id
     AND status <> 'REVERSED';
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice % has already been posted to the ledger', v_inv.invoice_number;
  END IF;

  -- حل حساب التسوية المفرد
  v_cash_acct := public.resolve_document_settlement_account(
    v_inv.payment_method::text,
    v_inv.cashbox_id,
    v_inv.bank_account_id,
    v_inv.payment_method_id
  );
  v_collectable := greatest(v_inv.total - v_inv.paid, 0);

  -- ── الإيراد دائن: بند مُصنَّف حسب item_class ──
  FOR r IN
    SELECT coalesce(p.item_class::text, 'UNCLASSIFIED') AS bucket, sum(it.total) AS amount
      FROM public.sales_invoice_items it
      LEFT JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
       AND it.product_id IS NOT NULL
     GROUP BY coalesce(p.item_class::text, 'UNCLASSIFIED')
    HAVING sum(it.total) <> 0
  LOOP
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.bucket
                        WHEN 'BY_PRODUCT' THEN '4211'
                        WHEN 'SERVICE'    THEN '4311'
                        ELSE '4111' END,
      'credit', round(r.amount, 2),
      'memo', 'إيراد ' || r.bucket);
  END LOOP;

  -- ── الإيراد دائن: الخدمة الحرة ──
  SELECT coalesce(sum(l.total), 0) INTO v_service_total
    FROM public.ad_hoc_service_lines l
   WHERE l.invoice_id = p_invoice_id;
  IF v_service_total <> 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '4311',
      'credit', round(v_service_total, 2),
      'memo', 'إيراد خدمة حرة (AD_HOC_SERVICE)');
  END IF;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Invoice % has no revenue lines', v_inv.invoice_number;
  END IF;

  -- ── أسطر التحصيل (مدين) ──
  IF v_inv.paid > 0 THEN
    -- فحص الدفع المجزأ أولاً: إذا كانت هناك سجلات تجزئة
    IF EXISTS (SELECT 1 FROM public.customer_payment_splits WHERE invoice_id = p_invoice_id) THEN
      SELECT round(coalesce(sum(amount), 0), 2)
        INTO v_split_total
        FROM public.customer_payment_splits
       WHERE invoice_id = p_invoice_id;
      IF v_split_total <> round(v_inv.paid, 2) THEN
        RAISE EXCEPTION 'Invoice % split total (%) does not match paid amount (%)',
          v_inv.invoice_number, v_split_total, round(v_inv.paid, 2);
      END IF;

      FOR r_split IN
        SELECT method::text AS method, amount, cashbox_id, bank_account_id,
               payment_method_id, reference_no
        FROM public.customer_payment_splits
        WHERE invoice_id = p_invoice_id
      LOOP
        IF r_split.amount > 0 THEN
          v_split_acct := public.resolve_document_settlement_account(
            r_split.method, r_split.cashbox_id, r_split.bank_account_id,
            coalesce(r_split.payment_method_id, r_split.method)
          );
          IF v_split_acct IS NULL THEN
            RAISE EXCEPTION 'No ledger account could be resolved for split tender %', r_split.method;
          END IF;
          v_lines := v_lines || jsonb_build_object(
            'account_code', v_split_acct,
            'debit', round(r_split.amount, 2),
            'memo', 'تحصيل مجزأ عبر ' || r_split.method ||
                    coalesce(' — ' || nullif(r_split.reference_no, ''), ''));
        END IF;
      END LOOP;
    ELSIF v_cash_acct IS NOT NULL THEN
      -- دفع مفرد
      v_lines := v_lines || jsonb_build_object(
        'account_code', v_cash_acct,
        'debit', round(v_inv.paid, 2),
        'memo', CASE
                  WHEN v_cash_acct = '1111' THEN 'تحصيل عبر البنك'
                  WHEN v_cash_acct = '1131' THEN 'تحصيل عبر المحفظة الإلكترونية'
                  ELSE 'تحصيل نقدي بالصندوق'
                END);
    END IF;
  END IF;

  -- سطر الآجل (مدين - ذمم العملاء 1211)
  IF v_collectable > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1211',
      'debit', round(v_collectable, 2),
      'partner_type', 'customer',
      'partner_id', v_inv.customer_id,
      'memo', 'ذمم العميل ' || coalesce(v_inv.invoice_number, ''));
  END IF;

  -- سطر الضريبة
  IF v_inv.tax > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2311',
      'credit', round(v_inv.tax, 2),
      'memo', 'ضريبة مخرجات مستحقة');
  END IF;

  -- إنشاء وترحيل قيد اليومية
  v_entry := public.post_journal_entry(
    p_entry_date := v_inv.created_at::date,
    p_memo := 'ترحيل فاتورة مبيعات ' || v_inv.invoice_number,
    p_lines := v_lines,
    p_source_type := 'sales_invoice',
    p_source_id := p_invoice_id,
    p_entry_number := 'JE-SI-' || v_inv.invoice_number
  );

  -- ── ترحيل تكلفة البضاعة المباعة (COGS) ──
  SELECT coalesce(sum(sm.total_cost), 0) AS total_cogs
    INTO v_cost
    FROM public.stock_movements sm
   WHERE sm.source_type = 'sales_invoice'
     AND sm.source_id = p_invoice_id
     AND sm.movement_type = 'OUT';

  IF v_cost.total_cogs > 0 THEN
    PERFORM public.post_journal_entry(
      p_entry_date := v_inv.created_at::date,
      p_memo := 'تكلفة البضاعة المباعة - فاتورة ' || v_inv.invoice_number,
      p_lines := jsonb_build_array(
        jsonb_build_object('account_code', '5111', 'debit', round(v_cost.total_cogs, 2), 'memo', 'تكلفة المبيعات'),
        jsonb_build_object('account_code', '1313', 'credit', round(v_cost.total_cogs, 2), 'memo', 'صرف مخزون تام')
      ),
      p_source_type := 'sales_invoice_cogs',
      p_source_id := p_invoice_id,
      p_entry_number := 'JE-COGS-' || v_inv.invoice_number
    );
  END IF;

  RETURN v_entry;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_sales_invoice(uuid) TO authenticated, service_role;


-- ── 2. ترقية دالة إنشاء البيع الشاملة create_sale (9-argument overload) لدعم التجزئة ──

CREATE OR REPLACE FUNCTION public.create_sale(
  _warehouse_id uuid,
  _customer_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb,
  _sale_date date,
  _payment_splits jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  v_system         boolean := false;
  v_posted_at      timestamptz;
  v_split          record;
  v_split_total    numeric := 0;
  v_distinct_methods integer := 0;
  v_recorded_method text := _payment_method;
  v_has_splits     boolean := false;
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

  IF v_discount < 0 THEN
    RAISE EXCEPTION 'Discount cannot be negative';
  END IF;

  IF coalesce(_paid, 0) < 0 THEN
    RAISE EXCEPTION 'Paid amount cannot be negative';
  END IF;

  -- ── التحقق من صحة سجلات الدفع المجزأ إن وجدت ──
  IF coalesce(jsonb_typeof(_payment_splits), 'jsonb') = 'array'
     AND coalesce(jsonb_array_length(_payment_splits), 0) > 0 THEN
    v_has_splits := true;

    FOR v_split IN
      SELECT part ->> 'method' AS method,
             coalesce((part ->> 'amount')::numeric, 0) AS amount,
             nullif(part ->> 'cashbox_id', '')::uuid AS cashbox_id,
             nullif(part ->> 'bank_account_id', '')::uuid AS bank_account_id,
             nullif(part ->> 'payment_method_id', '') AS payment_method_id,
             nullif(btrim(coalesce(part ->> 'reference', '')), '') AS reference
      FROM jsonb_array_elements(_payment_splits) AS part
    LOOP
      IF v_split.method IS NULL
         OR v_split.method NOT IN ('cash', 'card', 'bank_transfer', 'mobile_money', 'cheque') THEN
        RAISE EXCEPTION 'Unsupported split payment method: %', v_split.method;
      END IF;
      IF public.resolve_writable_payment_method(
           coalesce(v_split.payment_method_id, v_split.method), 'pos', true
         ) IS DISTINCT FROM v_split.method THEN
        RAISE EXCEPTION 'Payment method id does not match split tender %', v_split.method;
      END IF;
      IF v_split.amount <= 0 THEN
        RAISE EXCEPTION 'Every payment tender component requires a positive amount';
      END IF;
      v_split_total := v_split_total + v_split.amount;
    END LOOP;

    SELECT count(DISTINCT part ->> 'method') INTO v_distinct_methods
    FROM jsonb_array_elements(_payment_splits) AS part;

    IF v_distinct_methods <> jsonb_array_length(_payment_splits) THEN
      RAISE EXCEPTION 'A payment method may only be included once in a split';
    END IF;

    IF v_distinct_methods > 1 THEN
      v_recorded_method := 'split';
    END IF;
  ELSE
    IF _payment_method NOT IN ('cash', 'card', 'bank_transfer', 'credit', 'mobile_money', 'cheque') THEN
      RAISE EXCEPTION 'Unsupported payment method: %', _payment_method;
    END IF;
  END IF;

  -- ── التحقق من رصيد المخزون لجميع البنود ──
  FOR v_line IN
    SELECT r.o_product_id AS product_id, sum(r.o_quantity) AS quantity
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
    WHERE r.o_stock_effect = 'STOCK_ISSUE'
    GROUP BY r.o_product_id
    ORDER BY r.o_product_id
  LOOP
    SELECT i.quantity INTO v_available
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

  -- ── حساب المجاميع والأسعار ──
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
    SELECT balance, credit_limit, is_system
      INTO v_customer_balance, v_credit_limit, v_system
    FROM public.customers
    WHERE id = _customer_id AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected customer is unavailable';
    END IF;
  END IF;

  -- مطابقة مبالغ الدفع
  v_paid := least(coalesce(_paid, 0), v_total);
  v_outstanding := round(v_total - v_paid, 2);

  IF v_has_splits THEN
    IF round(v_split_total, 2) <> round(v_paid, 2) THEN
      RAISE EXCEPTION 'Split breakdown total (%) does not match paid amount (%)',
        round(v_split_total, 2), round(v_paid, 2);
    END IF;
  END IF;

  IF v_outstanding > 0 AND _customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required when the sale has an unpaid amount';
  END IF;

  IF v_outstanding > 0 AND v_system THEN
    RAISE EXCEPTION
      'The system cash customer cannot carry credit — select a real customer for a deferred sale'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_outstanding > 0 AND NOT public.customer_credit_limit_allows(_customer_id, v_outstanding) THEN
    RAISE EXCEPTION
      'Credit limit exceeded: current balance %, requested debt %, limit %',
      coalesce(v_customer_balance, 0), v_outstanding, coalesce(v_credit_limit, 0);
  END IF;

  v_status := 'confirmed'::public.invoice_status;
  v_invoice_number := public.next_invoice_number();
  v_posted_at := coalesce(_sale_date, current_date)::timestamp + localtime;

  -- ── إدراج رأس الفاتورة ──
  INSERT INTO public.sales_invoices (
    invoice_number, customer_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by,
    created_at, updated_at
  )
  VALUES (
    v_invoice_number, _customer_id, _warehouse_id, v_status,
    public.derive_payment_status(v_paid, v_total),
    v_subtotal, v_discount, v_tax_total, v_total, v_paid,
    v_recorded_method::public.payment_method, nullif(btrim(_note), ''), v_user,
    v_posted_at, now()
  )
  RETURNING id INTO v_invoice_id;

  -- ── إدراج سطور الفاتورة وحركات المخزون ──
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
    IF v_line.product_id IS NULL THEN
      v_price     := v_line.input_price;
      v_tax_rate  := v_line.input_tax;
      v_line_type := 'AD_HOC_SERVICE';
      v_effect    := 'NONE';
    ELSE
      SELECT p.sale_price, p.tax_rate
        INTO v_price, v_tax_rate
      FROM public.products p WHERE p.id = v_line.product_id;

      v_line_type := public.item_line_type(v_line.product_id, false);
      v_effect    := public.item_stock_effect(v_line.product_id, 'out');

      IF v_effect = 'STOCK_ISSUE' THEN
        PERFORM public.post_stock_delta(
          p_product_id => v_line.product_id,
          p_warehouse_id => _warehouse_id,
          p_signed_qty => -v_line.quantity,
          p_unit_cost => NULL,
          p_movement_kind => 'ISSUE'::public.stock_movement_kind,
          p_source_type => 'sales_invoice',
          p_source_id => v_invoice_id,
          p_note => 'POS sale',
          p_owner_type => 'COMPANY'::public.owner_type,
          p_owner_id => NULL,
          p_movement_type_legacy => 'sale'::public.movement_type
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

  -- مزامنة تواريخ حركات المخزون مع تاريخ البيع
  PERFORM set_config('app.stock_engine', 'on', true);
  UPDATE public.stock_movements
  SET created_at = v_posted_at
  WHERE source_type = 'sales_invoice' AND source_id = v_invoice_id;
  PERFORM set_config('app.stock_engine', 'off', true);

  -- ── تحديث ذمة العميل للآجل إن وجد ──
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
      v_posted_at, v_user, 'sale:' || v_invoice_id, 'قيد بيع آجل'
    )
    ON CONFLICT (source_key) DO NOTHING;
  END IF;

  -- ── إدراج سجلات الدفع المجزأ قبل الترحيل المحاسبي ──
  IF v_has_splits THEN
    FOR v_split IN
      SELECT part ->> 'method' AS method,
             coalesce((part ->> 'amount')::numeric, 0) AS amount,
             nullif(part ->> 'cashbox_id', '')::uuid AS cashbox_id,
             nullif(part ->> 'bank_account_id', '')::uuid AS bank_account_id,
             nullif(part ->> 'payment_method_id', '') AS payment_method_id,
             nullif(btrim(coalesce(part ->> 'reference', '')), '') AS reference
      FROM jsonb_array_elements(_payment_splits) AS part
    LOOP
      IF v_split.amount > 0 THEN
        INSERT INTO public.customer_payment_splits (
          customer_id, invoice_id, method, amount, occurred_at, created_by,
          cashbox_id, bank_account_id, payment_method_id, reference_no
        )
        VALUES (
          _customer_id,
          v_invoice_id,
          v_split.method::public.payment_method,
          round(v_split.amount, 2),
          v_posted_at,
          v_user,
          v_split.cashbox_id,
          v_split.bank_account_id,
          coalesce(v_split.payment_method_id, v_split.method),
          v_split.reference
        );
      END IF;
    END LOOP;
  END IF;

  -- ── سجل التدقيق ──
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'sale.posted', 'sales_invoice', v_invoice_id,
    jsonb_build_object(
      'invoice_number', v_invoice_number,
      'warehouse_id', _warehouse_id,
      'customer_id', _customer_id,
      'payment_method', v_recorded_method,
      'total', v_total,
      'paid', v_paid,
      'outstanding', v_outstanding,
      'has_splits', v_has_splits,
      'split_count', CASE WHEN v_has_splits THEN jsonb_array_length(_payment_splits) ELSE 0 END,
      'line_count', jsonb_array_length(_items)
    ));

  -- ── الترحيل المحاسبي المتوازن التلقائي ──
  PERFORM set_config('app.payment_split_internal_post', 'on', true);
  PERFORM public.post_sales_invoice(v_invoice_id);
  PERFORM set_config('app.payment_split_internal_post', 'off', true);

  RETURN v_invoice_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date, jsonb) TO authenticated, service_role;


-- ── 3. تحديث النسخ الفرعية من create_sale لتمرير النداءات للدالة الشاملة ──

CREATE OR REPLACE FUNCTION public.create_sale(
  _warehouse_id uuid,
  _customer_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb,
  _sale_date date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN public.create_sale(
    _warehouse_id, _customer_id, _payment_method, _paid, _discount, _note, _items, _sale_date, '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_sale(
  _warehouse_id uuid,
  _customer_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN public.create_sale(
    _warehouse_id, _customer_id, _payment_method, _paid, _discount, _note, _items, current_date, '[]'::jsonb
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb) TO authenticated, service_role;

COMMIT;

-- Rollback: replace post_sales_invoice/create_sale overloads with their prior
-- definitions from migrations 43 and 46, then disable the POS split switch.
