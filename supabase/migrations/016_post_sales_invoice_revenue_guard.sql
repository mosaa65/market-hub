-- ============================================================================
-- الترحيل 016_post_sales_invoice_revenue_guard.sql
-- مجال: المبيعات والترحيل المحاسبي (إصلاح تشغيلي)
--
-- المشكلة المُبلَّغ عنها:
--   عند قطع فاتورة مبيعات تظهر الاستثناء الإنجليزي
--   "Invoice INV-... has no revenue lines" ويُفشل إنشاء الفاتورة.
--
-- الجذر:
--   `post_sales_invoice` يبني أسطر الإيراد من بنود الفاتورة التي لها
--   `product_id` غير فارغ (مجمّعة حسب item_class) ومن `ad_hoc_service_lines`.
--   أي بند قيمته صفر (سعر 0 مثل بند هدية/خدمة مجانية) يُستبعد بـ
--   `HAVING sum(it.total) <> 0`، فإن كانت كل بنود الفاتورة صفرية
--   (أو الفاتورة بلا بنود ذات قيمة) صار قيد اليومية بلا أسطر إيراد
--   ورُفع الاستثناء الإنجليزي أعلاه، وفشلت الفاتورة كلها.
--
-- الإصلاح:
--   1) الفاتورة صافي قيمتها صفر (كل البنود مجانية/مخفّضة للصفر): تُرحَّل بقيد
--      متزن صفري الأثر — مدين/دائن على حساب المقبوضات النقدية بقيمة صفر
--      غير ممكن، لذا تُسجَّل ملاحظة الإيراد الصفري كسطر واحد متزن على حساب
--      الإيراد (دائن 0 = مدين 0 ليس قيدًا). القرار العملي: القيد الصفري
--      لا معنى محاسبية له، فنتخطى إنشاء قيد اليومية ونعيد NULL، ونكمل
--      تكلفة المبيعات (ستكون صفرية أيضًا). الفاتورة تُنشأ بنجاح وتظهر
--      في التقارير بقيمة صفر.
--   2) الفاتورة قيمتها غير صفرية ومع ذلك لا أسطر إيراد (حالة شاذة):
--      نرفع رسالة عربية واضحة تشرح السبب وما يجب فعله.
--
-- آمن للتشغيل المتكرر (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.post_sales_invoice(p_invoice_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $fn$
DECLARE
  v_user    uuid := auth.uid();
  v_inv     record;
  v_existing uuid;
  v_entry   uuid;
  v_lines   jsonb := '[]'::jsonb;
  v_cash_acct text;
  v_split_acct text;
  v_collectable numeric := 0;
  v_split_total numeric := 0;
  v_service_total numeric := 0;
  v_cost    record;
  r         record;
  r_split   record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
          OR public.has_role(v_user,'accountant') OR
          (public.has_role(v_user,'cashier') AND
           current_setting('app.payment_split_internal_post', true) = 'on')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may post an invoice';
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

  -- حل حساب التسوية المفرد
  v_cash_acct := public.resolve_document_settlement_account(
    v_inv.payment_method::text,
    v_inv.cashbox_id,
    v_inv.bank_account_id,
    v_inv.payment_method_id
  );
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
                        WHEN 'BY_PRODUCT' THEN '4211'
                        WHEN 'SERVICE'    THEN '4311'
                        ELSE '4111' END,
      'credit', round(r.amount, 2),
      'memo', 'إيراد ' || r.bucket);
  END LOOP;

  -- ── الإيراد دائن: الخدمة الحرة ──
  SELECT coalesce(sum(l.total), 0) INTO v_service_total
    FROM public.ad_hoc_service_lines l
   WHERE l.invoice_id = p_invoice_id;
  IF v_service_total <> 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '4311',
      'credit', round(v_service_total, 2),
      'memo', 'إيراد خدمة حرة (AD_HOC_SERVICE)');
  END IF;

  -- ── حارس الإيراد ──
  IF jsonb_array_length(v_lines) = 0 THEN
    -- الفاتورة صافيها صفر (بنود مجانية أو مخفَّضة للصفر بالكامل):
    -- لا معنى محاسبيًا لقيد صفحي، فتُرحَّل بلا قيد وتُكتمل التكلفة (صفرية).
    IF round(v_inv.total, 2) = 0 THEN
      PERFORM public.post_sales_invoice_cogs(
        p_invoice_id, v_inv.created_at::date, v_inv.invoice_number);
      RETURN NULL;
    END IF;
    -- حالة شاذة: فاتورة بقيمة لا تُرجَع فيها أصناف أو خدمات محتسبة.
    RAISE EXCEPTION
      'الفاتورة % بلا أسطر إيراد: كل بنودها إما بلا صنف محتسب أو قيمتها صفر. أعد فتح الفاتورة وأضف بنداً بقيمة أكبر من صفر قبل الترحيل.',
      v_inv.invoice_number
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── أسطر التحصيل (مدين) ──
  IF v_inv.paid > 0 THEN
    -- فحص الدفع المجزأ أولاً: إذا كانت هناك سجلات تجزئة
    IF EXISTS (SELECT 1 FROM public.customer_payment_splits WHERE invoice_id = p_invoice_id) THEN
      SELECT round(coalesce(sum(amount), 0), 2)
        INTO v_split_total
        FROM public.customer_payment_splits
       WHERE invoice_id = p_invoice_id;
      IF v_split_total <> round(v_inv.paid, 2) THEN
        RAISE EXCEPTION 'Invoice % split total (%) does not match paid amount (%)',
          v_inv.invoice_number, v_split_total, round(v_inv.paid, 2);
      END IF;

      FOR r_split IN
        SELECT method::text AS method, amount, cashbox_id, bank_account_id,
               payment_method_id, reference_no
        FROM public.customer_payment_splits
        WHERE invoice_id = p_invoice_id
      LOOP
        IF r_split.amount > 0 THEN
          v_split_acct := public.resolve_document_settlement_account(
            r_split.method, r_split.cashbox_id, r_split.bank_account_id,
            coalesce(r_split.payment_method_id, r_split.method)
          );
          IF v_split_acct IS NULL THEN
            RAISE EXCEPTION 'No ledger account could be resolved for split tender %', r_split.method;
          END IF;
          v_lines := v_lines || jsonb_build_object(
            'account_code', v_split_acct,
            'debit', round(r_split.amount, 2),
            'memo', 'تحصيل مجزأ عبر ' || r_split.method ||
                    coalesce(' — ' || nullif(r_split.reference_no, ''), ''));
        END IF;
      END LOOP;
    ELSIF v_cash_acct IS NOT NULL THEN
      -- دفع مفرد
      v_lines := v_lines || jsonb_build_object(
        'account_code', v_cash_acct,
        'debit', round(v_inv.paid, 2),
        'memo', CASE
                  WHEN v_cash_acct = '1111' THEN 'تحصيل عبر البنك'
                  WHEN v_cash_acct = '1131' THEN 'تحصيل عبر المحفظة الإلكترونية'
                  ELSE 'تحصيل نقدي بالصندوق'
                END);
    END IF;
  END IF;

  -- سطر الآجل (مدين - ذمم العملاء 1211)
  IF v_collectable > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1211',
      'debit', round(v_collectable, 2),
      'partner_type', 'customer',
      'partner_id', v_inv.customer_id,
      'memo', 'ذمم العميل ' || coalesce(v_inv.invoice_number, ''));
  END IF;

  -- سطر الضريبة
  IF v_inv.tax > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2311',
      'credit', round(v_inv.tax, 2),
      'memo', 'ضريبة مخرجات مستحقة');
  END IF;

  -- إنشاء وترحيل قيد اليومية
  v_entry := public.post_journal_entry(
    p_entry_date := v_inv.created_at::date,
    p_memo := 'ترحيل فاتورة مبيعات ' || v_inv.invoice_number,
    p_lines := v_lines,
    p_source_type := 'sales_invoice',
    p_source_id := p_invoice_id,
    p_entry_number := 'JE-SI-' || v_inv.invoice_number
  );

  -- ترحيل تكلفة المبيعات حسب فئة الصنف من تكلفة حركة الصرف الفعلية.
  PERFORM public.post_sales_invoice_cogs(p_invoice_id,v_inv.created_at::date,v_inv.invoice_number);

  RETURN v_entry;
END;
$fn$;

COMMENT ON FUNCTION public.post_sales_invoice(uuid) IS
'ترحيل فاتورة مبيعات للأستاذ. الفاتورة صفرية القيمة تُرحَّل بلا قيد (لا معنى محاسبي لقيد صفحي)، وأي غياب للإيراد في فاتورة ذات قيمة يُرفض برسالة عربية تشرح السبب.';
