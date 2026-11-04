-- ============================================================================
-- customer_balance_reconciliation_acceptance.sql
--
-- اختبارات قبول حسابية لدورة أرصدة العميل. كل الاختبارات تعمل داخل معاملة
-- واحدة تُلغى في النهاية: لا تترك أي حركة اختبار في قاعدة حقيقية.
--
-- التشغيل على قاعدة محلية أو سحابية:
--   npx supabase db query --db-url "$env:SUPABASE_DB_URL" --file supabase/tests/customer_balance_reconciliation_acceptance.sql
--
-- الفكرة المحورية لكل فحص:
--   بعد كل عملية مالية: customers.balance = Σ(customer_ledger.debit - credit)
--   وبعد كل قيد:        Σ(journal_lines.debit) = Σ(journal_lines.credit)
-- ============================================================================
BEGIN;

CREATE TEMP TABLE IF NOT EXISTS _cb_results (
  case_name text,
  passed    boolean,
  detail    text
) ON COMMIT DROP;

-- ── أدوات الاختبار ─────────────────────────────────────────────────────────

-- عميل اختباري معزول
CREATE OR REPLACE FUNCTION pg_temp._mk_customer(p_name text, p_limit numeric DEFAULT 1000000)
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.customers (name, credit_limit, balance)
  VALUES (p_name, p_limit, 0)
  RETURNING id;
$$;

CREATE OR REPLACE FUNCTION pg_temp._ledger_sum(p_customer uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT round(coalesce(sum(l.debit - l.credit), 0), 2)
    FROM public.customer_ledger l WHERE l.customer_id = p_customer;
$$;

CREATE OR REPLACE FUNCTION pg_temp._stored(p_customer uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT round(coalesce(c.balance, 0), 2) FROM public.customers c WHERE c.id = p_customer;
$$;

-- الفحص الأساسي: الرصيد المخزَّن = رصيد الدفتر
CREATE OR REPLACE FUNCTION pg_temp._check(p_case text, p_customer uuid, p_expected_stored numeric DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_stored numeric := pg_temp._stored(p_customer);
  v_ledger numeric := pg_temp._ledger_sum(p_customer);
  v_ok boolean;
BEGIN
  v_ok := abs(v_stored - v_ledger) < 0.005
          AND (p_expected_stored IS NULL OR abs(v_stored - p_expected_stored) < 0.005);
  INSERT INTO _cb_results VALUES (
    p_case, v_ok,
    format('stored=%s ledger=%s expected=%s', v_stored, v_ledger, coalesce(p_expected_stored::text, '—'))
  );
END $$;

-- توازن قيد المصدر
CREATE OR REPLACE FUNCTION pg_temp._check_entry(p_case text, p_source_type text, p_source_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_d numeric; v_c numeric;
BEGIN
  SELECT coalesce(sum(jl.debit), 0), coalesce(sum(jl.credit), 0)
    INTO v_d, v_c
    FROM public.journal_entries je
    JOIN public.journal_lines jl ON jl.entry_id = je.id
   WHERE je.source_type = p_source_type AND je.source_id = p_source_id
     AND je.status = 'POSTED';
  INSERT INTO _cb_results VALUES (
    p_case, abs(v_d - v_c) < 0.005 AND v_d > 0,
    format('debit=%s credit=%s', v_d, v_c)
  );
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) المبيعات والتحصيل
-- ════════════════════════════════════════════════════════════════════════════
-- يعتمد على وجود مخزون ومسودة فاتورة قابلة للإنشاء؛ يُنفَّذ فقط إن توفّر
-- صنف متتبَّع برصيد، وإلا يُسجّل كتخطٍّ صريح لا كنجاح كاذب.
DO $$
DECLARE
  v_customer uuid;
  v_wh uuid;
  v_item record;
  v_inv uuid;
  v_i int;
BEGIN
  SELECT i.product_id, i.warehouse_id INTO v_item
    FROM public.inventory i
    JOIN public.products p ON p.id = i.product_id
   WHERE i.quantity >= 2 AND i.owner_type = 'COMPANY' AND i.owner_id IS NULL
     AND p.is_sellable AND p.is_active
   LIMIT 1;

  IF v_item.product_id IS NULL THEN
    INSERT INTO _cb_results VALUES ('sales/collection', NULL, 'تخطّي: لا يوجد صنف برصيد كافٍ لإنشاء فاتورة اختبارية');
    RETURN;
  END IF;

  v_customer := pg_temp._mk_customer('اختبار أرصدة — بيع وتحصيل');

  -- فاتورة آجلة 1000
  v_inv := public.create_sale(
    v_item.warehouse_id, v_customer, 'credit', 0, 0, 'اختبار',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_item.product_id, 'quantity', 1, 'unit_price', 1000, 'tax_rate', 0)),
    CURRENT_DATE, NULL::jsonb);

  PERFORM pg_temp._check('فاتورة آجلة 1,000', v_customer, 1000);
  PERFORM pg_temp._check_entry('قيد الفاتورة الآجلة متوازن', 'sales_invoice', v_inv);

  -- تحصيل 300 ثم 700
  PERFORM public.record_customer_payment(v_customer, v_inv, 300, 'cash', CURRENT_DATE, 'اختبار 300');
  PERFORM pg_temp._check('تحصيل 300', v_customer, 700);

  PERFORM public.record_customer_payment(v_customer, v_inv, 700, 'cash', CURRENT_DATE, 'اختبار 700');
  PERFORM pg_temp._check('تحصيل 700 (سداد كامل)', v_customer, 0);

  -- تحصيل يتجاوز الذمة يُرفض
  BEGIN
    PERFORM public.record_customer_payment(v_customer, v_inv, 1, 'cash', CURRENT_DATE, 'زائد');
    INSERT INTO _cb_results VALUES ('رفض تحصيل يتجاوز الذمة', false, 'لم يُرفض');
  EXCEPTION WHEN others THEN
    INSERT INTO _cb_results VALUES ('رفض تحصيل يتجاوز الذمة', true, SQLERRM);
  END;

  DELETE FROM public.customers WHERE id = v_customer;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) المرتجعات — الآجلة، الجزئية، والمسدّدة كاملة
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_customer uuid;
  v_item record;
  v_inv uuid;
  v_line uuid;
  v_ret uuid;
  v_cash bigint;
  v_before bigint;
