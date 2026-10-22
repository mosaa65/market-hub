-- ============================================================================
-- 19_accounting_phase1b_returns_expenses_adjustments.sql
-- المرحلة 1 (تكملة): T-07, T-08(مشتريات), T-09, T-10
-- ══════════════
-- يعتمد على 18 (دالة balance_and_post_return) وعلى المرحلة 0 (T-01..T-04).
-- ── القرارات المحاسبية الموثّقة ──
-- T-07 مصروف: Dr حساب التصنيف (أو 5911) صافيًا + Dr 1316 ضريبة مدخلات إن وجدت
--            / Cr 2111 إن كان مورّدًا أو Cr حساب الطريقة (نقد/بنك) إن سُدّد.
-- T-09 تسوية مخزون: النقص Dr 5921 / Cr المخزون؛ الفائض Dr المخزون / Cr 5911.
-- T-10 تحصيل/دفعة مقدمة: Dr نقد/بنك (حسب الطريقة) / Cr 1211 ذم العميل.
-- ══════════════════════

BEGIN;

-- ════════════════════
-- T-08(ب) — قيد مرتجع المشتريات + إيقاف greatest(...,0) على رصيد المورد
-- ════════════════════

CREATE OR REPLACE FUNCTION public.create_purchase_return(_invoice_id uuid, _warehouse_id uuid, _supplier_id uuid, _refund_method text, _note text, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id     uuid;
  v_no     text;
  v_user   uuid := auth.uid();
  v_item   jsonb;
  v_sub    numeric := 0;
  v_tax    numeric := 0;
  v_tot    numeric := 0;
  v_qty    numeric;
  v_cost   numeric;
  v_tr     numeric;
  v_lt     numeric;
  v_ltax   numeric;
  v_p      uuid;
  v_effect text;
  v_type   text;
  v_avail  numeric;
  v_entry  uuid;
  v_lines  jsonb := '[]'::jsonb;
  v_cash_acct text;
  r        record;
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
    v_p    := (v_item ->> 'product_id')::uuid;
    v_qty  := (v_item ->> 'quantity')::numeric;
    v_cost := (v_item ->> 'unit_cost')::numeric;
    v_tr   := coalesce((v_item ->> 'tax_rate')::numeric, 0);

    v_effect := public.item_stock_effect(v_p, 'out');

    -- Only a tracked good has stock to send back.
    IF v_effect = 'STOCK_ISSUE' THEN
      SELECT i.quantity INTO v_avail
      FROM public.inventory i
      WHERE i.product_id = v_p
        AND i.warehouse_id = _warehouse_id
        AND i.owner_type = 'COMPANY'
        AND i.owner_id IS NULL;

      IF coalesce(v_avail, 0) < v_qty THEN
        RAISE EXCEPTION 'Insufficient stock for item %', v_p;
      END IF;
    END IF;

    v_lt   := v_qty * v_cost;
    v_ltax := v_lt * v_tr / 100;
    v_sub  := v_sub + v_lt;
    v_tax  := v_tax + v_ltax;
  END LOOP;
  v_tot := v_sub + v_tax;
  v_no  := public.next_purchase_return_number();

  INSERT INTO public.purchase_returns (
    return_number, invoice_id, supplier_id, warehouse_id,
    subtotal, tax, total, refund_method, note, created_by
  )
  VALUES (
    v_no, _invoice_id, _supplier_id, _warehouse_id,
    v_sub, v_tax, v_tot, _refund_method::public.payment_method,
    nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p    := (v_item ->> 'product_id')::uuid;
    v_qty  := (v_item ->> 'quantity')::numeric;
    v_cost := (v_item ->> 'unit_cost')::numeric;
    v_tr   := coalesce((v_item ->> 'tax_rate')::numeric, 0);
    v_lt   := v_qty * v_cost;
    v_ltax := v_lt * v_tr / 100;

    v_type   := public.item_line_type(v_p, false);
    v_effect := public.item_stock_effect(v_p, 'out');

    INSERT INTO public.purchase_return_items (
      return_id, product_id, quantity, unit_cost, tax, total, line_type
    )
    VALUES (v_id, v_p, v_qty, v_cost, v_ltax, v_lt + v_ltax, v_type);

    IF v_effect = 'STOCK_ISSUE' THEN
      PERFORM public.post_stock_delta(
        v_p,
        _warehouse_id,
        -v_qty,
        v_cost,
        'ISSUE'::public.stock_movement_kind,
        'purchase_return',
        v_id,
        'Purchase return',
        'COMPANY'::public.owner_type,
        NULL,
        'purchase_return'::public.movement_type
      );
    END IF;
  END LOOP;

  -- T-12: رصيد المورد يتغير فعليًا ويمكن أن يصير سالبًا (دائنًا لنا —
  -- مبلغ مسترد مستحق) بدل إخفاء الفرق بـ greatest(...,0).
  IF _supplier_id IS NOT NULL THEN
    UPDATE public.suppliers
    SET balance = round(coalesce(balance, 0) - v_tot, 2), updated_at = now()
    WHERE id = _supplier_id;
  END IF;

  -- ── T-08(ب): قيد المرتجع — أطراف قيد المشتريات المقلوبة ──────────────────
  IF v_tot <> 0 THEN
    -- عكس المخزون/مصروف المشتريات (صافي ضريبة البند)، مجمّعًا حسب النوع.
    FOR r IN
      SELECT p.item_class,
             sum(ri.total - coalesce(ri.tax, 0)) AS net_amount
        FROM public.purchase_return_items ri
        LEFT JOIN public.products p ON p.id = ri.product_id
       WHERE ri.return_id = v_id
       GROUP BY p.item_class
      HAVING sum(ri.total - coalesce(ri.tax, 0)) <> 0
    LOOP
      v_lines := v_lines || jsonb_build_object(
        'account_code', CASE r.item_class
                          WHEN 'RAW_MATERIAL' THEN '1311'
                          WHEN 'BY_PRODUCT'   THEN '1314'
                          WHEN 'SERVICE'      THEN '5911'
                          ELSE '1313' END,
        'credit', round(r.net_amount, 2),
        'memo', 'مرتجع مشتريات ' || coalesce(r.item_class, 'GOOD'));
    END LOOP;

    IF v_tax <> 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', '1316', 'credit', round(v_tax, 2),
        'memo', 'عكس ضريبة المدخلات');
    END IF;

    -- الطرف المدين: إن كان الاسترداد نقدًا/بنكًا فهو مدين نقدًا (استرِدّ فعلاً)،
    -- وإلا فهو عكس ذمة المورد (مدين على 2111).
    v_cash_acct := public.payment_method_ledger_account(_refund_method);
    IF v_cash_acct IS NOT NULL THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', v_cash_acct, 'debit', round(v_tot, 2),
        'memo', 'استرداد من المورد');
    ELSE
      v_lines := v_lines || jsonb_build_object(
        'account_code', '2111', 'debit', round(v_tot, 2),
        'memo', 'عكس ذمة المورد');
    END IF;

    v_entry := public.balance_and_post_return(
      'مرتجع مشتريات ' || v_no, CURRENT_DATE, 'purchase_return', v_id, v_lines);
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'purchase_return.posted', 'purchase_return', v_id,
    jsonb_build_object(
      'return_number', v_no,
      'invoice_id', _invoice_id,
      'supplier_id', _supplier_id,
      'total', v_tot,
      'journal_entry_id', v_entry
    ));

  RETURN v_id;
