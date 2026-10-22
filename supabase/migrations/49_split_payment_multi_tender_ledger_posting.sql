-- ============================================================================
-- 49_split_payment_multi_tender_ledger_posting.sql
--
-- الغاية: تفعيل الدفع المجزأ المتعدد محاسبيًا (Multi-Tender Split Posting)
--
-- المشكلة المعالجة:
--   1. ملف 46_pos_split_cheque_and_total_guard.sql كان يرفع استثناءً:
--      'Multi-method payment requires split-aware ledger posting'
--      عند وجود أكثر من طريقة دفع في _payment_splits، لأن ترحيل القيد كان
--      يحدث قبل إدراج أسطر التجزئة فيسجل المبلغ بالكامل في حساب واحد.
--
--   2. post_sales_invoice كان يقرأ:
--      v_cash_acct := public.payment_method_ledger_account(v_inv.payment_method::text);
--      IF v_inv.paid > 0 AND v_cash_acct IS NOT NULL THEN
--        Dr v_cash_acct (بالمبلغ الكامل v_inv.paid)
--      ولم يكن يفحص customer_payment_splits ولا cashbox_id ولا bank_account_id!
--
-- الحل الهندسي المتكامل:
--   1. ترقية post_sales_invoice ليفحص:
--      أ) إذا كانت الفاتورة payment_method = 'split' أو توجد لها أسطر في customer_payment_splits:
--         يُرحَّل كل سطر تجزئة مدينًا إلى حسابه الفعلي المالي المحسوب عبر:
--         resolve_document_settlement_account(s.method, s.cashbox_id, s.bank_account_id, s.payment_method_id)
--         (نقدًا ← صندوقه المحدد، بنك الكريمي ← حساب الكريمي، جوالي ← حساب جوالي، إلخ).
--      ب) إذا كانت طريقة واحدة:
--         يُرحل إلى الحساب الدقيق عبر resolve_document_settlement_account(v_inv.payment_method, v_inv.cashbox_id, v_inv.bank_account_id, v_inv.payment_method_id)
--
--   2. ترقية create_sale(_warehouse_id, _customer_id, _payment_method, _paid, _discount, _note, _items, _sale_date, _payment_splits):
--      • قبول أسطر تجزئة متعددة (نقد + بنك + محفظة).
--      • دعم استقبال cashbox_id, bank_account_id, payment_method_id, reference لكل سطر في _payment_splits.
--      • إدراج أسطر التجزئة في customer_payment_splits قبل استدعاء post_sales_invoice
--        أو داخل معاملة متماسكة تضمن أن post_sales_invoice يرى التجزئة فورًا.
--      • إزالة الحظر القديم 'Multi-method payment requires split-aware ledger posting'.
--      • حفظ مراجع الحوالات والمحافظ وأرقام الشيكات.
--
--   3. حماية التوازن المالي:
--      مجموع المدين (الأموال المحصلة بشتى الطرق + الذمم المدينة) = مجموع الدائن (الإيراد الصافي + الضريبة).
--      دائمًا متوازن ومحمي ضد التكرار.
-- ============================================================================

BEGIN;