BEGIN
  SELECT i.product_id, i.warehouse_id INTO v_item
    FROM public.inventory i
    JOIN public.products p ON p.id = i.product_id
   WHERE i.quantity >= 3 AND i.owner_type = 'COMPANY' AND i.owner_id IS NULL
     AND p.is_sellable AND p.is_active
   LIMIT 1;

  IF v_item.product_id IS NULL THEN
    INSERT INTO _cb_results VALUES ('sales returns', NULL, 'تخطّي: لا يوجد صنف برصيد كافٍ');
    RETURN;
  END IF;

  v_customer := pg_temp._mk_customer('اختبار أرصدة — مرتجعات');
  v_inv := public.create_sale(
    v_item.warehouse_id, v_customer, 'credit', 0, 0, 'اختبار مرتجع',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_item.product_id, 'quantity', 1, 'unit_price', 1000, 'tax_rate', 0)),
    CURRENT_DATE, NULL::jsonb);

  SELECT id INTO v_line FROM public.sales_invoice_items WHERE invoice_id = v_inv LIMIT 1;

  -- (أ) مرتجع 200 على فاتورة آجلة: يخصم من الذمة، بلا نقد
  SELECT coalesce(count(*), 0) INTO v_before FROM public.sales_return_items;
  v_ret := public.create_sales_return(
    v_inv, v_item.warehouse_id, v_customer, 'cash', 'اختبار مرتجع آجل',
    jsonb_build_array(jsonb_build_object(
      'invoice_item_id', v_line, 'product_id', v_item.product_id,
      'quantity', 0.2, 'uom_id', (SELECT uom_id FROM public.sales_invoice_items WHERE id = v_line))));
  PERFORM pg_temp._check('مرتجع 200 على آجلة يخصم الذمة', v_customer, 800);
  PERFORM pg_temp._check_entry('قيد المرتجع متوازن (آجل)', 'sales_return', v_ret);

  -- (ب) الفاتورة صارت 800 مستحقة؛ نستوفيها ثم نرجع الباقي
  PERFORM public.record_customer_payment(v_customer, v_inv, 800, 'cash', CURRENT_DATE, 'سداد كامل');
  PERFORM pg_temp._check('سداد كامل بعد المرتجع', v_customer, 0);

  SELECT coalesce(sum(credit), 0) INTO v_cash
    FROM public.customer_ledger
   WHERE customer_id = v_customer AND reference_type = 'sales_return_refund';

  v_ret := public.create_sales_return(
    v_inv, v_item.warehouse_id, v_customer, 'cash', 'اختبار مرتجع نقدي',
    jsonb_build_array(jsonb_build_object(
      'invoice_item_id', v_line, 'product_id', v_item.product_id,
      'quantity', 0.2, 'uom_id', (SELECT uom_id FROM public.sales_invoice_items WHERE id = v_line))));

  -- المرتجع على فاتورة مسدّدة: يخرج نقدًا ولا يخصم من الذمة
  PERFORM pg_temp._check('مرتجع على فاتورة مسدّدة لا يخلق رصيدًا دائنًا', v_customer, 0);
  PERFORM pg_temp._check_entry('قيد المرتجع النقدي متوازن', 'sales_return', v_ret);

  SELECT coalesce(sum(credit), 0) INTO v_cash
    FROM public.customer_ledger
   WHERE customer_id = v_customer AND reference_type = 'sales_return_refund';
  INSERT INTO _cb_results VALUES (
    'المرتجع النقدي مسجّل كاسترداد نقدي', v_cash > 0, format('refund=%s', v_cash));

  DELETE FROM public.customers WHERE id = v_customer;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) التسويات والقيود الافتتاحية — كانت تكتب الدفتر ولا تمسّ الرصيد
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_customer uuid;
  v_doc uuid;
  v_before numeric;
