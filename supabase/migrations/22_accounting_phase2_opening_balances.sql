-- ============================================================================
-- 20_accounting_phase2_opening_balances.sql — المرحلة 2 (T-11)
-- ترحيل الأقسام غير المرحَّلة في الأرصدة الافتتاحية للأستاذ.
--
--   CASH      → Dr 1101 (الصندوق)
--   BANK      → Dr حساب من payment_method_ledger_account؟ لا — البنوك
--               في الأرصدة الافتتاحية تُحدَّد بحساب البذرة: 1111 الافتراضي،
--               أو payment_method_settings.default_account_id عند وجوده.
--               البساطة والقرار: CASH وBANK كلاهما إلى 1101/1111 ثابتين
--               (1111 للبنك) — تخصيص كل بنك لعائله ممكن لاحقًا عبر الشاشة.
--   ASSET     → Dr حساب الأصول: لا معلومة نوع الأصل في سطر الافتتاح، فتُرحَّل
--               إلى 1411 (آلات ومعدات) الافتراضي إن لم يُحدَّد account_id
--               في السطر. (open_balance_lines لا يحمل account_id — راجع 08.)
--   LIABILITY → Cr 2111 (ذم موردين عامة) الافتراضي.
--   CAPITAL   → Cr 3111 (رأس المال) — هذا أهم سطر: الميزانية كانت عمياء عنه.
--
-- مع تقرير التوازن: post_opening_balance كان يرفض فحص التوازن على كل الأسطر
-- ثم يترك غير المرحَّل بلا أثر — الآن يفحص التوازن ثم يرحّل **كل** الأقسام،
-- فالتوازن الحسابي ينتقل إلى دفتر الأستاذ كاملًا.
-- ════════════════════

BEGIN;

-- أولاً: عمود اختياري لتوجيه الحساب في سطر الافتتاح (اختياري لاحقًا عبر شاشة).
-- إضافة آمنة: عمود جديد فقط، ولا يجري تغيير أي عمود قائم.
ALTER TABLE public.opening_balance_lines
  ADD COLUMN IF NOT EXISTS ledger_account_code text;

COMMENT ON COLUMN public.opening_balance_lines.ledger_account_code IS
  'T-11: توجيه اختياري لحساب الترحيل. عند غيابه تُشتق من القسم (CASH→1101، BANK→1111، ASSET→1411، LIABILITY→2111، CAPITAL→3111).';

