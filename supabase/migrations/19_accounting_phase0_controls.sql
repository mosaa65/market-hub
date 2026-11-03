-- ============================================================================
-- 17_accounting_phase0_controls.sql — المرحلة 0 من خطة معالجة الفجوات المحاسبية
-- (التقرير: ACCOUNTING_GAPS_AUDIT_REPORT_UPDATED.md، المهام T-01..T-04)
--
-- ماذا يفعل هذا الملف؟
--   T-01: إصلاح مضاعفة الضريبة في قيد المبيعات — الإيراد يُقيَّد صافيًا
--         (total − tax للبند) لا شاملًا، فتُحمَّل الضريبة مرة واحدة على 2311.
--   T-02: فهرس فريد بنيوي على مصدر القيد — منع الترحيل المزدوج في القاعدة
--         لا في الكود فقط.
--   T-03: رقابة الدفتر: فحص الدور داخل create_journal_entry، منع الترحيل
--         اليدوي على حسابات النظام، سجل تدقيق للإنشاء والعكس، وtrigger
--         يمنع حذف القيود.
--   T-04: توحيد ترقيم القيود على التسلسل journal_entry_seq بدل count(*) —
--         إزالة مخاطرة اصطدام أرقام تحت التزامن.
--
-- قواعد التطبيق:
--   • إضافي بالكامل: لا يحذف ولا يعدّل أي بيانات ولا أي جدول.
--   • يعيد تعريف الدوال الأربع فقط (CREATE OR REPLACE) بلا تغيير التوقيعات،
--     فلا ينكسر أي مستدعٍ قائم.
--   • يعمل بعد 16_payment_methods.sql — تعريفه النهائي هو المُطبَّق.
--   • آمن للتطبيق المتكرر (idempotent).
-- ============================================================================

BEGIN;

-- ════════════════════
-- T-02 — فهرس فريد على (source_type, source_id) في journal_entries
--
-- حماية «مرة واحدة فقط» كانت داخل دوال الترحيل (فحص SELECT قبل الإدراج).
-- أي مسار جديد أو نداء يدوي كان يستطيع إنشاء قيدين لنفس المستند. الفهرس
-- الجزئي يجعل الفشل قاعدةً لا كودًا: القيود المعكوسة (REVERSED) تُستثنى،
-- والمصادر اليدوية بلا source_id تُستثنى أيضًا (NULL لا يُفهرس).
-- ════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_source_active
  ON public.journal_entries (source_type, source_id)
  WHERE source_id IS NOT NULL AND status <> 'REVERSED';

COMMENT ON INDEX public.uq_journal_source_active IS
  'T-02: قيد واحد نشط لكل مستند مصدر — منع الترحيل المزدوج بنيويًا.';

-- ════════════════════
-- T-03 (1/3) — trigger يمنع حذف القيود
--
-- journal_lines لها ON DELETE CASCADE من journal_entries؛ أي حذف مباشر
-- (حتى عبر service_role) يحذف سطور القيد صامتًا بلا أثر. التصحيح الشرعي
-- للمسار هو العكس عبر reverse_journal_entry — والحذف يُمنع دائمًا.
-- ════════════════════

CREATE OR REPLACE FUNCTION public.tg_journal_entries_no_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Deleting a journal entry is forbidden. Reverse it via reverse_journal_entry instead (entry %).',
    OLD.entry_number
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS journal_entries_no_delete ON public.journal_entries;
CREATE TRIGGER journal_entries_no_delete
  BEFORE DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_journal_entries_no_delete();

COMMENT ON FUNCTION public.tg_journal_entries_no_delete() IS
  'T-03: يمنع حذف أي قيد — التصحيح يكون بالعكس فقط.';

-- ════════════════════
-- T-04 — ترقيم القيود من التسلسل لا من count(*)
--
-- النسخة السابقة تحسب count(*)+1 ليوم القيد؛ تزامنان قد ينتجان الرقم نفسه
-- (فشل عملية بفشل القيد الفريد). محرك الترقيم 14 عرّف journal_entry_seq
-- خصيصًا لهذا — والآن يُستخدم فعلًا. الشكل ظاهريًا كما هو.
-- ════════════

