-- ============================================================================
-- 9914_sales_return_customer_credit_and_cash_refund.sql
--
-- يعالج المشكلتين 1 و 4 في منظومة أرصدة العملاء:
--
--  • المشكلة 1 — المرتجعات:
--    خصم الدفتر قيمة المرتجع كاملةً من ذمة العميل وقيد القيد نفس القيمة كذمة
--    دائنة (1211) للمرتجع الآجل، أو كدفعة نقدية للسداد. هذا صحيح فقط إن كانت
--    الفاتورة غير مسدّدة. أما المرتجع على فاتورة مسدّدة كليًا أو جزئيًا فكان
--    يُنشئ رصيدًا دائنًا للمرور على حساب نقدي لم يخرج من الدرج، ويختلف
--    ما يخصمه الدفتر عمّا يقيده الأستاذ عند فاتورة ما زالت ذات ذمة.
--    الإصلاح: يُشتق سطرا القيد من قيمة الفاتورة نفسها:
--        ذمة = min(قيمة المرتجع، ذمة الفاتورة المتبقية)
--        ما يزيد = نقد/بنك يعود للعميل
--    ويُخصم من العميل ما يخصم من الصكّ لا أكثر، فيصبح أثر المرتجع على
--    دفتر العميل والأستاذ واحدًا على أي فاتورة (آجلة، جزئية، مسدّدة).
--
--  • المشكلة 4 — إخفاء الفرق:
--    create_sale كان لا يحدّث الرصيد المخزَّن إلا إذا كان الطلب شائعًا (cash).
--    أما `create_sale` فهو يخصم ثم يختبر بالـ greatest، والدفع المسبق في
--    06/21 يقص greatest(…,0). هذا يبتلع أي فرق صامتًا.
--    الإصلاح: في كل هذه الدوال يصبح الرصيد المخزَّن مشتقًا من الدفتر عبر
--    public.recalculate_customer_balance — لا اختيار بين مصدرين.
-- ============================================================================
BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- (1) create_sales_return — مزامنة أثر العميل مع طبيعة المرتجع
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_sales_return(
  _invoice_id uuid,
  _warehouse_id uuid,
  _customer_id uuid,
  _refund_method text,
  _note text,
  _items jsonb
)
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
  v_inv       record;
  v_returned  numeric;
  v_uom_id    uuid;
  v_entered_qty numeric;
  v_factor    numeric;
  v_quantity_increment numeric;
  v_entered_price numeric;
  v_invoice_item_id uuid;
  v_discount_factor numeric := 1;
  -- جديد: توزيع قيمة المرتجع بين الذمة والاسترداد النقدي
  v_credit_applied numeric := 0;
  v_cash_refund    numeric := 0;
  v_invoice_outstanding numeric := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _invoice_id IS NULL THEN
    RAISE EXCEPTION 'A sales return must be linked to its original invoice';
  END IF;
  IF coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;
  IF _refund_method IS NULL
     OR NOT (_refund_method::public.payment_method = ANY (ARRAY['cash','card','bank_transfer','mobile_money','split']::public.payment_method[])) THEN
    RAISE EXCEPTION 'A return refund method cannot be credit — pick the account the money leaves from';
  END IF;

  -- ── الفاتورة الأصلية: مقفولة، مؤكدة، وبطرفيها ───────────────────────────
  SELECT * INTO v_inv FROM public.sales_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original invoice % does not exist', _invoice_id;
  END IF;
  IF v_inv.status IN ('draft', 'cancelled') THEN
    RAISE EXCEPTION 'Invoice % is % - a return needs a confirmed sale', v_inv.invoice_number, v_inv.status;
  END IF;
  IF _customer_id IS NOT NULL AND v_inv.customer_id IS DISTINCT FROM _customer_id THEN
    RAISE EXCEPTION 'The return customer does not match the invoice customer';
  END IF;
  IF _warehouse_id IS NOT NULL AND v_inv.warehouse_id IS DISTINCT FROM _warehouse_id THEN
    RAISE EXCEPTION 'A return must go back to the invoice warehouse (%)', v_inv.warehouse_id;
  END IF;
  IF coalesce(v_inv.subtotal, 0) > 0 AND coalesce(v_inv.discount, 0) > 0 THEN
    v_discount_factor := 1 - least(1, v_inv.discount / v_inv.subtotal);
  END IF;

  -- A return identifies the exact source line and reuses its historical UoM
  -- factor and price. Current product settings must not reinterpret an old sale.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_items) AS src(item)
     WHERE nullif(btrim(coalesce(src.item ->> 'invoice_item_id', '')), '') IS NULL
        OR coalesce((src.item ->> 'quantity')::numeric, 0) <= 0
        OR NOT EXISTS (
          SELECT 1
            FROM public.sales_invoice_items sit
           WHERE sit.id = nullif(btrim(coalesce(src.item ->> 'invoice_item_id', '')), '')::uuid
             AND sit.invoice_id = _invoice_id
             AND sit.product_id = nullif(btrim(coalesce(src.item ->> 'product_id', '')), '')::uuid
             AND sit.uom_id IS NOT DISTINCT FROM nullif(btrim(coalesce(src.item ->> 'uom_id', '')), '')::uuid
             AND mod((src.item ->> 'quantity')::numeric, coalesce(sit.uom_quantity_increment, 0.001)) = 0
        )
  ) THEN
    RAISE EXCEPTION 'Every sales return line must match an original invoice line and its unit'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_items) AS src(item)
     GROUP BY nullif(btrim(coalesce(src.item ->> 'invoice_item_id', '')), '')::uuid
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Combine each original invoice line into one return line';
  END IF;

  FOR r IN
    SELECT sit.id AS invoice_item_id, sit.product_id,
           sum((src.item ->> 'quantity')::numeric) AS entered_quantity,
           sum((src.item ->> 'quantity')::numeric) * coalesce(sit.uom_conversion_factor, 1) AS quantity,
           coalesce(sit.uom_conversion_factor, 1) AS factor,
           coalesce(sit.uom_quantity_increment, 0.001) AS quantity_increment,
           coalesce(sit.base_unit_price, sit.unit_price) AS unit_price,
           coalesce(sit.tax / nullif(sit.quantity, 0), 0) AS unit_tax,
           sit.quantity AS sold_quantity
      FROM jsonb_array_elements(_items) AS src(item)
      JOIN public.sales_invoice_items sit
        ON sit.id = nullif(btrim(coalesce(src.item ->> 'invoice_item_id', '')), '')::uuid
       AND sit.invoice_id = _invoice_id
     GROUP BY sit.id, sit.product_id, sit.uom_conversion_factor, sit.uom_quantity_increment,
              sit.base_unit_price, sit.unit_price, sit.tax, sit.quantity
  LOOP
    IF r.quantity <> round(r.quantity, 3) THEN
      RAISE EXCEPTION 'Returned base quantity exceeds the inventory precision for line %', r.invoice_item_id
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(sum(ri.quantity), 0) INTO v_returned
      FROM public.sales_return_items ri
      JOIN public.sales_returns sr ON sr.id = ri.return_id
     WHERE sr.invoice_id = _invoice_id AND ri.product_id = r.product_id
       AND (ri.invoice_item_id = r.invoice_item_id OR ri.invoice_item_id IS NULL);
    IF v_returned + r.quantity > r.sold_quantity THEN
      RAISE EXCEPTION 'Return exceeds the remaining quantity on invoice line %', r.invoice_item_id
        USING ERRCODE = 'check_violation';
    END IF;
    v_sub := v_sub + round(coalesce(r.unit_price, 0) * r.quantity * v_discount_factor, 2);
    v_tax := v_tax + round(coalesce(r.unit_tax, 0) * r.quantity, 2);
  END LOOP;

  -- The returned subtotal uses the original invoice discount allocation.
  v_tot := round(v_sub + v_tax, 2);
  IF v_tot <= 0 THEN
    RAISE EXCEPTION 'The return value must be greater than zero';
  END IF;

  v_no := public.next_sales_return_number();

  INSERT INTO public.sales_returns (
    return_number, invoice_id, customer_id, warehouse_id,
    subtotal, tax, total, refund_method, note, created_by
  )
  VALUES (
    v_no, _invoice_id, coalesce(_customer_id, v_inv.customer_id), v_inv.warehouse_id,
    round(v_sub, 2), round(v_tax, 2), v_tot, _refund_method::public.payment_method,
    nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_id;

  FOR r IN
    SELECT sit.id AS invoice_item_id, sit.product_id,
           sum((src.item ->> 'quantity')::numeric) AS entered_quantity,
           sum((src.item ->> 'quantity')::numeric) * coalesce(sit.uom_conversion_factor, 1) AS quantity,
           coalesce(sit.uom_conversion_factor, 1) AS factor,
           sit.uom_id AS uom_id,
           coalesce(sit.uom_quantity_increment, 0.001) AS quantity_increment,
           coalesce(sit.base_unit_price, sit.unit_price) AS unit_price,
           coalesce(sit.entered_unit_price,
             coalesce(sit.base_unit_price, sit.unit_price) * coalesce(sit.uom_conversion_factor, 1)) AS entered_unit_price,
           coalesce(sit.tax / nullif(sit.quantity, 0), 0) AS unit_tax
      FROM jsonb_array_elements(_items) AS src(item)
      JOIN public.sales_invoice_items sit
        ON sit.id = nullif(btrim(coalesce(src.item ->> 'invoice_item_id', '')), '')::uuid
       AND sit.invoice_id = _invoice_id
     GROUP BY sit.id, sit.product_id, sit.uom_conversion_factor, sit.uom_quantity_increment, sit.uom_id,
              sit.unit_price, sit.base_unit_price,
              sit.entered_unit_price, sit.tax, sit.quantity
  LOOP
    v_invoice_item_id := r.invoice_item_id;
    v_p   := r.product_id;
    v_qty := r.quantity;
    v_uom_id := r.uom_id;
    v_entered_qty := r.entered_quantity;
    v_factor := r.factor;
    v_price := round(coalesce(r.unit_price, 0), 6);
    v_entered_price := round(coalesce(r.entered_unit_price, 0), 4);
    v_lt    := round(v_qty * v_price * v_discount_factor, 2);
    v_ltax  := round(coalesce(r.unit_tax, 0) * v_qty, 2);

    v_type   := public.item_line_type(v_p, false);
    v_effect := public.item_stock_effect(v_p, 'in');

    INSERT INTO public.sales_return_items (
      return_id, product_id, quantity, unit_price, tax, total, line_type, invoice_item_id,
      uom_id, entered_quantity, base_quantity, uom_conversion_factor, entered_unit_price,
      uom_quantity_increment
    )
    VALUES (
      v_id, v_p, v_qty, v_price, v_ltax, v_lt + v_ltax, v_type, v_invoice_item_id,
      v_uom_id,
      v_entered_qty, v_qty, v_factor, v_entered_price, r.quantity_increment
    );

    IF v_effect = 'STOCK_RECEIPT' THEN
      PERFORM public.post_stock_delta(
        p_product_id => v_p,
        p_warehouse_id => v_inv.warehouse_id,
        p_signed_qty => v_qty,
        p_unit_cost => NULL,   -- التقييم بمتوسط الطبقة (P0-3)
        p_movement_kind => 'RECEIPT'::public.stock_movement_kind,
        p_source_type => 'sales_return',
        p_source_id => v_id,
        p_note => 'Sales return ' || v_no,
        p_owner_type => 'COMPANY'::public.owner_type,
        p_owner_id => NULL,
        p_movement_type_legacy => 'sale_return'::public.movement_type
      );
    END IF;
  END LOOP;

  -- ── الأثر على العميل: مقدار واحد يخصمه الدفتر والأستاذ معًا ───────────────
  -- تُقفل ذمة الفاتورة قبل قراءتها: مرتجعتان متزامنتان لا تتجاوزان ذمتها.
  SELECT round(greatest(coalesce(total, 0) - coalesce(paid, 0), 0), 2)
    INTO v_invoice_outstanding
    FROM public.sales_invoices
   WHERE id = _invoice_id
   FOR UPDATE;

  IF v_inv.customer_id IS NOT NULL THEN
    -- قفل صف العميل ليتسلسل هذا المرتجع مع كل مرتجع/تحصيل آخر على نفس العميل.
    PERFORM public.customer_balance_lock(v_inv.customer_id);

    -- ذمة الفاتورة لا تنقص بأكثر من قيمتها، والباقي يُردّ نقدًا.
    v_credit_applied := round(least(v_tot, v_invoice_outstanding), 2);
    v_cash_refund    := round(v_tot - v_credit_applied, 2);

    IF v_credit_applied > 0 THEN
      UPDATE public.sales_invoices
         SET paid = greatest(round(coalesce(paid, 0) - v_credit_applied, 2), 0),
             status = 'confirmed'::public.invoice_status,
             payment_status = public.derive_payment_status(
               greatest(round(coalesce(paid, 0) - v_credit_applied, 2), 0), total),
             updated_at = now()
       WHERE id = _invoice_id;
    END IF;

    IF v_credit_applied < 0.005 THEN
      v_credit_applied := 0;
      UPDATE public.sales_invoices
         SET status = CASE
               WHEN round(coalesce(total, 0) - coalesce(paid, 0), 2) <= 0.005
                 THEN 'returned'::public.invoice_status
               ELSE status END,
             payment_status = public.derive_payment_status(paid, total),
             updated_at = now()
       WHERE id = _invoice_id;
    END IF;

    IF v_credit_applied > 0 THEN
      INSERT INTO public.customer_ledger (
        customer_id, entry_type, credit, reference_id, reference_type,
        occurred_at, created_by, source_key, note
      )
      VALUES (
        v_inv.customer_id, 'return', v_credit_applied, v_id, 'sales_return',
        now(), v_user, 'return:' || v_id,
        'مرتجع مبيعات — خصم من الذمة'
      );
    END IF;

    -- مبلغ صفري لا يمرّ على قيود الدفتر (debit + credit > 0)، فنسجّله في سجل
    -- المرتجعات الصريح بدل حركة صفرية محرّمة.
    IF v_cash_refund > 0 THEN
      INSERT INTO public.customer_ledger (
        customer_id, entry_type, credit, reference_id, reference_type,
        occurred_at, created_by, source_key, note
      )
      VALUES (
        v_inv.customer_id, 'return', v_cash_refund, v_id, 'sales_return_refund',
        now(), v_user, 'return-refund:' || v_id,
        'مرتجع مبيعات — استرداد نقدي (لا يمسّ الذمة)'
      );
    END IF;

    -- ما يُردّ نقدًا لا يخصم من العميل: العميل أخذ بضاعة ثم ردّها وأخذ ماله،
    -- وذمته لم تتغيّر. الأثر في الجانب النقدي وحده.
    PERFORM public.recalculate_customer_balance(
      v_inv.customer_id, 'مرتجع مبيعات ' || v_no, 'document_repost');
  END IF;

  -- ── القيد: يعكس إيراد البيع وضريبته وCOGS ─────────────────────────────────
  FOR r IN
    SELECT coalesce(p.item_class::text, 'UNCLASSIFIED') AS bucket,
           sum(ri.total - coalesce(ri.tax, 0)) AS net_amount
      FROM public.sales_return_items ri
      LEFT JOIN public.products p ON p.id = ri.product_id
     WHERE ri.return_id = v_id
     GROUP BY coalesce(p.item_class::text, 'UNCLASSIFIED')
    HAVING sum(ri.total - coalesce(ri.tax, 0)) <> 0
  LOOP
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.bucket
                        WHEN 'BY_PRODUCT' THEN '4211'
                        WHEN 'SERVICE'    THEN '4311'
                        ELSE '4111' END,
      'debit', round(r.net_amount, 2),
      'memo', 'مرتجع إيراد ' || r.bucket);
  END LOOP;

  IF v_tax <> 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2311', 'debit', round(v_tax, 2),
      'memo', 'عكس ضريبة القيمة المضافة');
  END IF;

  -- الذمة الدائنة تساوي ما خُصم من الفاتورة بالضبط، وما زاد يُردّ من الصندوق.
  IF v_credit_applied > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1211', 'credit', v_credit_applied,
      'partner_type', 'customer', 'partner_id', v_inv.customer_id,
      'memo', 'عكس ذم العميل');
  END IF;

  IF v_cash_refund > 0 THEN
    v_cash_acct := public.payment_method_ledger_account(_refund_method::text);
    IF v_cash_acct IS NULL THEN
      RAISE EXCEPTION
        'No ledger account could be resolved for refund tender % — record the refund through the treasury',
        _refund_method;
    END IF;
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_cash_acct, 'credit', v_cash_refund,
      'memo', 'استرداد نقدي للعميل');
  END IF;

  -- عكس COGS وقيمة المخزون مباشرة من حركات المرتجع، بلا ربط مضاعف بأسطر الصنف.
  FOR r IN
    SELECT p.item_class,
           sum(coalesce(sm.total_cost, 0)) AS cost
      FROM public.stock_movements sm
      JOIN public.products p ON p.id = sm.product_id
     WHERE sm.source_type = 'sales_return'
       AND sm.source_id = v_id
       AND sm.warehouse_id = v_inv.warehouse_id
       AND sm.movement_kind = 'RECEIPT'::public.stock_movement_kind
     GROUP BY p.item_class
    HAVING sum(coalesce(sm.total_cost, 0)) <> 0
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

  SELECT coalesce(sum((ln->>'debit')::numeric), 0),
         coalesce(sum((ln->>'credit')::numeric), 0)
    INTO v_debits, v_credits
    FROM jsonb_array_elements(v_lines) AS ln;

  IF v_debits > 0 OR v_credits > 0 THEN
    v_entry := public.balance_and_post_return(
      p_memo => 'مرتجع مبيعات ' || v_no,
      p_date => CURRENT_DATE,
      p_source_type => 'sales_return',
      p_source_id => v_id,
      p_lines => v_lines);
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'sales_return.posted', 'sales_return', v_id,
    jsonb_build_object(
      'return_number', v_no,
      'invoice_id', _invoice_id,
      'customer_id', v_inv.customer_id,
      'total', v_tot,
      'customer_credit', v_credit_applied,
      'cash_refund', v_cash_refund,
      'journal_entry_id', v_entry
    ));

  RETURN v_id;
END $function$;

REVOKE ALL ON FUNCTION public.create_sales_return(uuid, uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_return(uuid, uuid, uuid, text, text, jsonb)
  TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) إنشاء البيع: الرصيد المخزَّن يُشتق من الدفتر لا يُزاد اليدويًا
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.customer_balance_stamp_after_sale(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_customer_id IS NOT NULL THEN
    PERFORM public.recalculate_customer_balance(
      p_customer_id, 'ترحيل فاتورة بيع', 'document_repost');
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.customer_balance_stamp_after_sale(uuid) IS
  'نقطة واحدة يستدعيها كل مسار بيع بعد كتابة حركة الدفتر: تُعيد الرصيد المخزَّن إلى صافي الدفتر.';

REVOKE ALL ON FUNCTION public.customer_balance_stamp_after_sale(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_balance_stamp_after_sale(uuid) TO service_role;

COMMIT;

-- ============================================================================
-- ROLLBACK
--   أعد تطبيق 9903 لإرجاع create_sales_return السابقة، ثم:
--   DROP FUNCTION IF EXISTS public.customer_balance_stamp_after_sale(uuid);
-- ============================================================================
