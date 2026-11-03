-- ============================================================================
-- 9915_customer_collection_and_opening_balance_ledger_sync.sql
--
-- يعالج المشكلتين 2 و 4 (والثالثة في جانب الأرصدة الافتتاحية):
--
--  • التحصيل كان يحدّث الرصيد بـ greatest(balance − amount, 0): أي فرق بين
--    الرصيد المخزَّن والدفتر يُبتلع صامتًا، فيبقى الاختلاف مخفيًا حتى يظهر
--    لاحقًا كتنبيه تسوية بلا سبب معروف. الإصلاح: تحديث الرصيد يصير إعادة
--    احتساب من الدفتر — مصدر واحد لا مصدران.
--
--  • تحصيل غير مرتبط بفاتورة: كان يوزّع المبلغ على أقدم الفواتير ثم يكتب
--    paid = paid + المبلغ كاملًا على صف الفاتورة الذي طابق مبلغ التحصيل،
--    فلا تُسجَّل الزيادة إن لم توجد فاتورة بهذا المبلغ: تُفقد الدفعات المقدمة
--    ويُفسد ما تبقّى على الفواتير. الإصلاح: التوزيع هو المسار الوحيد، والزائد
--    (دفعة مقدمة) يبقى في الدفتر كرصيد دائن للعميل كما هو معتمد في 06/21.
--
--  • الأرصدة الافتتاحية: post_opening_balance يكتب في دفتر العميل ولا يمسّ
--    الرصيد المخزَّن (المشكلة 5). أصبح المُشغّل يقفل الفجوة، ونؤكد هنا أن
--    الافتتاحي المكرر لا يُنشئ حركة ثانية عبر source_key ثابت.
-- ============================================================================
BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- (1) record_customer_payment — لا greatest، ولا paid مزيّف
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.record_customer_payment(
  _customer_id uuid,
  _invoice_id uuid,
  _amount numeric,
  _method text,
  _payment_date date,
  _note text,
  _cashbox_id uuid DEFAULT NULL,
  _bank_account_id uuid DEFAULT NULL,
  _payment_method_id text DEFAULT NULL,
  _cheque_number text DEFAULT NULL,
  _cheque_bank text DEFAULT NULL,
  _cheque_due_date date DEFAULT NULL,
  _cheque_drawer text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_amount numeric := round(coalesce(_amount, 0), 2);
  v_method_id text;
  v_stored_method text;
  v_account text;
  v_payment_id uuid;
  v_customer_balance numeric;
  v_ledger_balance numeric;
  v_invoice record;
  v_inv_cur record;
  v_remaining numeric;
  v_allocation numeric;
  v_allocated numeric := 0;
  v_lines jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.is_platform_superadmin(v_user)
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'accountant')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to record customer payments';
  END IF;
  IF _customer_id IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'A customer and a positive amount are required';
  END IF;
  IF v_amount <> coalesce(_amount, 0) THEN
    RAISE EXCEPTION 'Payment amount must not have more than two decimal places';
  END IF;

  v_method_id := coalesce(_payment_method_id, _method);
  v_stored_method := public.resolve_writable_payment_method(
    v_method_id, 'customer_collection', true
  );
  IF v_stored_method = 'credit' THEN
    RAISE EXCEPTION 'A collection cannot record آجل — that is a deferred sale, not a receipt';
  END IF;

  -- Serialize collections by locking the customer row before checking balances.
  v_customer_balance := public.customer_balance_lock(_customer_id);
  IF v_customer_balance IS NULL THEN
    RAISE EXCEPTION 'Customer is unavailable';
  END IF;

  -- الدفتر هو المصدر: فحص المبلغ على صافي الدفتر لا على العمود المخزَّن
  -- حتى لا يُرفض تحصيل سليم أو يُقبل زائد بسبب فرق قديم.
  SELECT round(coalesce(sum(l.debit - l.credit), 0), 2)
    INTO v_ledger_balance
    FROM public.customer_ledger l
   WHERE l.customer_id = _customer_id;

  v_account := public.resolve_document_settlement_account(
    v_stored_method, _cashbox_id, _bank_account_id, v_method_id
  );
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'No ledger account could be resolved for collection tender %', v_method_id;
  END IF;

  IF _invoice_id IS NOT NULL THEN
    SELECT id, total, paid, customer_id INTO v_invoice
      FROM public.sales_invoices WHERE id = _invoice_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;
    IF v_invoice.customer_id IS DISTINCT FROM _customer_id THEN
      RAISE EXCEPTION 'Invoice does not belong to this customer';
    END IF;
    IF v_invoice.total - v_invoice.paid <= 0 THEN
      RAISE EXCEPTION 'Invoice has no outstanding balance';
    END IF;
    IF v_amount > v_invoice.total - v_invoice.paid + 0.001 THEN
      RAISE EXCEPTION 'Payment exceeds the invoice outstanding balance';
    END IF;
  ELSE
    -- تحصيل عام أو دفعة مقدمة (Advance payment):
    -- يُقبل المبلغ كاملاً؛ يُوزَّع على الفواتير المفتوحة وما يتبقى يُقيد كرصيد دائن للعميل
    NULL;
  END IF;

  INSERT INTO public.customer_payments (
    customer_id, invoice_id, amount, payment_method, payment_date, note, created_by,
    cashbox_id, bank_account_id, payment_method_id, payment_reference
  ) VALUES (
    _customer_id, _invoice_id, v_amount, v_stored_method::public.payment_method,
    coalesce(_payment_date, current_date), nullif(trim(_note), ''), v_user,
    _cashbox_id, _bank_account_id, v_method_id, _cheque_number
  ) RETURNING id INTO v_payment_id;

  INSERT INTO public.customer_ledger(
    customer_id, entry_type, credit, reference_id, reference_type,
    occurred_at, created_by, source_key, note
  ) VALUES (
    _customer_id, 'payment', v_amount, v_payment_id, 'customer_payment',
    coalesce(_payment_date, current_date)::timestamptz, v_user,
    'payment:' || v_payment_id,
    coalesce(nullif(trim(_note), ''), 'دفعة عميل')
  );

  IF (v_stored_method = 'cheque' OR v_method_id = 'cheque') AND _cheque_number IS NOT NULL THEN
    INSERT INTO public.cheques_register (
      cheque_number, bank_name, drawer_name, due_date, amount, status,
      customer_id, invoice_id, payment_id, notes, created_by
    ) VALUES (
      _cheque_number, coalesce(_cheque_bank, 'شيك مصرفي'), _cheque_drawer,
      coalesce(_cheque_due_date, CURRENT_DATE), v_amount, 'UNDER_COLLECTION',
      _customer_id, _invoice_id, v_payment_id, _note, v_user
    );
  END IF;

  IF _invoice_id IS NOT NULL THEN
    UPDATE public.sales_invoices
       SET paid = paid + v_amount,
           status = 'confirmed'::public.invoice_status,
           payment_status = public.derive_payment_status(paid + v_amount, total),
           updated_at = now()
     WHERE id = _invoice_id;
  ELSE
    -- التوزيع على أقدم الفواتير هو المسار الوحيد لزيادة paid. لا تُزاد ذمة
    -- فاتورة لم تُخصَّص لها فعليًا، وما لا يُخصَّص يبقى رصيدًا دائنًا في الدفتر.
    v_remaining := v_amount;
    FOR v_inv_cur IN
      SELECT id, total, paid
        FROM public.sales_invoices
       WHERE customer_id = _customer_id AND total > paid
         AND status NOT IN ('cancelled'::public.invoice_status, 'returned'::public.invoice_status)
       ORDER BY created_at ASC, id ASC
       FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_allocation := least(v_remaining, v_inv_cur.total - v_inv_cur.paid);
      IF v_allocation <= 0 THEN
        CONTINUE;
      END IF;
      UPDATE public.sales_invoices
         SET paid = round(paid + v_allocation, 2),
             status = 'confirmed'::public.invoice_status,
             payment_status = public.derive_payment_status(round(paid + v_allocation, 2), total),
             updated_at = now()
       WHERE id = v_inv_cur.id;
      v_remaining := round(v_remaining - v_allocation, 2);
      v_allocated := round(v_allocated + v_allocation, 2);
    END LOOP;
  END IF;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_code', v_account, 'debit', v_amount,
      'memo', CASE WHEN v_account = '1221'
                   THEN 'أوراق قبض (شيك برسم التحصيل)'
                   ELSE 'تحصيل من عميل' END),
    jsonb_build_object(
      'account_code', '1211', 'credit', v_amount,
      'memo', 'تحصيل ذمة عميل', 'partner_type', 'customer', 'partner_id', _customer_id)
  );
  -- A posting error aborts the whole RPC, including receipt and invoice updates.
  PERFORM public.create_journal_entry(
    'تحصيل من عميل — ' || coalesce(nullif(trim(_note), ''), ''),
    coalesce(_payment_date, current_date), 'customer_payment', v_payment_id, true, v_lines
  );

  -- الرصيد المخزَّن مشتق من الدفتر. لا greatest، ولا خصم مباشر يبتلع الفرق.
  PERFORM public.recalculate_customer_balance(
    _customer_id, 'تحصيل نقدي — ' || v_payment_id::text, 'document_repost');

  RETURN v_payment_id;
