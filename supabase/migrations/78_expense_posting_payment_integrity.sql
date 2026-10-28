-- Expense accounting and treasury integrity repair.
-- Paid-now posting first recognizes the payable, then settles it through the
-- same payment RPC used by later installments. This keeps cash impact and
-- liability impact correct and makes the two steps one database transaction.
BEGIN;

CREATE OR REPLACE FUNCTION public.record_expense_payment(
  p_entry_id uuid,
  p_amount numeric,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_payment_method payment_method DEFAULT 'cash'::payment_method,
  p_account_label text DEFAULT NULL::text,
  p_reference_no text DEFAULT NULL::text,
  p_note text DEFAULT NULL::text,
  p_idempotency_key text DEFAULT NULL::text,
  p_account_id uuid DEFAULT NULL::uuid,
  p_cashbox_id uuid DEFAULT NULL::uuid,
  p_bank_account_id uuid DEFAULT NULL::uuid,
  p_payment_method_id text DEFAULT NULL::text
)
RETURNS expense_entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.expense_actor();
  v_entry public.expense_entries;
  v_amount numeric(18,2);
  v_existing public.expense_payments;
  v_label text := nullif(btrim(coalesce(p_account_label, '')), '');
  v_cash_acct text;
  v_credit_acct text;
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
  v_payment_id uuid;
