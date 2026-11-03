-- ============================================================================
-- 25_accounting_phase4_supplier_ledger.sql
--
-- المرحلة الرابعة — المهمة T-24:
-- دفتر الموردين (supplier_ledger) وسندات صرف الموردين (supplier_payments)
-- مع تواريخ السداد والاستحقاق المستقلة والترحيل المحاسبي الذري (Dr 2111 / Cr 1101 or 1111).
--
-- معايير السلامة والجودة:
-- 1. جداول غير هدّامة مع IF NOT EXISTS.
-- 2. مفاتيح فريدة source_key لمنع التكرار نهائياً (Idempotent).
-- 3. تحديث ذري لأرصدة الموردين بدون greatest(..., 0).
-- 4. قيد محاسبي مزدوج متوازن ذرياً لكل سند صرف.
-- 5. مزامنة تلقائية عبر Triggers لفواتير الشراء والمرتجعات.
-- ============================================================================

-- ── 1. جدول دفتر حركات الموردين (supplier_ledger) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  entry_type text NOT NULL, -- 'PURCHASE_INVOICE', 'PAYMENT', 'PURCHASE_RETURN', 'OPENING_BALANCE', 'ADJUSTMENT'
  debit numeric(14,2) NOT NULL DEFAULT 0, -- ما سُدِّد أو أُرجع للمورد (ينقص التزامنا)
  credit numeric(14,2) NOT NULL DEFAULT 0, -- ما استحق للمورد علينا (يزيد التزامنا)
  balance_after numeric(14,2), -- رصيد المورد بعد الحركة
  reference_type text, -- 'purchase_invoice', 'supplier_payment', 'purchase_return', 'manual'
  reference_id uuid,
  due_date date, -- تاريخ استحقاق الفاتورة أو القسط
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  source_key text UNIQUE, -- لمنع ازدواج الحركات
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier_occurred
  ON public.supplier_ledger(supplier_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_supplier_ledger_reference
  ON public.supplier_ledger(reference_type, reference_id);

ALTER TABLE public.supplier_ledger ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'supplier_ledger' AND policyname = 'supplier_ledger_read_all'
  ) THEN
    CREATE POLICY supplier_ledger_read_all ON public.supplier_ledger
      FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'supplier_ledger' AND policyname = 'supplier_ledger_insert_auth'
  ) THEN
    CREATE POLICY supplier_ledger_insert_auth ON public.supplier_ledger
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'supplier_ledger' AND policyname = 'supplier_ledger_update_auth'
  ) THEN
    CREATE POLICY supplier_ledger_update_auth ON public.supplier_ledger
      FOR UPDATE TO authenticated USING (true);
  END IF;
END $$;

COMMENT ON TABLE public.supplier_ledger IS
  'T-24: دفتر أستاذ حركات الموردين التفصيلية (فواتير، مرتجعات، دفعات، تسويات) بتاريخ استحقاق وسداد صريح.';


-- ── 2. تسلسل وسجل سندات صرف الموردين (supplier_payments) ────────────────────
CREATE SEQUENCE IF NOT EXISTS public.supplier_payment_seq START 1;

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number text UNIQUE NOT NULL,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL DEFAULT 'CASH', -- 'CASH', 'BANK', 'TRANSFER', 'CHEQUE'
  account_code text NOT NULL DEFAULT '1101', -- '1101' نقدية بالصندوق، '1111' حساب بنكي
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_date
  ON public.supplier_payments(supplier_id, payment_date);

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'supplier_payments' AND policyname = 'supplier_payments_read_all'
  ) THEN
    CREATE POLICY supplier_payments_read_all ON public.supplier_payments
      FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'supplier_payments' AND policyname = 'supplier_payments_insert_auth'
  ) THEN
    CREATE POLICY supplier_payments_insert_auth ON public.supplier_payments
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE public.supplier_payments IS
  'T-24: سندات صرف الموردين المستقلة مع توثيق طريقة الدفع، الحساب المالي، والقيد المحاسبي.';


-- ── 3. دالة توليد رقم سند الصرف ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.next_supplier_voucher_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_seq bigint;
  v_prefix text;
