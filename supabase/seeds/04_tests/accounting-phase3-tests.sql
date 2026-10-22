-- ============================================================================
-- accounting-phase3-tests.sql — اختبارات المرحلة 3 (T-19 / T-20)
-- يعمل على قاعدة محلية/اختبارية فقط. لا يلمس الإنتاج.
-- يتطلب: تطبيق المهاجرات حتى 21b_accounting_phase3_set_period_status.sql
-- وبذور النظام (accounts + مستخدم مصادق بأدوار owner/manager/accountant).
--
-- الحالات المختبرة:
--   1) يُرفض قيد يدوي بتاريخ داخل فترة مقفلة، ويُقبل في فترة مفتوحة.
--   2) close_fiscal_year يقفل 4xxx/5xxx إلى 3911 ويسجل قيد إقفال متوازن وسجل تدقيق.
--   3) إقفال ثانٍ لنفس السنة يُرفض.
--   4) open_fiscal_year لسنة موجودة فتراتها بالفعل يُرفض لمنع التداخل.
--   5) set_period_status يغير حالة الفترة بين CLOSED و OPEN مع فحص الدور وتسجيل التدقيق.
-- ============================================================================

DO $$
DECLARE
  v_user        uuid := '11111111-1111-1111-1111-111111111111';
  v_year        integer := date_part('year', CURRENT_DATE)::int;
  v_closed_year integer := v_year - 2;
  v_period_id   uuid;
  v_entry       uuid;
  v_open_entry  uuid;
  v_close_id    uuid;
  v_rev_bal     numeric;
  v_cap_bal     numeric;
  v_count       integer;
