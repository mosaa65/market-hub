-- ============================================================================
-- accounting-phase4-asset-tests.sql — اختبارات الأصول الثابتة والإهلاك (T-21)
-- يعمل على قاعدة محلية/اختبارية فقط. لا يلمس الإنتاج.
-- ============================================================================

DO $$
DECLARE
  v_user        uuid := '11111111-1111-1111-1111-111111111111';
  v_asset_id    uuid;
  v_entry_id    uuid;
  v_disp_entry  uuid;
  v_acc_dep     numeric;
  v_book_val    numeric;
  v_debit_total numeric;
  v_credit_total numeric;
BEGIN
  RAISE NOTICE '── بدء اختبارات الأصول الثابتة والإهلاك (T-21) ──';

  -- 1) إنشاء أصل ثابت اختباري بحالة DRAFT
  INSERT INTO public.fixed_assets (
    asset_code, name_ar, category, purchase_date, purchase_cost,
    salvage_value, useful_life_months, asset_account_code,
    accumulated_depreciation_account_code, depreciation_expense_account_code,
    status, accumulated_depreciation, current_book_value
  )
  VALUES (
    'TEST-AST-01', 'آلة طحن اختبارية', 'MACHINERY', CURRENT_DATE - 30,
    120000, 0, 12, '1411', '1491', '5611',
    'DRAFT', 0, 120000
  )
  RETURNING id INTO v_asset_id;

  -- 2) تفعيل الأصل
  PERFORM public.activate_fixed_asset(v_asset_id);
  IF NOT EXISTS (SELECT 1 FROM public.fixed_assets WHERE id = v_asset_id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'FAIL T-21: تفعيل الأصل الثابت فشل';
  END IF;
  RAISE NOTICE 'PASS T-21: تفعيل الأصل الثابت بنجاح';

  -- 3) تشغيل الإهلاك الدوري (القسط = 120000 / 12 = 10000)
  v_entry_id := public.run_depreciation(v_asset_id, CURRENT_DATE);
  IF v_entry_id IS NULL THEN
    RAISE EXCEPTION 'FAIL T-21: تشغيل الإهلاك أعاد NULL';
  END IF;

  -- التحقق من قيد الإهلاك: متوازن، Dr 5611 / Cr 1491
  SELECT total_debit, total_credit INTO v_debit_total, v_credit_total
    FROM public.journal_entries WHERE id = v_entry_id;
  IF v_debit_total <> 10000 OR v_credit_total <> 10000 THEN
    RAISE EXCEPTION 'FAIL T-21: إجمالي القيد غير متوازن أو لا يساوي القسط الشهري (مدين: % دائن: %)', v_debit_total, v_credit_total;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.journal_lines jl
      JOIN public.accounts a ON a.id = jl.account_id
     WHERE jl.entry_id = v_entry_id AND a.code = '5611' AND jl.debit = 10000
  ) THEN
    RAISE EXCEPTION 'FAIL T-21: سطر المصروف 5611 غير صحيح في القيد';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.journal_lines jl
      JOIN public.accounts a ON a.id = jl.account_id
     WHERE jl.entry_id = v_entry_id AND a.code = '1491' AND jl.credit = 10000
  ) THEN
    RAISE EXCEPTION 'FAIL T-21: سطر مجمع الإهلاك 1491 غير صحيح في القيد';
  END IF;

  -- التحقق من تحديث القيمة الدفترية ومجمع الإهلاك في جدول الأصول
  SELECT accumulated_depreciation, current_book_value
    INTO v_acc_dep, v_book_val
    FROM public.fixed_assets WHERE id = v_asset_id;
  IF v_acc_dep <> 10000 OR v_book_val <> 110000 THEN
    RAISE EXCEPTION 'FAIL T-21: مجمع الإهلاك (%) أو القيمة الدفترية (%) غير متطابقين مع المتوقع', v_acc_dep, v_book_val;
  END IF;
  RAISE NOTICE 'PASS T-21: قيد الإهلاك متوازن Dr 5611 / Cr 1491 والقيم الدفترية محدثة';

  -- 4) محاولة إهلاك ثانية في نفس اليوم تُرفض
  BEGIN
    PERFORM public.run_depreciation(v_asset_id, CURRENT_DATE);
    RAISE EXCEPTION 'FAIL T-21: تم قبول إهلاك مكرر في نفس اليوم!';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE EXCEPTION '%', SQLERRM; END IF;
    RAISE NOTICE 'PASS T-21: منع الإهلاك المكرر بنجاح (%)', SQLERRM;
  END;

  -- 5) استبعاد الأصل والتخلص منه (Disposal)
  v_disp_entry := public.dispose_fixed_asset(v_asset_id, CURRENT_DATE, 115000, '1101');
  IF v_disp_entry IS NULL THEN
    RAISE EXCEPTION 'FAIL T-21: استبعاد الأصل فشل';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.fixed_assets WHERE id = v_asset_id AND status = 'DISPOSED') THEN
    RAISE EXCEPTION 'FAIL T-21: حالة الأصل لم تصبح DISPOSED';
  END IF;
  RAISE NOTICE 'PASS T-21: استبعاد الأصل الثابت وإنتاج قيد الشطب والأرباح بنجاح';

  -- تنظيف بيانات الاختبار
  DELETE FROM public.asset_depreciation_lines WHERE asset_id = v_asset_id;
  DELETE FROM public.journal_lines WHERE entry_id IN (v_entry_id, v_disp_entry);
  DELETE FROM public.journal_entries WHERE id IN (v_entry_id, v_disp_entry);
  DELETE FROM public.fixed_assets WHERE id = v_asset_id;
  DELETE FROM public.audit_logs WHERE entity_id = v_asset_id;

  RAISE NOTICE '── اكتملت جميع اختبارات الأصول الثابتة والإهلاك بنجاح PASS ──';
END $$;
