-- ============================================================================
-- 9916_phase1_expense_control_ledger_and_production_tax.sql
--
-- المرحلة الأولى من خطة تطوير الوحدة المالية (تقرير التدقيق المحاسبي النهائي):
--
--   1) إغلاق تجاوز الاعتماد: لا يُرحَّل مصروف DRAFT إلا عبر اعتماد مسجّل
--      (decide_expense) من شخص آخر غير المنشئ، وبتوقيع أمر صريح عندها فقط.
--   2) تكامل مصروف المورد مع دفتر المورد الفرعي وكشف الحساب، بمرجع مصدر
--      فريد (source_key) يجعل الترحيل والعكس والسداد idempotent.
--   3) احتساب الجزء المؤهل من الضريبة غير القابلة للاسترداد في تكلفة الإنتاج.
--   4) idempotency على مستوى مستند الترحيل نفسه (source_id في journal_entries).
--
-- القيود المتّبعة:
--   • لا تحديث لأي بيانات تاريخية. لا backfill. لا حذف.
--   • كل عمود جديد NOT NULL DEFAULT ⟹ آمن على الجداول القائمة.
--   • الدوال تُعاد تعريفها بنفس التوقيع والإذن السابقين (9913).
--   • لا تعديل على مخطط الإنتاج (9906) هنا؛ منطق الضريبة في دالته معدَّل
--     مباشرة لأن تعديل جسم الدالة لا يمكن أن يحدث خارج تعريفها.
-- ============================================================================
BEGIN;

-- ── 1. مصدر اعتماد صريح للترحيل (لا يُستنتج من رتبة الدور) ──────────────────
ALTER TABLE public.expense_entries
  ADD COLUMN IF NOT EXISTS allow_draft_post boolean NOT NULL DEFAULT false;
ALTER TABLE public.expense_entries
  ADD COLUMN IF NOT EXISTS draft_post_reason text;
-- سبب التجاوز غير قابل للعكس: يمكن تعبئته فقط، ولا يُمسح بعد الاعتماد.
CREATE OR REPLACE FUNCTION public.guard_expense_draft_post_reason()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF OLD.draft_post_reason IS NOT NULL
     AND NEW.draft_post_reason IS DISTINCT FROM OLD.draft_post_reason THEN
    RAISE EXCEPTION 'A recorded draft-posting override reason cannot be altered'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS expense_entries_guard_draft_post_reason ON public.expense_entries;
CREATE TRIGGER expense_entries_guard_draft_post_reason
  BEFORE UPDATE OF draft_post_reason ON public.expense_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_expense_draft_post_reason();

COMMENT ON COLUMN public.expense_entries.allow_draft_post IS
  'يُفعَّل حصراً داخل decide_expense عند اعتماد مسودة مباشرة؛ post_expense يرفض DRAFT إن لم يكن مفعّلاً.';
COMMENT ON COLUMN public.expense_entries.draft_post_reason IS
  'سبب تجاوز maker-checker المسجّل لحظة الاعتماد المباشر للمسودة، للتدقيق.';

-- ── 2. مرجع مصدر فريد لحركات مصروف المورد في دفتر الموردين ─────────────────
--    source_key في supplier_ledger فريد أصلاً؛ الضمان النهائي تكرارٌ في المصدر.
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_ledger_expense_source
  ON public.supplier_ledger (reference_type, reference_id, source_key)
  WHERE reference_type IN ('expense', 'expense_payment');

-- ── 3. المساعدات الداخلية ──────────────────────────────────────────────────