END $function$;

COMMENT ON FUNCTION public.create_purchase_return(uuid, uuid, uuid, text, text, jsonb) IS
  'T-08/T-12: مرتجع مشتريات بقيد أستاذ عكسي ورصيد مورد فعلي (قد يكون سالبًا).';

-- ════════════
-- T-07 — قيد المصروف عند الترحيل + قيد الدفعة وعكسهما
-- ════════════════════

-- حاسم كود حساب التصنيف (أو الافتراضي 5911) وضريبة المصروف مجمعتين.
CREATE OR REPLACE FUNCTION public.expense_ledger_summary(p_entry_id uuid, OUT o_net numeric, OUT o_tax numeric, OUT o_account_code text)
RETURNS record
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    round(COALESCE(sum(l.net_amount), 0), 2) AS o_net,
    round(COALESCE(sum(l.tax_amount), 0), 2) AS o_tax,
    COALESCE((SELECT a.code
                FROM public.expense_categories c
                JOIN public.accounts a ON a.id = c.account_id
               WHERE c.id = (SELECT category_id
                               FROM public.expense_lines
                              WHERE entry_id = p_entry_id
                              ORDER BY line_no LIMIT 1)
                 AND c.account_id IS NOT NULL), '5911') AS o_account_code
  FROM public.expense_lines l
  WHERE l.entry_id = p_entry_id;
$$;

COMMENT ON FUNCTION public.expense_ledger_summary(uuid) IS
  'T-07: صافي المصروف وضريبته وحسابه من التصنيف — مصدر وحيد لقيد المصروف.';

CREATE OR REPLACE FUNCTION public.post_expense(p_entry_id uuid, p_expected_version integer DEFAULT NULL::integer, p_pay_now boolean DEFAULT false, p_payment_method payment_method DEFAULT 'cash'::payment_method, p_account_label text DEFAULT NULL::text, p_payment_date date DEFAULT NULL::date, p_idempotency_key text DEFAULT NULL::text, p_account_id uuid DEFAULT NULL::uuid)
 RETURNS expense_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user  uuid := public.expense_actor();
  v_entry public.expense_entries;
  v_from  public.expense_status;
  v_led   record;
  v_entry_journal uuid;
  v_lines jsonb := '[]'::jsonb;
  v_cash_acct text;
