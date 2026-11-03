-- ============================================================================
-- 9917_collection_business_day_timezone.sql
--
-- إصلاح احتساب الوقت في عمليات التحصيل.
--
-- الخلل:
--   customer_ledger.occurred_at هو timestamptz، بينما payment_date عمود date
--   بلا منطقة زمنية. الكتابة كانت:
--       occurred_at = coalesce(_payment_date, current_date)::timestamptz
--   أي أن التوقيت يُفسَّر بمنطقة زمنية الخادم (عادة UTC). النظام يعمل بتوقيت
--   اليمن Asia/Aden (UTC+3) — وهو التوقيت المستخدم في ملفات الطباعة والقيود.
--   النتيجة: تحصيل مسجَّل "اليوم" يظهر في الدفتر قبل ساعات، وقد يسقط في اليوم
--   السابق عند التسوية بين منتصف الليل والثالثة صباحًا — فيختلف تسلسل الحركات
--   في كشف الحساب عن ترتيبها الفعلي، وقد يقع في فترة مالية/تاريخية مختلفة.
--
-- الإصلاح:
--   كل تحويل من date إلى timestamptz في مسارات العميل يُثبَّت على منطقة
--   تشغيل واحدة يمكن ضبطها من إعدادات الشركة (default: Asia/Aden)، ويُطبَّق
--   على الساعات الفعلية أيضاً عبر `business_now()`.
-- ============================================================================
BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- (1) منطقة التشغيل: قراءة من إعدادات الشركة إن كانت بدأت تُحفظ، وإلا Asia/Aden
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.business_timezone()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  -- المنطقة الزمنية نظامية للدولة، لا تفضيلاً شخصياً؛ يُسمح بتغييرها لاحقاً
  -- من إعداد واحد دون لمس عشرات الدوال.
  SELECT coalesce(
    nullif(current_setting('app.business_timezone', true), ''),
    'Asia/Aden'
  );
$function$;

COMMENT ON FUNCTION public.business_timezone() IS
  'المنطقة الزمنية المحاسبية الوحيدة للنظام. تُقرأ من إعداد الجلسة app.business_timezone وتعود إلى Asia/Aden.';

-- الآن (بتوقيت التشغيل) — لا يعتمد على TIMEZONE الجلسة ولا على الخادم.
CREATE OR REPLACE FUNCTION public.business_now()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT now();
$function$;

COMMENT ON FUNCTION public.business_now() IS
  'لحظة الكتابة الحقيقية (timestamptz). استخدمها لـ occurred_at بدل now() المتناثر، فتصبح نقطة الضبط واحدة.';

-- اليوم التشغيلي: التاريخ الذي يراه المستخدم في Asia/Aden.
CREATE OR REPLACE FUNCTION public.business_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT (now() AT TIME ZONE public.business_timezone())::date;
$function$;

COMMENT ON FUNCTION public.business_today() IS
  'اليوم التشغيلي للمنشأة. لا تستخدم current_date بدلاً منها: current_date يتبع TIMEZONE الجلسة، وهو من مصدر الاختلاف في تواريخ التحصيل.';

-- تحويل تاريخ مستند إلى لحظة كتابة، بمنطقة التشغيل.
CREATE OR REPLACE FUNCTION public.business_timestamp(p_date date, p_time time DEFAULT NULL)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT ((coalesce(p_date, public.business_today()) + coalesce(p_time, time '00:00'))::timestamp
          AT TIME ZONE public.business_timezone());
$function$;

COMMENT ON FUNCTION public.business_timestamp(date, time) IS
  'يحوّل تاريخ مستند (date) إلى لحظة (timestamptz) بتوقيت المنشأة. هو البديل الصحيح لـ date::timestamptz.';