-- سبب إلزامي للتجاوز: لا "تمرير" صامت.
CREATE OR REPLACE FUNCTION public.expense_require_override_reason(p_reason text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $function$
DECLARE
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A written reason is required to post a draft expense without prior approval'
      USING ERRCODE = '22023';
  END IF;
  IF length(v_reason) < 10 THEN
    RAISE EXCEPTION 'The override reason is too short to be auditable (minimum 10 characters)'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_reason;
END
$function$;

-- الجزء المؤهل من ضريبة السطر: صافي مع إعادة التصنيف أو إجمالي مع الاسترداد.
-- ترحيل المصروف يحمّل الضريبة غير المستردة على حساب المصروف (9913:788)،
-- لذلك يجب أن ينتقل هذا الجزء إلى WIP عند رسملة البند على الإنتاج.
CREATE OR REPLACE FUNCTION public.expense_line_production_base_amount(
  p_net_amount numeric,
  p_tax_amount numeric,
  p_tax_recoverable boolean
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT public.expense_round(
    coalesce(p_net_amount, 0)
    + CASE WHEN coalesce(p_tax_recoverable, false) THEN 0 ELSE coalesce(p_tax_amount, 0) END
  )
$function$;

-- حركة دفتر المورد لمصروف: credit للاستحقاق، debit للسداد. idempotent عبر source_key.
CREATE OR REPLACE FUNCTION public.expense_write_supplier_ledger(
  p_supplier_id uuid,
  p_entry_type text,
  p_side text,              -- 'CREDIT' (استحقاق) أو 'DEBIT' (سداد/عكس)
  p_amount numeric,
  p_reference_type text,
  p_reference_id uuid,
  p_source_key text,
  p_due_date date DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_actor uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_amount numeric(18,2) := public.expense_round(p_amount);
  v_balance numeric;
BEGIN
  IF p_supplier_id IS NULL OR p_source_key IS NULL THEN
    RETURN;
  END IF;
  IF v_amount <= 0 THEN
    RETURN;
  END IF;
  IF p_side NOT IN ('CREDIT', 'DEBIT') THEN
    RAISE EXCEPTION 'Supplier ledger side must be CREDIT or DEBIT' USING ERRCODE = '22023';
  END IF;

  -- الحجز على ترتيب الرصيد التراكمي: دفتر المورد يُقرأ تسلسلياً في الكشف.
  PERFORM pg_advisory_xact_lock(hashtextextended('supplier_ledger:' || p_supplier_id::text, 0));

  IF p_side = 'CREDIT' THEN
    UPDATE public.suppliers
       SET balance = public.expense_round(coalesce(balance, 0) + v_amount),
           updated_at = now()
     WHERE id = p_supplier_id
    RETURNING balance INTO v_balance;
    IF v_balance IS NULL THEN
      RAISE EXCEPTION 'Supplier % not found', p_supplier_id USING ERRCODE = 'P0002';
    END IF;
  ELSE
    UPDATE public.suppliers
       SET balance = public.expense_round(coalesce(balance, 0) - v_amount),
           updated_at = now()
     WHERE id = p_supplier_id
    RETURNING balance INTO v_balance;
    IF v_balance IS NULL THEN
      RAISE EXCEPTION 'Supplier % not found', p_supplier_id USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO public.supplier_ledger (
    supplier_id, entry_type, debit, credit, balance_after,
    reference_type, reference_id, due_date, occurred_at, created_by, source_key, note
  ) VALUES (
    p_supplier_id, p_entry_type,
    CASE WHEN p_side = 'DEBIT' THEN v_amount ELSE 0 END,
    CASE WHEN p_side = 'CREDIT' THEN v_amount ELSE 0 END,
    v_balance, p_reference_type, p_reference_id, p_due_date,
    coalesce(p_occurred_at, now()), p_actor, p_source_key, p_note
  )
  ON CONFLICT (source_key) DO NOTHING;
END
$function$;

-- عكس حركة مصروف سبق أن كتبتها هذه الدالة: يعيد الرصيد ويقيد حركة عكسية
-- بنفس المرجع الأصلي حتى يظهر العكس بجانب الأصل في كشف المورد.
CREATE OR REPLACE FUNCTION public.expense_reverse_supplier_ledger(
  p_supplier_id uuid,
  p_source_key text,
  p_reference_type text,
  p_reference_id uuid,
  p_reversal_key text,
  p_note text DEFAULT NULL,
  p_actor uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_original public.supplier_ledger;
BEGIN
  IF p_supplier_id IS NULL OR p_source_key IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO v_original
    FROM public.supplier_ledger
   WHERE source_key = p_source_key;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_original.credit > 0 THEN
    PERFORM public.expense_write_supplier_ledger(
      p_supplier_id, 'ADJUSTMENT', 'DEBIT', v_original.credit,
      p_reference_type, p_reference_id, p_reversal_key, NULL, now(),
      coalesce(p_note, 'عكس استحقاق مصروف'), p_actor);
  ELSIF v_original.debit > 0 THEN
    PERFORM public.expense_write_supplier_ledger(
      p_supplier_id, 'ADJUSTMENT', 'CREDIT', v_original.debit,
      p_reference_type, p_reference_id, p_reversal_key, NULL, now(),
      coalesce(p_note, 'عكس سداد مصروف'), p_actor);
  END IF;
END
$function$;

-- ── 4. الاعتماد: يفتح استثناء DRAFT صراحةً بسببٍ مكتوب ─────────────────────
CREATE OR REPLACE FUNCTION public.decide_expense(
  p_entry_id uuid,
  p_approve boolean,
  p_reason text DEFAULT NULL,
  p_expected_version integer DEFAULT NULL
)
RETURNS public.expense_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := public.expense_actor();
  v_entry public.expense_entries;
  v_action text := CASE WHEN p_approve THEN 'approve' ELSE 'reject' END;
  v_target public.expense_status;
  v_from public.expense_status;
  v_user_rank integer;
  v_reason text;
BEGIN
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'Choose whether to approve or reject this expense' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002'; END IF;
  IF v_entry.status NOT IN ('SUBMITTED', 'DRAFT') THEN
    RAISE EXCEPTION 'This expense is not awaiting approval (current: %)', v_entry.status
      USING ERRCODE = '55000';
  END IF;
  PERFORM public.expense_assert_capability(v_user, 'expense.' || v_action);
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_entry.version THEN
    RAISE EXCEPTION 'This expense was changed by someone else. Reload it and try again.'
      USING ERRCODE = '40001';
  END IF;
  v_user_rank := public.expense_role_rank(v_user);
  IF v_user_rank < v_entry.approval_required_rank THEN
    RAISE EXCEPTION 'This expense requires approval from a higher role based on its amount'
      USING ERRCODE = '42501';
  END IF;
  -- المسار المباشر (DRAFT): لا يعتمد المنشئ مصروفه بنفسه إلا إذا كان مالكاً
  -- ويكتب سبباً موثقاً؛ المحاسب/المدير لا يمرران maker-checker على مستنديهما.
  IF v_entry.created_by = v_user
     AND NOT (public.has_role(v_user, 'owner') AND v_entry.status = 'DRAFT') THEN
    RAISE EXCEPTION 'You cannot approve an expense you created yourself' USING ERRCODE = '42501';
  END IF;

  IF p_approve THEN
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    IF v_reason IS NULL AND v_entry.status = 'DRAFT' THEN
      RAISE EXCEPTION 'A written reason is required to approve a draft expense directly'
        USING ERRCODE = '22023';
    END IF;
    IF v_entry.created_by = v_user AND public.has_role(v_user, 'owner') THEN
      v_reason := coalesce(v_reason, 'Self-approved by owner (no other approver available)');
    END IF;
  ELSE
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'A reason is required when rejecting an expense' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_target := CASE WHEN p_approve THEN 'APPROVED'::public.expense_status
                   ELSE 'REJECTED'::public.expense_status END;
  v_from := v_entry.status;
  UPDATE public.expense_entries
     SET status = v_target,
         version = version + 1,
         allow_draft_post = CASE WHEN p_approve AND v_entry.status = 'DRAFT' THEN true ELSE allow_draft_post END,
         draft_post_reason = CASE WHEN p_approve AND v_entry.status = 'DRAFT' THEN v_reason ELSE draft_post_reason END,
         approved_by = CASE WHEN p_approve THEN v_user END,
         approved_at = CASE WHEN p_approve THEN now() END,
         submitted_by = CASE WHEN p_approve AND v_entry.status = 'DRAFT' THEN v_user ELSE submitted_by END,
         submitted_at = CASE WHEN p_approve AND v_entry.status = 'DRAFT' THEN now() ELSE submitted_at END,
         rejected_by = CASE WHEN NOT p_approve THEN v_user END,
         rejected_at = CASE WHEN NOT p_approve THEN now() END,
         rejection_reason = CASE WHEN NOT p_approve THEN v_reason END,
         cancelled_by = NULL,
         cancelled_at = NULL,
         cancel_reason = NULL
   WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  PERFORM public.expense_log_action(p_entry_id, v_action, v_from, v_target, v_reason, v_user);
  RETURN v_entry;
END;
$function$;

-- ── 5. الترحيل: لا DRAFT بلا توقيع، ولا قيد مكرر، والمورد في دفتره ─────────
CREATE OR REPLACE FUNCTION public.post_expense(
  p_entry_id uuid,
  p_expected_version integer DEFAULT NULL,
  p_pay_now boolean DEFAULT false,
  p_payment_method public.payment_method DEFAULT 'cash',
  p_account_label text DEFAULT NULL,
  p_payment_date date DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_account_id uuid DEFAULT NULL,
  p_cashbox_id uuid DEFAULT NULL,
  p_bank_account_id uuid DEFAULT NULL,
  p_payment_method_id text DEFAULT NULL
)
RETURNS public.expense_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := public.expense_actor();
  v_entry public.expense_entries;
  v_from public.expense_status;
  v_lines jsonb := '[]'::jsonb;
  v_tax numeric(18,2) := 0;
  v_tax_account text;
  v_payable_role text;
  v_journal uuid;
  v_override_reason text;
  r record;
BEGIN
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002'; END IF;
  v_from := v_entry.status;
  IF v_from IN ('POSTED', 'PARTIALLY_PAID', 'PAID', 'CLOSED') THEN RETURN v_entry; END IF;
  IF v_from NOT IN ('APPROVED', 'DRAFT') THEN
    RAISE EXCEPTION 'This expense cannot be posted from status %', v_from USING ERRCODE = '55000';
  END IF;
  PERFORM public.expense_assert_capability(v_user, 'expense.post');
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_entry.version THEN
    RAISE EXCEPTION 'This expense was changed by someone else. Reload it and try again.'
      USING ERRCODE = '40001';
  END IF;
  IF v_entry.entry_type = 'ADVANCE' THEN
    RAISE EXCEPTION 'Employee advances need a separate issue and settlement document; this expense entry cannot post them'
      USING ERRCODE = '55000';
  END IF;
  IF v_entry.total_amount <= 0 OR v_entry.line_count = 0 THEN
    RAISE EXCEPTION 'Cannot post an expense with no lines' USING ERRCODE = '22023';
  END IF;

  -- ⛔ قاعدة المرحلة 1: لا يُرحَّم مسودة بالصلاحية وحدها. يلزم اعتماد مسجل
  --    عبر decide_expense مسبقاً (يكتب allow_draft_post وسبباً موثقاً)، ويلزم
  --    أيضاً أن يكون المرحّل مالكاً. والترحيل نفسه لا يمرر Maker-checker من
  --    داخل الواجهة، حتى لو كان الفاعل مالكاً.
  IF v_from = 'DRAFT' THEN
    IF NOT (public.has_role(v_user, 'owner') AND coalesce(v_entry.allow_draft_post, false)) THEN
      RAISE EXCEPTION 'Submit this expense for approval before posting it' USING ERRCODE = '55000';
    END IF;
    v_override_reason := public.expense_require_override_reason(v_entry.draft_post_reason);
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.expense_lines l
      LEFT JOIN public.expense_categories c ON c.id = l.category_id
      LEFT JOIN public.accounts a ON a.id = c.account_id
     WHERE l.entry_id = p_entry_id
       AND (c.id IS NULL OR c.account_id IS NULL OR a.id IS NULL
            OR a.account_type::text <> 'EXPENSE' OR NOT a.is_active OR NOT a.is_postable)
  ) THEN
    RAISE EXCEPTION 'Every expense line needs an active, postable expense account mapping' USING ERRCODE = '55000';
  END IF;

  v_payable_role := CASE
    WHEN v_entry.payee_type = 'SUPPLIER' AND v_entry.supplier_id IS NOT NULL THEN 'SUPPLIER_PAYABLE'
    WHEN v_entry.payee_type = 'EMPLOYEE' AND v_entry.employee_id IS NOT NULL THEN 'EMPLOYEE_PAYABLE'
    ELSE 'OTHER_PAYABLE'
  END;
  -- Resolve before changing status so a missing role never leaves a document
  -- apparently posted without its journal.
  PERFORM public.expense_posting_account_code(v_payable_role);
  IF v_entry.tax_recoverable AND EXISTS (
    SELECT 1 FROM public.expense_lines WHERE entry_id = p_entry_id AND tax_amount > 0
  ) THEN
    v_tax_account := public.expense_posting_account_code('INPUT_TAX');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries je
     WHERE je.source_type = 'expense' AND je.source_id = p_entry_id
  ) THEN
    RAISE EXCEPTION 'This expense already has a journal entry; reload it instead of posting again'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.expense_entries
     SET status = 'POSTED', posting_date = coalesce(posting_date, CURRENT_DATE),
         posted_by = v_user, posted_at = now(), version = version + 1
   WHERE id = p_entry_id
  RETURNING * INTO v_entry;
  PERFORM public.expense_log_action(
    p_entry_id, 'posted', v_from, 'POSTED',
    CASE WHEN v_override_reason IS NOT NULL
         THEN 'Posted from draft by owner override: ' || v_override_reason END,
    v_user);

  FOR r IN (
    SELECT a.code::text AS account_code,
           coalesce(c.name_ar, c.name, 'مصروف') AS label,
           round(sum(l.net_amount + CASE WHEN v_entry.tax_recoverable THEN 0 ELSE l.tax_amount END), 2) AS debit_amount,
           round(sum(l.tax_amount), 2) AS tax_amount
      FROM public.expense_lines l
      JOIN public.expense_categories c ON c.id = l.category_id
      JOIN public.accounts a ON a.id = c.account_id
     WHERE l.entry_id = p_entry_id
     GROUP BY a.code, coalesce(c.name_ar, c.name, 'مصروف')
  ) LOOP
    IF r.debit_amount > 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', r.account_code, 'debit', r.debit_amount,
        'memo', 'مصروف ' || v_entry.reference || ' — ' || r.label
      );
    END IF;
    v_tax := v_tax + r.tax_amount;
  END LOOP;
  IF v_tax > 0 AND v_entry.tax_recoverable THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_tax_account, 'debit', round(v_tax, 2),
      'memo', 'ضريبة قابلة للاسترداد على مصروف ' || v_entry.reference
    );
  END IF;
  v_lines := v_lines || jsonb_build_object(
    'account_code', public.expense_posting_account_code(v_payable_role),
    'credit', round(v_entry.total_amount, 2),
    'memo', 'التزام مصروف ' || v_entry.reference
  );
  v_journal := public.create_journal_entry(
    'إثبات استحقاق مصروف ' || v_entry.reference,
    coalesce(v_entry.expense_date, CURRENT_DATE), 'expense', p_entry_id, true, v_lines
  );

  -- مصروف المورد: الذمة العامة في الأستاذ العام كانت وحدها تُحدَّث، فينفصل
  -- كشف المورد عن حساب الموردين (2111). الآن يُكتب الاستحقاق في دفتر المورد
  -- بنفس العملية الذرية وبمفتاح مصدر فريد.
  IF v_entry.payee_type = 'SUPPLIER' AND v_entry.supplier_id IS NOT NULL THEN
    PERFORM public.expense_write_supplier_ledger(
      v_entry.supplier_id, 'EXPENSE_ACCRUAL', 'CREDIT', v_entry.total_amount,
      'expense', p_entry_id, 'EXP-' || p_entry_id::text,
      v_entry.due_date, v_entry.expense_date::timestamptz,
      'مصروف ' || v_entry.reference, v_user);
  END IF;

  IF p_pay_now THEN
    SELECT * INTO v_entry FROM public.record_expense_payment(
      p_entry_id, v_entry.total_amount, coalesce(p_payment_date, CURRENT_DATE),
      p_payment_method, p_account_label, NULL, 'Settled at posting',
      coalesce(NULLIF(btrim(coalesce(p_idempotency_key, '')), ''), 'post:' || p_entry_id::text),
      p_account_id, p_cashbox_id, p_bank_account_id, p_payment_method_id
    );
  END IF;
  RETURN v_entry;