BEGIN
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002';
  END IF;

  v_from := v_entry.status;

  IF v_from = 'POSTED' THEN
    RETURN v_entry;
  END IF;

  IF v_from NOT IN ('APPROVED', 'DRAFT') THEN
    RAISE EXCEPTION 'This expense cannot be posted from status %', v_from
      USING ERRCODE = '55000';
  END IF;

  PERFORM public.expense_assert_capability(v_user, 'expense.post');

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_entry.version THEN
    RAISE EXCEPTION 'This expense was changed by someone else. Reload it and try again.'
      USING ERRCODE = '40001';
  END IF;

  IF v_entry.total_amount <= 0 OR v_entry.line_count = 0 THEN
    RAISE EXCEPTION 'Cannot post an expense with no lines' USING ERRCODE = '22023';
  END IF;

  IF v_from = 'DRAFT' AND NOT public.expense_can(v_user, 'expense.approve') THEN
    RAISE EXCEPTION 'Submit this expense for approval before posting it'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.expense_entries
     SET status       = 'POSTED',
         posting_date = COALESCE(posting_date, CURRENT_DATE),
         posted_by    = v_user,
         posted_at    = now(),
         version      = version + 1
   WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  PERFORM public.expense_log_action(p_entry_id, 'posted', v_from, 'POSTED', NULL, v_user);

  -- ── T-07: قيد المصروف في الأستاذ ──────────────────────────────────────────
  -- Dr حساب المصروف (من التصنيف) صافيًا + Dr 1316 ضريبة مدخلات إن وجدت
  -- / Cr الطرف: مورّد → 2111، وإلا → حساب طريقة الدفع (نقد/بنك) إذا سُدّد فورًا
  -- أو 2221 مصروفات مستحقة إذا لم يُسدَّد بعد.
  SELECT * INTO v_led FROM public.expense_ledger_summary(p_entry_id);

  v_lines := v_lines || jsonb_build_object(
    'account_code', v_led.o_account_code, 'debit', v_led.o_net,
    'memo', 'مصروف ' || v_entry.reference);
  IF v_led.o_tax > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1316', 'debit', v_led.o_tax,
      'memo', 'ضريبة مدخلات على مصروف');
  END IF;

  v_cash_acct := public.payment_method_ledger_account(p_payment_method);
  IF v_entry.payee_type = 'SUPPLIER' AND v_entry.supplier_id IS NOT NULL
     AND NOT coalesce(p_pay_now, false) THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2111', 'credit', round(v_entry.total_amount, 2),
      'memo', 'ذمة مورد — مصروف ' || v_entry.reference);
  ELSIF coalesce(p_pay_now, false) AND v_cash_acct IS NOT NULL THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_cash_acct, 'credit', round(v_entry.total_amount, 2),
      'memo', 'دفع مصروف ' || v_entry.reference);
  ELSE
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2221', 'credit', round(v_entry.total_amount, 2),
      'memo', 'مصروف مستحق الدفع');
  END IF;

  v_entry_journal := public.create_journal_entry(
    'مصروف ' || v_entry.reference,
    COALESCE(v_entry.expense_date, CURRENT_DATE),
    'expense', p_entry_id, true, v_lines);

  IF p_pay_now THEN
    SELECT * INTO v_entry FROM public.record_expense_payment(
      p_entry_id,
      v_entry.total_amount,
      COALESCE(p_payment_date, CURRENT_DATE),
      p_payment_method,
      p_account_label,
      NULL,
      'Settled at posting',
      COALESCE(p_idempotency_key, 'post:' || p_entry_id::text),
      p_account_id
    );
  END IF;

  RETURN v_entry;
END $function$;

COMMENT ON FUNCTION public.post_expense(uuid, integer, boolean, payment_method, text, date, text, uuid) IS
  'T-07: ترحيل المصروف للاستحقاق مع قيد أستاذ مزدوج (مصروف+ضريبة مقابل ذمة/نقد/مستحق).';

-- قيد الدفعة: Dr نقد/بنك (من الكتالوج أو p_account_id) / Cr 2111 أو 2221
-- (الطرف الائتماني نفسه الذي ورد في قيد الترحيل). التحديد: الدفعة تسدّد
-- ذمة موجودة؛ بمعرفة payee_type نحدد الحساب الائتماني نفسه.
CREATE OR REPLACE FUNCTION public.record_expense_payment(p_entry_id uuid, p_amount numeric, p_payment_date date DEFAULT CURRENT_DATE, p_payment_method payment_method DEFAULT 'cash'::payment_method, p_account_label text DEFAULT NULL::text, p_reference_no text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_account_id uuid DEFAULT NULL::uuid)
 RETURNS expense_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user      uuid := public.expense_actor();
  v_entry     public.expense_entries;
  v_amount    numeric(18,2);
  v_existing  public.expense_payments;
  v_label     text := nullif(btrim(coalesce(p_account_label, '')), '');
  v_cash_acct text;
  v_lines     jsonb := '[]'::jsonb;
  v_entry_journal uuid;
  v_credit_acct text;
