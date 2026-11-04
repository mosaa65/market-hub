-- ============================================================================
-- phase1_expense_fixes_acceptance.sql
--
-- اختبارات قبول للمرحلة الأولى — تُشغَّل **يدوياً** على قاعدة اختبار محلية
-- معزولة فقط (وليس الإنتاج). كل السيناريوهات داخل معاملة واحدة تُلغى في
-- النهاية بـ ROLLBACK، فلا تتغير أي بيانات.
--
-- التشغيل:
--   psql "$LOCAL_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v owner=<uuid> -v accountant=<uuid> \
--        -v supplier=<uuid> -v category=<uuid> \
--        -f supabase/tests/phase1_expense_fixes_acceptance.sql
--
-- المتطلبات المسبقة في القاعدة المعزولة:
--   • owner وaccountant مستخدمان نشطان في auth.users/profiles مع أدوارهما.
--   • supplier موجود، category مرتبط بحساب 5xxx، ومراكز التكلفة والموردين
--     مضبوطة عبر set_expense_ledger_account / payment_methods.
--   • يمكن تعيين هوية الجلسة بـ set_config('request.jwt.claim.sub', ...)
--     كما تفعل دوال الأمن الموجودة في المشروع (expense_actor ← auth.uid()).
--
-- ملاحظة: لم يُشغَّل هذا الملف في هذه المرحلة (لا قاعدة اختبار متاحة)، ولم
-- يُشغَّل على الإنتاج. اختبارات العقود النصية تعمل عبر:
--   node --test src/lib/expenses/__tests__/phase1-accounting-fixes.test.mjs
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ── 1. ترحيل مسودة بلا توقيع: يجب أن يُرفض ──────────────────────────────────
DO $phase1_draft_guard$
DECLARE
  v_entry  public.expense_entries;
  v_blocked boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', :'accountant', true);

  SELECT * INTO v_entry FROM public.create_expense_v2(
    p_lines => jsonb_build_array(jsonb_build_object(
      'category_id', :'category'::uuid,
      'quantity', 1,
      'unit_price', 100,
      'tax_rate', 0)),
    p_expense_date => CURRENT_DATE,
    p_payee_type => 'NONE',
    p_tax_mode => 'NONE',
    p_submit => false,
    p_idempotency_key => 'phase1-guard-1'
  );

  BEGIN
    PERFORM public.post_expense(v_entry.id);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'فشل الحارس: رُحّل مصروف DRAFT دون اعتماد';
  END IF;

  -- بعد الاعتماد المسجل (reason مكتوب) والمُلحق بالمالك، يسمح الترحيل.
  UPDATE public.expense_entries
     SET allow_draft_post = true,
         draft_post_reason = 'اختبار قبول: اعتماد مباشر موثّق'
   WHERE id = v_entry.id;

  PERFORM set_config('request.jwt.claim.sub', :'owner', true);
  PERFORM public.post_expense(v_entry.id, v_entry.version + 1);

  IF (SELECT status FROM public.expense_entries WHERE id = v_entry.id) <> 'POSTED' THEN
    RAISE EXCEPTION 'فشل المسار المرخّص: لم يُرحَّل المستند بعد التوقيع';
  END IF;
END
$phase1_draft_guard$;