BEGIN
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.expense_assert_capability(v_user, 'expense.pay');
  IF v_entry.status NOT IN ('POSTED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'Payments can only be recorded against posted expenses (current: %)', v_entry.status USING ERRCODE = '55000';
  END IF;
  v_amount := public.expense_round(p_amount);
  IF v_amount <= 0 OR v_amount > v_entry.remaining_amount + 0.005 THEN
    RAISE EXCEPTION 'Payment amount is invalid or exceeds remaining amount' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.expense_payments WHERE idempotency_key = btrim(p_idempotency_key);
    IF FOUND THEN RETURN v_entry; END IF;
  END IF;

  -- Resolve the actual selected treasury account, not a generic method default.
  IF p_cashbox_id IS NOT NULL THEN
    SELECT c.name_ar, a.code INTO v_label, v_cash_acct
      FROM public.cashboxes c JOIN public.accounts a ON a.id = c.account_id WHERE c.id = p_cashbox_id AND c.is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cashbox is unavailable' USING ERRCODE = '22023'; END IF;
  ELSIF p_bank_account_id IS NOT NULL THEN
    SELECT b.name_ar, a.code INTO v_label, v_cash_acct
      FROM public.company_bank_accounts b JOIN public.accounts a ON a.id = b.account_id WHERE b.id = p_bank_account_id AND b.is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bank account is unavailable' USING ERRCODE = '22023'; END IF;
  ELSIF p_account_id IS NOT NULL THEN
    SELECT a.name_ar, a.code INTO v_label, v_cash_acct FROM public.accounts a WHERE a.id = p_account_id;
  END IF;
  IF v_cash_acct IS NULL THEN
    v_cash_acct := public.payment_method_ledger_account(COALESCE(p_payment_method::text, 'cash'));
  END IF;
  IF v_cash_acct IS NULL THEN RAISE EXCEPTION 'No ledger account configured for payment method' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.expense_payments (
    entry_id, amount, payment_date, payment_method, account_label, reference_no, note,
    idempotency_key, created_by, account_id, cashbox_id, bank_account_id, payment_method_id
  ) VALUES (
    p_entry_id, v_amount, COALESCE(p_payment_date, CURRENT_DATE), COALESCE(p_payment_method, 'cash'),
    v_label, nullif(btrim(coalesce(p_reference_no, '')), ''), nullif(btrim(coalesce(p_note, '')), ''),
    nullif(btrim(coalesce(p_idempotency_key, '')), ''), v_user, p_account_id, p_cashbox_id, p_bank_account_id, p_payment_method_id
  ) RETURNING id INTO v_payment_id;

  -- Settlement: Dr payable, Cr cash/bank.
  v_credit_acct := CASE WHEN v_entry.payee_type = 'SUPPLIER' AND v_entry.supplier_id IS NOT NULL THEN '2111' ELSE '2221' END;
  v_lines := v_lines
    || jsonb_build_object('account_code', v_credit_acct, 'debit', v_amount, 'memo', 'تسوية التزام مصروف ' || v_entry.reference)
    || jsonb_build_object('account_code', v_cash_acct, 'credit', v_amount, 'memo', 'صرف دفعة مصروف ' || v_entry.reference);
  v_journal := public.create_journal_entry('سداد مصروف ' || v_entry.reference,
    COALESCE(p_payment_date, CURRENT_DATE), 'expense_payment', v_payment_id, true, v_lines);
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id;
  PERFORM public.expense_log_action(p_entry_id, 'payment', v_entry.status, v_entry.status,
    'Payment of ' || v_amount::text || ' ' || v_entry.currency_symbol || ' recorded', v_user);
  RETURN v_entry;
END $$;

-- Legacy signature retained for existing clients/RPC callers.
CREATE OR REPLACE FUNCTION public.record_expense_payment(
  p_entry_id uuid, p_amount numeric, p_payment_date date DEFAULT CURRENT_DATE,
  p_payment_method payment_method DEFAULT 'cash'::payment_method,
  p_account_label text DEFAULT NULL::text, p_reference_no text DEFAULT NULL::text,
  p_note text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text,
  p_account_id uuid DEFAULT NULL::uuid
)
RETURNS expense_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN
  RETURN public.record_expense_payment(p_entry_id,p_amount,p_payment_date,p_payment_method,p_account_label,
    p_reference_no,p_note,p_idempotency_key,p_account_id,NULL,NULL,NULL);
END $$;

CREATE OR REPLACE FUNCTION public.post_expense(
  p_entry_id uuid,
  p_expected_version integer DEFAULT NULL::integer,
  p_pay_now boolean DEFAULT false,
  p_payment_method payment_method DEFAULT 'cash'::payment_method,
  p_account_label text DEFAULT NULL::text,
  p_payment_date date DEFAULT NULL::date,
  p_idempotency_key text DEFAULT NULL::text,
  p_account_id uuid DEFAULT NULL::uuid,
  p_cashbox_id uuid DEFAULT NULL::uuid,
  p_bank_account_id uuid DEFAULT NULL::uuid,
  p_payment_method_id text DEFAULT NULL::text
)
RETURNS expense_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.expense_actor();
  v_entry public.expense_entries;
  v_from public.expense_status;
  v_lines jsonb := '[]'::jsonb;
  v_tax numeric(18,2) := 0;
  v_journal uuid;
  r record;
BEGIN
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002'; END IF;
  v_from := v_entry.status;
  IF v_from = 'POSTED' THEN RETURN v_entry; END IF;
  IF v_from NOT IN ('APPROVED','DRAFT') THEN RAISE EXCEPTION 'This expense cannot be posted from status %',v_from USING ERRCODE='55000'; END IF;
  PERFORM public.expense_assert_capability(v_user, 'expense.post');
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_entry.version THEN
    RAISE EXCEPTION 'This expense was changed by someone else. Reload it and try again.' USING ERRCODE='40001';
  END IF;
  IF v_entry.total_amount <= 0 OR v_entry.line_count = 0 THEN RAISE EXCEPTION 'Cannot post an expense with no lines' USING ERRCODE='22023'; END IF;
  IF v_from = 'DRAFT' AND NOT public.expense_can(v_user, 'expense.approve') THEN
    RAISE EXCEPTION 'Submit this expense for approval before posting it' USING ERRCODE='55000';
  END IF;
  UPDATE public.expense_entries SET status='POSTED', posting_date=COALESCE(posting_date,CURRENT_DATE),
    posted_by=v_user, posted_at=now(), version=version+1 WHERE id=p_entry_id RETURNING * INTO v_entry;
  PERFORM public.expense_log_action(p_entry_id,'posted',v_from,'POSTED',NULL,v_user);

  -- Each category/account receives its own debit; taxes are posted once.
  FOR r IN (
    SELECT COALESCE(a.code,'5911') account_code,
      COALESCE(c.name_ar,c.name,'مصروفات تشغيلية') label,
      round(sum(l.net_amount),2) net, round(sum(l.tax_amount),2) tax
    FROM public.expense_lines l
    LEFT JOIN public.expense_categories c ON c.id=l.category_id
    LEFT JOIN public.accounts a ON a.id=c.account_id
    WHERE l.entry_id=p_entry_id
    GROUP BY COALESCE(a.code,'5911'),COALESCE(c.name_ar,c.name,'مصروفات تشغيلية')
  ) LOOP
    IF r.net > 0 THEN v_lines := v_lines || jsonb_build_object('account_code',r.account_code,'debit',r.net,'memo','مصروف '||v_entry.reference||' — '||r.label); END IF;
    v_tax := v_tax + r.tax;
  END LOOP;
  IF v_tax > 0 THEN v_lines := v_lines || jsonb_build_object('account_code','1316','debit',v_tax,'memo','ضريبة مدخلات على مصروف '||v_entry.reference); END IF;
  -- Always recognize liability first. Immediate payments settle it below.
  IF v_entry.payee_type='SUPPLIER' AND v_entry.supplier_id IS NOT NULL THEN
    v_lines := v_lines || jsonb_build_object('account_code','2111','credit',round(v_entry.total_amount,2),'memo','ذمة مورد — مصروف '||v_entry.reference);
  ELSE
    v_lines := v_lines || jsonb_build_object('account_code','2221','credit',round(v_entry.total_amount,2),'memo','مصروف مستحق الدفع '||v_entry.reference);
  END IF;
  v_journal := public.create_journal_entry('إثبات استحقاق مصروف '||v_entry.reference,
    COALESCE(v_entry.expense_date,CURRENT_DATE),'expense',p_entry_id,true,v_lines);
  IF p_pay_now THEN
    SELECT * INTO v_entry FROM public.record_expense_payment(p_entry_id,v_entry.total_amount,
      COALESCE(p_payment_date,CURRENT_DATE),p_payment_method,p_account_label,NULL,'Settled at posting',
      COALESCE(p_idempotency_key,'post:'||p_entry_id::text),p_account_id,p_cashbox_id,p_bank_account_id,p_payment_method_id);
  END IF;
  RETURN v_entry;
END $$;

-- Legacy signature retained for existing clients/RPC callers.
CREATE OR REPLACE FUNCTION public.post_expense(
  p_entry_id uuid,p_expected_version integer DEFAULT NULL::integer,p_pay_now boolean DEFAULT false,
  p_payment_method payment_method DEFAULT 'cash'::payment_method,p_account_label text DEFAULT NULL::text,
  p_payment_date date DEFAULT NULL::date,p_idempotency_key text DEFAULT NULL::text,p_account_id uuid DEFAULT NULL::uuid
)
RETURNS expense_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN
  RETURN public.post_expense(p_entry_id,p_expected_version,p_pay_now,p_payment_method,p_account_label,
    p_payment_date,p_idempotency_key,p_account_id,NULL,NULL,NULL);
END $$;

-- A payment reversal must reverse its GL journal in the same transaction.
CREATE OR REPLACE FUNCTION public.reverse_expense_payment(p_payment_id uuid,p_reason text DEFAULT NULL::text)
RETURNS expense_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.expense_actor();
  v_payment public.expense_payments;
  v_entry public.expense_entries;
  v_reversal_id uuid;
  v_journal_id uuid;
BEGIN
  SELECT * INTO v_payment FROM public.expense_payments WHERE id=p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found' USING ERRCODE='P0002'; END IF;
  PERFORM public.expense_assert_capability(v_user,'expense.payment.reverse');
  IF v_payment.reversed_by IS NOT NULL THEN SELECT * INTO v_entry FROM public.expense_entries WHERE id=v_payment.entry_id; RETURN v_entry; END IF;
  IF v_payment.reversal_of IS NOT NULL THEN RAISE EXCEPTION 'A reversal row cannot itself be reversed' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_entry FROM public.expense_entries WHERE id=v_payment.entry_id FOR UPDATE;
  SELECT id INTO v_journal_id FROM public.journal_entries
    WHERE source_type='expense_payment' AND source_id=p_payment_id AND status='POSTED' FOR UPDATE;
  IF v_journal_id IS NOT NULL THEN
    PERFORM public.reverse_journal_entry(v_journal_id,COALESCE(NULLIF(btrim(p_reason),''),'عكس دفعة المصروف'));
  END IF;
  INSERT INTO public.expense_payments(entry_id,amount,payment_date,payment_method,account_label,reference_no,note,
    reversal_of,created_by,account_id,cashbox_id,bank_account_id,payment_method_id)
  VALUES(v_payment.entry_id,v_payment.amount,CURRENT_DATE,v_payment.payment_method,v_payment.account_label,
    v_payment.reference_no,COALESCE(NULLIF(btrim(p_reason),''),'Reversal of payment'),v_payment.id,v_user,
    v_payment.account_id,v_payment.cashbox_id,v_payment.bank_account_id,v_payment.payment_method_id)
  RETURNING id INTO v_reversal_id;
  UPDATE public.expense_payments SET reversed_by=v_reversal_id WHERE id=p_payment_id;
  SELECT * INTO v_entry FROM public.expense_entries WHERE id=v_payment.entry_id;
  PERFORM public.expense_log_action(v_payment.entry_id,'payment',v_entry.status,v_entry.status,'Payment reversed',v_user);
  RETURN v_entry;
END $$;

GRANT EXECUTE ON FUNCTION public.record_expense_payment(uuid,numeric,date,payment_method,text,text,text,text,uuid,uuid,uuid,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_expense_payment(uuid,numeric,date,payment_method,text,text,text,text,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.post_expense(uuid,integer,boolean,payment_method,text,date,text,uuid,uuid,uuid,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.post_expense(uuid,integer,boolean,payment_method,text,date,text,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reverse_expense_payment(uuid,text) TO authenticated,service_role;
COMMIT;