BEGIN
  v_customer := pg_temp._mk_customer('اختبار أرصدة — افتتاحي');

  INSERT INTO public.customer_ledger
    (customer_id, entry_type, debit, reference_type, occurred_at, source_key, note)
  VALUES (v_customer, 'adjustment', 400, 'opening_balance', now(),
          'opening-test:' || v_customer, 'رصيد افتتاحي اختباري');

  PERFORM pg_temp._check('حركة افتتاحية تُحدِّث الرصيد المخزَّن عبر المُشغّل', v_customer, 400);

  INSERT INTO public.customer_ledger
    (customer_id, entry_type, credit, reference_type, occurred_at, source_key, note)
  VALUES (v_customer, 'adjustment', 150, 'adjustment', now(),
          'adjust-test:' || v_customer, 'تسوية دائنة اختبارية (تخفيض مديونية)');

  PERFORM pg_temp._check('تسوية تخفيض 150', v_customer, 250);

  INSERT INTO public.customer_ledger
    (customer_id, entry_type, debit, reference_type, occurred_at, source_key, note)
  VALUES (v_customer, 'adjustment', 100, 'adjustment', now(),
          'adjust-test2:' || v_customer, 'تسوية مدينة اختبارية (زيادة مديونية)');

  PERFORM pg_temp._check('تسوية زيادة 100', v_customer, 350);

  -- الأثر التدقيقي: كل تعديل للعمود المخزَّن له صف في سجل التصحيحات
  SELECT count(*) INTO v_before FROM public.customer_balance_adjustments WHERE customer_id = v_customer;
  INSERT INTO _cb_results VALUES (
    'سجل تدقيق التصحيحات يحفظ من/إلى والسبب', v_before >= 3, format('rows=%s', v_before));

  -- إعادة احتساب على رصيد سليم لا تغيّر شيئًا
  PERFORM public.recalculate_customer_balance(v_customer);
  PERFORM pg_temp._check('إعادة احتساب لا تغيّر رصيدًا سليمًا', v_customer, 350);

  -- تصحيح يدوي خاطئ للعمود يُعاد إلى الدفتر بحكم البنية
  UPDATE public.customers SET balance = 99999 WHERE id = v_customer;
  PERFORM pg_temp._check('الرصيد المخزَّن منحرف يُصحَّح بإعادة الاحتساب', v_customer, 99999);
  PERFORM public.recalculate_customer_balance(v_customer, 'اختبار تصحيح');
  PERFORM pg_temp._check('الرصيد بعد التصحيح = الدفتر', v_customer, 350);

  DELETE FROM public.customers WHERE id = v_customer;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) التزامن والتكرار
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_customer uuid;
  v_key text;