CREATE OR REPLACE FUNCTION public.next_journal_number(p_date date)
RETURNS text
LANGUAGE sql
SET search_path TO 'public'
AS $function$
  SELECT 'JE-' || to_char(p_date, 'YYYYMMDD') || '-' ||
         lpad(nextval('public.journal_entry_seq')::text, 4, '0')
$function$;

COMMENT ON FUNCTION public.next_journal_number(date) IS
  'T-04: رقم القيد من تسلسل ذري journal_entry_seq — بلا اصطدام تحت التزامن.';

-- ════════════════════
-- T-03 (2/3) — create_journal_entry بفحص دور ورقابة حسابات النظام وسجل تدقيق
--
-- الجسم السابق كان يفحص المصادقة والتوازن فقط:
--   • أي مستخدم مصادَق (authenticated) يستطيع إنشاء قيد يدوي.
--   • يمكن الترحيل اليدوي على حسابات النظام (is_system).
--   • لا أثر في audit_logs.
-- الآن: owner/manager/accountant فقط، ويُمنع اليدوي على حسابات is_system
-- إلا إذا كان القيد نفسه system (كما تُنشئه دوال الترحيل SECURITY DEFINER)،
-- ويُسجَّل كل قيد في سجل التدقيق. باقي المنطق (توازن، سطر واحد فقط لكل
-- جهة، وجود الحساب وقابلية الترحيل) بلا مساس.
-- ════════════════════

