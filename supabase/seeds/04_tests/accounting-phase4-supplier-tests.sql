-- ============================================================================
-- accounting-phase4-supplier-tests.sql
--
-- اختبارات التحقق من المرحلة الرابعة: المهمة T-24 (دفتر وسندات صرف الموردين)
-- ============================================================================

DO $$
DECLARE
  v_supplier_id uuid;
  v_res jsonb;
  v_payment_id uuid;
  v_journal_id uuid;
  v_voucher_no text;
  v_initial_balance numeric := 5000.00;
  v_pay_amount numeric := 1500.00;
  v_expected_balance numeric := 3500.00;
  v_supplier_bal numeric;
  v_ledger_count integer;
  v_dr numeric;
  v_cr numeric;
  v_stmt_count integer;
BEGIN
  RAISE NOTICE '=== بدء اختبارات T-24: دفتر الموردين وسندات الصرف ===';

  -- 1. التأكد من وجود الحسابات المطلوبة
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE code = '2111') THEN
    INSERT INTO public.accounts (code, name, type, is_postable, is_system)
    VALUES ('2111', 'ذمم الموردين', 'LIABILITY', true, true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE code = '1101') THEN
    INSERT INTO public.accounts (code, name, type, is_postable, is_system)
    VALUES ('1101', 'الصندوق الرئيسي', 'ASSET', true, true);
  END IF;

  -- 2. إنشاء مورد اختباري برصيد افتتاحي
  INSERT INTO public.suppliers (name, phone, balance, is_active)
  VALUES ('مورد اختبار محاسبي T24', '0599000240', v_initial_balance, true)
  RETURNING id INTO v_supplier_id;

  RAISE NOTICE '1. تم إنشاء المورد الاختباري: % برصيد افتتاحي %', v_supplier_id, v_initial_balance;

  -- 3. تسجيل سند صرف للمورد
  v_res := public.record_supplier_payment(
    p_supplier_id := v_supplier_id,
    p_amount := v_pay_amount,
    p_payment_method := 'CASH',
    p_account_code := '1101',
    p_payment_date := CURRENT_DATE,
    p_notes := 'سند صرف اختباري T-24'
  );

  v_payment_id := (v_res->>'payment_id')::uuid;
  v_voucher_no := v_res->>'voucher_number';
  v_journal_id := (v_res->>'journal_entry_id')::uuid;

  IF v_payment_id IS NULL OR v_journal_id IS NULL THEN
    RAISE EXCEPTION 'فشل تسجيل سند الصرف أو القيد المحاسبي: %', v_res;
  END IF;

  RAISE NOTICE '2. تم تسجيل سند الصرف بنجاح: رقم السند %, القيد %', v_voucher_no, v_journal_id;

  -- 4. التحقق من رصيد المورد بعد السداد
  SELECT balance INTO v_supplier_bal
  FROM public.suppliers
  WHERE id = v_supplier_id;

  IF v_supplier_bal <> v_expected_balance THEN
    RAISE EXCEPTION 'خطأ في رصيد المورد بعد السداد: المتوقع % والفعلي %', v_expected_balance, v_supplier_bal;
  END IF;

  RAISE NOTICE '3. تم التحقق من رصيد المورد: % مطابق للمتوقع %', v_supplier_bal, v_expected_balance;

  -- 5. التحقق من القيد المحاسبي المزدوج وتوازنه
  SELECT sum(debit), sum(credit)
  INTO v_dr, v_cr
  FROM public.journal_entry_lines
  WHERE journal_entry_id = v_journal_id;

  IF v_dr <> v_cr OR v_dr <> v_pay_amount THEN
    RAISE EXCEPTION 'خطأ في توازن القيد المحاسبي: مدين % دائن % المتوقع %', v_dr, v_cr, v_pay_amount;
  END IF;

  RAISE NOTICE '4. قيد سند الصرف متوازن تماماً: مدين % دائن %', v_dr, v_cr;

  -- 6. التحقق من حركة دفتر الموردين
  SELECT count(*) INTO v_ledger_count
  FROM public.supplier_ledger
  WHERE supplier_id = v_supplier_id
    AND reference_type = 'supplier_payment'
    AND reference_id = v_payment_id
    AND debit = v_pay_amount;

  IF v_ledger_count <> 1 THEN
    RAISE EXCEPTION 'لم يتم العثور على حركة الدفتر المطابقة لسند الصرف';
  END IF;

  RAISE NOTICE '5. تم التحقق من تسجيل الحركة بدقة في supplier_ledger';

  -- 7. التحقق من دالة كشف الحساب get_supplier_statement
  SELECT count(*) INTO v_stmt_count
  FROM public.get_supplier_statement(v_supplier_id);

  IF v_stmt_count < 1 THEN
    RAISE EXCEPTION 'دالة كشف الحساب لم ترجع أي حركات للمورد';
  END IF;

  RAISE NOTICE '6. تم التحقق من عمل دالة كشف حساب المورد get_supplier_statement بنجاح (عدد الحركات: %)', v_stmt_count;

  -- 8. تنظيف سجلات الاختبار
  DELETE FROM public.supplier_ledger WHERE supplier_id = v_supplier_id;
  DELETE FROM public.supplier_payments WHERE id = v_payment_id;
  DELETE FROM public.journal_entry_lines WHERE journal_entry_id = v_journal_id;
  DELETE FROM public.journal_entries WHERE id = v_journal_id;
  DELETE FROM public.suppliers WHERE id = v_supplier_id;

  RAISE NOTICE '=== اكتملت جميع اختبارات T-24 لدفتر وسندات صرف الموردين بنجاح 100% ===';
END $$;
