-- ============================================================================
-- accounting-phase4-prepayment-tests.sql — اختبارات المصاريف والإيرادات المقدمة (T-22)
-- يعمل على قاعدة محلية/اختبارية فقط. لا يلمس الإنتاج.
-- ============================================================================

DO $$
DECLARE
  v_user        uuid := '11111111-1111-1111-1111-111111111111';
  v_ppd_id      uuid;
  v_def_id      uuid;
  v_entry1      uuid;
  v_entry2      uuid;
  v_debit1      numeric;
  v_credit1     numeric;
  v_debit2      numeric;
  v_credit2     numeric;
  v_rem         numeric;
BEGIN
  RAISE NOTICE '── بدء اختبارات المصاريف والإيرادات المقدمة (T-22) ──';

  -- 1) اختبار عقد مصروف مدفوع مقدماً (إيجار سنوي 120,000 على 12 شهراً)
  INSERT INTO public.prepaid_and_deferred_contracts (
    contract_number, contract_type, title, total_amount, start_date, end_date,
    total_periods, balance_account_code, target_account_code, status,
    amortized_amount, remaining_amount
  )
  VALUES (
    'TEST-PPD-01', 'PREPAID_EXPENSE', 'عقد إيجار المقر السنوي', 120000,
    CURRENT_DATE, CURRENT_DATE + 365, 12, '1511', '5313', 'DRAFT',
    0, 120000
  )
  RETURNING id INTO v_ppd_id;

  -- تفعيل العقد
  PERFORM public.activate_prepaid_contract(v_ppd_id);
  IF NOT EXISTS (SELECT 1 FROM public.prepaid_and_deferred_contracts WHERE id = v_ppd_id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'FAIL T-22: تفعيل عقد المصروف المقدم فشل';
  END IF;

  -- استهلاك قسط الشهر الأول (10,000)
  v_entry1 := public.run_contract_amortization(v_ppd_id, CURRENT_DATE);
  IF v_entry1 IS NULL THEN
    RAISE EXCEPTION 'FAIL T-22: استهلاك قسط المصروف المقدم أعاد NULL';
  END IF;

  SELECT total_debit, total_credit INTO v_debit1, v_credit1
    FROM public.journal_entries WHERE id = v_entry1;
  IF v_debit1 <> 10000 OR v_credit1 <> 10000 THEN
    RAISE EXCEPTION 'FAIL T-22: قيد استهلاك المصروف المقدم غير متوازن (مدين: % دائن: %)', v_debit1, v_credit1;
  END IF;

  -- التحقق من الحسابات: Dr 5313 / Cr 1511
  IF NOT EXISTS (
    SELECT 1 FROM public.journal_lines jl JOIN public.accounts a ON a.id = jl.account_id
     WHERE jl.entry_id = v_entry1 AND a.code = '5313' AND jl.debit = 10000
  ) OR NOT EXISTS (
    SELECT 1 FROM public.journal_lines jl JOIN public.accounts a ON a.id = jl.account_id
     WHERE jl.entry_id = v_entry1 AND a.code = '1511' AND jl.credit = 10000
  ) THEN
    RAISE EXCEPTION 'FAIL T-22: حسابات قيد المصروف المقدم غير صحيحة';
  END IF;

  -- منع التكرار في نفس التاريخ
  BEGIN
    PERFORM public.run_contract_amortization(v_ppd_id, CURRENT_DATE);
    RAISE EXCEPTION 'FAIL T-22: تم قبول استهلاك مكرر لنفس العقد والتاريخ!';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE EXCEPTION '%', SQLERRM; END IF;
    RAISE NOTICE 'PASS T-22: منع تكرار استهلاك المصروف المقدم بنجاح (%)', SQLERRM;
  END;

  -- 2) اختبار عقد إيراد مؤجل (اشتراك خدمات 60,000 على 6 أشهر)
  INSERT INTO public.prepaid_and_deferred_contracts (
    contract_number, contract_type, title, total_amount, start_date, end_date,
    total_periods, balance_account_code, target_account_code, status,
    amortized_amount, remaining_amount
  )
  VALUES (
    'TEST-DEF-01', 'DEFERRED_REVENUE', 'اشتراك صيانة سنوي مقبوض مقدماً', 60000,
    CURRENT_DATE, CURRENT_DATE + 180, 6, '2231', '4311', 'ACTIVE',
    0, 60000
  )
  RETURNING id INTO v_def_id;

  v_entry2 := public.run_contract_amortization(v_def_id, CURRENT_DATE);
  IF v_entry2 IS NULL THEN
    RAISE EXCEPTION 'FAIL T-22: استهلاك قسط الإيراد المؤجل أعاد NULL';
  END IF;

  SELECT total_debit, total_credit INTO v_debit2, v_credit2
    FROM public.journal_entries WHERE id = v_entry2;
  IF v_debit2 <> 10000 OR v_credit2 <> 10000 THEN
    RAISE EXCEPTION 'FAIL T-22: قيد الإيراد المؤجل غير متوازن';
  END IF;

  -- التحقق من الحسابات: Dr 2231 / Cr 4311
  IF NOT EXISTS (
    SELECT 1 FROM public.journal_lines jl JOIN public.accounts a ON a.id = jl.account_id
     WHERE jl.entry_id = v_entry2 AND a.code = '2231' AND jl.debit = 10000
  ) OR NOT EXISTS (
    SELECT 1 FROM public.journal_lines jl JOIN public.accounts a ON a.id = jl.account_id
     WHERE jl.entry_id = v_entry2 AND a.code = '4311' AND jl.credit = 10000
  ) THEN
    RAISE EXCEPTION 'FAIL T-22: حسابات قيد الإيراد المؤجل غير صحيحة';
  END IF;

  RAISE NOTICE 'PASS T-22: قيود استهلاك المصروفات والإيرادات المقدمة متوازنة ومطابقة للدليل';

  -- تنظيف بيانات الاختبار
  DELETE FROM public.amortization_lines WHERE contract_id IN (v_ppd_id, v_def_id);
  DELETE FROM public.journal_lines WHERE entry_id IN (v_entry1, v_entry2);
  DELETE FROM public.journal_entries WHERE id IN (v_entry1, v_entry2);
  DELETE FROM public.prepaid_and_deferred_contracts WHERE id IN (v_ppd_id, v_def_id);
  DELETE FROM public.audit_logs WHERE entity_id IN (v_ppd_id, v_def_id);

  RAISE NOTICE '── اكتملت اختبارات T-22 بنجاح PASS ──';
END $$;