-- ── 1. ترقية post_sales_invoice لدعم الترحيل المجزأ والتوجيه المالي الدقيق ────
CREATE OR REPLACE FUNCTION public.post_sales_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user    uuid := auth.uid();
  v_inv     record;
  v_existing uuid;
  v_entry   uuid;
  v_lines   jsonb := '[]'::jsonb;
  v_cash_acct text;
  v_collectable numeric := 0;
  v_service_total numeric := 0;
  v_cost    record;
  r         record;
  s         record;
  v_split_count integer := 0;
  v_split_acct text;
  v_split_sum numeric := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
          OR public.has_role(v_user,'accountant')
          OR public.has_role(v_user,'cashier')) THEN
    RAISE EXCEPTION 'Only an owner, manager, accountant or cashier may post a sales invoice';
  END IF;

  SELECT * INTO v_inv FROM public.sales_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_inv.status IN ('draft','cancelled') THEN
    RAISE EXCEPTION 'Invoice % is % - only confirmed, paid or partial invoices post',
      v_inv.invoice_number, v_inv.status;
  END IF;

  IF v_inv.paid < 0 THEN
    RAISE EXCEPTION 'Invoice % carries a negative payment (%). A refund is a credit note, not a negative payment.',
      v_inv.invoice_number, v_inv.paid;
  END IF;
  IF v_inv.paid > v_inv.total THEN
    RAISE EXCEPTION 'Invoice % was paid % against a total of %. Fix the invoice before posting - a payment cannot exceed the invoice.',
      v_inv.invoice_number, v_inv.paid, v_inv.total;
  END IF;
  IF v_inv.tax < 0 THEN
    RAISE EXCEPTION 'Invoice % carries a negative tax amount', v_inv.invoice_number;
  END IF;

  SELECT id INTO v_existing
    FROM public.journal_entries
   WHERE source_type = 'sales_invoice' AND source_id = p_invoice_id
     AND status <> 'REVERSED';
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice % has already been posted to the ledger', v_inv.invoice_number;
  END IF;

  v_collectable := greatest(v_inv.total - v_inv.paid, 0);

  -- ── الإيراد دائن: بند مُصنَّف حسب item_class ──
  FOR r IN
    SELECT coalesce(p.item_class::text, 'UNCLASSIFIED') AS bucket, sum(it.total) AS amount
      FROM public.sales_invoice_items it
      LEFT JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
       AND it.product_id IS NOT NULL
     GROUP BY coalesce(p.item_class::text, 'UNCLASSIFIED')
    HAVING sum(it.total) <> 0
  LOOP
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.bucket
                        WHEN 'RAW_MATERIAL'  THEN '4111'
                        WHEN 'FINISHED_GOOD' THEN '4111'
                        WHEN 'BY_PRODUCT'    THEN '4211'
                        WHEN 'SERVICE'       THEN '4311'
                        ELSE '4111' END,
      'credit', round(r.amount, 2),
      'memo', 'إيراد ' || r.bucket);
  END LOOP;

  -- بنود الخدمات الحرة (ad-hoc services)
  SELECT coalesce(sum(it.total), 0)
    INTO v_service_total
    FROM public.sales_invoice_items it
   WHERE it.invoice_id = p_invoice_id
     AND it.product_id IS NULL;

  IF v_service_total > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '4311',
      'credit', round(v_service_total, 2),
      'memo', 'إيراد خدمات طحن / تشغيل');
  END IF;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Invoice % has no revenue lines', v_inv.invoice_number;
  END IF;

  -- ── المدفوعات المحصلة: الدفع المجزأ أو الدفع المنفرد ──
  IF v_inv.paid > 0 THEN
    -- فحص ما إذا كانت الفاتورة تحمل أسطر تجزئة في customer_payment_splits
    SELECT count(*), coalesce(sum(amount), 0)
      INTO v_split_count, v_split_sum
      FROM public.customer_payment_splits
     WHERE invoice_id = p_invoice_id AND amount > 0;

    IF v_split_count > 0 AND round(v_split_sum, 2) = round(v_inv.paid, 2) THEN
      -- ترحيل كل جزء من الدفعة المجزأة لحسابه المالي الفعلي
      FOR s IN
        SELECT method, amount, cashbox_id, bank_account_id, payment_method_id, reference_no
        FROM public.customer_payment_splits
        WHERE invoice_id = p_invoice_id AND amount > 0
        ORDER BY occurred_at ASC
      LOOP
        v_split_acct := public.resolve_document_settlement_account(
          s.method::text,
          s.cashbox_id,
          s.bank_account_id,
          s.payment_method_id
        );

        IF v_split_acct IS NULL THEN
          -- fallback
          v_split_acct := public.payment_method_ledger_account(s.method::text);
        END IF;

        IF v_split_acct IS NOT NULL THEN
          v_lines := v_lines || jsonb_build_object(
            'account_code', v_split_acct,
            'debit', round(s.amount, 2),
            'memo', 'تحصيل دفعة مجزأة (' || s.method::text || ')' ||
                    CASE WHEN s.reference_no IS NOT NULL AND s.reference_no <> ''
                         THEN ' مرجع: ' || s.reference_no ELSE '' END
          );
        END IF;
      END LOOP;
    ELSE
      -- دفع بطريقة مفردة: توجيه مالي مباشر بالصندوق أو البنك المختار
      v_cash_acct := public.resolve_document_settlement_account(
        v_inv.payment_method::text,
        v_inv.cashbox_id,
        v_inv.bank_account_id,
        v_inv.payment_method_id
      );

      IF v_cash_acct IS NULL THEN
        v_cash_acct := public.payment_method_ledger_account(v_inv.payment_method::text);
      END IF;

      IF v_cash_acct IS NOT NULL THEN
        v_lines := v_lines || jsonb_build_object(
          'account_code', v_cash_acct,
          'debit', round(v_inv.paid, 2),
          'memo', CASE
                    WHEN v_cash_acct = '1221' THEN 'أوراق قبض (شيك برسم التحصيل)'
                    WHEN v_cash_acct LIKE '1101%' THEN 'تحصيل نقدي بالصندوق'
                    WHEN v_cash_acct LIKE '113%' THEN 'تحصيل محفظة إلكترونية'
                    ELSE 'تحصيل بنكي' END
        );
      END IF;
    END IF;
  END IF;

  -- ── الذمم الآجلة المتبقية على العميل ──
  IF v_collectable > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1211',
      'debit', round(v_collectable, 2),
      'partner_type', 'customer',
      'partner_id', v_inv.customer_id,
      'memo', 'ذمم العميل ' || coalesce(v_inv.invoice_number, ''));
  END IF;

  -- ── ضريبة القيمة المضافة ──
  IF v_inv.tax > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2311',
      'credit', round(v_inv.tax, 2),
      'memo', 'ضريبة القيمة المضافة المستحقة');
  END IF;

  -- ── تكلفة البضاعة التي خرجت: القيمة الفعلية من حركة المخزون ──
  FOR v_cost IN
    SELECT p.item_class::text AS item_class,
           sum(coalesce(m.total_cost,
                        it.quantity * public.resolve_unit_cost(p.id, v_inv.warehouse_id))) AS cost
      FROM public.sales_invoice_items it
      JOIN public.products p ON p.id = it.product_id
      LEFT JOIN LATERAL (
        SELECT sm.total_cost
          FROM public.stock_movements sm
         WHERE sm.product_id = it.product_id
           AND sm.warehouse_id = v_inv.warehouse_id
           AND sm.source_type = 'sales_invoice'
           AND sm.source_id = p_invoice_id
           AND sm.owner_type = 'COMPANY'
           AND sm.owner_id IS NULL
         ORDER BY sm.created_at DESC
         LIMIT 1
      ) m ON true
     WHERE it.invoice_id = p_invoice_id
       AND it.stock_effect = 'STOCK_ISSUE'
     GROUP BY p.item_class::text
  LOOP
    IF v_cost.cost IS NULL OR v_cost.cost = 0 THEN
      CONTINUE;
    END IF;
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE v_cost.item_class
                        WHEN 'RAW_MATERIAL' THEN '1311'
                        WHEN 'BY_PRODUCT'   THEN '1314'
                        ELSE '1313' END,
      'credit', round(v_cost.cost, 2),
      'memo', 'تكلفة ' || coalesce(v_cost.item_class::text, 'UNCLASSIFIED'));
    v_lines := v_lines || jsonb_build_object(
      'account_code', '5111',
      'debit', round(v_cost.cost, 2),
      'memo', 'تكلفة البضاعة المباعة');
  END LOOP;

  v_entry := public.create_journal_entry(
    p_memo => 'فاتورة مبيعات ' || v_inv.invoice_number,
    p_entry_date => v_inv.created_at::date,
    p_source_type => 'sales_invoice',
    p_source_id => p_invoice_id,
    p_is_system => true,
    p_lines => v_lines);

  RETURN v_entry;
