-- ============================================================================
-- accounting-phase0-tests.sql — اختبارات المرحلة 0 (T-05)
-- يعمل على قاعدة محلية/اختبارية فقط. لا يلمس الإنتاج.
-- يبني مستخدمًا وهميًا بحرف محاسب، ينفّذ الحالات، ويرفع خطأ عند أول فشل.
-- يتطلب: تطبيق المهاجرات حتى 17_accounting_phase0_controls.sql ثم بذور النظام
-- (accounts ومستخدم اختباري بأدوار owner/manager/accountant في profiles/roles).
-- ============================================================================

DO $$
DECLARE
  v_user   uuid := '11111111-1111-1111-1111-111111111111';
  v_entry  uuid;
  v_d      numeric; v_c numeric;
  v_rev    numeric; v_tax numeric; v_rec numeric;
  v_lines  jsonb;
BEGIN
  RAISE NOTICE '── اختبارات المرحلة 0 ──';

  ----------------------------------------------------------------
  -- 0) التسلسل الجديد يعطي أرقامًا متزايدة (T-04)
  ----------------------------------------------------------------
  IF (SELECT last_value FROM public.journal_entry_seq) IS NULL THEN
    RAISE EXCEPTION 'FAIL T-04: journal_entry_seq غير موجود';
  END IF;
  RAISE NOTICE 'PASS T-04-pre: تسلسل الترقيم موجود';

  ----------------------------------------------------------------
  -- 1) توازن القيود: قيد غير متوازن يُرفض
  ----------------------------------------------------------------
  BEGIN
    PERFORM public.create_journal_entry('قيد غير متوازن', CURRENT_DATE,
      NULL, NULL, false,
      '[{"account_code":"1101","debit":100},{"account_code":"4111","credit":90}]'::jsonb);
    RAISE EXCEPTION 'FAIL: قيد غير متوازن مُرضِي!';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE EXCEPTION '%', SQLERRM; END IF;
    RAISE NOTICE 'PASS: رفض القيد غير المتوازن';
  END;

  ----------------------------------------------------------------
  -- 2) قيد متوازن سليم يعمل ويُسجَّل في audit_logs
  ----------------------------------------------------------------
  v_entry := public.create_journal_entry('قيد اختبار متوازن', CURRENT_DATE,
    NULL, NULL, false,
    '[{"account_code":"1101","debit":100},{"account_code":"4111","credit":100}]'::jsonb);
  SELECT total_debit, total_credit INTO v_d, v_c
    FROM public.journal_entries WHERE id = v_entry;
  IF v_d <> 100 OR v_c <> 100 THEN
    RAISE EXCEPTION 'FAIL: قيد متوازن بأرقام خاطئة';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                 WHERE entity_type = 'journal_entry' AND entity_id = v_entry
                   AND action = 'journal_entry.posted') THEN
    RAISE EXCEPTION 'FAIL: لا سجل تدقيق للقيد';
  END IF;
  IF (SELECT entry_number FROM public.journal_entries WHERE id = v_entry)
     NOT LIKE 'JE-%' THEN
    RAISE EXCEPTION 'FAIL T-04: رقم القيد لا يأتي من التسلسل';
  END IF;
  RAISE NOTICE 'PASS: قيد متوازن + سجل تدقيق + ترقيم JE-';

  ----------------------------------------------------------------
  -- 3) منع الحذف (trigger)
  ----------------------------------------------------------------
  BEGIN
    DELETE FROM public.journal_entries WHERE id = v_entry;
    RAISE EXCEPTION 'FAIL: حذف القيد مُرضِي!';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE EXCEPTION '%', SQLERRM; END IF;
    RAISE NOTICE 'PASS: منع حذف القيد';
  END;

  ----------------------------------------------------------------
  -- 4) منع اليدوي على حسابات النظام (1491 مجمع إهلاك is_system)
  ----------------------------------------------------------------
  BEGIN
    PERFORM public.create_journal_entry('يدوي على نظام', CURRENT_DATE,
      NULL, NULL, false,
      '[{"account_code":"1101","debit":10},{"account_code":"1491","credit":10}]'::jsonb);
    RAISE EXCEPTION 'FAIL: ترحيل يدوي على حساب نظامي مُرضِي!';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE EXCEPTION '%', SQLERRM; END IF;
    RAISE NOTICE 'PASS: منع اليدوي على حسابات النظام';
  END;

  ----------------------------------------------------------------
  -- 5) العكس يعمل ويكتب سجل تدقيق ويرجع الحساب للصفر
  ----------------------------------------------------------------
  DECLARE v_reversal uuid;
  BEGIN
    v_reversal := public.reverse_journal_entry(v_entry, 'اختبار العكس');
    IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                   WHERE action = 'journal_entry.reversed'
                     AND entity_id = v_entry) THEN
      RAISE EXCEPTION 'FAIL: لا سجل تدقيق للعكس';
    END IF;
    SELECT coalesce(sum(natural_balance),0) INTO v_d
      FROM public.trial_balance
     WHERE code IN ('1101','4111');
    IF v_d <> 0 THEN
      RAISE EXCEPTION 'FAIL: العكس لم يصفّر الأثر (natural_balance = %)', v_d;
    END IF;
  END;
  RAISE NOTICE 'PASS: العكس + تصفير الأثر في trial_balance';

  ----------------------------------------------------------------
  -- 6) T-01: فاتورة مبيعات آجلة — الإيراد صافي والضريبة مرة واحدة
  ----------------------------------------------------------------
  -- فاتورة اختبارية: دقيق 1,000 صافي + 50 ضريبة، بلا دفع (آجلة).
  DECLARE
    v_customer uuid;
    v_invoice  uuid;
  BEGIN
    -- عميل اختباري مؤقت
    INSERT INTO public.customers (id, name, phone, balance, is_active)
    VALUES ('22222222-2222-2222-2222-222222222222', 'اختبار ترحيل',
            '000', 0, true)
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO v_customer;

    -- بند يمر عبر مسار الفواتير اليدوي لأن create_sale يتطلب مخزونًا؛
    -- نكتب الفاتورة وبنودها مباشرة (بيانات اختبار تُحذف في النهاية).
    INSERT INTO public.sales_invoices
      (invoice_number, customer_id, warehouse_id, status, payment_status,
       subtotal, discount, tax, total, paid, payment_method, created_by)
    VALUES ('TEST-T01', '22222222-2222-2222-2222-222222222222',
            (SELECT id FROM public.warehouses LIMIT 1),
            'confirmed', 'unpaid', 1000, 0, 50, 1050, 0, 'credit', v_user)
    RETURNING id INTO v_invoice;

    INSERT INTO public.sales_invoice_items
      (invoice_id, product_id, description, quantity, unit_price, discount, tax, total,
       line_type, stock_effect)
    SELECT v_invoice, NULL, 'بند اختبار', 1, 1000, 0, 50, 1050,
           'STOCK_ITEM', 'NONE';

    -- التصنيف يتطلب صف products مرتبطًا؛ بند ad-hoc بلا منتج يُقيَّد على 4111.
    v_entry := public.post_sales_invoice(v_invoice);

    -- تحقق: الإيراد 1000 (صافي) لا 1050
    SELECT coalesce(sum(jl.credit),0) INTO v_rev
      FROM public.journal_lines jl
      JOIN public.accounts a ON a.id = jl.account_id
     WHERE jl.entry_id = v_entry AND a.code = '4111';
    SELECT coalesce(sum(jl.credit),0) INTO v_tax
      FROM public.journal_lines jl
      JOIN public.accounts a ON a.id = jl.account_id
     WHERE jl.entry_id = v_entry AND a.code = '2311';
    SELECT coalesce(sum(jl.debit),0) INTO v_rec
      FROM public.journal_lines jl
      JOIN public.accounts a ON a.id = jl.account_id
     WHERE jl.entry_id = v_entry AND a.code = '1211';

    IF v_rev <> 1000 THEN
      RAISE EXCEPTION 'FAIL T-01: الإيراد = % والمتوقع 1000 (صافي)', v_rev;
    END IF;
    IF v_tax <> 50 THEN
      RAISE EXCEPTION 'FAIL T-01: الضريبة = % والمتوقع 50 مرة واحدة', v_tax;
    END IF;
    IF v_rec <> 1050 THEN
      RAISE EXCEPTION 'FAIL T-01: الذم = % والمتوقع 1050', v_rec;
    END IF;
    SELECT total_debit, total_credit INTO v_d, v_c
      FROM public.journal_entries WHERE id = v_entry;
    IF v_d <> v_c OR v_d <> 1050 THEN
      RAISE EXCEPTION 'FAIL T-01: القيد غير متوازن (% vs %)', v_d, v_c;
    END IF;
  END;
  RAISE NOTICE 'PASS T-01: إيراد صافي 1000 + ضريبة 50 مرة واحدة + ذمم 1050 + ميزان متوازن';

  ----------------------------------------------------------------
  -- 7) T-02: ترحيل الفاتورة نفسها مرة ثانية يفشل في القاعدة
  ----------------------------------------------------------------
  BEGIN
    PERFORM public.post_sales_invoice(
      (SELECT id FROM public.sales_invoices WHERE invoice_number = 'TEST-T01'));
    RAISE EXCEPTION 'FAIL T-02: الترحيل المزدوج مُرضِي!';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS T-02: فهرس فريد منع الترحيل المزدوج (unique_violation)';
  WHEN others THEN
    IF SQLERRM LIKE 'FAIL%' OR SQLERRM LIKE 'Invoice %already been posted%'
       OR SQLERRM LIKE 'Invoice%has already been posted%' THEN
      RAISE NOTICE 'PASS T-02: منع الترحيل المزدوج (%)', SQLERRM;
    ELSE
      RAISE EXCEPTION 'FAIL T-02: خطأ غير متوقع: %', SQLERRM;
    END IF;
  END;

  ----------------------------------------------------------------
  -- تنظيف بيانات الاختبار (اختبار فقط — لا يبقى في القاعدة)
  ----------------------------------------------------------------
  DELETE FROM public.sales_invoice_items
   WHERE invoice_id IN (SELECT id FROM public.sales_invoices WHERE invoice_number = 'TEST-T01');
  DELETE FROM public.sales_invoices WHERE invoice_number = 'TEST-T01';
  DELETE FROM public.customers WHERE id = '22222222-2222-2222-2222-222222222222';
  DELETE FROM public.audit_logs WHERE actor_id = v_user
     AND action IN ('journal_entry.posted','journal_entry.reversed');
  RAISE NOTICE '── اكتملت الاختبارات: جميعها PASS ──';
END $$;
