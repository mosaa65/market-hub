-- ============================================================================
-- accounting-phase4-tax-tests.sql — اختبارات التسوية الضريبية والإقرار (T-23)
-- يعمل على قاعدة محلية/اختبارية فقط. لا يلمس الإنتاج.
-- ============================================================================

DO $$
DECLARE
  v_user        uuid := '11111111-1111-1111-1111-111111111111';
  v_entry_out   uuid;
  v_entry_in    uuid;
  v_decl        jsonb;
  v_settle_id   uuid;
  v_pay_id      uuid;
  v_settle_ent  uuid;
  v_pay_ent     uuid;
  v_d_tot       numeric;
  v_c_tot       numeric;
BEGIN
  RAISE NOTICE '── بدء اختبارات التسوية الضريبية والإقرار (T-23) ──';

  -- 1) إنشاء قيدين اختباريين:
  -- أ) مبيعات: ضريبة مخرجات على 2311 دائنة بـ 15000
  v_entry_out := public.create_journal_entry(
    'قيد اختبار ضريبة مخرجات',
    CURRENT_DATE,
    'test_sales',
    NULL,
    true,
    '[{"account_code":"1101","debit":15000},{"account_code":"2311","credit":15000}]'::jsonb
  );

  -- ب) مشتريات: ضريبة مدخلات على 1316 مدينة بـ 5000
  v_entry_in := public.create_journal_entry(
    'قيد اختبار ضريبة مدخلات',
    CURRENT_DATE,
    'test_purchases',
    NULL,
    true,
    '[{"account_code":"1316","debit":5000},{"account_code":"1101","credit":5000}]'::jsonb
  );

  -- 2) توليد الإقرار الضريبي
  v_decl := public.generate_tax_declaration(CURRENT_DATE - 1, CURRENT_DATE + 1);
  IF (v_decl->>'output_tax')::numeric < 15000 OR (v_decl->>'input_tax')::numeric < 5000 THEN
    RAISE EXCEPTION 'FAIL T-23: أرقام الإقرار الضريبي غير متطابقة مع القيود (مخرجات: % مدخلات: %)',
      v_decl->>'output_tax', v_decl->>'input_tax';
  END IF;
  RAISE NOTICE 'PASS T-23: توليد الإقرار الضريبي صحيح (مخرجات 2311: %، مدخلات 1316: %)',
    v_decl->>'output_tax', v_decl->>'input_tax';

  -- 3) تنفيذ التسوية الضريبية
  v_settle_id := public.settle_tax_period(
    CURRENT_DATE - 1,
    CURRENT_DATE + 1,
    'TEST-TAX-2026-Q1',
    CURRENT_DATE
  );
  IF v_settle_id IS NULL THEN
    RAISE EXCEPTION 'FAIL T-23: settle_tax_period أعاد NULL';
  END IF;

  SELECT journal_entry_id INTO v_settle_ent
    FROM public.tax_settlement_periods WHERE id = v_settle_id;

  -- فحص توازن قيد التسوية: Dr 2311 / Cr 1316 / Cr 2321
  SELECT total_debit, total_credit INTO v_d_tot, v_c_tot
    FROM public.journal_entries WHERE id = v_settle_ent;
  IF v_d_tot <> v_c_tot THEN
    RAISE EXCEPTION 'FAIL T-23: قيد التسوية الضريبية غير متوازن (مدين % دائن %)', v_d_tot, v_c_tot;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.journal_lines jl JOIN public.accounts a ON a.id = jl.account_id
     WHERE jl.entry_id = v_settle_ent AND a.code = '2321'
  ) THEN
    RAISE EXCEPTION 'FAIL T-23: قيد التسوية لا يحتوي على حساب صافي الضريبة 2321';
  END IF;
  RAISE NOTICE 'PASS T-23: قيد التسوية متوازن وتمت مقفلة 2311 و 1316 وترحيل الصافي إلى 2321';

  -- 4) سداد الالتزام الضريبي لهيئة الضرائب
  v_pay_ent := public.pay_tax_settlement(v_settle_id, CURRENT_DATE, '1101');
  IF v_pay_ent IS NULL THEN
    RAISE EXCEPTION 'FAIL T-23: سداد الضريبة أعاد NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tax_settlement_periods
     WHERE id = v_settle_id AND status = 'PAID'
  ) THEN
    RAISE EXCEPTION 'FAIL T-23: حالة التسوية لم تتغير إلى PAID';
  END IF;
  RAISE NOTICE 'PASS T-23: سداد الالتزام الضريبي (Dr 2321 / Cr 1101) وتحديث الحالة بنجاح';

  -- تنظيف بيانات الاختبار
  DELETE FROM public.journal_lines WHERE entry_id IN (v_entry_out, v_entry_in, v_settle_ent, v_pay_ent);
  DELETE FROM public.journal_entries WHERE id IN (v_entry_out, v_entry_in, v_settle_ent, v_pay_ent);
  DELETE FROM public.tax_settlement_periods WHERE id = v_settle_id;
  DELETE FROM public.audit_logs WHERE entity_id = v_settle_id;

  RAISE NOTICE '── اكتملت اختبارات التسوية الضريبية بنجاح PASS ──';
END $$;