CREATE OR REPLACE FUNCTION public.create_journal_entry(p_memo text, p_entry_date date DEFAULT CURRENT_DATE, p_source_type text DEFAULT NULL::text, p_source_id uuid DEFAULT NULL::uuid, p_is_system boolean DEFAULT false, p_lines jsonb DEFAULT '[]'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_id   uuid;
  v_num  text;
  v_d    numeric := 0;
  v_c    numeric := 0;
  src    jsonb;
  v_missing integer;
  v_blocked integer;
  v_sideless text;
  v_system_accounts integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- T-03: فحص الدور — القيد اليدوي (p_is_system=false) للمحاسبة فقط.
  -- القيد النظامي (من دوال الترحيل SECURITY DEFINER) مسموح لأي موظف مصادق:
  -- فالكاشير يبيع عبر create_sale، وترحيل فاتورته جزء من نفس العملية
  -- (قرار T-06-b المعتمد: مسار POS يستمر مع الترحيل التلقائي).
  IF NOT coalesce(p_is_system, false) THEN
    IF NOT (public.has_role(v_user, 'owner')
            OR public.has_role(v_user, 'manager')
            OR public.has_role(v_user, 'accountant')) THEN
      RAISE EXCEPTION 'Only an owner, manager or accountant may create manual journal entries';
    END IF;
  END IF;

  IF p_memo IS NULL OR btrim(p_memo) = '' THEN
    RAISE EXCEPTION 'A journal entry needs a description';
  END IF;
  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'A journal entry needs at least two lines - one to debit and one to credit';
  END IF;

  -- A line must carry exactly one side. Checked up front, before the entry
  -- header is written, so a rejected line never leaves a DRAFT entry behind
  -- in the table for someone to find later and wonder about.
  SELECT string_agg(coalesce(ln->>'account_code', '?'), '، ') INTO v_sideless
    FROM jsonb_array_elements(p_lines) AS ln
   WHERE coalesce((ln->>'debit')::numeric, 0) = 0
     AND coalesce((ln->>'credit')::numeric, 0) = 0;
  IF v_sideless IS NOT NULL THEN
    RAISE EXCEPTION
      'Line(s) % carry neither a debit nor a credit. Every line must have exactly one side.',
      v_sideless;
  END IF;

  -- T-03: اليدوي لا يلمس حسابات النظام. دوال الترحيل تمرر p_is_system = true
  -- فتعمل كما كانت؛ النداء اليدوي (false) يُرفض إن كان أي حساب هدفه نظاميًا.
  IF NOT coalesce(p_is_system, false) THEN
    SELECT count(*) INTO v_system_accounts
      FROM jsonb_array_elements(p_lines) AS ln
      JOIN public.accounts a ON a.code = ln->>'account_code'
     WHERE a.is_system;
    IF v_system_accounts > 0 THEN
      RAISE EXCEPTION
        '% line(s) target a system account. Manual entries cannot post to system accounts.',
        v_system_accounts;
    END IF;
  END IF;

  -- مستند واحد = قيد واحد نشط. غير الرقمي يُطبَّع إلى NULL فيُستثنى من
  -- uq_journal_source_active (لأن NULL لا يُفهرَس): مصدر نصي بلا معناه الرقمي
  -- كان يمنع القيد الثاني لأي مستند آخر يحمل نفس النص.
  p_source_id := CASE WHEN p_source_id::text ~ '^[0-9a-fA-F-]{36}$' THEN p_source_id END;

  v_num := public.next_journal_number(coalesce(p_entry_date, CURRENT_DATE));

  INSERT INTO public.journal_entries
    (entry_number, entry_date, memo, source_type, source_id, is_system, created_by)
  VALUES (v_num, coalesce(p_entry_date, CURRENT_DATE), btrim(p_memo),
          p_source_type, p_source_id, p_is_system, v_user)
  RETURNING id INTO v_id;

  FOR src IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_d := v_d + coalesce((src->>'debit')::numeric, 0);
    v_c := v_c + coalesce((src->>'credit')::numeric, 0);
  END LOOP;

  IF v_d <> v_c THEN
    RAISE EXCEPTION
      'Entry does not balance: debits % vs credits % (difference %). An entry that cannot balance is not an entry.',
      round(v_d, 2)::text, round(v_c, 2)::text, round(v_d - v_c, 2)::text;
  END IF;
  IF v_d <= 0 THEN
    RAISE EXCEPTION 'Entry total must be greater than zero';
  END IF;

  -- The two failure modes are reported separately: "code does not exist" sends
  -- the operator hunting for a typo when the code was real and simply not
  -- postable, and that misdirection costs more than the extra check.
  SELECT count(*) FILTER (WHERE a.id IS NULL),
         count(*) FILTER (WHERE a.id IS NOT NULL AND NOT a.is_postable)
    INTO v_missing, v_blocked
    FROM jsonb_array_elements(p_lines) AS ln
    LEFT JOIN public.accounts a ON a.code = ln->>'account_code';

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'One or more account codes do not exist. Check the code before posting.';
  END IF;
  IF v_blocked > 0 THEN
    RAISE EXCEPTION
      'One or more accounts is not postable directly (a contra or clearing account). Post through the account that moves it.';
  END IF;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, memo, partner_type, partner_id)
  SELECT v_id, a.id,
         coalesce((ln->>'debit')::numeric, 0),
         coalesce((ln->>'credit')::numeric, 0),
         nullif(btrim(coalesce(ln->>'memo','')), ''),
         nullif(btrim(coalesce(ln->>'partner_type','')), ''),
         (ln->>'partner_id')::uuid
    FROM jsonb_array_elements(p_lines) AS ln
    JOIN public.accounts a ON a.code = ln->>'account_code'
   WHERE (ln->>'debit')::numeric IS DISTINCT FROM 0
      OR (ln->>'credit')::numeric IS DISTINCT FROM 0;

  IF (SELECT count(*) FROM public.journal_lines WHERE entry_id = v_id)
     <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'One or more lines could not be written';
  END IF;

  UPDATE public.journal_entries
     SET total_debit = v_d, total_credit = v_c, status = 'POSTED',
         posted_by = v_user, posted_at = now()
   WHERE id = v_id;

  -- T-03: كل قيد له أثر في سجل التدقيق.
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'journal_entry.posted', 'journal_entry', v_id,
          jsonb_build_object('entry_number', v_num,
                             'entry_date', coalesce(p_entry_date, CURRENT_DATE),
                             'source_type', p_source_type,
                             'source_id', p_source_id,
                             'total', v_d));

  RETURN v_id;
END $function$;

COMMENT ON FUNCTION public.create_journal_entry(text, date, text, uuid, boolean, jsonb) IS
  'T-03: إنشاء قيد مزدوج مع فحص الدور، ومنع اليدوي على حسابات النظام، وسجل تدقيق.';