-- ── 2. مصروف مورد 100 ← سداد 40: دفتر المورد = 60، القيود متوازنة ─────────
DO $phase1_supplier$
DECLARE
  v_entry       public.expense_entries;
  v_payment_id  uuid;
  v_ledger      numeric;
  v_journal_net numeric;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', :'owner', true);

  SELECT * INTO v_entry FROM public.create_expense_v2(
    p_lines => jsonb_build_array(jsonb_build_object(
      'category_id', :'category'::uuid,
      'quantity', 1,
      'unit_price', 100,
      'tax_rate', 0)),
    p_payee_type => 'SUPPLIER',
    p_supplier_id => :'supplier'::uuid,
    p_expense_date => CURRENT_DATE,
    p_tax_mode => 'NONE',
    p_submit => true,
    p_idempotency_key => 'phase1-supplier-1'
  );
  PERFORM public.decide_expense(v_entry.id, true, 'اختبار قبول');
  SELECT * INTO v_entry FROM public.post_expense(v_entry.id, v_entry.version);

  -- إعادة ترحيل مستند مُرحّل: يجب ألا تُنشئ قيداً ثانياً.
  PERFORM public.post_expense(v_entry.id, NULL);
  IF (SELECT count(*) FROM public.journal_entries je
       WHERE je.source_type = 'expense' AND je.source_id = v_entry.id) <> 1 THEN
    RAISE EXCEPTION 'فشل منع التكرار: تكرر قيد المصروف %', v_entry.id;
  END IF;

  PERFORM public.record_expense_payment(
    v_entry.id, 40, CURRENT_DATE, 'cash', NULL, NULL, 'دفعة اختبار',
    'phase1-supplier-pay-1');

  SELECT id INTO v_payment_id FROM public.expense_payments
   WHERE idempotency_key = 'phase1-supplier-pay-1';

  -- إعادة إرسال نفس الدفعة (فشل شبكة) لا تُنشئ دفعة ثانية.
  PERFORM public.record_expense_payment(
    v_entry.id, 40, CURRENT_DATE, 'cash', NULL, NULL, 'دفعة اختبار',
    'phase1-supplier-pay-1');
  IF (SELECT count(*) FROM public.expense_payments
       WHERE idempotency_key = 'phase1-supplier-pay-1') <> 1 THEN
    RAISE EXCEPTION 'فشل منع تكرار الدفعة';
  END IF;

  SELECT coalesce(sum(credit) - sum(debit), 0) INTO v_ledger
    FROM public.supplier_ledger
   WHERE supplier_id = :'supplier'::uuid
     AND ((reference_type = 'expense' AND reference_id = v_entry.id)
       OR (reference_type = 'expense_payment' AND reference_id = v_payment_id));
  IF v_ledger <> 60 THEN
    RAISE EXCEPTION 'فشل دفتر المورد: المتوقع 60، الواقع %', v_ledger;
  END IF;

  SELECT coalesce(sum(debit), 0) - coalesce(sum(credit), 0) INTO v_journal_net
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.entry_id
   WHERE je.source_id IN (v_entry.id, v_payment_id)
     AND je.source_type IN ('expense', 'expense_payment');
  IF v_journal_net <> 0 THEN
    RAISE EXCEPTION 'قيد غير متوازن بمقدار %', v_journal_net;
  END IF;
END
$phase1_supplier$;

-- ── 3. الضريبة غير المستردة تدخل المتاح للإنتاج مرة واحدة ──────────────────
DO $phase1_production$
DECLARE
  v_entry     public.expense_entries;
  v_line      uuid;
  v_available numeric;
  v_eligible  numeric;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', :'owner', true);

  SELECT * INTO v_entry FROM public.create_expense_v2(
    p_lines => jsonb_build_array(jsonb_build_object(
      'category_id', :'category'::uuid,
      'quantity', 1,
      'unit_price', 100,
      'tax_rate', 15)),
    p_expense_date => CURRENT_DATE,
    p_payee_type => 'NONE',
    p_tax_mode => 'EXCLUSIVE',
    p_tax_recoverable => false,
    p_submit => true,
    p_idempotency_key => 'phase1-production-tax-1'
  );
  PERFORM public.decide_expense(v_entry.id, true, 'اختبار قبول ضريبة');
  PERFORM public.post_expense(v_entry.id, v_entry.version);

  SELECT id INTO v_line FROM public.expense_lines WHERE entry_id = v_entry.id;
  SELECT eligible_amount, available_amount INTO v_eligible, v_available
    FROM public.production_expense_line_available(v_line);

  IF v_eligible <> 115 OR v_available <> 115 THEN
    RAISE EXCEPTION 'فشل الضريبة المؤهلة: الجزء المؤهل % والمتاح % (المتوقع 115)',
      v_eligible, v_available;
  END IF;
END
$phase1_production$;

ROLLBACK;