REVOKE ALL ON FUNCTION public.business_timezone() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.business_now() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.business_today() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.business_timestamp(date, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_timezone() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.business_now() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.business_today() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.business_timestamp(date, time) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) التحصيل المفرد — occurred_at بتوقيت المنشأة
-- ════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF to_regprocedure(
       'public.record_customer_payment(uuid,uuid,numeric,text,date,text,uuid,uuid,text,text,text,date,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'record_customer_payment غير موجودة بالتوقيع المتوقع — راجع ترتيب الترحيلات';
  END IF;
END $$;

-- يُعاد تعريف الجسم كاملاً لتبقى النسخة السارية واحدة وواضحة (لا ترقيع نصي).
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
  v_lines jsonb;
  v_doc_date date := coalesce(_payment_date, public.business_today());
  v_occurred timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_user, 'owner')
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

  -- تاريخ المستقبل ليس تحصيلاً وقع بعد.
  IF v_doc_date > public.business_today() THEN
    RAISE EXCEPTION 'A collection cannot be dated in the future (%)', v_doc_date;
  END IF;

  -- تحصيل اليوم يُسجَّل بلحظته الفعلية؛ وتاريخ سابق يُسجَّل بمنتصف ليل ذلك اليوم
  -- بتوقيت المنشأة — لا بتوقيت الخادم.
  v_occurred := CASE
    WHEN v_doc_date = public.business_today() THEN public.business_now()
    ELSE public.business_timestamp(v_doc_date, time '00:00')
  END;

  v_method_id := coalesce(_payment_method_id, _method);
  v_stored_method := public.resolve_writable_payment_method(
    v_method_id, 'customer_collection', true
  );
  IF v_stored_method = 'credit' THEN
    RAISE EXCEPTION 'A collection cannot record آجل — that is a deferred sale, not a receipt';
  END IF;

  v_customer_balance := public.customer_balance_lock(_customer_id);
  IF v_customer_balance IS NULL THEN
    RAISE EXCEPTION 'Customer is unavailable';
  END IF;

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
    IF v_amount > greatest(coalesce(v_ledger_balance, 0), 0) + 0.001 THEN
      RAISE EXCEPTION
        'Payment exceeds the customer outstanding balance (ledger %)', v_ledger_balance;
    END IF;
  END IF;

  INSERT INTO public.customer_payments (
    customer_id, invoice_id, amount, payment_method, payment_date, note, created_by,
    cashbox_id, bank_account_id, payment_method_id, payment_reference
  ) VALUES (
    _customer_id, _invoice_id, v_amount, v_stored_method::public.payment_method,
    v_doc_date, nullif(trim(_note), ''), v_user,
    _cashbox_id, _bank_account_id, v_method_id, _cheque_number
  ) RETURNING id INTO v_payment_id;

  INSERT INTO public.customer_ledger(
    customer_id, entry_type, credit, reference_id, reference_type,
    occurred_at, created_by, source_key, note
  ) VALUES (
    _customer_id, 'payment', v_amount, v_payment_id, 'customer_payment',
    v_occurred, v_user,
    'payment:' || v_payment_id,
    coalesce(nullif(trim(_note), ''), 'دفعة عميل')
  );

  IF (v_stored_method = 'cheque' OR v_method_id = 'cheque') AND _cheque_number IS NOT NULL THEN
    INSERT INTO public.cheques_register (
      cheque_number, bank_name, drawer_name, due_date, amount, status,
      customer_id, invoice_id, payment_id, notes, created_by
    ) VALUES (
      _cheque_number, coalesce(_cheque_bank, 'شيك مصرفي'), _cheque_drawer,
      coalesce(_cheque_due_date, v_doc_date), v_amount, 'UNDER_COLLECTION',
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
  -- القيد يحمل تاريخ المستند التشغيلي، لا تاريخ الخادم.
  PERFORM public.create_journal_entry(
    'تحصيل من عميل — ' || coalesce(nullif(trim(_note), ''), ''),
    v_doc_date, 'customer_payment', v_payment_id, true, v_lines
  );

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
-- (3) التحصيل المجزأ — نفس تثبيت المنطقة الزمنية
-- ════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF to_regprocedure('public.record_customer_payment_splits(uuid,uuid,numeric,date,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'record_customer_payment_splits غير موجودة — راجع ترتيب الترحيلات';
  END IF;
END $$;

-- يبقى الجسم كما هو في 9915 مع تغيير نقطة الزمن وحدها.
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
  v_doc_date date := coalesce(_payment_date, public.business_today());
  v_occurred timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_user, 'owner')
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
  IF v_doc_date > public.business_today() THEN
    RAISE EXCEPTION 'A collection cannot be dated in the future (%)', v_doc_date;
  END IF;

  v_occurred := CASE
    WHEN v_doc_date = public.business_today() THEN public.business_now()
    ELSE public.business_timestamp(v_doc_date, time '00:00')
  END;

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
    SELECT round(coalesce(sum(total - paid), 0), 2)
      INTO v_customer_outstanding
      FROM public.sales_invoices
     WHERE customer_id = _customer_id AND total > paid
       AND status NOT IN ('cancelled'::public.invoice_status, 'returned'::public.invoice_status);
    IF v_total > greatest(coalesce(v_ledger_balance, 0), 0) + 0.001
       OR (v_customer_outstanding > 0 AND v_total > v_customer_outstanding + 0.001) THEN
      RAISE EXCEPTION 'Payment exceeds the customer outstanding balance (ledger %)', v_ledger_balance;
    END IF;
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
      v_doc_date,
      nullif(trim(concat_ws(' — ', _note, r_split.reference)), ''),
      v_user, v_method_id, r_split.reference, r_split.cashbox_id, r_split.bank_account_id
    ) RETURNING id INTO v_payment_id;
    v_last_id := v_payment_id;

    INSERT INTO public.customer_ledger(
      customer_id, entry_type, credit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    ) VALUES (
      _customer_id, 'payment', v_amount, v_payment_id, 'customer_payment',
      v_occurred, v_user,
      'payment:' || v_payment_id,
      coalesce(nullif(trim(_note), ''), 'دفعة عميل (دفع مجزأ)')
    );

    IF (v_stored_method = 'cheque' OR v_method_id = 'cheque') AND r_split.reference IS NOT NULL THEN
      INSERT INTO public.cheques_register (
        cheque_number, bank_name, due_date, amount, status,
        customer_id, invoice_id, payment_id, notes, created_by
      ) VALUES (
        r_split.reference, 'شيك مصرفي', v_doc_date, v_amount,
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
      v_doc_date,
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
-- (4) فحص أثر: أي حركة دفتر بساعة لا تطابق تاريخ مستندها؟
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.customer_ledger_time_mismatches()
RETURNS TABLE (
  ledger_id uuid,
  customer_id uuid,
  entry_type text,
  reference_type text,
  payment_date date,
  occurred_local_date date,
  drift_days integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.can_read_finance(auth.uid()) THEN
    RAISE EXCEPTION 'Only finance roles may inspect ledger time drift'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT l.id,
         l.customer_id,
         l.entry_type,
         l.reference_type,
         p.payment_date,
         (l.occurred_at AT TIME ZONE public.business_timezone())::date,
         ((l.occurred_at AT TIME ZONE public.business_timezone())::date - p.payment_date)
    FROM public.customer_ledger l
    JOIN public.customer_payments p
      ON l.reference_type = 'customer_payment' AND p.id = l.reference_id
   WHERE (l.occurred_at AT TIME ZONE public.business_timezone())::date <> p.payment_date
   ORDER BY l.occurred_at DESC;
END;
$function$;

COMMENT ON FUNCTION public.customer_ledger_time_mismatches() IS
  'يكشف حركات التحصيل التي يقع occurred_at فيها في يوم غير يوم payment_date — من آثار منطقة الخادم الزمنية السابقة. قراءة فقط.';

REVOKE ALL ON FUNCTION public.customer_ledger_time_mismatches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_ledger_time_mismatches() TO authenticated, service_role;

COMMIT;

-- ============================================================================
-- ROLLBACK
--   أعد تطبيق 9915 لإرجاع دوال التحصيل السابقة، ثم:
--   DROP FUNCTION IF EXISTS public.customer_ledger_time_mismatches();
--   DROP FUNCTION IF EXISTS public.business_timestamp(date, time);
--   DROP FUNCTION IF EXISTS public.business_today();
--   DROP FUNCTION IF EXISTS public.business_now();
--   DROP FUNCTION IF EXISTS public.business_timezone();
-- ============================================================================