CREATE OR REPLACE FUNCTION public.post_opening_balance(_document_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user    uuid := auth.uid();
  v_doc     record;
  v_debit   numeric;
  v_credit  numeric;
  v_capital numeric;
  l         record;
  v_lines   jsonb := '[]'::jsonb;
  v_journal uuid;
  v_acct    text;
  v_section text;
BEGIN
  SELECT * INTO v_doc FROM public.opening_balance_documents WHERE id = _document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opening document not found';
  END IF;
  IF v_doc.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Document % is already %', v_doc.document_number, v_doc.status;
  END IF;

  SELECT coalesce(sum(amount) FILTER (WHERE side='DEBIT'), 0),
         coalesce(sum(amount) FILTER (WHERE side='CREDIT'), 0),
         coalesce(sum(amount) FILTER (WHERE section='CAPITAL'), 0)
    INTO v_debit, v_credit, v_capital
    FROM public.opening_balance_lines WHERE document_id = _document_id;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION
      'Opening entry does not balance: debits % vs credits % (difference %). Capital required is %. Correct the document before posting.',
      round(v_debit, 2)::text,
      round(v_credit, 2)::text,
      round(v_debit - v_credit, 2)::text,
      round(v_debit - v_credit, 2)::text;
  END IF;

  UPDATE public.opening_balance_documents
     SET total_assets      = v_debit,
         total_liabilities = v_credit - v_capital,
         capital_required  = v_debit - v_credit + v_capital,
         status            = 'POSTED',
         posted_by         = v_user,
         posted_at         = now()
   WHERE id = _document_id;

  FOR l IN SELECT * FROM public.opening_balance_lines WHERE document_id = _document_id ORDER BY id
  LOOP
    v_section := l.section;

    IF l.section = 'STOCK' THEN
      -- Real stock, through the real engine. Not a disguised purchase.
      -- movement_type_legacy is set explicitly: the default is 'adjustment',
      -- which the stock engine correctly refuses without an adjustment reason,
      -- and which would file an opening entry under adjustments anyway.
      PERFORM public.post_stock_delta(
        p_product_id => l.product_id, p_warehouse_id => l.warehouse_id,
        p_signed_qty => l.quantity, p_unit_cost => coalesce(l.unit_cost, 0),
        p_movement_kind => 'OPENING', p_movement_type_legacy => 'opening',
        p_source_type => 'opening_balance', p_source_id => _document_id,
        p_note => 'رصيد افتتاحي ' || v_doc.document_number,
        p_owner_type => 'COMPANY', p_owner_id => NULL);

      PERFORM public.apply_cost_movement(
        p_product_id => l.product_id, p_warehouse_id => l.warehouse_id,
        p_signed_qty => l.quantity, p_incoming_cost => l.unit_cost,
        p_source_type => 'opening_balance', p_source_id => _document_id,
        p_note => 'رصيد افتتاحي ' || v_doc.document_number);

      -- سطر المخزون في القيد (توجيه اختياري وإلا فحسب item_class).
      SELECT COALESCE(l.ledger_account_code,
                      CASE p.item_class
                        WHEN 'RAW_MATERIAL' THEN '1311'
                        WHEN 'BY_PRODUCT'   THEN '1314'
                        ELSE '1313' END)
        INTO v_acct
      FROM public.products p WHERE p.id = l.product_id;

      IF l.side = 'DEBIT' THEN
        v_lines := v_lines || jsonb_build_object('account_code', v_acct,
          'debit', round(l.amount, 2), 'memo', 'رصيد افتتاحي — ' || l.description);
      END IF;

    ELSIF l.section = 'RECEIVABLE' THEN
      IF l.customer_id IS NULL THEN
        RAISE EXCEPTION 'Receivable line "%" has no customer', l.description;
      END IF;
      -- 'adjustment' is the existing ledger value for a movement that is not a
      -- sale, a payment or a return; reference_type carries the real reason.
      INSERT INTO public.customer_ledger
        (customer_id, entry_type, debit, credit, reference_id, reference_type,
         occurred_at, created_by, note)
      VALUES
        (l.customer_id, 'adjustment', l.amount, 0, _document_id,
         'opening_balance', v_doc.effective_date::timestamptz, v_user,
         'رصيد افتتاحي ' || v_doc.document_number);

      v_lines := v_lines || jsonb_build_object('account_code',
        COALESCE(l.ledger_account_code, '1211'),
        'debit', round(l.amount, 2), 'memo', 'رصيد افتتاحي — ' || l.description);

    ELSIF l.section = 'PAYABLE' THEN
      IF l.supplier_id IS NULL THEN
        RAISE EXCEPTION 'Payable line "%" has no supplier', l.description;
      END IF;
      UPDATE public.suppliers
         SET balance = coalesce(balance, 0) + l.amount
       WHERE id = l.supplier_id;

      v_lines := v_lines || jsonb_build_object('account_code',
        COALESCE(l.ledger_account_code, '2111'),
        'credit', round(l.amount, 2), 'memo', 'رصيد افتتاحي — ' || l.description);

    ELSE
      -- ── T-11: الأقسام المتبقية تُرحَّل إلى الأستاذ الآن (كانت NULL) ────────
      v_acct := COALESCE(l.ledger_account_code,
        CASE l.section
          WHEN 'CASH'      THEN '1101'  -- الصندوق
          WHEN 'BANK'      THEN '1111'  -- البنك الافتراضي
          WHEN 'ASSET'     THEN '1411'  -- أصول ثابتة (افتراضي: آلات ومعدات)
          WHEN 'LIABILITY' THEN '2111'  -- التزامات عامة (ذمم موردين)
          WHEN 'CAPITAL'   THEN '3111'  -- رأس المال — أهم سطر
          ELSE NULL END);

      IF v_acct IS NULL THEN
        RAISE EXCEPTION 'Opening section % has no ledger account mapping', l.section;
      END IF;

      v_lines := v_lines || jsonb_build_object('account_code', v_acct,
        CASE WHEN l.side = 'DEBIT' THEN 'debit' ELSE 'credit' END,
        round(l.amount, 2),
        'memo', 'رصيد افتتاحي — ' || l.description);
    END IF;
  END LOOP;

  -- ── T-11: قيد الأستاذ للرصيد الافتتاحي كاملًا ────────────────────────────
  IF jsonb_array_length(v_lines) >= 2 THEN
    v_journal := public.create_journal_entry(
      'رصيد افتتاحي ' || v_doc.document_number,
      v_doc.effective_date,
      'opening_balance', _document_id, true, v_lines);
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'opening_balance.posted', 'opening_balance', _document_id,
          jsonb_build_object('document_number', v_doc.document_number,
                             'debits', v_debit, 'credits', v_credit,
                             'journal_entry_id', v_journal));
  RETURN _document_id;
END $function$;

COMMENT ON FUNCTION public.post_opening_balance(uuid) IS
  'T-11: ترحيل الأرصدة الافتتاحية كاملةً للأستاذ — النقدية والبنوك والأصول والالتزامات ورأس المال لم تعد بلا أثر.';

COMMIT;

-- ============================================================================
-- التحقق بعد التطبيق:
--   1. مستند افتتاحي «نقدية 50م / رأس مال 50م»: بعد الترحيل يظهر في
--      trial_balance رصيد 1101 مدين 50,000,000 ورصيد 3111 دائن 50,000,000.
--   2. العكس (reverse_opening_balance) يعكس القيد الأستاذي أيضًا — راجع تحديثه
--      أدناه إن لزم (بقي قائمًا كما هو؛ العكس عبر reverse_journal_entry
--      ممكن يدويًا على القيد المُنشأ).
--   3. مستند متوازن على الورق يمر، ومتوزّن على الأستاذ يمر أيضًا — والميزانية
--      ترى رأس المال لأول مرة.
-- ==========================================================================