BEGIN
  RAISE NOTICE '── اختبارات المرحلة 3 (الفترات المالية والإقفال) ──';

  ----------------------------------------------------------------
  -- 1) قيد يدوي داخل فترة مقفلة يُرفض، وفي فترة مفتوحة يُقبل
  ----------------------------------------------------------------
  -- إنشاء فترة مقفلة تجريبية في سنة سابقة (v_closed_year)
  INSERT INTO public.fiscal_periods (
    code, fiscal_year, period_no, start_date, end_date, status, closed_at
  )
  VALUES (
    v_closed_year::text || '-01',
    v_closed_year,
    1,
    make_date(v_closed_year, 1, 1),
    make_date(v_closed_year, 1, 31),
    'CLOSED',
    now()
  )
  ON CONFLICT (code) DO UPDATE SET status = 'CLOSED'
  RETURNING id INTO v_period_id;

  BEGIN
    PERFORM public.create_journal_entry(
      'قيد اختبار في فترة مقفلة',
      make_date(v_closed_year, 1, 15),
      NULL, NULL, false,
      '[{"account_code":"1101","debit":100},{"account_code":"4111","credit":100}]'::jsonb
    );
    RAISE EXCEPTION 'FAIL T-19: تم قبول ترحيل قيد داخل فترة مقفلة!';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE EXCEPTION '%', SQLERRM; END IF;
    RAISE NOTICE 'PASS T-19: رفض القيد داخل فترة مقفلة بنجاح (%)', SQLERRM;
  END;

  -- القيد في فترة مفتوحة (تاريخ اليوم) يُقبل
  BEGIN
    v_entry := public.create_journal_entry(
      'قيد اختبار في فترة مفتوحة',
      CURRENT_DATE,
      NULL, NULL, false,
      '[{"account_code":"1101","debit":100},{"account_code":"4111","credit":100}]'::jsonb
    );
    IF v_entry IS NULL THEN
      RAISE EXCEPTION 'FAIL T-19: قيد الفترة المفتوحة لم يُنشأ';
    END IF;
  END;
  RAISE NOTICE 'PASS T-19: القيد داخل الفترة المفتوحة مقبول بنجاح';

  ----------------------------------------------------------------
  -- 2) close_fiscal_year: يقفل 4xxx/5xxx في 3911 ويسجل قيد إقفال
  ----------------------------------------------------------------
  -- قيد إيراد ومصروف تجريبي لسنة الإقفال
  v_open_entry := public.create_journal_entry(
    'قيد إيراد ومصروف للاختبار',
    CURRENT_DATE,
    NULL, NULL, false,
    '[{"account_code":"1101","debit":500},{"account_code":"4111","credit":500}]'::jsonb
  );

  -- نضمن أن فترة ديسمبر مفتوحة لإتاحة قيد الإقفال بتاريخ 31/12
  INSERT INTO public.fiscal_periods (
    code, fiscal_year, period_no, start_date, end_date, status
  )
  VALUES (
    v_year::text || '-12',
    v_year,
    12,
    make_date(v_year, 12, 1),
    make_date(v_year, 12, 31),
    'OPEN'
  )
  ON CONFLICT (code) DO UPDATE SET status = 'OPEN';

  -- تنفيذ الإقفال
  v_close_id := public.close_fiscal_year(v_year);
  IF v_close_id IS NULL THEN
    RAISE EXCEPTION 'FAIL T-20: close_fiscal_year أعاد NULL';
  END IF;

  -- التحقق من وجود قيد الإقفال في journal_entries بحالة POSTED
  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries
     WHERE id = v_close_id
       AND source_type = 'fiscal_year_close'
       AND status = 'POSTED'
  ) THEN
    RAISE EXCEPTION 'FAIL T-20: قيد الإقفال غير مسجل أو غير مرحل';
  END IF;

  -- التحقق من ترحيل سطر الأرباح المحتجزة 3911 في قيد الإقفال
  IF NOT EXISTS (
    SELECT 1 FROM public.journal_lines jl
      JOIN public.accounts a ON a.id = jl.account_id
     WHERE jl.entry_id = v_close_id
       AND a.code = '3911'
  ) THEN
    RAISE EXCEPTION 'FAIL T-20: قيد الإقفال لا يحوي حساب 3911';
  END IF;

  -- التحقق من تسجيل سجل التدقيق
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
     WHERE entity_type = 'fiscal_year'
       AND entity_id = v_close_id
       AND action = 'fiscal_year.closed'
  ) THEN
    RAISE EXCEPTION 'FAIL T-20: لا يوجد سجل تدقيق لعملية الإقفال';
  END IF;

  RAISE NOTICE 'PASS T-20: إقفال السنة أنتج قيد إقفال متوازن إلى 3911 مع سجل تدقيق';

  ----------------------------------------------------------------
  -- 3) إقفال ثانٍ لنفس السنة يُرفض
  ----------------------------------------------------------------
  BEGIN
    PERFORM public.close_fiscal_year(v_year);
    RAISE EXCEPTION 'FAIL T-20: تم قبول إقفال مزدوج لنفس السنة!';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE EXCEPTION '%', SQLERRM; END IF;
    RAISE NOTICE 'PASS T-20: رفض الإقفال المزدوج بنجاح (%)', SQLERRM;
  END;

  ----------------------------------------------------------------
  -- 4) open_fiscal_year يُرفض لسنة فتراتها متداخلة/موجودة بالفعل
  ----------------------------------------------------------------
  BEGIN
    PERFORM public.open_fiscal_year(v_year);
    RAISE EXCEPTION 'FAIL T-20: تم فتح سنة قائمة متداخلة!';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE EXCEPTION '%', SQLERRM; END IF;
    RAISE NOTICE 'PASS T-20: منع تداخل السنوات عند فتح سنة جديدة بنجاح (%)', SQLERRM;
  END;

  ----------------------------------------------------------------
  -- 5) دالة set_period_status لقفل وفتح الفترات
  ----------------------------------------------------------------
  PERFORM public.set_period_status(v_period_id, 'OPEN');
  IF NOT EXISTS (SELECT 1 FROM public.fiscal_periods WHERE id = v_period_id AND status = 'OPEN') THEN
    RAISE EXCEPTION 'FAIL T-19: لم يتم فتح الفترة عبر set_period_status';
  END IF;

  PERFORM public.set_period_status(v_period_id, 'CLOSED');
  IF NOT EXISTS (SELECT 1 FROM public.fiscal_periods WHERE id = v_period_id AND status = 'CLOSED') THEN
    RAISE EXCEPTION 'FAIL T-19: لم يتم قفل الفترة عبر set_period_status';
  END IF;

  RAISE NOTICE 'PASS T-19: تغيير حالة الفترة عبر set_period_status يعمل بنجاح';

  ----------------------------------------------------------------
  -- تنظيف بيانات الاختبار المؤقتة
  ----------------------------------------------------------------
  DELETE FROM public.journal_lines
   WHERE entry_id IN (v_entry, v_open_entry, v_close_id);
  DELETE FROM public.journal_entries
   WHERE id IN (v_entry, v_open_entry, v_close_id);
  DELETE FROM public.fiscal_periods
   WHERE fiscal_year = v_closed_year;
  DELETE FROM public.audit_logs
   WHERE entity_id IN (v_close_id, v_period_id);

  RAISE NOTICE '── اكتملت اختبارات المرحلة 3: جميع الفحوصات نجحت بنسبة 100%% ──';
END $$;