-- ════════════
-- T-03 (3/3) — reverse_journal_entry بسجل تدقيق
-- الجسم بلا تغيير جوهري؛ الإضافة الوحيدة سجل التدقيق عند العكس.
-- ════════════════════

CREATE OR REPLACE FUNCTION public.reverse_journal_entry(p_entry_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_old  record;
  v_id   uuid;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Reversing an entry requires a reason';
  END IF;

  SELECT * INTO v_old FROM public.journal_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND OR v_old.status <> 'POSTED' THEN
    RAISE EXCEPTION 'Only a posted entry can be reversed';
  END IF;

  SELECT public.create_journal_entry(
    'عكس القيد ' || v_old.entry_number || ': ' || btrim(p_reason),
    CURRENT_DATE, 'journal_reversal', p_entry_id, v_old.is_system,
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'account_code', a.code,
        -- A reversal swaps the sides rather than negating: the credit of the
        -- original becomes the debit of the reversal.
        'debit',  CASE WHEN jl.debit  > 0 THEN 0 ELSE jl.credit END,
        'credit', CASE WHEN jl.debit  > 0 THEN jl.debit  ELSE 0 END,
        'memo',   coalesce(jl.memo, a.name_ar)
      ) ORDER BY jl.id), '[]'::jsonb)
       FROM public.journal_lines jl JOIN public.accounts a ON a.id = jl.account_id
      WHERE jl.entry_id = p_entry_id)
  ) INTO v_id;

  UPDATE public.journal_entries SET status = 'REVERSED' WHERE id = p_entry_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'journal_entry.reversed', 'journal_entry', p_entry_id,
          jsonb_build_object('reversal_entry_id', v_id, 'reason', btrim(p_reason)));

  RETURN v_id;
END $function$;

COMMENT ON FUNCTION public.reverse_journal_entry(uuid, text) IS
  'T-03: عكس قيد مرحَّل ببدل الطرفين، مع سجل تدقيق للعكس.';

-- ════════════════════
-- T-01 — post_sales_invoice: الإيراد صافي الضريبة
--
-- sales_invoice_items.total مخزَّن شاملًا للضريبة (create_sale يخزّن
-- total = line_total + line_tax). النسخة السابقة تقيّد الإيراد من it.total
-- ثم تضيف الضريبة دائنة إضافية على 2311 — فتظهر الضريبة مرتين (داخل الإيراد
-- وكالتزام). الإصلاح: الإيراد يُقيَّد من (it.total − it.tax)، فتصبح:
--   Dr نقد/بنك (paid) + Dr ذمم (total − paid)  =  total
--   Cr إيراد (net) + Cr ضريبة (tax)            =  total
-- كل ما عدا ذلك (حارس المرة الواحدة، فحص الدور، حساب التحصيل من الكتالوج،
-- تصنيف الإيراد حسب item_class، سطور COGS، الضريبة على 2311) بلا مساس.
-- ════════════════════