BEGIN
  v_seq := nextval('public.supplier_payment_seq');
  v_prefix := 'PV-' || to_char(CURRENT_DATE, 'YYYYMM') || '-';
  RETURN v_prefix || lpad(v_seq::text, 4, '0');
END;
$$;


-- ── 4. دالة تسجيل سند صرف للمورد وترحيله محاسبياً وذرياً ───────────────────
CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_supplier_id uuid,
  p_amount numeric,
  p_payment_method text DEFAULT 'CASH',
  p_account_code text DEFAULT NULL,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL,
  p_due_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_supplier_name text;
  v_payment_id uuid;
  v_voucher_no text;
  v_account text;
  v_journal_id uuid;
  v_lines jsonb;
  v_new_balance numeric;
BEGIN
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier ID is required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero, got %', p_amount;
  END IF;

  SELECT name INTO v_supplier_name
  FROM public.suppliers
  WHERE id = p_supplier_id;

  IF v_supplier_name IS NULL THEN
    RAISE EXCEPTION 'Supplier with ID % not found', p_supplier_id;
  END IF;

  -- تحديد الحساب المالي (الصندوق أو البنك)
  IF p_account_code IS NOT NULL AND btrim(p_account_code) <> '' THEN
    v_account := btrim(p_account_code);
    IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE code = v_account) THEN
      RAISE EXCEPTION 'Account code % does not exist in chart of accounts', v_account;
    END IF;
  ELSE
    -- الافتراضي: إن كانت طريقة الدفع بنك أو تحويل -> 1111، وإلا -> 1101 (صندوق)
    IF upper(coalesce(p_payment_method, 'CASH')) IN ('BANK', 'TRANSFER', 'CHEQUE', 'CARD') THEN
      v_account := '1111';
    ELSE
      v_account := '1101';
    END IF;
  END IF;

  v_voucher_no := public.next_supplier_voucher_number();

  -- 1. إدراج سند الصرف
  INSERT INTO public.supplier_payments (
    voucher_number,
    supplier_id,
    amount,
    payment_method,
    account_code,
    payment_date,
    notes,
    created_by
  ) VALUES (
    v_voucher_no,
    p_supplier_id,
    round(p_amount, 2),
    upper(coalesce(p_payment_method, 'CASH')),
    v_account,
    coalesce(p_payment_date, CURRENT_DATE),
    p_notes,
    v_user
  ) RETURNING id INTO v_payment_id;

  -- 2. إعداد وترحيل القيد المحاسبي المزدوج المتوازن:
  -- Dr 2111 (ذمم الموردين) - تخفيض الالتزام
  -- Cr v_account (1101 نقدية بالصندوق أو 1111 بنك) - تخفيض النقدية
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_code', '2111',
      'debit', round(p_amount, 2),
      'credit', 0,
      'memo', 'سداد ذمة للمورد ' || v_supplier_name
    ),
    jsonb_build_object(
      'account_code', v_account,
      'debit', 0,
      'credit', round(p_amount, 2),
      'memo', 'صرف نقدي/بنكي بسند ' || v_voucher_no
    )
  );

  v_journal_id := public.create_journal_entry(
    'سند صرف مورد ' || v_supplier_name || ' (' || v_voucher_no || ')',
    coalesce(p_payment_date, CURRENT_DATE),
    'supplier_payment',
    v_payment_id,
    true, -- is_system
    v_lines
  );

  -- ربط القيد بالسند
  UPDATE public.supplier_payments
  SET journal_entry_id = v_journal_id
  WHERE id = v_payment_id;

  -- 3. تحديث رصيد المورد ذرياً دون greatest(..., 0)
  UPDATE public.suppliers
  SET balance = round(coalesce(balance, 0) - p_amount, 2),
      updated_at = now()
  WHERE id = p_supplier_id
  RETURNING balance INTO v_new_balance;

  -- 4. إدراج الحركة في دفتر الموردين
  INSERT INTO public.supplier_ledger (
    supplier_id,
    entry_type,
    debit,
    credit,
    balance_after,
    reference_type,
    reference_id,
    due_date,
    occurred_at,
    created_by,
    source_key,
    note
  ) VALUES (
    p_supplier_id,
    'PAYMENT',
    round(p_amount, 2),
    0,
    v_new_balance,
    'supplier_payment',
    v_payment_id,
    p_due_date,
    coalesce(p_payment_date::timestamptz, now()),
    v_user,
    'SUP-PAY-' || v_payment_id::text,
    coalesce(p_notes, 'سند صرف رقم ' || v_voucher_no)
  );

  -- سجل التدقيق
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user,
    'supplier_payment.recorded',
    'supplier_payment',
    v_payment_id,
    jsonb_build_object(
      'voucher_number', v_voucher_no,
      'supplier_id', p_supplier_id,
      'amount', round(p_amount, 2),
      'account_code', v_account,
      'journal_entry_id', v_journal_id,
      'new_balance', v_new_balance
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'voucher_number', v_voucher_no,
    'journal_entry_id', v_journal_id,
    'amount', round(p_amount, 2),
    'new_balance', v_new_balance
  );