END;
$function$;

-- ── 6. السداد: نفس قيد الالتزام ونفس حساب الترحيل + دفتر المورد ────────────
CREATE OR REPLACE FUNCTION public.record_expense_payment(
  p_entry_id uuid,
  p_amount numeric,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_payment_method public.payment_method DEFAULT 'cash',
  p_account_label text DEFAULT NULL,
  p_reference_no text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_account_id uuid DEFAULT NULL,
  p_cashbox_id uuid DEFAULT NULL,
  p_bank_account_id uuid DEFAULT NULL,
  p_payment_method_id text DEFAULT NULL
)
RETURNS public.expense_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := public.expense_actor();
  v_entry public.expense_entries;
  v_amount numeric(18,2);
  v_existing public.expense_payments;
  v_label text := nullif(btrim(coalesce(p_account_label, '')), '');
  v_cash_acct text;
  v_credit_acct text;
  v_payable_role text;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
  v_payment_id uuid;
BEGIN
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.expense_assert_capability(v_user, 'expense.pay');
  v_amount := public.expense_round(p_amount);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount is invalid or exceeds remaining amount' USING ERRCODE = '22023';
  END IF;
  -- إعادة الطلب (شبكة/مهلة): إن وُجد الدفع بنفس المفتاح نعيد المستند كما هو.
  -- المفتاح فريد على مستوى الجدول: أساس الدفع هو الدفعة، لا المستند.
  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.expense_payments
     WHERE idempotency_key = v_key;
    IF FOUND THEN
      IF v_existing.entry_id <> p_entry_id OR v_existing.amount <> v_amount THEN
        RAISE EXCEPTION 'Payment request key was already used for a different payment'
          USING ERRCODE = '23505';
      END IF;
      RETURN v_entry;
    END IF;
  END IF;
  IF v_entry.status NOT IN ('POSTED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'Payments can only be recorded against posted expenses (current: %)', v_entry.status
      USING ERRCODE = '55000';
  END IF;
  IF v_amount > v_entry.remaining_amount + 0.005 THEN
    RAISE EXCEPTION 'Payment amount is invalid or exceeds remaining amount' USING ERRCODE = '22023';
  END IF;

  IF p_cashbox_id IS NOT NULL THEN
    SELECT c.name_ar, a.code INTO v_label, v_cash_acct
      FROM public.cashboxes c JOIN public.accounts a ON a.id = c.account_id
     WHERE c.id = p_cashbox_id AND c.is_active AND a.account_type::text = 'ASSET'
       AND a.is_active AND a.is_postable;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cashbox is unavailable' USING ERRCODE = '22023'; END IF;
  ELSIF p_bank_account_id IS NOT NULL THEN
    SELECT b.name_ar, a.code INTO v_label, v_cash_acct
      FROM public.company_bank_accounts b JOIN public.accounts a ON a.id = b.account_id
     WHERE b.id = p_bank_account_id AND b.is_active AND a.account_type::text = 'ASSET'
       AND a.is_active AND a.is_postable;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bank account is unavailable' USING ERRCODE = '22023'; END IF;
  ELSIF p_account_id IS NOT NULL THEN
    SELECT a.name_ar, a.code INTO v_label, v_cash_acct FROM public.accounts a
     WHERE a.id = p_account_id AND a.account_type::text = 'ASSET' AND a.is_active AND a.is_postable;
    IF NOT FOUND THEN RAISE EXCEPTION 'The selected settlement account is unavailable' USING ERRCODE = '22023'; END IF;
  END IF;
  IF v_cash_acct IS NULL THEN
    v_cash_acct := public.payment_method_ledger_account(coalesce(p_payment_method::text, 'cash'));
  END IF;
  IF v_cash_acct IS NULL THEN
    RAISE EXCEPTION 'No active ledger account is configured for this payment method' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts a
     WHERE a.code = v_cash_acct AND a.account_type::text = 'ASSET'
       AND a.is_active AND a.is_postable
  ) THEN
    RAISE EXCEPTION 'The payment method is not linked to an active, postable cash or bank account'
      USING ERRCODE = '22023';
  END IF;
  v_payable_role := CASE
    WHEN v_entry.payee_type = 'SUPPLIER' AND v_entry.supplier_id IS NOT NULL THEN 'SUPPLIER_PAYABLE'
    WHEN v_entry.payee_type = 'EMPLOYEE' AND v_entry.employee_id IS NOT NULL THEN 'EMPLOYEE_PAYABLE'
    ELSE 'OTHER_PAYABLE'
  END;
  v_credit_acct := public.expense_posting_account_code(v_payable_role);

  INSERT INTO public.expense_payments (
    entry_id, amount, payment_date, payment_method, account_label, reference_no,
    note, idempotency_key, created_by, account_id, cashbox_id, bank_account_id, payment_method_id
  ) VALUES (
    p_entry_id, v_amount, coalesce(p_payment_date, CURRENT_DATE), coalesce(p_payment_method, 'cash'),
    v_label, nullif(btrim(coalesce(p_reference_no, '')), ''), nullif(btrim(coalesce(p_note, '')), ''),
    v_key, v_user, p_account_id,
    p_cashbox_id, p_bank_account_id, p_payment_method_id
  ) RETURNING id INTO v_payment_id;

  v_lines := v_lines
    || jsonb_build_object('account_code', v_credit_acct, 'debit', v_amount, 'memo', 'تسوية التزام مصروف ' || v_entry.reference)
    || jsonb_build_object('account_code', v_cash_acct, 'credit', v_amount, 'memo', 'صرف دفعة مصروف ' || v_entry.reference);
  v_journal := public.create_journal_entry(
    'سداد مصروف ' || v_entry.reference, coalesce(p_payment_date, CURRENT_DATE),
    'expense_payment', v_payment_id, true, v_lines
  );

  IF v_entry.payee_type = 'SUPPLIER' AND v_entry.supplier_id IS NOT NULL THEN
    PERFORM public.expense_write_supplier_ledger(
      v_entry.supplier_id, 'EXPENSE_PAYMENT', 'DEBIT', v_amount,
      'expense_payment', v_payment_id, 'EXPPAY-' || v_payment_id::text,
      v_entry.due_date, coalesce(p_payment_date, CURRENT_DATE)::timestamptz,
      coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'سداد مصروف ' || v_entry.reference),
      v_user);
  END IF;

  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id;
  PERFORM public.expense_log_action(p_entry_id, 'payment', v_entry.status, v_entry.status,
    'Payment of ' || v_amount::text || ' ' || v_entry.currency_symbol || ' recorded', v_user);
  RETURN v_entry;