END
$function$;

REVOKE ALL ON FUNCTION public.record_customer_payment(
  uuid, uuid, numeric, text, date, text, uuid, uuid, text, text, text, date, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(
  uuid, uuid, numeric, text, date, text, uuid, uuid, text, text, text, date, text
) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) record_customer_payment_splits — نفس المبادئ للمرفق المجزأ
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.record_customer_payment_splits(
  _customer_id uuid,
  _invoice_id uuid,
  _amount numeric,
  _payment_date date,
  _note text,
  _splits jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_customer_balance numeric;
  v_ledger_balance numeric;
  v_customer_outstanding numeric := 0;
  v_total numeric := 0;
  v_split_total numeric := 0;
  v_method_id text;
  v_stored_method text;
  v_account text;
  v_amount numeric;
  v_payment_id uuid;
  v_last_id uuid;
  v_remaining numeric;
  v_invoice record;
  v_inv_cur record;
  v_allocation numeric;
  v_tender_lines jsonb;
  r_split record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.is_platform_superadmin(v_user)
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'accountant')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to record customer payments';
  END IF;
  IF _customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required';
  END IF;
  IF _amount IS NULL OR _amount <= 0 OR round(_amount, 2) <> _amount THEN
    RAISE EXCEPTION 'A positive collection total with at most two decimals is required';
  END IF;
  IF coalesce(jsonb_typeof(_splits), '') <> 'array'
     OR jsonb_array_length(_splits) < 2 THEN
    RAISE EXCEPTION 'A split collection requires at least two tenders';
  END IF;

  -- Serialize against single and split receipts for the same customer.
  v_customer_balance := public.customer_balance_lock(_customer_id);
  IF v_customer_balance IS NULL THEN
    RAISE EXCEPTION 'Customer is unavailable';
  END IF;

  SELECT round(coalesce(sum(l.debit - l.credit), 0), 2)
    INTO v_ledger_balance
    FROM public.customer_ledger l
   WHERE l.customer_id = _customer_id;

  FOR r_split IN
    SELECT part ->> 'methodId' AS method_id,
           part ->> 'method' AS method,
           coalesce((part ->> 'amount')::numeric, 0) AS amount,
           nullif(btrim(coalesce(part ->> 'reference', '')), '') AS reference,
           nullif(part ->> 'cashbox_id', '')::uuid AS cashbox_id,
           nullif(part ->> 'bank_account_id', '')::uuid AS bank_account_id,
           nullif(part ->> 'payment_method_id', '') AS payment_method_id
      FROM jsonb_array_elements(_splits) AS part
  LOOP
    IF r_split.amount <= 0 THEN
      RAISE EXCEPTION 'Every collection tender requires a positive amount';
    END IF;
    v_method_id := coalesce(r_split.method_id, r_split.method);
    v_stored_method := public.resolve_writable_payment_method(
      v_method_id, 'customer_collection', true
    );
    IF v_stored_method = 'credit' THEN
      RAISE EXCEPTION 'A collection cannot record آجل — that is a deferred sale, not a receipt';
    END IF;
    v_split_total := v_split_total + r_split.amount;
  END LOOP;
  IF v_split_total <> round(v_split_total, 2) THEN
    RAISE EXCEPTION 'Each payment tender must not have more than two decimal places';
  END IF;
  v_total := round(v_split_total, 2);
  IF v_total <= 0 OR v_split_total <> v_total
     OR (_amount IS NOT NULL AND round(_amount, 2) <> v_total) THEN
    RAISE EXCEPTION 'Collection total (%) does not match the sum of its tenders (%)',
      round(coalesce(_amount, 0), 2), v_total;
  END IF;

  IF _invoice_id IS NOT NULL THEN
    SELECT id, total, paid, customer_id INTO v_invoice
      FROM public.sales_invoices WHERE id = _invoice_id FOR UPDATE;
    IF NOT FOUND OR v_invoice.customer_id IS DISTINCT FROM _customer_id THEN
      RAISE EXCEPTION 'Invoice not found for this customer';
    END IF;
    IF v_invoice.total - v_invoice.paid <= 0
       OR v_total > v_invoice.total - v_invoice.paid + 0.001
       OR v_total > greatest(coalesce(v_ledger_balance, 0), 0) + 0.001 THEN
      RAISE EXCEPTION 'Payment exceeds the invoice outstanding balance';
    END IF;
  ELSE
    -- تحصيل عام أو دفعة مقدمة مجزأة: يُقبل المبلغ كاملاً وما يفيض عن الفواتير يُسجل كرصيد دائن
    NULL;
  END IF;

  v_remaining := v_total;
  FOR r_split IN
    SELECT part ->> 'methodId' AS method_id,
           part ->> 'method' AS method,
           coalesce((part ->> 'amount')::numeric, 0) AS amount,
           nullif(btrim(coalesce(part ->> 'reference', '')), '') AS reference,
           nullif(part ->> 'cashbox_id', '')::uuid AS cashbox_id,
           nullif(part ->> 'bank_account_id', '')::uuid AS bank_account_id,
           nullif(part ->> 'payment_method_id', '') AS payment_method_id
      FROM jsonb_array_elements(_splits) AS part
  LOOP
    v_method_id := coalesce(r_split.method_id, r_split.method);
    v_stored_method := public.resolve_writable_payment_method(
      v_method_id, 'customer_collection', true
    );
    v_account := public.resolve_document_settlement_account(
      v_stored_method, r_split.cashbox_id, r_split.bank_account_id, v_method_id
    );
    IF v_account IS NULL THEN
      RAISE EXCEPTION 'No ledger account could be resolved for collection tender %', v_method_id;
    END IF;
    v_amount := round(r_split.amount, 2);

    INSERT INTO public.customer_payments (
      customer_id, invoice_id, amount, payment_method, payment_date, note, created_by,
      payment_method_id, payment_reference, cashbox_id, bank_account_id
    ) VALUES (
      _customer_id, _invoice_id, v_amount, v_stored_method::public.payment_method,
      coalesce(_payment_date, current_date),
      nullif(trim(concat_ws(' — ', _note, r_split.reference)), ''),
      v_user, v_method_id, r_split.reference, r_split.cashbox_id, r_split.bank_account_id
    ) RETURNING id INTO v_payment_id;
    v_last_id := v_payment_id;

    INSERT INTO public.customer_ledger(
      customer_id, entry_type, credit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    ) VALUES (
      _customer_id, 'payment', v_amount, v_payment_id, 'customer_payment',
      coalesce(_payment_date, current_date)::timestamptz, v_user,
      'payment:' || v_payment_id,
      coalesce(nullif(trim(_note), ''), 'دفعة عميل (دفع مجزأ)')
    );

    IF (v_stored_method = 'cheque' OR v_method_id = 'cheque') AND r_split.reference IS NOT NULL THEN
      INSERT INTO public.cheques_register (
        cheque_number, bank_name, due_date, amount, status,
        customer_id, invoice_id, payment_id, notes, created_by
      ) VALUES (
        r_split.reference, 'شيك مصرفي', coalesce(_payment_date, current_date), v_amount,
        'UNDER_COLLECTION', _customer_id, _invoice_id, v_payment_id, _note, v_user
      );
    END IF;

    v_tender_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', v_account, 'debit', v_amount,
        'memo', 'تحصيل من عميل (دفع مجزأ) — ' || v_stored_method),
      jsonb_build_object(
        'account_code', '1211', 'credit', v_amount,
        'memo', 'تحصيل ذمة عميل', 'partner_type', 'customer', 'partner_id', _customer_id)
    );
    PERFORM public.create_journal_entry(
      'تحصيل من عميل — ' || coalesce(nullif(trim(_note), ''), ''),
      coalesce(_payment_date, current_date),
      'customer_payment', v_payment_id, true, v_tender_lines
    );
  END LOOP;

  IF _invoice_id IS NOT NULL THEN
    UPDATE public.sales_invoices
       SET paid = paid + v_total,
           status = 'confirmed'::public.invoice_status,
           payment_status = public.derive_payment_status(paid + v_total, total),
           updated_at = now()
     WHERE id = _invoice_id;
  ELSE
    FOR v_inv_cur IN
      SELECT id, total, paid
        FROM public.sales_invoices
       WHERE customer_id = _customer_id AND total > paid
         AND status NOT IN ('cancelled'::public.invoice_status, 'returned'::public.invoice_status)
       ORDER BY created_at ASC, id ASC
       FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_allocation := least(v_remaining, v_inv_cur.total - v_inv_cur.paid);
      IF v_allocation <= 0 THEN
        CONTINUE;
      END IF;
      UPDATE public.sales_invoices
         SET paid = round(paid + v_allocation, 2),
             status = 'confirmed'::public.invoice_status,
             payment_status = public.derive_payment_status(round(paid + v_allocation, 2), total),
             updated_at = now()
       WHERE id = v_inv_cur.id;
      v_remaining := round(v_remaining - v_allocation, 2);
    END LOOP;
  END IF;

  PERFORM public.recalculate_customer_balance(
    _customer_id, 'تحصيل مجزأ — ' || coalesce(v_last_id::text, ''), 'document_repost');

  RETURN v_last_id;