CREATE OR REPLACE FUNCTION public.post_sales_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_inv     record;
  v_existing uuid;
  v_entry   uuid;
  v_lines   jsonb := '[]'::jsonb;
  v_cash_acct text;
  v_collectable numeric := 0;
  r         record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
          OR public.has_role(v_user,'accountant')
          -- T-06-b (المعتمد): الكاشير يبيع عبر create_sale التي تستدعي هذه
          -- الدالة في نفس المعاملة؛ الترحيل جزء من البيع لا عملية منفصلة.
          OR public.has_role(v_user,'cashier')) THEN
    RAISE EXCEPTION 'Only an owner, manager, accountant or the cashier''s own sale may post a sales invoice';
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

  -- الحساب من الكتالوج (16_payment_methods.sql) — بلا تغيير.
  -- 'credit'          -> NULL      (لم يُحصَّل شيء)
  -- BANK/WALLET/CARD  -> '1111'    (يخرج عبر البنك)
  -- CASH / OTHER      -> '1101'    (الصندوق؛ وsplit تُسوّى نقداً)
  v_cash_acct := public.ledger_account_code_for_payment_method(v_inv.payment_method);

  v_collectable := greatest(v_inv.total - v_inv.paid, 0);

  -- ── revenue, credited NET of line tax ────────────────────────────────────
  -- T-01: it.total شامل الضريبة على مستوى البند، والإيراد يُقيَّد صافيًا
  -- فلا تتكرر الضريبة (مرة داخل الإيراد ومرة على 2311).
  FOR r IN
    SELECT p.item_class,
           sum(it.total - coalesce(it.tax, 0)) AS net_amount
      FROM public.sales_invoice_items it
      JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
     GROUP BY p.item_class
    HAVING sum(it.total - coalesce(it.tax, 0)) <> 0
  LOOP
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.item_class
                        WHEN 'BY_PRODUCT' THEN '4211'
                        WHEN 'SERVICE'    THEN '4311'
                        ELSE '4111' END,
      'credit', round(r.net_amount, 2),
      'memo', 'إيراد ' || r.item_class);
  END LOOP;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Invoice % has no revenue lines', v_inv.invoice_number;
  END IF;

  -- ── ما استلمته المنشأة: النقد والذمة كلاهما مدين ──
  -- هما بديلان لنفس الزيادة، فبيعة مسدّدة بالكامل لها مدين نقدي بلا ذمة، وبيعة
  -- آجلة العكس. الذمة شاملة الضريبة (المستحق على العميل إجمالي الفاتورة).
  IF v_inv.paid > 0 AND v_cash_acct IS NOT NULL THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_cash_acct, 'debit', round(v_inv.paid, 2),
      'memo', 'تحصيل نقدي/بنكي');
  END IF;
  IF v_collectable > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1211', 'debit', round(v_collectable, 2),
      'memo', 'ذمم العميل ' || coalesce(v_inv.invoice_number, ''));
  END IF;

  IF v_inv.tax > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2311', 'credit', round(v_inv.tax, 2),
      'memo', 'ضريبة القيمة المضافة المستحقة');
  END IF;

  -- ── the cost of the goods that left ──
  FOR r IN
    SELECT p.item_class,
           sum(it.quantity * public.resolve_unit_cost(p.id, v_inv.warehouse_id)) AS cost
      FROM public.sales_invoice_items it
      JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
       AND it.stock_effect = 'STOCK_ISSUE'
     GROUP BY p.item_class
  LOOP
    IF r.cost IS NULL OR r.cost = 0 THEN
      CONTINUE;   -- no cost known; a zero COGS line would overstate profit
    END IF;
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.item_class
                        WHEN 'RAW_MATERIAL' THEN '1311'
                        WHEN 'BY_PRODUCT'   THEN '1314'
                        ELSE '1313' END,
      'credit', round(r.cost, 2),
      'memo', 'تكلفة ' || r.item_class);
    v_lines := v_lines || jsonb_build_object(
      'account_code', '5111', 'debit', round(r.cost, 2),
      'memo', 'تكلفة البضاعة المباعة');
  END LOOP;

  v_entry := public.create_journal_entry(
    'فاتورة مبيعات ' || v_inv.invoice_number,
    v_inv.created_at::date,
    'sales_invoice', p_invoice_id, true, v_lines);

  RETURN v_entry;
END $$;

REVOKE ALL ON FUNCTION public.post_sales_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_sales_invoice(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.post_sales_invoice(uuid) IS
  'T-01: يرحّل فاتورة المبيعات بإيراد صافٍ من ضريبة البند — الضريبة تُحمَّل مرة واحدة على 2311.';

COMMIT;

-- ============================================================================
-- التحقق بعد التطبيق:
--   1. فاتورة 1,000 صافي + 50 ضريبة، آجلة بالكامل:
--      Dr 1211 بـ 1,050 / Cr 4111 بـ 1,000 / Cr 2311 بـ 50 — والميزان متوازن.
--   2. ترحيل الفاتورة نفسها مرة ثانية يفشل في القاعدة (uq_journal_source_active)
--      حتى قبل فحص الدالة.
--   3. أي DELETE على journal_entries يفشل دائمًا.
--   4. مستخدم بلا دور (cashier/warehouse) يستدعي create_journal_entry يُرفض.
--   5. نداء يدوي على حساب is_system (مثل 1491) يُرفض.
--   6. كل قيد جديد له صف في audit_logs بـ action = 'journal_entry.posted'.
-- ============================================================================