END;
$$;

COMMENT ON FUNCTION public.record_supplier_payment(uuid, numeric, text, text, date, text, date) IS
  'T-24: تسجيل سند صرف للمورد وترحيل قيد مزدوج متوازن Dr 2111 / Cr 1101-1111، وتحديث رصيد ودفتر المورد ذرياً.';


-- ── 5. Triggers لمزامنة فواتير ومرتجعات الشراء تلقائياً مع دفتر الموردين ─────

-- (أ) مشغل فواتير الشراء
CREATE OR REPLACE FUNCTION public.trg_purchase_invoice_to_supplier_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.supplier_id IS NOT NULL THEN
    -- إثبات حركة استحقاق الفاتورة (Credit للمورد)
    INSERT INTO public.supplier_ledger (
      supplier_id, entry_type, debit, credit, balance_after,
      reference_type, reference_id, occurred_at, source_key, note, created_by
    ) VALUES (
      NEW.supplier_id,
      'PURCHASE_INVOICE',
      0,
      round(NEW.total, 2),
      (SELECT balance FROM public.suppliers WHERE id = NEW.supplier_id),
      'purchase_invoice',
      NEW.id,
      coalesce(NEW.created_at, now()),
      'PINV-' || NEW.id::text,
      'فاتورة مشتريات رقم ' || NEW.invoice_number || coalesce(' - ' || NEW.note, ''),
      NEW.created_by
    ) ON CONFLICT (source_key) DO NOTHING;

    -- إثبات السداد الفوري المرافق للفاتورة إن وُجد (Debit للمورد)
    IF coalesce(NEW.paid, 0) > 0 THEN
      INSERT INTO public.supplier_ledger (
        supplier_id, entry_type, debit, credit, balance_after,
        reference_type, reference_id, occurred_at, source_key, note, created_by
      ) VALUES (
        NEW.supplier_id,
        'PAYMENT',
        round(NEW.paid, 2),
        0,
        (SELECT balance FROM public.suppliers WHERE id = NEW.supplier_id),
        'purchase_invoice_payment',
        NEW.id,
        coalesce(NEW.created_at, now()),
        'PINV-PAID-' || NEW.id::text,
        'سداد فوري مرافق لفاتورة مشتريات ' || NEW.invoice_number,
        NEW.created_by
      ) ON CONFLICT (source_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_invoice_supplier_ledger ON public.purchase_invoices;
CREATE TRIGGER trg_purchase_invoice_supplier_ledger
  AFTER INSERT ON public.purchase_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_purchase_invoice_to_supplier_ledger();


-- (ب) مشغل مرتجعات الشراء
CREATE OR REPLACE FUNCTION public.trg_purchase_return_to_supplier_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.supplier_id IS NOT NULL THEN
    -- إثبات مرتجع الشراء (Debit للمورد - تخفيض دينه)
    INSERT INTO public.supplier_ledger (
      supplier_id, entry_type, debit, credit, balance_after,
      reference_type, reference_id, occurred_at, source_key, note, created_by
    ) VALUES (
      NEW.supplier_id,
      'PURCHASE_RETURN',
      round(NEW.total, 2),
      0,
      (SELECT balance FROM public.suppliers WHERE id = NEW.supplier_id),
      'purchase_return',
      NEW.id,
      coalesce(NEW.created_at, now()),
      'PRET-' || NEW.id::text,
      'مرتجع مشتريات رقم ' || NEW.return_number || coalesce(' - ' || NEW.note, ''),
      NEW.created_by
    ) ON CONFLICT (source_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_return_supplier_ledger ON public.purchase_returns;
CREATE TRIGGER trg_purchase_return_supplier_ledger
  AFTER INSERT ON public.purchase_returns
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_purchase_return_to_supplier_ledger();


-- ── 6. ترحيل البيانات التاريخية القائمة إن وُجدت (Backfill Idempotent) ───────
INSERT INTO public.supplier_ledger (
  supplier_id, entry_type, debit, credit, reference_type, reference_id, occurred_at, source_key, note, created_by
)
SELECT
  pi.supplier_id,
  'PURCHASE_INVOICE',
  0,
  round(pi.total, 2),
  'purchase_invoice',
  pi.id,
  pi.created_at,
  'PINV-' || pi.id::text,
  'فاتورة مشتريات رقم ' || pi.invoice_number || coalesce(' - ' || pi.note, ''),
  pi.created_by
FROM public.purchase_invoices pi
WHERE pi.supplier_id IS NOT NULL
ON CONFLICT (source_key) DO NOTHING;

INSERT INTO public.supplier_ledger (
  supplier_id, entry_type, debit, credit, reference_type, reference_id, occurred_at, source_key, note, created_by
)
SELECT
  pi.supplier_id,
  'PAYMENT',
  round(pi.paid, 2),
  0,
  'purchase_invoice_payment',
  pi.id,
  pi.created_at,
  'PINV-PAID-' || pi.id::text,
  'سداد فوري مرافق لفاتورة مشتريات ' || pi.invoice_number,
  pi.created_by
FROM public.purchase_invoices pi
WHERE pi.supplier_id IS NOT NULL AND coalesce(pi.paid, 0) > 0
ON CONFLICT (source_key) DO NOTHING;

INSERT INTO public.supplier_ledger (
  supplier_id, entry_type, debit, credit, reference_type, reference_id, occurred_at, source_key, note, created_by
)
SELECT
  pr.supplier_id,
  'PURCHASE_RETURN',
  round(pr.total, 2),
  0,
  'purchase_return',
  pr.id,
  pr.created_at,
  'PRET-' || pr.id::text,
  'مرتجع مشتريات رقم ' || pr.return_number || coalesce(' - ' || pr.note, ''),
  pr.created_by
FROM public.purchase_returns pr
WHERE pr.supplier_id IS NOT NULL
ON CONFLICT (source_key) DO NOTHING;


-- ── 7. دالة كشف حساب المورد مع الرصيد التراكمي المتحرك ───────────────────────
CREATE OR REPLACE FUNCTION public.get_supplier_statement(
  p_supplier_id uuid,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  occurred_at timestamptz,
  entry_type text,
  debit numeric,
  credit numeric,
  running_balance numeric,
  reference_type text,
  reference_id uuid,
  due_date date,
  note text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH ordered_entries AS (
    SELECT
      sl.id,
      sl.occurred_at,
      sl.entry_type,
      sl.debit,
      sl.credit,
      SUM(sl.credit - sl.debit) OVER (
        ORDER BY sl.occurred_at ASC, sl.id ASC
      ) AS running_balance,
      sl.reference_type,
      sl.reference_id,
      sl.due_date,
      sl.note
    FROM public.supplier_ledger sl
    WHERE sl.supplier_id = p_supplier_id
  )
  SELECT
    oe.id,
    oe.occurred_at,
    oe.entry_type,
    oe.debit,
    oe.credit,
    oe.running_balance,
    oe.reference_type,
    oe.reference_id,
    oe.due_date,
    oe.note
  FROM ordered_entries oe
  WHERE (p_start_date IS NULL OR oe.occurred_at >= p_start_date)
    AND (p_end_date IS NULL OR oe.occurred_at <= p_end_date)
  ORDER BY oe.occurred_at DESC, oe.id DESC;
$$;

COMMENT ON FUNCTION public.get_supplier_statement(uuid, timestamptz, timestamptz) IS
  'T-24: جلب كشف حساب المورد التفصيلي مع احتساب الرصيد التراكمي المستحق للمورد عبر الفترات.';