END;
$function$;

-- ── 7. العكس: قيد عكسي + سحب توقيع المسودة + عكس حركة دفتر المورد ──────────
CREATE OR REPLACE FUNCTION public.reverse_expense(p_entry_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS public.expense_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user     uuid := public.expense_actor();
  v_entry    public.expense_entries;
  v_reversal public.expense_entries;
  v_original uuid;
BEGIN
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.expense_assert_capability(v_user, 'expense.reverse');

  IF v_entry.status = 'REVERSED' THEN
    RETURN v_entry;   -- idempotent: reversing twice is a no-op, not an error
  END IF;
  IF v_entry.status NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID') THEN
    RAISE EXCEPTION 'Only a posted expense can be reversed (current: %)', v_entry.status
      USING ERRCODE = '55000';
  END IF;
  IF v_entry.paid_amount > 0 THEN
    RAISE EXCEPTION 'Reverse the recorded payments first (paid: %)', v_entry.paid_amount
      USING ERRCODE = '55000';
  END IF;

  SELECT je.id INTO v_original
    FROM public.journal_entries je
   WHERE je.source_type = 'expense' AND je.source_id = p_entry_id
     AND je.status <> 'REVERSED';
  IF v_original IS NOT NULL THEN
    PERFORM public.reverse_journal_entry(v_original,
      COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'عكس المصروف'));
  END IF;

  INSERT INTO public.expense_entries (
    reference, entry_type, status, source_kind,
    payee_type, payee_name, supplier_id, employee_id,
    warehouse_id, cost_center_id, project_id,
    expense_date, posting_date, description, note,
    tax_mode, tax_recoverable, currency, currency_symbol,
    reversal_of, created_by, posted_by, posted_at
  )
  VALUES (
    v_entry.reference || '-R',
    v_entry.entry_type,
    'POSTED',
    v_entry.source_kind,
    v_entry.payee_type, v_entry.payee_name, v_entry.supplier_id, v_entry.employee_id,
    v_entry.warehouse_id, v_entry.cost_center_id, v_entry.project_id,
    CURRENT_DATE, CURRENT_DATE,
    'Reversal of ' || v_entry.reference,
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_entry.tax_mode, v_entry.tax_recoverable, v_entry.currency, v_entry.currency_symbol,
    v_entry.id, v_user, v_user, now()
  )
  RETURNING * INTO v_reversal;

  INSERT INTO public.expense_lines (
    entry_id, line_no, description, category_id, quantity, unit_price,
    net_amount, tax_rate, tax_amount, gross_amount,
    cost_center_id, project_id, note
  )
  SELECT
    v_reversal.id, line_no, description, category_id, quantity, unit_price,
    net_amount, tax_rate, tax_amount, gross_amount,
    cost_center_id, project_id, note
  FROM public.expense_lines
  WHERE entry_id = p_entry_id
  ORDER BY line_no;

  UPDATE public.expense_entries
     SET total_amount = v_entry.total_amount,
         line_count   = v_entry.line_count
   WHERE id = v_reversal.id
  RETURNING * INTO v_reversal;

  UPDATE public.expense_entries
     SET status         = 'REVERSED',
         reversed_by_id = v_reversal.id,
         version        = version + 1
   WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  IF v_entry.payee_type = 'SUPPLIER' AND v_entry.supplier_id IS NOT NULL THEN
    PERFORM public.expense_reverse_supplier_ledger(
      v_entry.supplier_id, 'EXP-' || p_entry_id::text, 'expense', p_entry_id,
      'EXP-REV-' || p_entry_id::text, 'عكس مصروف ' || v_entry.reference, v_user);
  END IF;

  PERFORM public.expense_log_action(
    p_entry_id, 'reversed', 'POSTED', 'REVERSED',
    COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Reversed'), v_user);

  RETURN v_entry;
END $function$;

-- ── 8. الصلاحيات والأدوار ─────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.expense_require_override_reason(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.expense_line_production_base_amount(numeric, numeric, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.expense_write_supplier_ledger(uuid, text, text, numeric, text, uuid, text, date, timestamptz, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.expense_reverse_supplier_ledger(uuid, text, text, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expense_require_override_reason(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_line_production_base_amount(numeric, numeric, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_write_supplier_ledger(uuid, text, text, numeric, text, uuid, text, date, timestamptz, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expense_reverse_supplier_ledger(uuid, text, text, uuid, text, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.post_expense(uuid,integer,boolean,public.payment_method,text,date,text,uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_expense(uuid,integer,boolean,public.payment_method,text,date,text,uuid,uuid,uuid,text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_expense_payment(uuid,numeric,date,public.payment_method,text,text,text,text,uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_expense_payment(uuid,numeric,date,public.payment_method,text,text,text,text,uuid,uuid,uuid,text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reverse_expense(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_expense(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.decide_expense(uuid, boolean, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_expense(uuid, boolean, text, integer)
  TO authenticated, service_role;

COMMIT;

-- Rollback (manual, after data review):
--   DROP FUNCTION public.expense_reverse_supplier_ledger(uuid, text, text, uuid, text, text, uuid);
--   DROP FUNCTION public.expense_write_supplier_ledger(uuid, text, text, numeric, text, uuid, text, date, timestamptz, text, uuid);
--   DROP FUNCTION public.expense_line_production_base_amount(numeric, numeric, boolean);
--   DROP FUNCTION public.expense_require_override_reason(text);
--   DROP INDEX public.uq_supplier_ledger_expense_source;
--   ALTER TABLE public.expense_entries DROP COLUMN draft_post_reason, DROP COLUMN allow_draft_post;
--   (أعد تعريف decide_expense/post_expense/record_expense_payment/reverse_expense من 9913 و09 و21)

-- ── 9. منطق تكلفة الإنتاج من المصروفات المؤهلة ──────────────────────────────
--    يُستخرج ليعاد استخدامه حرفياً داخل create_and_post_production_order
--    (9906) بدل تكرار قواعد المتاح/الضريبة في موضعين قد يتباعدان.
--    القواعد:
--      • المصروف يجب أن يكون مرحّلاً وتاريخه لا يتجاوز تاريخ التشغيلة.
--      • مركز التكلفة مطابق.
--      • التصنيف مؤهل (production_cost_eligible) ومرتبط بحساب مصروف صالح.
--      • المتاح = صافي السطر + الضريبة غير القابلة للاسترداد − المحمَّل سابقاً.
--        الضريبة القابلة للاسترداد لا تُرسمل لأنها لم تُحمَّل على المصروف أصلاً،
--        والضريبة غير المستردة المؤهلة تُرسمل لأنها جزء من تكلفة التحويل (IAS 2).
CREATE OR REPLACE FUNCTION public.production_expense_line_available(p_expense_line_id uuid)
RETURNS TABLE (
  expense_line_id uuid,
  expense_entry_id uuid,
  entry_reference text,
  expense_date date,
  net_amount numeric,
  tax_amount numeric,
  tax_recoverable boolean,
  eligible_amount numeric,
  allocated_amount numeric,
  available_amount numeric,
  expense_account_code text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    l.id,
    e.id,
    e.reference,
    e.expense_date,
    l.net_amount,
    l.tax_amount,
    coalesce(e.tax_recoverable, false),
    public.expense_line_production_base_amount(l.net_amount, l.tax_amount, e.tax_recoverable),
    coalesce((
      SELECT sum(a.amount) FROM public.production_order_cost_allocations a
       WHERE a.expense_line_id = l.id
    ), 0),
    public.expense_round(
      public.expense_line_production_base_amount(l.net_amount, l.tax_amount, e.tax_recoverable)
      - coalesce((
          SELECT sum(a.amount) FROM public.production_order_cost_allocations a
           WHERE a.expense_line_id = l.id
        ), 0)
    ),
    acct.code::text
  FROM public.expense_lines l
  JOIN public.expense_entries e ON e.id = l.entry_id
  JOIN public.expense_categories c ON c.id = l.category_id
  JOIN public.accounts acct ON acct.id = c.account_id
  WHERE l.id = p_expense_line_id
    AND acct.account_type::text = 'EXPENSE'
    AND acct.is_active
    AND acct.is_postable
$function$;

REVOKE ALL ON FUNCTION public.production_expense_line_available(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.production_expense_line_available(uuid) TO service_role;

-- لا COMMIT هنا: قسم إعادة تعريف create_and_post_production_order (ما يلي) في
-- نفس المعاملة. يُختم الملف بـ COMMIT واحد في نهايته حتى لا يُطبَّق جزء منه.

-- ── 10. تكلفة الإنتاج: create_and_post_production_order (9912 ← 9916)
--     يعاد تعريف الدالة كاملة بنفس التوقيع. التغيير الوحيد في الجسم:
--     قراءة المتاح من production_expense_line_available بدل net_amount،
--     ليُرسمل الجزء المؤهل من الضريبة غير المستردة مرة واحدة فقط، ولإبقاء
--     منع التحميل الزائد ومطابقة المركز وتاريخ القيد كما هي.
--     يُولَّد جسم الدالة التالي آلياً من ملف 9906 (السطور 358–813) ثم يُحقن
--     فرق الضريبة فقط، حتى لا يُعاد نسخ منطق المخزون والفاقد والترحيل يدوياً.
CREATE OR REPLACE FUNCTION public.complete_production_order(
  p_order_id uuid,
  p_materials jsonb,
  p_outputs jsonb,
  p_expenses jsonb DEFAULT '[]'::jsonb,
  p_losses jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_order public.production_orders%ROWTYPE;
  v_input jsonb;
  v_output jsonb;
  v_expense jsonb;
  v_loss jsonb;
  v_product public.products%ROWTYPE;
  v_expense_line public.expense_lines%ROWTYPE;
  v_expense_entry public.expense_entries%ROWTYPE;
  v_expense_category_eligible boolean;
  v_eligible_amount numeric;
  v_batch public.product_batches%ROWTYPE;
  v_material_id uuid;
  v_output_id uuid;
  v_allocation_id uuid;
  v_journal_id uuid;
  v_movement_id uuid;
  v_batch_id uuid;
  v_base_uom_id uuid;
  v_uom_id uuid;
  v_base_qty numeric;
  v_factor numeric;
  v_mass numeric;
  v_total_input_mass numeric := 0;
  v_total_output_mass numeric := 0;
  v_normal_loss_mass numeric := 0;
  v_abnormal_loss_mass numeric := 0;
  v_input_mass_complete boolean := true;
  v_output_mass_complete boolean := true;
  v_expected_mass numeric;
  v_total_material_cost numeric := 0;
  v_total_conversion_cost numeric := 0;
  v_total_wip numeric := 0;
  v_abnormal_cost numeric := 0;
  v_allocated numeric := 0;
  v_remaining_wip numeric := 0;
  v_actual_output_total numeric := 0;
  v_line_cost numeric := 0;
  v_available numeric := 0;
  v_already_allocated numeric := 0;
  v_currency_account text;
  v_stock_account text;
  v_journal_lines jsonb;
  v_batch_settings jsonb := '{}'::jsonb;
  v_company_strategy text := 'FEFO';
  v_strategy text := 'FEFO';
  v_prevent_expired boolean := true;
  v_remaining numeric;
  v_take numeric;
  v_batch_line record;
  v_unit record;
  v_output_count integer;
  v_output_index integer := 0;
  v_batch_number text;
  v_expiry date;
  v_loss_factor numeric;
  v_kg_factor numeric;
  v_variance numeric;
  v_material_journal uuid;
BEGIN
  IF v_user IS NULL OR NOT public.is_staff(v_user) OR NOT (
    public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
    OR public.has_role(v_user,'warehouse') OR public.has_role(v_user,'accountant')
  ) THEN RAISE EXCEPTION 'ليس لديك صلاحية ترحيل تشغيلة الإنتاج'; END IF;
  IF p_materials IS NULL OR jsonb_typeof(p_materials)<>'array' OR jsonb_array_length(p_materials)=0
     OR p_outputs IS NULL OR jsonb_typeof(p_outputs)<>'array' OR jsonb_array_length(p_outputs)=0 THEN
    RAISE EXCEPTION 'أضف مادة واحدة وناتجاً واحداً على الأقل' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(coalesce(p_expenses,'[]'::jsonb))<>'array'
     OR jsonb_typeof(coalesce(p_losses,'[]'::jsonb))<>'array' THEN
    RAISE EXCEPTION 'بيانات المصروفات أو الفاقد غير صحيحة' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_order FROM public.production_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تشغيلة الإنتاج غير موجودة' USING ERRCODE='P0002'; END IF;
  IF v_order.status<>'DRAFT' THEN RAISE EXCEPTION 'لا يمكن ترحيل تشغيلة ليست مسودة'; END IF;
  IF jsonb_array_length(coalesce(p_expenses,'[]'::jsonb))>0 AND NOT public.can_read_finance(v_user) THEN
    RAISE EXCEPTION 'تخصيص المصروفات يتطلب صلاحية مالية';
  END IF;

  SELECT coalesce(cs.batch_settings,'{}'::jsonb) INTO v_batch_settings
    FROM public.company_settings cs LIMIT 1;
  v_strategy := coalesce(v_batch_settings->>'dispatch_strategy','FEFO');
  IF v_strategy NOT IN ('FEFO','FIFO','MANUAL') THEN v_strategy:='FEFO'; END IF;
  v_company_strategy:=v_strategy;
  v_prevent_expired := coalesce((v_batch_settings->>'prevent_selling_expired')::boolean,true);

  -- Materials: normalize entered units, issue company stock once, and capture
  -- the actual moving-average amount created by the stock-cost engine.
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    SELECT * INTO v_product FROM public.products WHERE id=(v_input->>'product_id')::uuid FOR SHARE;
    IF NOT FOUND OR v_product.item_class IS NULL OR v_product.item_class IN ('SERVICE','NON_STOCK_ITEM')
       OR v_product.item_nature='SERVICE' OR public.item_effective_policy(v_product.id)<>'TRACKED' THEN
      RAISE EXCEPTION 'المادة % لا تدار كمخزون مملوك للمنشأة',coalesce(v_input->>'product_id','?')
        USING ERRCODE='check_violation';
    END IF;
    IF v_product.tracking='SERIAL' THEN
      RAISE EXCEPTION 'التصنيع لا يدعم حالياً الصرف التسلسلي للصنف %',v_product.name_ar USING ERRCODE='check_violation';
    END IF;
    v_uom_id := nullif(v_input->>'uom_id','')::uuid;
    v_base_uom_id := coalesce(v_product.base_uom_id,v_product.unit_id);
    v_base_qty := public.production_quantity_in_base(v_product.id,(v_input->>'quantity')::numeric,v_uom_id);
    v_factor := v_base_qty/(v_input->>'quantity')::numeric;
    IF v_base_qty<>round(v_base_qty,3) THEN RAISE EXCEPTION 'كمية المادة تتجاوز دقة المخزون 0.001'; END IF;
    v_mass := public.production_mass_in_kg(v_product.id,v_base_qty);
    IF v_product.item_class='RAW_MATERIAL' THEN
      IF v_mass IS NULL THEN v_input_mass_complete:=false; ELSE v_total_input_mass:=v_total_input_mass+v_mass; END IF;
    END IF;

    INSERT INTO public.production_order_materials(
      production_order_id,product_id,entered_quantity,uom_id,base_uom_id,uom_conversion_factor,
      base_quantity,mass_kg,inventory_account_code)
    VALUES (v_order.id,v_product.id,(v_input->>'quantity')::numeric,v_uom_id,v_base_uom_id,v_factor,
      v_base_qty,v_mass,public.production_inventory_account_code(v_product.item_class))
    RETURNING id INTO v_material_id;

    IF v_product.tracking='BATCH' THEN
      v_remaining:=v_base_qty;
      IF nullif(v_input->>'batch_id','') IS NOT NULL THEN
        SELECT * INTO v_batch FROM public.product_batches
         WHERE id=(v_input->>'batch_id')::uuid AND product_id=v_product.id AND warehouse_id=v_order.warehouse_id
         FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'الدفعة المحددة لا تخص المادة أو المستودع'; END IF;
        IF v_prevent_expired AND v_batch.expiry_date IS NOT NULL AND v_batch.expiry_date<=current_date THEN
          RAISE EXCEPTION 'لا يمكن صرف دفعة منتهية الصلاحية: %',v_batch.batch_number;
        END IF;
        IF v_batch.quantity<v_remaining THEN RAISE EXCEPTION 'رصيد الدفعة % غير كافٍ',v_batch.batch_number; END IF;
        UPDATE public.product_batches SET quantity=round(quantity-v_remaining,3),updated_at=now() WHERE id=v_batch.id;
        INSERT INTO public.production_order_batch_allocations(material_id,batch_id,base_quantity)
        VALUES(v_material_id,v_batch.id,v_remaining);
      ELSE
        v_strategy:=coalesce(v_product.batch_dispatch_strategy,v_company_strategy);
        IF v_strategy='MANUAL' THEN RAISE EXCEPTION 'حدد دفعة المادة % للصرف اليدوي',v_product.name_ar; END IF;
        FOR v_batch_line IN
          SELECT pb.id,pb.batch_number,pb.expiry_date,pb.quantity
            FROM public.product_batches pb
           WHERE pb.product_id=v_product.id AND pb.warehouse_id=v_order.warehouse_id AND pb.quantity>0
             AND (NOT v_prevent_expired OR pb.expiry_date IS NULL OR pb.expiry_date>current_date)
           ORDER BY CASE WHEN v_strategy='FIFO' THEN pb.created_at END ASC,
                    CASE WHEN v_strategy='FIFO' THEN pb.id END ASC,
                    CASE WHEN v_strategy='FEFO' THEN pb.expiry_date END ASC NULLS LAST,
                    CASE WHEN v_strategy='FEFO' THEN pb.created_at END ASC,pb.id
           FOR UPDATE
        LOOP
          EXIT WHEN v_remaining<=0;
          v_take:=least(v_batch_line.quantity,v_remaining);
          UPDATE public.product_batches SET quantity=round(quantity-v_take,3),updated_at=now() WHERE id=v_batch_line.id;
          INSERT INTO public.production_order_batch_allocations(material_id,batch_id,base_quantity)
          VALUES(v_material_id,v_batch_line.id,v_take);
          v_remaining:=v_remaining-v_take;
        END LOOP;
        IF v_remaining>0 THEN RAISE EXCEPTION 'رصيد الدفعات الصالحة غير كافٍ للمادة %',v_product.name_ar; END IF;
      END IF;
    ELSIF nullif(v_input->>'batch_id','') IS NOT NULL THEN
      RAISE EXCEPTION 'لا تقبل دفعة لصنف غير متتبع بالدفعات';
    END IF;

    PERFORM public.post_stock_delta(v_product.id,v_order.warehouse_id,-v_base_qty,NULL,
      'PRODUCTION','production_material',v_material_id,'صرف مواد لتشغيلة '||v_order.order_number,
      'COMPANY',NULL,'production_out');
    SELECT sm.id,sm.total_cost,sm.unit_cost INTO v_movement_id,v_line_cost,v_factor
      FROM public.stock_movements sm
     WHERE sm.source_type='production_material' AND sm.source_id=v_material_id
     ORDER BY sm.created_at DESC,sm.id DESC LIMIT 1;
    IF v_movement_id IS NULL THEN RAISE EXCEPTION 'لم تُسجل حركة صرف المادة'; END IF;
    UPDATE public.production_order_materials SET stock_movement_id=v_movement_id,
      total_cost=coalesce(v_line_cost,0),unit_cost=coalesce(v_factor,0)
     WHERE id=v_material_id;
    v_total_material_cost:=v_total_material_cost+coalesce(v_line_cost,0);
  END LOOP;

  -- Journal the material issue: debit WIP, credit the appropriate inventory.
  IF v_total_material_cost>0 THEN
    v_journal_lines:=jsonb_build_array(jsonb_build_object(
      'account_code','1312','debit',round(v_total_material_cost,2),'memo','مواد مصروفة للتشغيلة '||v_order.order_number));
    FOR v_batch_line IN
      SELECT inventory_account_code AS code,round(sum(total_cost),2) AS amount
        FROM public.production_order_materials WHERE production_order_id=v_order.id
       GROUP BY inventory_account_code HAVING sum(total_cost)>0
    LOOP
      v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
        'account_code',v_batch_line.code,'credit',v_batch_line.amount,'memo','صرف مخزون للتشغيلة '||v_order.order_number));
    END LOOP;
    v_material_journal:=public.post_journal_entry(v_order.production_date,
      'صرف مواد لتشغيلة إنتاج '||v_order.order_number,v_journal_lines,
      'production_material_issue',v_order.id,'JE-PM-'||v_order.order_number);
  END IF;

  -- Eligible, already-posted expense lines are reclassified net of input VAT.
  FOR v_expense IN SELECT value FROM jsonb_array_elements(coalesce(p_expenses,'[]'::jsonb))
  LOOP
    SELECT * INTO v_expense_line FROM public.expense_lines
     WHERE id=(v_expense->>'expense_line_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'بند المصروف المحدد غير موجود'; END IF;
    SELECT * INTO v_expense_entry FROM public.expense_entries WHERE id=v_expense_line.entry_id FOR SHARE;
    IF v_expense_entry.status::text NOT IN ('POSTED','PARTIALLY_PAID','PAID','CLOSED') THEN
      RAISE EXCEPTION 'لا يمكن تحميل مصروف غير مرحّل على الإنتاج';
    END IF;
    IF v_expense_entry.expense_date>v_order.production_date THEN
      RAISE EXCEPTION 'تاريخ المصروف % بعد تاريخ التشغيلة %',v_expense_entry.expense_date,v_order.production_date;
    END IF;
    IF coalesce(v_expense_line.cost_center_id,v_expense_entry.cost_center_id)
       IS DISTINCT FROM v_order.cost_center_id THEN
      RAISE EXCEPTION 'مركز تكلفة المصروف لا يطابق مركز تكلفة التشغيلة';
    END IF;
    SELECT c.production_cost_eligible,a.code,a.account_type::text
      INTO v_expense_category_eligible,v_currency_account,v_stock_account
      FROM public.expense_categories c JOIN public.accounts a ON a.id=c.account_id
       AND a.is_active AND a.is_postable
     WHERE c.id=v_expense_line.category_id;
    IF NOT FOUND OR v_stock_account<>'EXPENSE' THEN
      RAISE EXCEPTION 'تصنيف المصروف غير مرتبط بحساب مصروف صالح للرسملة';
    END IF;
    IF v_expense_category_eligible IS NOT TRUE THEN
      RAISE EXCEPTION 'تصنيف المصروف غير مؤهل للرسملة على الإنتاج';
    END IF;
    v_line_cost:=round((v_expense->>'amount')::numeric,2);
    IF v_line_cost<=0 THEN RAISE EXCEPTION 'قيمة تحميل المصروف يجب أن تكون موجبة'; END IF;
    SELECT coalesce(sum(amount),0) INTO v_already_allocated
      FROM public.production_order_cost_allocations WHERE expense_line_id=v_expense_line.id;
    -- المتاح = الصافي + الضريبة غير القابلة للاسترداد − المحمَّل سابقاً.
    -- الضريبة القابلة للاسترداد لم تُحمَّل على المصروف عند الترحيل (9913)،
    -- فلا تُرسمل؛ وغير المستردة جزء من تكلفة التحويل المؤهلة (IAS 2).
    SELECT r.eligible_amount, r.allocated_amount, r.available_amount,
           r.expense_account_code
      INTO v_eligible_amount, v_already_allocated, v_available, v_currency_account
      FROM public.production_expense_line_available(v_expense_line.id) r;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'بند المصروف غير مرتبط بحساب مصروف نشط وقابل للترحيل';
    END IF;
    IF v_line_cost>v_available THEN
      RAISE EXCEPTION 'قيمة تحميل المصروف % تتجاوز المتاح %',v_line_cost,v_available;
    END IF;
    IF length(btrim(coalesce(v_expense->>'basis','')))<3 THEN
      RAISE EXCEPTION 'اذكر أساس توزيع تكلفة المصروف على التشغيلة';
    END IF;
    INSERT INTO public.production_order_cost_allocations(
      production_order_id,expense_line_id,expense_entry_id,cost_center_id,expense_account_code,
      amount,allocation_basis,note,created_by)
    VALUES(v_order.id,v_expense_line.id,v_expense_entry.id,v_order.cost_center_id,v_currency_account,
      v_line_cost,btrim(v_expense->>'basis'),nullif(btrim(coalesce(v_expense->>'note','')),''),v_user)
    RETURNING id INTO v_allocation_id;
    v_journal_id:=public.post_journal_entry(v_order.production_date,
      'رسملة تكلفة إنتاج من المصروف '||v_expense_entry.reference,
      jsonb_build_array(
        jsonb_build_object('account_code','1312','debit',v_line_cost,'memo','تحميل على تشغيلة '||v_order.order_number),
        jsonb_build_object('account_code',v_currency_account,'credit',v_line_cost,'memo','إعادة تصنيف مصروف إلى إنتاج')),
      'production_expense_allocation',v_allocation_id,'JE-PEX-'||replace(v_allocation_id::text,'-',''));
    UPDATE public.production_order_cost_allocations SET journal_entry_id=v_journal_id WHERE id=v_allocation_id;
    v_total_conversion_cost:=v_total_conversion_cost+v_line_cost;
  END LOOP;

  -- Loss is recorded in mass units, normalized to kg. Unit counts are never
  -- compared across unrelated products.
  SELECT factor_to_reference INTO v_kg_factor FROM public.units
   WHERE dimension_code='MASS' AND lower(short_name) IN ('kg','كجم','كيلوجرام')
   ORDER BY CASE WHEN lower(short_name)='kg' THEN 0 ELSE 1 END LIMIT 1;
  FOR v_loss IN SELECT value FROM jsonb_array_elements(coalesce(p_losses,'[]'::jsonb))
  LOOP
    SELECT dimension_code,factor_to_reference INTO v_unit FROM public.units
     WHERE id=(v_loss->>'uom_id')::uuid;
    IF NOT FOUND OR v_unit.dimension_code<>'MASS' OR v_unit.factor_to_reference IS NULL OR v_kg_factor IS NULL THEN
      RAISE EXCEPTION 'وحدة الفاقد يجب أن تكون وحدة كتلة معرفة مثل كجم أو جرام';
    END IF;
    v_mass:=round((v_loss->>'quantity')::numeric*v_unit.factor_to_reference/v_kg_factor,6);
    IF v_mass<=0 THEN RAISE EXCEPTION 'كمية الفاقد يجب أن تكون موجبة'; END IF;
    IF upper(v_loss->>'loss_type')='NORMAL' THEN v_normal_loss_mass:=v_normal_loss_mass+v_mass;
    ELSIF upper(v_loss->>'loss_type')='ABNORMAL' THEN v_abnormal_loss_mass:=v_abnormal_loss_mass+v_mass;
    ELSE RAISE EXCEPTION 'نوع الفاقد غير معروف'; END IF;
    INSERT INTO public.production_order_losses(production_order_id,loss_type,quantity,uom_id,mass_kg,reason)
    VALUES(v_order.id,upper(v_loss->>'loss_type'),(v_loss->>'quantity')::numeric,(v_loss->>'uom_id')::uuid,
      v_mass,btrim(coalesce(v_loss->>'reason','')));
  END LOOP;

  SELECT count(*) INTO v_output_count FROM jsonb_array_elements(p_outputs);
  -- Outputs: only inventory goods that may be sold or used as a by-product.
  FOR v_output IN SELECT value FROM jsonb_array_elements(p_outputs)
  LOOP
    v_output_index:=v_output_index+1;
    SELECT * INTO v_product FROM public.products WHERE id=(v_output->>'product_id')::uuid FOR SHARE;
    IF NOT FOUND OR v_product.item_class IS NULL OR v_product.item_class NOT IN ('FINISHED_GOOD','BY_PRODUCT')
       OR v_product.item_nature='SERVICE' OR public.item_effective_policy(v_product.id)<>'TRACKED'
       OR NOT v_product.is_sellable THEN
      RAISE EXCEPTION 'الناتج يجب أن يكون منتجاً تاماً أو ناتجاً جانبياً مملوكاً ومخزونياً ومتاحاً للبيع';
    END IF;
    IF v_product.tracking='SERIAL' THEN RAISE EXCEPTION 'لا يدعم مسار الإنتاج حالياً تتبع الناتج التسلسلي'; END IF;
    v_uom_id:=nullif(v_output->>'uom_id','')::uuid;
    v_base_uom_id:=coalesce(v_product.base_uom_id,v_product.unit_id);
    v_base_qty:=public.production_quantity_in_base(v_product.id,(v_output->>'quantity')::numeric,v_uom_id);
    v_factor:=v_base_qty/(v_output->>'quantity')::numeric;
    IF v_base_qty<>round(v_base_qty,3) THEN RAISE EXCEPTION 'كمية الناتج تتجاوز دقة المخزون 0.001'; END IF;
    v_mass:=public.production_mass_in_kg(v_product.id,v_base_qty);
    IF v_mass IS NULL THEN v_output_mass_complete:=false; ELSE v_total_output_mass:=v_total_output_mass+v_mass; END IF;
    v_batch_number:=nullif(btrim(coalesce(v_output->>'batch_number','')),'');
    v_expiry:=nullif(v_output->>'expiry_date','')::date;
    IF v_product.tracking='BATCH' THEN
      IF v_batch_number IS NULL THEN v_batch_number:=v_order.order_number||'-'||lpad(v_output_index::text,2,'0'); END IF;
      IF v_product.track_expiry AND v_expiry IS NULL THEN
        RAISE EXCEPTION 'تاريخ الانتهاء مطلوب للناتج %',v_product.name_ar;
      END IF;
    ELSIF v_batch_number IS NOT NULL OR v_expiry IS NOT NULL THEN
      RAISE EXCEPTION 'بيانات الدفعة لا تقبل لناتج غير متتبع بالدفعات';
    END IF;
    INSERT INTO public.production_order_outputs(
      production_order_id,product_id,entered_quantity,uom_id,base_uom_id,uom_conversion_factor,
      base_quantity,mass_kg,allocation_value_per_base,inventory_account_code,batch_number,expiry_date)
    VALUES(v_order.id,v_product.id,(v_output->>'quantity')::numeric,v_uom_id,v_base_uom_id,v_factor,
      v_base_qty,v_mass,greatest(coalesce((v_output->>'allocation_value_per_base')::numeric,0),0),
      public.production_inventory_account_code(v_product.item_class),v_batch_number,v_expiry)
    RETURNING id INTO v_output_id;
  END LOOP;

  -- Enforce a physical mass balance when all raw inputs and outputs have a
  -- meaningful product-level mass conversion. Otherwise retain exact base-UOM
  -- snapshots and do not invent a conversion between unrelated count units.
  IF v_input_mass_complete AND v_output_mass_complete AND v_total_input_mass>0 THEN
    v_expected_mass:=v_total_output_mass+v_normal_loss_mass+v_abnormal_loss_mass;
    IF abs(v_total_input_mass-v_expected_mass)>0.01 THEN
      RAISE EXCEPTION 'ميزان الكتلة غير متزن: مواد خام % كجم مقابل نواتج وفاقد % كجم',
        round(v_total_input_mass,3),round(v_expected_mass,3) USING ERRCODE='check_violation';
    END IF;
  END IF;
  IF v_abnormal_loss_mass>0 AND (NOT v_input_mass_complete OR v_total_input_mass<=0) THEN
    RAISE EXCEPTION 'يجب تعريف مكافئ كتلي للمواد الخام قبل تحميل الفاقد غير الطبيعي';
  END IF;

  v_total_wip:=round(v_total_material_cost+v_total_conversion_cost,2);
  IF v_total_wip<=0 THEN RAISE EXCEPTION 'لا يمكن إقفال تشغيلة بلا تكلفة مواد أو تحويل مسجلة'; END IF;
  IF v_abnormal_loss_mass>0 THEN
    IF v_abnormal_loss_mass>v_total_input_mass THEN RAISE EXCEPTION 'الفاقد غير الطبيعي يتجاوز كتلة المواد الخام'; END IF;
    v_abnormal_cost:=round(v_total_wip*v_abnormal_loss_mass/v_total_input_mass,2);
  END IF;

  -- Allocate joint conversion cost by estimated sales value per base unit.
  IF v_output_count>1 AND EXISTS(
    SELECT 1 FROM public.production_order_outputs
     WHERE production_order_id=v_order.id AND allocation_value_per_base<=0
  ) THEN
    RAISE EXCEPTION 'أدخل قيمة بيع تقديرية لوحدة الأساس لكل ناتج لتوزيع تكلفة التشغيل';
  END IF;
  v_remaining_wip:=round(v_total_wip-v_abnormal_cost,2);
  FOR v_batch_line IN
    SELECT id,base_quantity,allocation_value_per_base,
           base_quantity*allocation_value_per_base AS allocation_weight,
           row_number() OVER (ORDER BY created_at,id) AS rn
      FROM public.production_order_outputs WHERE production_order_id=v_order.id ORDER BY created_at,id
  LOOP
    IF v_batch_line.rn=v_output_count THEN
      v_allocated:=v_remaining_wip;
    ELSIF v_output_count=1 THEN
      v_allocated:=v_remaining_wip;
    ELSE
      SELECT sum(base_quantity*allocation_value_per_base) INTO v_expected_mass
        FROM public.production_order_outputs WHERE production_order_id=v_order.id;
      v_allocated:=round((v_total_wip-v_abnormal_cost)*v_batch_line.allocation_weight/v_expected_mass,2);
    END IF;
    UPDATE public.production_order_outputs SET allocated_cost=v_allocated,
      unit_cost=CASE WHEN base_quantity>0 THEN v_allocated/base_quantity ELSE 0 END
     WHERE id=v_batch_line.id;
    v_remaining_wip:=round(v_remaining_wip-v_allocated,2);
  END LOOP;

  -- Receive each output through the same valuation engine used by purchases.
  FOR v_output IN SELECT to_jsonb(o) FROM public.production_order_outputs o
    WHERE o.production_order_id=v_order.id ORDER BY o.created_at,o.id
  LOOP
    v_output_id:=(v_output->>'id')::uuid;
    SELECT p.* INTO v_product FROM public.products p
      JOIN public.production_order_outputs o ON o.product_id=p.id WHERE o.id=v_output_id;
    SELECT o.base_quantity,o.allocated_cost,o.inventory_account_code,o.batch_number,o.expiry_date,
           o.allocated_cost/NULLIF(o.base_quantity,0)
      INTO v_base_qty,v_line_cost,v_stock_account,v_batch_number,v_expiry,v_factor
      FROM public.production_order_outputs o WHERE o.id=v_output_id;
    PERFORM public.post_stock_delta(v_product.id,v_order.warehouse_id,v_base_qty,v_factor,
      'PRODUCTION','production_output',v_output_id,'استلام ناتج تشغيلة '||v_order.order_number,
      'COMPANY',NULL,'production_in');
    SELECT sm.id,sm.total_cost INTO v_movement_id,v_available FROM public.stock_movements sm
     WHERE sm.source_type='production_output' AND sm.source_id=v_output_id
     ORDER BY sm.created_at DESC,sm.id DESC LIMIT 1;
    IF v_movement_id IS NULL THEN RAISE EXCEPTION 'لم تُسجل حركة استلام الناتج'; END IF;
    v_batch_id:=NULL;
    IF v_product.tracking='BATCH' THEN
      INSERT INTO public.product_batches(product_id,warehouse_id,batch_number,expiry_date,quantity,unit_cost,note,created_by)
      VALUES(v_product.id,v_order.warehouse_id,v_batch_number,v_expiry,v_base_qty,
        CASE WHEN v_base_qty>0 THEN round(v_available/v_base_qty,4) ELSE 0 END,
        'ناتج تشغيلة '||v_order.order_number,v_user)
      RETURNING id INTO v_batch_id;
    END IF;
    UPDATE public.production_order_outputs SET stock_movement_id=v_movement_id,batch_id=v_batch_id,
      actual_stock_cost=coalesce(v_available,0),unit_cost=CASE WHEN base_quantity>0 THEN coalesce(v_available,0)/base_quantity ELSE 0 END
     WHERE id=v_output_id;
    v_actual_output_total:=v_actual_output_total+coalesce(v_available,0);
  END LOOP;

  -- Complete WIP clearing and finished/by-product inventory recognition.
  v_journal_lines:='[]'::jsonb;
  FOR v_batch_line IN
    SELECT inventory_account_code AS code,round(sum(actual_stock_cost),2) AS amount
      FROM public.production_order_outputs WHERE production_order_id=v_order.id
     GROUP BY inventory_account_code HAVING sum(actual_stock_cost)>0
  LOOP
    v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
      'account_code',v_batch_line.code,'debit',v_batch_line.amount,'memo','استلام ناتج تشغيلة '||v_order.order_number));
  END LOOP;
  IF v_abnormal_cost>0 THEN
    v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
      'account_code','5911','debit',v_abnormal_cost,'memo','فاقد إنتاج غير طبيعي - '||v_order.order_number));
  END IF;
  v_variance:=round(v_total_wip-v_actual_output_total-v_abnormal_cost,2);
  IF v_variance>0 THEN
    v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
      'account_code','5911','debit',v_variance,'memo','فرق تقريب تكلفة استلام الإنتاج - '||v_order.order_number));
  ELSIF v_variance<0 THEN
    v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
      'account_code','5911','credit',abs(v_variance),'memo','فرق تقريب تكلفة استلام الإنتاج - '||v_order.order_number));
  END IF;
  v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
    'account_code','1312','credit',v_total_wip,'memo','إقفال الإنتاج تحت التنفيذ - '||v_order.order_number));
  v_journal_id:=public.post_journal_entry(v_order.production_date,
    'إقفال تشغيلة إنتاج '||v_order.order_number,v_journal_lines,
    'production_completion',v_order.id,'JE-PO-'||v_order.order_number);

  UPDATE public.production_orders SET status='POSTED',material_cost=round(v_total_material_cost,2),
    conversion_cost=round(v_total_conversion_cost,2),total_cost=v_total_wip,
    output_cost=round(v_actual_output_total,2),abnormal_loss_cost=v_abnormal_cost,
    completed_by=v_user,completed_at=now(),updated_at=now()
   WHERE id=v_order.id;
  RETURN v_journal_id;
END;
$function$;

COMMIT;

-- ── 11. Rollback (manual, after data review):
--   أعد تعريف complete_production_order من 9906 (السطور 358–789) لإلغاء تغيير الضريبة.
--   DROP FUNCTION public.production_expense_line_available(uuid);
--   DROP FUNCTION public.expense_reverse_supplier_ledger(uuid, text, text, uuid, text, text, uuid);
--   DROP FUNCTION public.expense_write_supplier_ledger(uuid, text, text, numeric, text, uuid, text, date, timestamptz, text, uuid);
--   DROP FUNCTION public.expense_line_production_base_amount(numeric, numeric, boolean);
--   DROP FUNCTION public.expense_require_override_reason(text);
--   DROP FUNCTION public.guard_expense_draft_post_reason();
--   DROP TRIGGER expense_entries_guard_draft_post_reason ON public.expense_entries;
--   DROP INDEX public.uq_supplier_ledger_expense_source;
--   ALTER TABLE public.expense_entries DROP COLUMN draft_post_reason, DROP COLUMN allow_draft_post;
--   (أعد تعريف decide_expense/post_expense/record_expense_payment/reverse_expense من 9913 و09 و21)

-- ⚠️ ملاحظة: لا تستخدم هذا الملف لمسح بيانات تاريخية. لا backfill لدفتر المورد
--    وللمصروفات القديمة، لأن ذلك يغيّر أرصدة فعلية بلا مراجعة محاسبية.