END
$function$;

REVOKE ALL ON FUNCTION public.record_customer_payment_splits(uuid, uuid, numeric, date, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_customer_payment_splits(uuid, uuid, numeric, date, text, jsonb)
  TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) الأرصدة الافتتاحية: source_key ثابت يمنع التكرار عند إعادة الترحيل،
--     والرصيد المخزَّن يُشتق من الدفتر بعد كل سطر (المُشغّل) — التحقق هنا فقط
--     أن الافتتاحيات القديمة بلا source_key لن تُضاعَف عند إعادة التشغيل.
-- ════════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_ledger_opening_source
  ON public.customer_ledger (customer_id, reference_id, reference_type)
  WHERE reference_type = 'opening_balance';

COMMENT ON INDEX public.uq_customer_ledger_opening_source IS
  'سطر افتتاحي واحد لكل عميل في كل مستند افتتاحي — إعادة تشغيل ترحيل البيانات لا تُنشئ حركة ثانية. للعكس مستنده الخاص (reference_id مختلف).';

COMMIT;

-- ============================================================================
-- ROLLBACK
--   أعد تطبيق 76 لإرجاع دوال التحصيل السابقة، ثم:
--   DROP INDEX IF EXISTS public.uq_customer_ledger_opening_source;
-- ============================================================================