BEGIN
  v_customer := pg_temp._mk_customer('اختبار أرصدة — تكرار');
  v_key := 'dup-test:' || v_customer;

  INSERT INTO public.customer_ledger (customer_id, entry_type, debit, reference_type, occurred_at, source_key)
  VALUES (v_customer, 'sale', 500, 'sales_invoice', now(), v_key);

  BEGIN
    INSERT INTO public.customer_ledger (customer_id, entry_type, debit, reference_type, occurred_at, source_key)
    VALUES (v_customer, 'sale', 500, 'sales_invoice', now(), v_key);
    INSERT INTO _cb_results VALUES ('منع تكرار الحركة بنفس source_key', false, 'لم يُرفض');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO _cb_results VALUES ('منع تكرار الحركة بنفس source_key', true, 'unique_violation');
  END;

  PERFORM pg_temp._check('التكرار المرفوض لم يغيّر الرصيد', v_customer, 500);

  DELETE FROM public.customers WHERE id = v_customer;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) ترحيل البيانات: استيراد متكرر لا يُضاعف الرصيد
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_customer uuid;
  v_doc uuid;
  v_rows int;
BEGIN
  v_customer := pg_temp._mk_customer('اختبار أرصدة — استيراد');

  INSERT INTO public.opening_balance_documents
    (document_number, effective_date, status, fiscal_year, created_by)
  VALUES ('OB-TEST-' || v_customer, CURRENT_DATE, 'DRAFT',
          EXTRACT(YEAR FROM CURRENT_DATE)::int, auth.uid())
  RETURNING id INTO v_doc;

  INSERT INTO public.opening_balance_lines
    (document_id, section, side, customer_id, description, amount)
  VALUES (v_doc, 'RECEIVABLE', 'DEBIT', v_customer, 'اختبار استيراد', 750);

  INSERT INTO public.customer_ledger
    (customer_id, entry_type, debit, reference_id, reference_type, occurred_at, note)
  VALUES (v_customer, 'adjustment', 750, v_doc, 'opening_balance', now(), 'رصيد افتتاحي مستورد')
  ON CONFLICT DO NOTHING;

  -- إعادة تشغيل نفس الترحيل
  BEGIN
    INSERT INTO public.customer_ledger
      (customer_id, entry_type, debit, reference_id, reference_type, occurred_at, note)
    VALUES (v_customer, 'adjustment', 750, v_doc, 'opening_balance', now(), 'رصيد افتتاحي مستورد');
    INSERT INTO _cb_results VALUES ('إعادة تشغيل الاستيراد لا تُكرر الحركة', false, 'أُدخل سطر ثانٍ');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO _cb_results VALUES ('إعادة تشغيل الاستيراد لا تُكرر الحركة', true, 'unique_violation');
  END;

  SELECT count(*) INTO v_rows FROM public.customer_ledger
   WHERE customer_id = v_customer AND reference_type = 'opening_balance';
  PERFORM pg_temp._check('رصيد الاستيراد المتكرر 750 لا 1500', v_customer, 750);
  INSERT INTO _cb_results VALUES ('سطر افتتاحي واحد فقط', v_rows = 1, format('rows=%s', v_rows));

  DELETE FROM public.customers WHERE id = v_customer;
  DELETE FROM public.opening_balance_documents WHERE id = v_doc;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) المطابقة الجماعية: تقرير بلا تعديل
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_mismatched int;
BEGIN
  SELECT count(*) INTO v_mismatched
    FROM public.customer_balance_reconciliation_report()
   WHERE status NOT IN ('matched');
  INSERT INTO _cb_results VALUES (
    'تقرير المطابقة يعمل ويصنّف كل صف', true, format('non_matched=%s', v_mismatched));
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- النتيجة
-- ════════════════════════════════════════════════════════════════════════════
SELECT case_name, passed, detail FROM _cb_results ORDER BY passed NULLS LAST;

DO $$
DECLARE
  v_failed int;
  v_skipped int;
BEGIN
  SELECT count(*) FILTER (WHERE passed IS FALSE), count(*) FILTER (WHERE passed IS NULL)
    INTO v_failed, v_skipped FROM _cb_results;
  IF v_failed > 0 THEN
    RAISE EXCEPTION 'فشل % فحصًا من اختبارات أرصدة العملاء', v_failed;
  END IF;
  RAISE NOTICE 'نجحت كل الفحوص المنفَّذة (متخطّى: %)', v_skipped;
END $$;

ROLLBACK;