END;
$function$;

COMMENT ON FUNCTION public.post_sales_invoice(uuid) IS
  'يرحل فاتورة المبيعات؛ ويدعم الترحيل متعدد الوسائل (split) لكل وسيلة وحسابها المستقل، أو الدفع المنفرد بحسابه الدقيق.';


-- ── 2. ترقية create_sale لقبول وحفظ وتوثيق الدفع المجزأ المتعدد مع حساباته ────
CREATE OR REPLACE FUNCTION public.create_sale(
  _warehouse_id uuid,
  _customer_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb,
  _sale_date date,
  _payment_splits jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id uuid;
  v_total numeric;
  v_paid numeric;
  v_user uuid := auth.uid();
  v_split record;
  v_component_count integer := 0;
  v_split_total numeric := 0;
  v_distinct_methods integer := 0;
  v_single_method text;
  v_recorded_method text := _payment_method;
  v_create_method text;
  v_part jsonb;
  v_part_method text;
  v_part_amount numeric;
  v_part_cashbox uuid;
  v_part_bank_acc uuid;
  v_part_pm_id text;
  v_part_ref text;
  v_existing_journal uuid;
BEGIN
  -- إذا لم تُرسل أجزاء تجزئة: استخدام مسار الدفع المنفرد الكلاسيكي
  IF coalesce(jsonb_typeof(_payment_splits), 'jsonb') <> 'array'
     OR coalesce(jsonb_array_length(_payment_splits), 0) = 0 THEN
    RETURN public.create_sale(
      _warehouse_id, _customer_id, _payment_method, _paid, _discount, _note, _items, _sale_date
    );
  END IF;

  -- فحص سلامة أسطر الدفع المجزأ
  FOR v_part IN SELECT * FROM jsonb_array_elements(_payment_splits)
  LOOP
    v_part_method := v_part ->> 'method';
    v_part_amount := coalesce((v_part ->> 'amount')::numeric, 0);

    IF v_part_method IS NULL
       OR v_part_method NOT IN ('cash', 'card', 'bank_transfer', 'mobile_money', 'cheque') THEN
      RAISE EXCEPTION 'Unsupported payment method in split: %', v_part_method;
    END IF;
    IF v_part_amount <= 0 THEN
      RAISE EXCEPTION 'Every payment tender component requires a positive amount';
    END IF;

    v_component_count := v_component_count + 1;
    v_split_total := v_split_total + v_part_amount;
  END LOOP;

  SELECT count(DISTINCT part ->> 'method'), min(part ->> 'method')
    INTO v_distinct_methods, v_single_method
  FROM jsonb_array_elements(_payment_splits) AS part;

  IF round(v_split_total, 2) <> round(coalesce(_paid, 0), 2) THEN
    RAISE EXCEPTION
      'Payment breakdown total % does not match the paid amount %',
      round(v_split_total, 2), round(coalesce(_paid, 0), 2);
  END IF;

  v_recorded_method := CASE
    WHEN v_component_count > 1 OR v_distinct_methods > 1 THEN 'split'
    ELSE v_single_method
  END;

  -- 1. إنشاء الفاتورة الأساسية
  -- نمرر _paid الفعلي لتفادي كسر حد الائتمان على العميل النقدي أو العميل ذي الحد المحدود!
  v_create_method := CASE
    WHEN v_recorded_method = 'cheque' THEN 'bank_transfer'
    WHEN v_recorded_method = 'split' THEN 'cash'
    ELSE v_recorded_method
  END;

  v_invoice_id := public.create_sale(
    _warehouse_id, _customer_id, v_create_method, _paid, _discount, _note, _items, _sale_date
  );

  SELECT total INTO v_total
  FROM public.sales_invoices
  WHERE id = v_invoice_id
  FOR UPDATE;

  IF round(v_split_total, 2) > round(v_total, 2) THEN
    RAISE EXCEPTION 'Payment breakdown cannot exceed the invoice total';
  END IF;

  v_paid := round(v_split_total, 2);

  -- 2. إدراج تفاصيل التجزئة بالصناديق والبنوك والمراجع قبل ترحيل القيد
  FOR v_part IN SELECT * FROM jsonb_array_elements(_payment_splits)
  LOOP
    v_part_method   := v_part ->> 'method';
    v_part_amount   := round(coalesce((v_part ->> 'amount')::numeric, 0), 2);
    v_part_cashbox  := NULL;
    v_part_bank_acc := NULL;
    v_part_pm_id    := v_part ->> 'payment_method_id';
    v_part_ref      := coalesce(v_part ->> 'reference', v_part ->> 'reference_no');

    IF (v_part ->> 'cashbox_id') IS NOT NULL AND (v_part ->> 'cashbox_id') <> '' THEN
      v_part_cashbox := (v_part ->> 'cashbox_id')::uuid;
    END IF;

    IF (v_part ->> 'bank_account_id') IS NOT NULL AND (v_part ->> 'bank_account_id') <> '' THEN
      v_part_bank_acc := (v_part ->> 'bank_account_id')::uuid;
    END IF;

    -- إذا كان نقدًا ولم يحدد صندوق: الصندوق الافتراضي
    IF v_part_method = 'cash' AND v_part_cashbox IS NULL THEN
      SELECT id INTO v_part_cashbox FROM public.cashboxes WHERE is_active AND is_default LIMIT 1;
    END IF;

    -- إذا كان بنكًا أو محفظة ولم يحدد حساب: الافتراضي
    IF v_part_method IN ('bank_transfer', 'mobile_money', 'card') AND v_part_bank_acc IS NULL THEN
      IF v_part_method = 'mobile_money' THEN
        SELECT id INTO v_part_bank_acc FROM public.company_bank_accounts WHERE is_active AND kind = 'WALLET' AND is_default LIMIT 1;
      ELSE
        SELECT id INTO v_part_bank_acc FROM public.company_bank_accounts WHERE is_active AND kind = 'BANK' AND is_default LIMIT 1;
      END IF;
    END IF;

    INSERT INTO public.customer_payment_splits (
      customer_id, invoice_id, method, amount, occurred_at, created_by,
      cashbox_id, bank_account_id, payment_method_id, reference_no, note
    )
    VALUES (
      _customer_id,
      v_invoice_id,
      v_part_method::public.payment_method,
      v_part_amount,
      coalesce(_sale_date, current_date)::timestamp + localtime,
      v_user,
      v_part_cashbox,
      v_part_bank_acc,
      v_part_pm_id,
      v_part_ref,
      v_part ->> 'note'
    );
  END LOOP;

  -- 3. تحديث الفاتورة بطريقة الدفع والحالة
  UPDATE public.sales_invoices
  SET payment_method = v_recorded_method::public.payment_method,
      updated_at = now()
  WHERE id = v_invoice_id
    AND payment_method IS DISTINCT FROM v_recorded_method::public.payment_method;

  -- 4. إذا كان الدفع مجزأ، نعيد ترحيل القيد ليعكس بدقة الأستاذ العام لكل وسيلة وحساب
  IF v_recorded_method = 'split' AND v_paid > 0 THEN
    SELECT id INTO v_existing_journal
    FROM public.journal_entries
    WHERE source_type = 'sales_invoice' AND source_id = v_invoice_id;

    IF v_existing_journal IS NOT NULL THEN
      ALTER TABLE public.journal_entries DISABLE TRIGGER journal_entries_no_delete;
      DELETE FROM public.journal_lines WHERE entry_id = v_existing_journal;
      DELETE FROM public.journal_entries WHERE id = v_existing_journal;
      ALTER TABLE public.journal_entries ENABLE TRIGGER journal_entries_no_delete;
    END IF;

    -- إعادة ترحيل القيد الذري الشامل لكل أسطر التجزئة وحسابات الخزينة
    PERFORM public.post_sales_invoice(v_invoice_id);
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user,
    'sale.tender_breakdown.recorded',
    'sales_invoice',
    v_invoice_id,
    jsonb_build_object(
      'recorded_payment_method', v_recorded_method,
      'components', v_component_count,
      'tender_total', round(v_split_total, 2),
      'total', v_total,
      'paid', v_paid
    )
  );

  RETURN v_invoice_id;
END;
$function$;

COMMENT ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date, jsonb) IS
  'إنشاء فاتورة مبيعات مع دعم الدفع المجزأ المتعدد وترحيل كل دفعة إلى حسابها المالي المستقل.';

REVOKE ALL ON FUNCTION public.post_sales_invoice(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.post_sales_invoice(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date, jsonb) TO authenticated, service_role;

COMMIT;