BEGIN
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.expense_assert_capability(v_user, 'expense.pay');

  IF v_entry.status NOT IN ('POSTED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'Payments can only be recorded against posted expenses (current: %)', v_entry.status
      USING ERRCODE = '55000';
  END IF;

  v_amount := public.expense_round(p_amount);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero' USING ERRCODE = '22023';
  END IF;

  IF v_amount > v_entry.remaining_amount + 0.005 THEN
    RAISE EXCEPTION 'Payment (%) exceeds remaining amount (%)', v_amount, v_entry.remaining_amount
      USING ERRCODE = '22023';
  END IF;

  -- If financial account provided, fetch label default if label is empty
  IF p_account_id IS NOT NULL AND v_label IS NULL AND to_regclass('public.accounts') IS NOT NULL THEN
    SELECT name_ar INTO v_label FROM public.accounts WHERE id = p_account_id;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.expense_payments
     WHERE idempotency_key = btrim(p_idempotency_key);
    IF FOUND THEN
      RETURN v_entry;
    END IF;
  END IF;

  INSERT INTO public.expense_payments (
    entry_id, amount, payment_date, payment_method,
    account_label, reference_no, note, idempotency_key, created_by,
    account_id
  )
  VALUES (
    p_entry_id, v_amount, COALESCE(p_payment_date, CURRENT_DATE),
    COALESCE(p_payment_method, 'cash'),
    v_label,
    nullif(btrim(coalesce(p_reference_no, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    nullif(btrim(coalesce(p_idempotency_key, '')), ''),
    v_user,
    p_account_id
  );

  -- ── T-07: قيد الدفعة ─────────────────────────────────────────────────────
  -- Dr حساب النقد/البنك (من p_account_id إن وُجد وإلا الكتالوج)
  -- / Cr الحساب الائتماني نفسه (2111 للمورد، 2221 لمستحق عام).
  IF p_account_id IS NOT NULL THEN
    SELECT code INTO v_cash_acct FROM public.accounts WHERE id = p_account_id;
  END IF;
  IF v_cash_acct IS NULL THEN
    v_cash_acct := public.payment_method_ledger_account(
      COALESCE(p_payment_method::text, 'cash'));
  END IF;
  v_credit_acct := CASE
    WHEN v_entry.payee_type = 'SUPPLIER' AND v_entry.supplier_id IS NOT NULL THEN '2111'
    ELSE '2221' END;

  v_lines := v_lines
    || jsonb_build_object('account_code', v_cash_acct, 'debit', v_amount,
                          'memo', 'سداد مصروف ' || v_entry.reference)
    || jsonb_build_object('account_code', v_credit_acct, 'credit', v_amount,
                          'memo', 'سداد مصروف ' || v_entry.reference);

  v_entry_journal := public.create_journal_entry(
    'سداد مصروف ' || v_entry.reference,
    COALESCE(p_payment_date, CURRENT_DATE),
    'expense_payment', (SELECT id FROM public.expense_payments
                         WHERE entry_id = p_entry_id
                         ORDER BY created_at DESC LIMIT 1), true, v_lines);

  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id;

  PERFORM public.expense_log_action(
    p_entry_id, 'payment', v_entry.status, v_entry.status,
    'Payment of ' || v_amount::text || ' ' || v_entry.currency_symbol || ' recorded',
    v_user
  );

  RETURN v_entry;
END $function$;

COMMENT ON FUNCTION public.record_expense_payment(uuid, numeric, date, payment_method, text, text, text, text, uuid) IS
  'T-07: دفعة مصروف بقيد أستاذ (نقد/بنك مدين مقابل الذمة الائتمانية).';

-- عكس المصروف يعكس قيده في الأستاذ.
CREATE OR REPLACE FUNCTION public.reverse_expense(p_entry_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS expense_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user     uuid := public.expense_actor();
  v_entry    public.expense_entries;
  v_reversal public.expense_entries;
  v_original uuid;
BEGIN
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.expense_assert_capability(v_user, 'expense.reverse');

  IF v_entry.status = 'REVERSED' THEN
    RETURN v_entry;   -- idempotent: reversing twice is a no-op, not an error
  END IF;
  IF v_entry.status NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID') THEN
    RAISE EXCEPTION 'Only a posted expense can be reversed (current: %)', v_entry.status
      USING ERRCODE = '55000';
  END IF;
  -- Money already sitting in the drawer has to be dealt with through the
  -- payment record, not by erasing the document that produced it.
  IF v_entry.paid_amount > 0 THEN
    RAISE EXCEPTION 'Reverse the recorded payments first (paid: %)', v_entry.paid_amount
      USING ERRCODE = '55000';
  END IF;

  -- T-07: عكس قيد المصروف في الأستاذ قبل إنشاء المستند العكسي.
  SELECT je.id INTO v_original
    FROM public.journal_entries je
   WHERE je.source_type = 'expense' AND je.source_id = p_entry_id
     AND je.status <> 'REVERSED';
  IF v_original IS NOT NULL THEN
    PERFORM public.reverse_journal_entry(v_original,
      COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'عكس المصروف'));
  END IF;

  INSERT INTO public.expense_entries (
    reference, entry_type, status, source_kind,
    payee_type, payee_name, supplier_id, employee_id,
    warehouse_id, cost_center_id, project_id,
    expense_date, posting_date, description, note,
    tax_mode, currency, currency_symbol,
    reversal_of, created_by, posted_by, posted_at
  )
  VALUES (
    v_entry.reference || '-R',
    v_entry.entry_type,
    -- The reversal is itself posted: it is a recognised, immutable correction.
    'POSTED',
    v_entry.source_kind,
    v_entry.payee_type, v_entry.payee_name, v_entry.supplier_id, v_entry.employee_id,
    v_entry.warehouse_id, v_entry.cost_center_id, v_entry.project_id,
    CURRENT_DATE, CURRENT_DATE,
    'Reversal of ' || v_entry.reference,
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_entry.tax_mode, v_entry.currency, v_entry.currency_symbol,
    v_entry.id, v_user, v_user, now()
  )
  RETURNING * INTO v_reversal;

  -- Mirror the lines so the reversal is a real, reportable document rather than
  -- an amount with no category — otherwise the reversal would vanish from the
  -- by-category report and leave that report showing an expense that no longer
  -- exists.
  INSERT INTO public.expense_lines (
    entry_id, line_no, description, category_id, quantity, unit_price,
    net_amount, tax_rate, tax_amount, gross_amount,
    cost_center_id, project_id, note
  )
  SELECT
    v_reversal.id, line_no, description, category_id, quantity, unit_price,
    net_amount, tax_rate, tax_amount, gross_amount,
    cost_center_id, project_id, note
  FROM public.expense_lines
  WHERE entry_id = p_entry_id
  ORDER BY line_no;

  UPDATE public.expense_entries
     SET total_amount = v_entry.total_amount,
         line_count   = v_entry.line_count
   WHERE id = v_reversal.id
  RETURNING * INTO v_reversal;

  UPDATE public.expense_entries
     SET status         = 'REVERSED',
         reversed_by_id = v_reversal.id,
         version        = version + 1
   WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  PERFORM public.expense_log_action(
    p_entry_id, 'reversed', 'POSTED', 'REVERSED',
    COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Reversed'), v_user);

  RETURN v_entry;
END $function$;

COMMENT ON FUNCTION public.reverse_expense(uuid, text) IS
  'T-07: عكس مصروف يعكس قيده في الأستاذ (reverse_journal_entry) قبل إنشاء المستند العكسي.';

-- ════════════════════
-- T-09 — قيد تسوية المخزون
-- ════════════

CREATE OR REPLACE FUNCTION public.post_stock_adjustment(_warehouse_id uuid, _reason text, _note text, _effective_date date, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user       uuid := auth.uid();
  v_id         uuid;
  v_number     text;
  v_line       record;
  v_policy     public.inventory_policy;
  v_nature     public.item_nature;
  v_total      numeric := 0;
  v_line_total numeric;
  v_entry      uuid;
  v_stock_code text;
  v_lines      jsonb := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'warehouse')
    OR public.has_role(v_user, 'accountant')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to post stock adjustments';
  END IF;

  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required';
  END IF;

  IF coalesce(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'A documented reason is required for every stock adjustment';
  END IF;

  IF coalesce(jsonb_typeof(_items), '') <> 'array'
     OR coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'A stock adjustment requires at least one item';
  END IF;

  FOR v_line IN
    SELECT (line ->> 'product_id')::uuid                 AS product_id,
           (line ->> 'quantity')::numeric                AS quantity,
           coalesce((line ->> 'unit_cost')::numeric, 0)  AS unit_cost,
           nullif(btrim(coalesce(line ->> 'note', '')), '') AS note
    FROM jsonb_array_elements(_items) AS line
  LOOP
    IF v_line.product_id IS NULL OR v_line.quantity IS NULL OR v_line.quantity = 0 THEN
      RAISE EXCEPTION 'Every adjustment line requires an item and a non-zero quantity';
    END IF;

    SELECT p.item_nature INTO v_nature FROM public.products p WHERE p.id = v_line.product_id;
    IF v_nature IS NULL THEN
      RAISE EXCEPTION 'Item % does not exist', v_line.product_id;
    END IF;
    IF v_nature = 'SERVICE' THEN
      RAISE EXCEPTION 'Item % is a SERVICE and has no inventory to adjust', v_line.product_id;
    END IF;

    v_policy := public.item_effective_policy(v_line.product_id);
    IF v_policy <> 'TRACKED' THEN
      RAISE EXCEPTION
        'Item % has inventory policy %, so it has no inventory balance to adjust',
        v_line.product_id, v_policy;
    END IF;
  END LOOP;

  v_number := public.next_stock_adjustment_number();

  INSERT INTO public.stock_adjustments (document_number, warehouse_id, effective_date, reason, note, created_by)
  VALUES (v_number, _warehouse_id, coalesce(_effective_date, current_date), btrim(_reason),
          nullif(btrim(coalesce(_note, '')), ''), v_user)
  RETURNING id INTO v_id;

  FOR v_line IN
    SELECT (line ->> 'product_id')::uuid                 AS product_id,
           (line ->> 'quantity')::numeric                AS quantity,
           coalesce((line ->> 'unit_cost')::numeric, 0)  AS unit_cost,
           nullif(btrim(coalesce(line ->> 'note', '')), '') AS note
    FROM jsonb_array_elements(_items) AS line
  LOOP
    v_line_total := round(abs(v_line.quantity) * v_line.unit_cost, 2);
    v_total := v_total + v_line_total;

    -- حساب المخزون حسب item_class للقيد.
    SELECT CASE p.item_class
             WHEN 'RAW_MATERIAL' THEN '1311'
             WHEN 'BY_PRODUCT'   THEN '1314'
             ELSE '1313' END
      INTO v_stock_code
    FROM public.products p WHERE p.id = v_line.product_id;

    INSERT INTO public.stock_adjustment_items (adjustment_id, product_id, quantity, unit_cost, total_cost, note)
    VALUES (v_id, v_line.product_id, v_line.quantity, v_line.unit_cost, v_line_total, v_line.note);

    -- signed quantity goes straight through: positive adds, negative removes.
    PERFORM public.post_stock_delta(
      v_line.product_id,
      _warehouse_id,
      v_line.quantity,
      v_line.unit_cost,
      'ADJUSTMENT'::public.stock_movement_kind,
      'stock_adjustment',
      v_id,
      coalesce(v_line.note, btrim(_reason)),
      'COMPANY'::public.owner_type,
      NULL,
      'adjustment'::public.movement_type
    );

    -- ── T-09: سطر القيد لهذا الصنف ──────────────────────────────────────
    IF v_line.quantity < 0 THEN
      v_lines := v_lines
        || jsonb_build_object('account_code', '5921', 'debit', v_line_total,
                              'memo', 'نقص جرد — ' || btrim(_reason))
        || jsonb_build_object('account_code', v_stock_code, 'credit', v_line_total,
                              'memo', 'مخزون');
    ELSE
      v_lines := v_lines
        || jsonb_build_object('account_code', v_stock_code, 'debit', v_line_total,
                              'memo', 'فائض جرد')
        || jsonb_build_object('account_code', '5911', 'credit', v_line_total,
                              'memo', 'فائض جرد — ' || btrim(_reason));
    END IF;
  END LOOP;

  -- The DB constraint requires a coded reason on every adjustment movement.
  UPDATE public.stock_movements
  SET adjustment_reason = btrim(_reason)
  WHERE source_type = 'stock_adjustment'
    AND source_id = v_id
    AND movement_kind = 'ADJUSTMENT'
    AND adjustment_reason IS NULL;

  UPDATE public.stock_adjustments SET total_value = v_total WHERE id = v_id;

  -- ── T-09: قيد التسوية في الأستاذ ──────────────────────────────────────
  IF v_total > 0 AND jsonb_array_length(v_lines) >= 2 THEN
    v_entry := public.create_journal_entry(
      'تسوية مخزون ' || v_number, coalesce(_effective_date, current_date),
      'stock_adjustment', v_id, true, v_lines);
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'stock_adjustment.posted', 'stock_adjustment', v_id,
    jsonb_build_object(
      'document_number', v_number,
      'warehouse_id', _warehouse_id,
      'reason', btrim(_reason),
      'effective_date', coalesce(_effective_date, current_date),
      'lines', jsonb_array_length(_items),
      'total_value', v_total,
      'journal_entry_id', v_entry
    ));

  RETURN v_id;
END $function$;

COMMENT ON FUNCTION public.post_stock_adjustment(uuid, text, text, date, jsonb) IS
  'T-09: تسوية مخزون بقيد أستاذ — نقص Dr 5921/Cr مخزون، فائض Dr مخزون/Cr 5911. (التوقيع والسلوك التشغيلي بلا تغيير — القيد إضافة).';

-- ════════════════════
-- T-10 — قيد التحصيل والدفعة المقدمة
-- ════════════════════

CREATE OR REPLACE FUNCTION public.record_customer_payment(_customer_id uuid, _invoice_id uuid, _amount numeric, _method text, _payment_date date, _note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_user uuid := auth.uid();
  v_invoice record;
  v_customer_balance numeric;
  v_remaining numeric := round(coalesce(_amount, 0), 2);
  v_allocation numeric;
  v_outstanding numeric := 0;
  v_stored_method text;
  v_cash_acct text;
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
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

  IF _customer_id IS NULL OR v_remaining <= 0 THEN
    RAISE EXCEPTION 'A customer and a positive amount are required';
  END IF;

  -- الحارس الموحّد: يطبّع القيمة عبر كتالوج طرق الدفع ويعيد القيمة المخزّنة.
  v_stored_method := public.resolve_writable_payment_method(
    _method, 'customer_collection', true
  );

  -- صف العميل هو قفل التسلسل لكل سندات هذا العميل.
  SELECT balance
    INTO v_customer_balance
  FROM public.customers
  WHERE id = _customer_id
    AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer is unavailable';
  END IF;

  v_cash_acct := public.payment_method_ledger_account(v_stored_method);

  IF _invoice_id IS NOT NULL THEN
    SELECT id, total, paid, customer_id
      INTO v_invoice
    FROM public.sales_invoices
    WHERE id = _invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;

    IF v_invoice.customer_id IS DISTINCT FROM _customer_id THEN
      RAISE EXCEPTION 'Invoice does not belong to this customer';
    END IF;

    IF v_invoice.total - v_invoice.paid <= 0 THEN
      RAISE EXCEPTION 'Invoice has no outstanding balance';
    END IF;

    IF v_remaining > v_invoice.total - v_invoice.paid THEN
      RAISE EXCEPTION 'Payment exceeds the invoice outstanding balance';
    END IF;

    INSERT INTO public.customer_payments (
      customer_id, invoice_id, amount, payment_method, payment_date, note, created_by
    )
    VALUES (
      _customer_id, _invoice_id, v_remaining, v_stored_method::public.payment_method,
      coalesce(_payment_date, current_date), nullif(trim(_note), ''), v_user
    )
    RETURNING id INTO v_id;

    INSERT INTO public.customer_ledger(customer_id, entry_type, credit, reference_id, reference_type, occurred_at, created_by, source_key, note)
    VALUES (_customer_id, 'payment', v_remaining, v_id, 'customer_payment', coalesce(_payment_date, current_date)::timestamptz, v_user, 'payment:' || v_id, coalesce(nullif(trim(_note), ''), 'دفعة عميل'))
    ON CONFLICT (source_key) DO NOTHING;

    UPDATE public.sales_invoices
    SET paid = paid + v_remaining,
        -- حالة الدورة تبقى «مؤكدة» — الدفع لا يغيّرها.
        -- حالة السداد تُحدّث في عمودها المستقل.
        status = 'confirmed'::public.invoice_status,
        payment_status = public.derive_payment_status(paid + v_remaining, total),
        updated_at = now()
    WHERE id = _invoice_id;

    -- ── T-10: قيد التحصيل ─────────────────────────────────────────────────
    IF v_cash_acct IS NOT NULL THEN
      v_lines := v_lines
        || jsonb_build_object('account_code', v_cash_acct, 'debit', v_remaining,
                              'memo', 'تحصيل من عميل')
        || jsonb_build_object('account_code', '1211', 'credit', v_remaining,
                              'memo', 'تحصيل من عميل');
      v_journal := public.create_journal_entry(
        'تحصيل من عميل — ' || coalesce(nullif(trim(_note), ''), ''),
        COALESCE(_payment_date, CURRENT_DATE),
        'customer_payment', v_id, true, v_lines);
    END IF;

  ELSE
    -- لا فاتورة مختارة: تُستهلك أقدم الذمم أولًا.
    SELECT coalesce(sum(total - paid), 0)
      INTO v_outstanding
    FROM public.sales_invoices
    WHERE customer_id = _customer_id
      AND total > paid
      AND status NOT IN ('cancelled'::public.invoice_status, 'returned'::public.invoice_status);

    IF v_outstanding <= 0 AND coalesce(v_customer_balance, 0) <= 0 THEN
      RAISE EXCEPTION 'Customer has no outstanding balance. Record an explicit advance payment instead.';
    END IF;
    IF v_outstanding > 0 AND v_remaining > v_outstanding THEN
      RAISE EXCEPTION 'Payment exceeds the customer outstanding balance';
    END IF;

    IF v_outstanding <= 0 THEN
      IF v_remaining > v_customer_balance THEN
        RAISE EXCEPTION 'Payment exceeds the customer outstanding balance';
      END IF;

      INSERT INTO public.customer_payments (
        customer_id, invoice_id, amount, payment_method, payment_date, note, created_by
      )
      VALUES (
        _customer_id, NULL, v_remaining, v_stored_method::public.payment_method,
        coalesce(_payment_date, current_date),
        coalesce(nullif(trim(_note), ''), 'سداد رصيد غير مرتبط بفاتورة'), v_user
      )
      RETURNING id INTO v_id;

      INSERT INTO public.customer_ledger(customer_id, entry_type, credit, reference_id, reference_type, occurred_at, created_by, source_key, note)
      VALUES (_customer_id, 'payment', v_remaining, v_id, 'customer_payment', coalesce(_payment_date, current_date)::timestamptz, v_user, 'payment:' || v_id, coalesce(nullif(trim(_note), ''), 'سداد رصيد غير مرتبط بفاتورة'))
      ON CONFLICT (source_key) DO NOTHING;

      -- ── T-10: قيد التحصيل ───────────────────────────────────────────────
      IF v_cash_acct IS NOT NULL THEN
        v_lines := v_lines
          || jsonb_build_object('account_code', v_cash_acct, 'debit', v_remaining,
                                'memo', 'تحصيل من عميل')
          || jsonb_build_object('account_code', '1211', 'credit', v_remaining,
                                'memo', 'تحصيل من عميل');
        v_journal := public.create_journal_entry(
          'تحصيل من عميل', COALESCE(_payment_date, CURRENT_DATE),
          'customer_payment', v_id, true, v_lines);
      END IF;

      v_remaining := 0;
    END IF;

    FOR v_invoice IN
      SELECT id, total, paid
      FROM public.sales_invoices
      WHERE customer_id = _customer_id
        AND total > paid
        AND status NOT IN ('cancelled'::public.invoice_status, 'returned'::public.invoice_status)
      ORDER BY created_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_allocation := least(v_remaining, v_invoice.total - v_invoice.paid);

      INSERT INTO public.customer_payments (
        customer_id, invoice_id, amount, payment_method, payment_date, note, created_by
      )
      VALUES (
        _customer_id, v_invoice.id, v_allocation, v_stored_method::public.payment_method,
        coalesce(_payment_date, current_date), nullif(trim(_note), ''), v_user
      )
      RETURNING id INTO v_id;

      INSERT INTO public.customer_ledger(customer_id, entry_type, credit, reference_id, reference_type, occurred_at, created_by, source_key, note)
      VALUES (_customer_id, 'payment', v_allocation, v_id, 'customer_payment', coalesce(_payment_date, current_date)::timestamptz, v_user, 'payment:' || v_id, coalesce(nullif(trim(_note), ''), 'دفعة عميل'))
      ON CONFLICT (source_key) DO NOTHING;

      UPDATE public.sales_invoices
      SET paid = paid + v_allocation,
          status = 'confirmed'::public.invoice_status,
          payment_status = public.derive_payment_status(paid + v_allocation, total),
          updated_at = now()
      WHERE id = v_invoice.id;

      -- ── T-10: قيد التحصيل لكل سند ────────────────────────────────────────
      IF v_cash_acct IS NOT NULL THEN
        v_lines := v_lines
          || jsonb_build_object('account_code', v_cash_acct, 'debit', v_allocation,
                                'memo', 'تحصيل من عميل')
          || jsonb_build_object('account_code', '1211', 'credit', v_allocation,
                                'memo', 'تحصيل من عميل');
        v_journal := public.create_journal_entry(
          'تحصيل من عميل', COALESCE(_payment_date, CURRENT_DATE),
          'customer_payment', v_id, true, v_lines);
        v_lines := '[]'::jsonb;
      END IF;

      v_remaining := v_remaining - v_allocation;
    END LOOP;
  END IF;

  UPDATE public.customers
  SET balance = round(coalesce(balance, 0) - _amount, 2), updated_at = now()
  WHERE id = _customer_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user,
    'customer_payment.recorded',
    'customer',
    _customer_id,
    jsonb_build_object(
      'invoice_id', _invoice_id,
      'amount', _amount,
      'method', v_stored_method,
      'payment_date', coalesce(_payment_date, current_date),
      'allocation', CASE WHEN _invoice_id IS NULL THEN 'oldest_first' ELSE 'selected_invoice' END,
      'journal_entry_id', v_journal
    )
  );

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.record_customer_payment(uuid, uuid, numeric, text, date, text) IS
  'T-10: تحصيل بقيد أستاذ (نقد/بنك مدين مقابل ذمم) — التوزيع على الأقدم بلا تغيير.';

-- الدفعة المقدمة الصريحة: قيدها Dr نقد/بنك / Cr 1211 (ذمة عكسية — عميل دائن).
CREATE OR REPLACE FUNCTION public.record_customer_advance_payment(_customer_id uuid, _amount numeric, _method text, _payment_date date, _note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_user uuid := auth.uid();
  v_stored_method text;
  v_cash_acct text;
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
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

  IF _customer_id IS NULL OR coalesce(_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'A customer and a positive advance amount are required';
  END IF;

  v_stored_method := public.resolve_writable_payment_method(
    _method, 'customer_collection', true
  );

  PERFORM 1 FROM public.customers
  WHERE id = _customer_id AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer is unavailable';
  END IF;

  INSERT INTO public.customer_payments (
    customer_id, invoice_id, amount, payment_method, payment_date, note, created_by
  )
  VALUES (
    _customer_id, NULL, round(_amount, 2), v_stored_method::public.payment_method,
    coalesce(_payment_date, current_date),
    coalesce(nullif(trim(_note), ''), 'دفعة مقدمة'), v_user
  )
  RETURNING id INTO v_id;

  UPDATE public.customers
  SET balance = round(coalesce(balance, 0) - _amount, 2), updated_at = now()
  WHERE id = _customer_id;

  INSERT INTO public.customer_ledger(customer_id, entry_type, credit, reference_id, reference_type, occurred_at, created_by, source_key, note)
  VALUES (_customer_id, 'credit', round(_amount, 2), v_id, 'customer_payment', coalesce(_payment_date, current_date)::timestamptz, v_user, 'advance-payment:' || v_id, coalesce(nullif(trim(_note), ''), 'دفعة مقدمة'))
  ON CONFLICT (source_key) DO NOTHING;

  -- ── T-10: قيد الدفعة المقدمة — نقد مدين مقابل ذمة عكسية للعميل ──────────
  v_cash_acct := public.payment_method_ledger_account(v_stored_method);
  IF v_cash_acct IS NOT NULL THEN
    v_lines := v_lines
      || jsonb_build_object('account_code', v_cash_acct, 'debit', round(_amount, 2),
                            'memo', 'دفعة مقدمة من عميل')
      || jsonb_build_object('account_code', '1211', 'credit', round(_amount, 2),
                            'memo', 'رصيد دائن للعميل — دفعة مقدمة');
    v_journal := public.create_journal_entry(
      'دفعة مقدمة من عميل', COALESCE(_payment_date, CURRENT_DATE),
      'customer_advance_payment', v_id, true, v_lines);
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user, 'customer_advance_payment.recorded', 'customer', _customer_id,
    jsonb_build_object('amount', _amount, 'method', v_stored_method,
                       'payment_date', coalesce(_payment_date, current_date),
                       'journal_entry_id', v_journal)
  );

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.record_customer_advance_payment(uuid, numeric, text, date, text) IS
  'T-10: دفعة مقدمة صريحة بقيد أستاذ (نقد مدين مقابل رصيد دائن للعميل على 1211).';

COMMIT;

-- ============================================================================
-- التحقق بعد التطبيق:
--   1. مرتجع مشتريات: قيد عكسي متوازن + رصيد مورد قد يصير سالبًا والدفتر يطابقه.
--   2. مصروف POSTED: له قيد (مصروف + ضريبة مقابل ذمة/نقد/مستحق) وكل دفعة قيد.
--   3. عكس مصروف مدفوع بالكامل يفشل (كما كان)، وعكس غير مدفوع يعكس القيد.
--   4. تسوية نقص تُنتج مصروف 5921 في trial_balance، وفائض يُقيَّد Cr 5911.
--   5. تحصيل ودفعة مقدمة تُنتج قيودًا متوازنة على حساب الطريقة من الكتالوج.
--   6. لا قيد غير متوازن يمر (create_journal_entry يرفض، والمرتجعان يستعملان
--      balance_and_post_return لفرق الهامش).
-- ==========================================================================
