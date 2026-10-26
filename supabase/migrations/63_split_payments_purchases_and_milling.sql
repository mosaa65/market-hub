-- Migration 63: الدفع المجزأ في المشتريات واستلام الطحن
-- Split payments for purchase invoices and milling service documents
--
-- WHY
-- ---
-- Migration 62 gave sales one honest split mechanism: its tenders are written to
-- `customer_payment_splits` and `post_sales_invoice` debits each tender to its
-- own ledger account (1101 / 1111 / 1131) while the unpaid remainder goes to
-- 1211. Purchases and milling intake were left with a single `payment_method`
-- column, so a purchase paid half cash and half bank could only be recorded
-- against ONE account: the other tender vanished from the ledger while the
-- trial balance still reconciled. That is the same class of silent error
-- migration 62 removed for sales, so it is fixed the same way here.
--
-- WHAT
-- ----
--  1. `payment_splits` — one row per (document, tender, amount) for purchase
--     invoices and milling service documents. A deferred trigger keeps the sum
--     of the tenders equal to the document's paid amount.
--  2. `post_purchase_invoice` — unchanged accounting, except the settlement
--     credit is split per tender when splits exist instead of posted to a
--     single account.
--  3. `create_purchase` gains `_payment_splits`; every older signature
--     delegates with an empty array, so no existing caller changes.
--  4. `create_milling_service_document_multi` gains `_payment_splits`.
--
-- The rules `create_sale` enforces for splits are enforced here too: every
-- tender is positive, no tender is `credit` (a receivable, not a tender), and
-- the tenders sum to at most the document total.

BEGIN;

-- ── 1. جدول تجزئة الدفعات للمستندات غير البيعية ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL CHECK (document_type IN ('purchase_invoice', 'milling_service_document')),
  document_id uuid NOT NULL,
  method public.payment_method NOT NULL,
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  reference text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_splits_not_credit CHECK (method <> 'credit'),
  CONSTRAINT payment_splits_not_split CHECK (method <> 'split')
);

CREATE INDEX IF NOT EXISTS payment_splits_document_idx
  ON public.payment_splits (document_type, document_id);

COMMENT ON TABLE public.payment_splits IS
  'تفصيل الدفعة الواحدة على أكثر من طريقة دفع. كل صف = طريقة تحصيل فعلية بمبلغها. الآجل لا يُسجّل هنا لأنه دين لا تحصيل.';


-- ── 2. بوابة التحقق: مجموع الأجزاء يجب أن يساوي المدفوع على المستند ─────────
-- A DEFERRED constraint trigger runs at COMMIT, so the inserting function may
-- write the header and then the tenders in whatever order it likes.

CREATE OR REPLACE FUNCTION public.assert_payment_splits_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_split_total numeric := 0;
  v_paid numeric;
  v_total numeric;
BEGIN
  SELECT round(coalesce(sum(amount), 0), 2) INTO v_split_total
    FROM public.payment_splits
   WHERE document_type = NEW.document_type AND document_id = NEW.document_id;

  IF NEW.document_type = 'purchase_invoice' THEN
    SELECT pi.paid, pi.total INTO v_paid, v_total
      FROM public.purchase_invoices pi WHERE pi.id = NEW.document_id;
  ELSE
    SELECT si.paid, si.total
      INTO v_paid, v_total
      FROM public.milling_service_documents d
      JOIN public.sales_invoices si ON si.id = d.sales_invoice_id
     WHERE d.id = NEW.document_id;
  END IF;

  IF v_total IS NULL THEN
    RAISE EXCEPTION 'Record the document before its payment split';
  END IF;
  IF v_split_total > round(v_total, 2) THEN
    RAISE EXCEPTION 'Payment split total (%) exceeds the document total (%)',
      v_split_total, round(v_total, 2);
  END IF;
  IF v_split_total <> round(coalesce(v_paid, 0), 2) THEN
    RAISE EXCEPTION 'Payment split total (%) does not match the paid amount (%)',
      v_split_total, round(coalesce(v_paid, 0), 2);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_splits_balance ON public.payment_splits;
CREATE CONSTRAINT TRIGGER trg_payment_splits_balance
  AFTER INSERT OR UPDATE ON public.payment_splits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_payment_splits_balance();


-- ── 3. ترحيل فاتورة الشراء: كل طريقة تحصيل إلى حسابها ────────────────────────
-- Body preserved from migration 43 (the authoritative version) except the single
-- settlement credit, which becomes one credit per tender when a split exists.

CREATE OR REPLACE FUNCTION public.post_purchase_invoice(p_invoice_id uuid)
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
  v_split_acct text;
  v_owed     numeric := 0;
  v_has_splits boolean := false;
  r         record;
  r_split   record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
          OR public.has_role(v_user,'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may post a purchase invoice';
  END IF;

  SELECT * INTO v_inv FROM public.purchase_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase invoice not found';
  END IF;

  IF v_inv.status IN ('draft','cancelled') THEN
    RAISE EXCEPTION 'Purchase % is % - only confirmed, paid or partial invoices post',
      v_inv.invoice_number, v_inv.status;
  END IF;

  IF v_inv.paid < 0 THEN
    RAISE EXCEPTION 'Purchase % carries a negative payment (%). A supplier return is a return document, not a negative payment.',
      v_inv.invoice_number, v_inv.paid;
  END IF;
  IF v_inv.paid > v_inv.total THEN
    RAISE EXCEPTION 'Purchase % was paid % against a total of %. Fix the invoice before posting - a payment cannot exceed the invoice.',
      v_inv.invoice_number, v_inv.paid, v_inv.total;
  END IF;

  SELECT id INTO v_existing
    FROM public.journal_entries
   WHERE source_type = 'purchase_invoice' AND source_id = p_invoice_id
     AND status <> 'REVERSED';
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase % has already been posted to the ledger', v_inv.invoice_number;
  END IF;

  -- P0: نداء موضعي على المصدر مباشرة، فلا يتأثر بأي اسم وسيط.
  v_cash_acct := public.payment_method_ledger_account(v_inv.payment_method::text);
  v_owed := greatest(v_inv.total - v_inv.paid, 0);

  FOR r IN
    SELECT coalesce(p.item_class::text, 'UNCLASSIFIED') AS item_class,
           coalesce(it.stock_effect, 'NONE') AS effect,
           sum(it.total)                     AS amount,
           sum(it.tax)                       AS line_tax
      FROM public.purchase_invoice_items it
      LEFT JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
     GROUP BY coalesce(p.item_class::text, 'UNCLASSIFIED'), coalesce(it.stock_effect, 'NONE')
    HAVING sum(it.total) <> 0 OR sum(it.tax) <> 0
  LOOP
    IF r.amount <> 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', CASE
          WHEN r.effect <> 'STOCK_RECEIPT' THEN '5911'
          ELSE CASE r.item_class
                 WHEN 'RAW_MATERIAL'  THEN '1311'
                 WHEN 'BY_PRODUCT'    THEN '1314'
                 WHEN 'FINISHED_GOOD' THEN '1313'
                 ELSE '1315' END END,
        'debit', round(r.amount, 2),
        'memo', CASE WHEN r.effect <> 'STOCK_RECEIPT'
                     THEN 'مصروف مشتريات ' || r.item_class
                     ELSE 'شراء ' || r.item_class END);
    END IF;

    IF r.line_tax <> 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', '1316', 'debit', round(r.line_tax, 2),
        'memo', 'ضريبة مدخلات قابلة للاسترداد');
    END IF;
  END LOOP;

  IF v_inv.tax <> 0 AND NOT EXISTS (
       SELECT 1 FROM public.purchase_invoice_items it
        WHERE it.invoice_id = p_invoice_id AND it.tax <> 0) THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1316', 'debit', round(v_inv.tax, 2),
      'memo', 'ضريبة مدخلات قابلة للاسترداد');
  END IF;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Purchase % has nothing to post - its lines are empty or zero',
      v_inv.invoice_number;
  END IF;

  IF v_owed > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2111', 'credit', round(v_owed, 2),
      'memo', 'مستحق للمورد',
      'partner_type', 'supplier',
      'partner_id', v_inv.supplier_id);
  END IF;

  -- ── السداد: إمّا حساب واحد (السلوك السابق) أو حساب لكل طريقة ──
  SELECT EXISTS (
    SELECT 1 FROM public.payment_splits
     WHERE document_type = 'purchase_invoice' AND document_id = p_invoice_id
  ) INTO v_has_splits;

  IF v_inv.paid > 0 AND v_has_splits THEN
    FOR r_split IN
      SELECT method::text AS method, round(sum(amount), 2) AS amount
        FROM public.payment_splits
       WHERE document_type = 'purchase_invoice' AND document_id = p_invoice_id
       GROUP BY method
    LOOP
      v_split_acct := public.payment_method_ledger_account(r_split.method);
      IF v_split_acct IS NOT NULL AND r_split.amount > 0 THEN
        v_lines := v_lines || jsonb_build_object(
          'account_code', v_split_acct,
          'credit', r_split.amount,
          'memo', 'سداد للمورد (دفع مجزأ) — ' || r_split.method);
      END IF;
    END LOOP;
  ELSIF v_inv.paid > 0 AND v_cash_acct IS NOT NULL THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_cash_acct, 'credit', round(v_inv.paid, 2),
      'memo', 'سداد للمورد');
  END IF;

  v_entry := public.create_journal_entry(
    p_memo => 'فاتورة مشتريات ' || v_inv.invoice_number,
    p_entry_date => v_inv.created_at::date,
    p_source_type => 'purchase_invoice',
    p_source_id => p_invoice_id,
    p_is_system => true,
    p_lines => v_lines);

  RETURN v_entry;
END $$;

COMMENT ON FUNCTION public.post_purchase_invoice(uuid) IS
  'يرحّل فاتورة شراء واحدة بقيود متوازنة، ويوزّع السداد على حساب كل طريقة دفع عند وجود تجزئة.';

GRANT EXECUTE ON FUNCTION public.post_purchase_invoice(uuid) TO authenticated, service_role;


-- ── 4. create_purchase: توقيع يقبل تجزئة الدفع ─────────────────────────────
-- Body preserved from migration 43 (system-supplier guard, v_paid clamp), plus
-- split validation and the payment_splits rows.

CREATE OR REPLACE FUNCTION public.create_purchase(
  _warehouse_id uuid,
  _supplier_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb,
  _payment_splits jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id       uuid;
  v_invoice_no       text;
  v_user             uuid := auth.uid();
  v_item             jsonb;
  v_subtotal         numeric := 0;
  v_tax_total        numeric := 0;
  v_total            numeric := 0;
  v_qty              numeric;
  v_cost             numeric;
  v_tax_rate         numeric;
  v_line_total       numeric;
  v_line_tax         numeric;
  v_product          uuid;
  v_effect           text;
  v_type             text;
  v_purchasable      boolean;
  v_system           boolean := false;
  v_supplier_balance numeric;
  v_paid             numeric;
  v_split            record;
  v_split_total      numeric := 0;
  v_split_count      integer := 0;
  v_recorded_method  text := coalesce(_payment_method, 'cash');
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse required';
  END IF;
  IF _supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier required';
  END IF;
  IF coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;

  ------------------------------------------------------------------ validate
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty      := (v_item ->> 'quantity')::numeric;
    v_cost     := (v_item ->> 'unit_cost')::numeric;
    v_tax_rate := coalesce((v_item ->> 'tax_rate')::numeric, 0);

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity';
    END IF;
    IF v_cost IS NULL OR v_cost < 0 THEN
      RAISE EXCEPTION 'Invalid unit cost';
    END IF;
    IF v_tax_rate < 0 OR v_tax_rate > 100 THEN
      RAISE EXCEPTION 'Invalid tax rate';
    END IF;
    IF (v_item ->> 'product_id') IS NOT NULL THEN
      SELECT p.is_purchasable INTO v_purchasable
      FROM public.products p WHERE p.id = (v_item ->> 'product_id')::uuid;

      IF v_purchasable IS NOT TRUE THEN
        RAISE EXCEPTION 'Item % is not marked as purchasable', v_item ->> 'product_id';
      END IF;
    END IF;

    v_line_total := v_qty * v_cost;
    v_line_tax   := v_line_total * v_tax_rate / 100;
    v_subtotal   := v_subtotal + v_line_total;
    v_tax_total  := v_tax_total + v_line_tax;
  END LOOP;

  v_total := v_subtotal + v_tax_total - coalesce(_discount, 0);

  -- ── التحقق من تجزئة الدفع قبل أي إدراج ──
  IF coalesce(jsonb_typeof(_payment_splits), '') = 'array'
     AND jsonb_array_length(_payment_splits) > 0 THEN
    FOR v_split IN
      SELECT part ->> 'method' AS method,
             coalesce((part ->> 'amount')::numeric, 0) AS amount
        FROM jsonb_array_elements(_payment_splits) AS part
    LOOP
      IF v_split.method IS NULL
         OR v_split.method NOT IN ('cash', 'card', 'bank_transfer', 'mobile_money', 'cheque') THEN
        RAISE EXCEPTION 'Unsupported purchase split method: %', v_split.method;
      END IF;
      IF v_split.amount <= 0 THEN
        RAISE EXCEPTION 'Every purchase payment tender requires a positive amount';
      END IF;
      v_split_total := v_split_total + v_split.amount;
      v_split_count := v_split_count + 1;
    END LOOP;

    IF round(v_split_total, 2) > round(v_total, 2) THEN
      RAISE EXCEPTION 'Purchase payment split total (%) exceeds the invoice total (%)',
        round(v_split_total, 2), round(v_total, 2);
    END IF;

    IF v_split_count > 1 THEN
      v_recorded_method := 'split';
    END IF;
  END IF;

  SELECT balance, is_system INTO v_supplier_balance, v_system
    FROM public.suppliers WHERE id = _supplier_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected supplier is unavailable';
  END IF;

  -- مع التجزئة، المدفوع هو مجموع الأجزاء نفسها، لا رقم يخمّنه العميل.
  v_paid := CASE
              WHEN v_split_count > 0 THEN round(v_split_total, 2)
              ELSE least(coalesce(_paid, 0), v_total)
            END;

  IF v_paid < 0 OR v_paid > v_total THEN
    RAISE EXCEPTION 'Paid amount (%) must be between zero and the invoice total (%)', v_paid, v_total;
  END IF;

  IF v_paid < v_total AND v_system THEN
    RAISE EXCEPTION
      'The system cash supplier cannot carry a payable balance — record a paid purchase or choose a real supplier'
      USING ERRCODE = 'check_violation';
  END IF;

  v_invoice_no := public.next_purchase_number();

  INSERT INTO public.purchase_invoices (
    invoice_number, supplier_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by
  )
  VALUES (
    v_invoice_no, _supplier_id, _warehouse_id,
    'confirmed'::public.invoice_status,
    public.derive_payment_status(v_paid, v_total),
    v_subtotal, coalesce(_discount, 0), v_tax_total, v_total, v_paid,
    v_recorded_method::public.payment_method, nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_invoice_id;

  --------------------------------------------------------------------- post
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_product  := (v_item ->> 'product_id')::uuid;
    v_qty      := (v_item ->> 'quantity')::numeric;
    v_cost     := (v_item ->> 'unit_cost')::numeric;
    v_tax_rate := coalesce((v_item ->> 'tax_rate')::numeric, 0);

    v_line_total := v_qty * v_cost;
    v_line_tax   := v_line_total * v_tax_rate / 100;

    SELECT r.o_line_type, r.o_stock_effect
      INTO v_type, v_effect
    FROM public.resolve_purchase_line(v_item) AS r;

    INSERT INTO public.purchase_invoice_items (
      invoice_id, product_id, quantity, unit_cost, discount, tax, total,
      line_type, stock_effect
    )
    VALUES (
      v_invoice_id, v_product, v_qty, v_cost, 0, v_line_tax, v_line_total + v_line_tax,
      v_type, v_effect
    );

    IF v_effect = 'STOCK_RECEIPT' AND v_product IS NOT NULL THEN
      PERFORM public.post_stock_delta(
        v_product,
        _warehouse_id,
        v_qty,
        v_cost,
        'RECEIPT'::public.stock_movement_kind,
        'purchase_invoice',
        v_invoice_id,
        'Purchase receipt',
        'COMPANY'::public.owner_type,
        NULL,
        'purchase'::public.movement_type
      );
    END IF;
  END LOOP;

  -- سجلات التجزئة — الحارس المؤجل يتحقق من مطابقة المدفوع عند الالتزام.
  IF v_split_count > 0 THEN
    FOR v_split IN
      SELECT part ->> 'method' AS method,
             coalesce((part ->> 'amount')::numeric, 0) AS amount,
             nullif(btrim(coalesce(part ->> 'reference', '')), '') AS reference
        FROM jsonb_array_elements(_payment_splits) AS part
    LOOP
      INSERT INTO public.payment_splits (
        document_type, document_id, method, amount, reference, created_by
      )
      VALUES (
        'purchase_invoice', v_invoice_id,
        v_split.method::public.payment_method,
        round(v_split.amount, 2), v_split.reference, v_user
      );
    END LOOP;
  END IF;

  IF v_paid < v_total THEN
    UPDATE public.suppliers
    SET balance = balance + (v_total - v_paid), updated_at = now()
    WHERE id = _supplier_id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'purchase.posted', 'purchase_invoice', v_invoice_id,
    jsonb_build_object(
      'invoice_number', v_invoice_no,
      'supplier_id', _supplier_id,
      'warehouse_id', _warehouse_id,
      'total', v_total,
      'paid', v_paid,
      'line_count', jsonb_array_length(_items),
      'has_splits', v_split_count > 0,
      'split_count', v_split_count
    ));

  PERFORM public.post_purchase_invoice(v_invoice_id);

  RETURN v_invoice_id;
END $function$;

GRANT EXECUTE ON FUNCTION public.create_purchase(uuid, uuid, text, numeric, numeric, text, jsonb, jsonb) TO authenticated, service_role;


-- ── 5. النسخ القديمة تمرّر تجزئة فارغة (توافق عكسي كامل) ────────────────────
-- PostgREST resolves an RPC by the JSON keys it receives, so the wrapper that
-- declares `_cashbox_id … _payment_method_id` also catches every call made with
-- any subset of those four keys.

CREATE OR REPLACE FUNCTION public.create_purchase(
  _warehouse_id uuid,
  _supplier_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb,
  _cashbox_id uuid DEFAULT NULL,
  _bank_account_id uuid DEFAULT NULL,
  _payment_reference text DEFAULT NULL,
  _payment_method_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id uuid;
  v_resolved_cashbox uuid := _cashbox_id;
BEGIN
  -- نفس سلوك النسخة السابقة: الصندوق الافتراضي للدفع النقدي عند غيابه.
  IF _payment_method = 'cash' AND v_resolved_cashbox IS NULL THEN
    SELECT id INTO v_resolved_cashbox
      FROM public.cashboxes
     WHERE is_active = true AND is_default = true
     LIMIT 1;
    IF v_resolved_cashbox IS NULL THEN
      SELECT id INTO v_resolved_cashbox FROM public.cashboxes
       WHERE is_active = true ORDER BY created_at ASC LIMIT 1;
    END IF;
  END IF;

  v_invoice_id := public.create_purchase(
    _warehouse_id, _supplier_id, _payment_method, _paid, _discount, _note, _items,
    '[]'::jsonb
  );

  UPDATE public.purchase_invoices
     SET cashbox_id = v_resolved_cashbox,
         bank_account_id = _bank_account_id,
         payment_reference = nullif(btrim(_payment_reference), ''),
         payment_method_id = _payment_method_id
   WHERE id = v_invoice_id;

  RETURN v_invoice_id;
END $function$;

CREATE OR REPLACE FUNCTION public.create_purchase(
  _warehouse_id uuid,
  _supplier_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.create_purchase(
    _warehouse_id, _supplier_id, _payment_method, _paid, _discount, _note, _items,
    '[]'::jsonb
  );
$function$;


-- ── 6. استلام الطحن: تجزئة الدفع للسند ──────────────────────

CREATE OR REPLACE FUNCTION public.create_milling_service_document_multi(
  _customer_id uuid,
  _warehouse_id uuid,
  _grains jsonb,
  _service_item_id uuid,
  _service_unit_price numeric,
  _discount numeric,
  _payment_method text,
  _paid numeric,
  _notes text,
  _payment_splits jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_document_id uuid;
  v_document_number text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_subtotal numeric;
  v_total numeric;
  v_paid numeric;
  v_outstanding numeric;
  v_customer_balance numeric;
  v_credit_limit numeric;
  v_is_system boolean := false;
  v_split record;
  v_split_total numeric := 0;
  v_split_count integer := 0;
  v_recorded_method text := coalesce(_payment_method, 'cash');
  r record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to create milling service documents';
  END IF;
  IF _customer_id IS NULL OR _warehouse_id IS NULL OR _service_item_id IS NULL THEN
    RAISE EXCEPTION 'Customer, warehouse and service are required';
  END IF;
  IF _grains IS NULL OR jsonb_typeof(_grains) <> 'array' OR jsonb_array_length(_grains) = 0 THEN
    RAISE EXCEPTION 'At least one grain line is required';
  END IF;
  IF coalesce(_service_unit_price, 0) < 0 OR coalesce(_discount, 0) < 0
     OR coalesce(_paid, 0) < 0 THEN
    RAISE EXCEPTION 'Service price, discount and paid amount cannot be negative';
  END IF;
  IF _payment_method NOT IN ('cash', 'card', 'bank_transfer', 'credit', 'mobile_money', 'split') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  -- تجزئة الدفع: طرق تحصيل فقط، بمبالغ موجبة
  IF coalesce(jsonb_typeof(_payment_splits), '') = 'array'
     AND jsonb_array_length(_payment_splits) > 0 THEN
    FOR v_split IN
      SELECT part ->> 'method' AS method,
             coalesce((part ->> 'amount')::numeric, 0) AS amount
        FROM jsonb_array_elements(_payment_splits) AS part
    LOOP
      IF v_split.method IS NULL
         OR v_split.method NOT IN ('cash', 'card', 'bank_transfer', 'mobile_money', 'cheque') THEN
        RAISE EXCEPTION 'Unsupported milling split method: %', v_split.method;
      END IF;
      IF v_split.amount <= 0 THEN
        RAISE EXCEPTION 'Every milling payment tender requires a positive amount';
      END IF;
      v_split_total := v_split_total + v_split.amount;
      v_split_count := v_split_count + 1;
    END LOOP;
    IF v_split_count > 1 THEN
      v_recorded_method := 'split';
    END IF;
  END IF;

  -- تحقق أسطر الحبوب: منتج أمانات + كمية موجبة
  FOR r IN SELECT * FROM jsonb_to_recordset(_grains) AS g(item_id uuid, bags numeric, kg numeric)
  LOOP
    IF r.item_id IS NULL THEN
      RAISE EXCEPTION 'Every grain line needs an item';
    END IF;
    IF coalesce(r.bags, 0) < 0 OR coalesce(r.kg, 0) < 0 THEN
      RAISE EXCEPTION 'Grain quantities cannot be negative';
    END IF;
    IF coalesce(r.bags, 0) = 0 AND coalesce(r.kg, 0) = 0 THEN
      RAISE EXCEPTION 'Every grain line needs a positive quantity';
    END IF;
  END LOOP;

  SELECT balance, credit_limit, is_system
    INTO v_customer_balance, v_credit_limit, v_is_system
    FROM public.customers
   WHERE id = _customer_id AND is_active = true
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected customer is unavailable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = _warehouse_id AND is_active) THEN
    RAISE EXCEPTION 'Selected warehouse is unavailable';
  END IF;

  v_subtotal := round(coalesce(_service_unit_price, 0), 2);
  v_total := round(v_subtotal - coalesce(_discount, 0), 2);
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Discount cannot exceed the service fee';
  END IF;

  IF v_split_count > 0 THEN
    IF round(v_split_total, 2) > v_total THEN
      RAISE EXCEPTION 'Milling payment split total (%) exceeds the fee total (%)',
        round(v_split_total, 2), v_total;
    END IF;
    v_paid := round(v_split_total, 2);
  ELSE
    v_paid := least(round(coalesce(_paid, 0), 2), v_total);
  END IF;

  v_outstanding := round(v_total - v_paid, 2);
  IF _payment_method = 'credit' AND v_split_count = 0 AND v_paid <> 0 THEN
    RAISE EXCEPTION 'Credit payment method requires zero paid amount';
  END IF;
  IF v_outstanding > 0 AND v_is_system THEN
    RAISE EXCEPTION
      'The system cash customer cannot carry credit — select a real customer for a deferred ticket'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_outstanding > 0 AND NOT public.customer_credit_limit_allows(_customer_id, v_outstanding) THEN
    RAISE EXCEPTION
      'Credit limit exceeded: current balance %, requested debt %, limit %',
      coalesce(v_customer_balance, 0), v_outstanding, coalesce(v_credit_limit, 0);
  END IF;

  v_invoice_number := public.next_invoice_number();
  INSERT INTO public.sales_invoices (
    invoice_number, customer_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by
  ) VALUES (
    v_invoice_number, _customer_id, _warehouse_id, 'confirmed',
    public.derive_payment_status(v_paid, v_total),
    v_subtotal, round(coalesce(_discount, 0), 2), 0, v_total, v_paid,
    v_recorded_method::public.payment_method, nullif(btrim(_notes), ''), v_user
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.sales_invoice_items (
    invoice_id, product_id, description, quantity, unit_price, discount, tax, total,
    line_type, stock_effect
  ) VALUES (
    v_invoice_id, _service_item_id, 'أجور طحن وتجهيز', 1, v_subtotal,
    0, 0, v_subtotal, 'SERVICE', 'NONE'
  );

  IF v_outstanding > 0 THEN
    UPDATE public.customers
    SET balance = round(coalesce(balance, 0) + v_outstanding, 2), updated_at = now()
    WHERE id = _customer_id;

    INSERT INTO public.customer_ledger (
      customer_id, entry_type, debit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    ) VALUES (
      _customer_id, 'sale', v_outstanding, v_invoice_id, 'sales_invoice',
      now(), v_user, 'sale:' || v_invoice_id, 'قيد أجور طحن آجل'
    ) ON CONFLICT (source_key) DO NOTHING;
  END IF;

  v_document_number := 'MT-' || to_char(now(), 'YYYYMM') || '-' ||
    lpad(nextval('public.milling_document_seq')::text, 4, '0');
  INSERT INTO public.milling_service_documents (
    document_number, customer_id, warehouse_id, sales_invoice_id, created_by
  ) VALUES (
    v_document_number, _customer_id, _warehouse_id, v_invoice_id, v_user
  ) RETURNING id INTO v_document_id;

  -- أجزاء الدفع تُسجّل قبل الترحيل ليقرأها post_sales_invoice ويوزّعها على الحسابات.
  IF v_split_count > 0 THEN
    FOR v_split IN
      SELECT part ->> 'method' AS method,
             coalesce((part ->> 'amount')::numeric, 0) AS amount
        FROM jsonb_array_elements(_payment_splits) AS part
    LOOP
      INSERT INTO public.payment_splits (
        document_type, document_id, method, amount, created_by
      ) VALUES (
        'milling_service_document', v_document_id,
        v_split.method::public.payment_method, round(v_split.amount, 2), v_user
      );
    END LOOP;
  END IF;

  PERFORM public.post_sales_invoice(v_invoice_id);

  FOR r IN SELECT * FROM jsonb_to_recordset(_grains) AS g(item_id uuid, bags numeric, kg numeric)
  LOOP
    INSERT INTO public.custody_ledger (
      customer_id, warehouse_id, entry_type, item_id, doc_number,
      bags_in, kg_in, milling_document_id, notes, created_by
    ) VALUES (
      _customer_id, _warehouse_id, 'INTAKE', r.item_id, v_document_number,
      coalesce(r.bags, 0), coalesce(r.kg, 0), v_document_id, _notes, v_user
    );
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'milling.service_document.created', 'milling_service_documents', v_document_id,
    jsonb_build_object(
      'document_number', v_document_number,
      'invoice_id', v_invoice_id,
      'grains', _grains,
      'service_total', v_total,
      'paid', v_paid,
      'outstanding', v_outstanding,
      'has_splits', v_split_count > 0,
      'split_count', v_split_count,
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN jsonb_build_object(
    'document_id', v_document_id,
    'document_number', v_document_number,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.create_milling_service_document_multi(uuid, uuid, jsonb, uuid, numeric, numeric, text, numeric, text, jsonb) TO authenticated, service_role;


-- النسخة التسعيّة القديمة تمرّر مصفوفة فارغة.
CREATE OR REPLACE FUNCTION public.create_milling_service_document_multi(
  _customer_id uuid,
  _warehouse_id uuid,
  _grains jsonb,
  _service_item_id uuid,
  _service_unit_price numeric,
  _discount numeric,
  _payment_method text,
  _paid numeric,
  _notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.create_milling_service_document_multi(
    _customer_id, _warehouse_id, _grains, _service_item_id, _service_unit_price,
    _discount, _payment_method, _paid, _notes, '[]'::jsonb
  );
END $function$;


-- ── 7. تحصيل ذم العملاء على أكثر من طريقة ─────────────────────────────
-- The collection screen may take one debt in several tenders. Each tender is a
-- real `customer_payments` row (so it appears in the customer ledger and in
-- every treasury report exactly once), and the journal debits each tender's own
-- account instead of a single settlement account.
--
-- The wrapper below also owns the treasury columns (`cashbox_id`,
-- `bank_account_id`, `payment_method_id`, cheque fields) for every call, so the
-- 12-argument overload from migration 32 — which no longer has a body of its own
-- — resolves here with and without those keys.

CREATE OR REPLACE FUNCTION public.record_customer_payment_splits(
  _customer_id uuid,
  _invoice_id uuid,
  _amount numeric,
  _payment_date date,
  _note text,
  _splits jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_total numeric := 0;
  v_split_total numeric := 0;
  v_split_count integer := 0;
  v_method_id text;
  v_stored_method text;
  v_account text;
  v_amount numeric;
  v_payment_id uuid;
  v_last_id uuid;
  v_remaining numeric;
  v_invoice record;
  v_inv_cur record;
  v_allocation numeric;
  v_lines jsonb := '[]'::jsonb;
  r_split record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'accountant')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to record customer payments';
  END IF;

  IF _customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required';
  END IF;

  -- ── التحقق من الأجزاء ──
  IF coalesce(jsonb_typeof(_splits), '') <> 'array'
     OR jsonb_array_length(_splits) < 2 THEN
    RAISE EXCEPTION 'A split collection requires at least two tenders';
  END IF;

  FOR r_split IN
    SELECT part ->> 'methodId' AS method_id,
           part ->> 'method' AS method,
           coalesce((part ->> 'amount')::numeric, 0) AS amount,
           nullif(btrim(coalesce(part ->> 'reference', '')), '') AS reference
      FROM jsonb_array_elements(_splits) AS part
  LOOP
    IF r_split.amount <= 0 THEN
      RAISE EXCEPTION 'Every collection tender requires a positive amount';
    END IF;

    -- الآجل ليس تحصيلاً: يُرفض هنا لأن التحصيل لا يُنشئ ديناً جديداً.
    v_method_id := coalesce(r_split.method_id, r_split.method);
    v_stored_method := public.resolve_writable_payment_method(
      v_method_id, 'customer_collection', true
    );
    IF v_stored_method = 'credit' THEN
      RAISE EXCEPTION 'A collection cannot record آجل — that is a deferred sale, not a receipt';
    END IF;

    v_split_total := v_split_total + r_split.amount;
    v_split_count := v_split_count + 1;
  END LOOP;

  v_total := round(v_split_total, 2);

  IF _amount IS NOT NULL AND round(_amount, 2) <> v_total THEN
    RAISE EXCEPTION 'Collection total (%) does not match the sum of its tenders (%)',
      round(_amount, 2), v_total;
  END IF;

  -- ── التحقق من سقف الدين قبل أي إدراج ──
  PERFORM 1 FROM public.customers
   WHERE id = _customer_id AND is_active = true
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer is unavailable';
  END IF;

  IF _invoice_id IS NOT NULL THEN
    SELECT id, total, paid, customer_id INTO v_invoice
      FROM public.sales_invoices WHERE id = _invoice_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;
    IF v_invoice.customer_id IS DISTINCT FROM _customer_id THEN
      RAISE EXCEPTION 'Invoice does not belong to this customer';
    END IF;
    IF v_invoice.total - v_invoice.paid <= 0 THEN
      RAISE EXCEPTION 'Invoice has no outstanding balance';
    END IF;
    IF v_total > (v_invoice.total - v_invoice.paid + 0.01) THEN
      RAISE EXCEPTION 'Payment exceeds the invoice outstanding balance';
    END IF;
  END IF;

  -- ── إدراج صف لكل طريقة (يظهر في دفتر العميل والخزينة مرة واحدة) ──
  v_remaining := v_total;

  FOR r_split IN
    SELECT part ->> 'methodId' AS method_id,
           part ->> 'method' AS method,
           coalesce((part ->> 'amount')::numeric, 0) AS amount,
           nullif(btrim(coalesce(part ->> 'reference', '')), '') AS reference
      FROM jsonb_array_elements(_splits) AS part
  LOOP
    v_method_id := coalesce(r_split.method_id, r_split.method);
    v_stored_method := public.resolve_writable_payment_method(
      v_method_id, 'customer_collection', true
    );
    v_account := public.resolve_document_settlement_account(v_stored_method, NULL, NULL, v_method_id);
    v_amount := round(r_split.amount, 2);

    INSERT INTO public.customer_payments (
      customer_id, invoice_id, amount, payment_method, payment_date, note, created_by,
      payment_method_id, payment_reference
    )
    VALUES (
      _customer_id, _invoice_id, v_amount, v_stored_method::public.payment_method,
      coalesce(_payment_date, current_date),
      nullif(trim(concat_ws(' — ', _note, r_split.reference)), ''),
      v_user, v_method_id, r_split.reference
    )
    RETURNING id INTO v_payment_id;

    v_last_id := v_payment_id;

    INSERT INTO public.customer_ledger(
      customer_id, entry_type, credit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    )
    VALUES (
      _customer_id, 'payment', v_amount, v_payment_id, 'customer_payment',
      coalesce(_payment_date, current_date)::timestamptz, v_user,
      'payment:' || v_payment_id,
      coalesce(nullif(trim(_note), ''), 'دفعة عميل (دفع مجزأ)')
    )
    ON CONFLICT (source_key) DO NOTHING;

    IF v_account IS NOT NULL THEN
      v_lines := v_lines
        || jsonb_build_object(
             'account_code', v_account, 'debit', v_amount,
             'memo', 'تحصيل من عميل (دفع مجزأ) — ' || v_stored_method)
        || jsonb_build_object(
             'account_code', '1211', 'credit', v_amount,
             'memo', 'تحصيل ذمة عميل');
    END IF;

    -- تخصيص لفاتورة محددة
    IF _invoice_id IS NOT NULL THEN
      UPDATE public.sales_invoices
      SET paid = paid + v_amount,
          status = 'confirmed'::public.invoice_status,
          payment_status = public.derive_payment_status(paid + v_amount, total),
          updated_at = now()
      WHERE id = _invoice_id;
    END IF;
  END LOOP;

  -- توزيع تلقائي على الأقدم أولاً عندما لا تُحدد فاتورة
  IF _invoice_id IS NULL THEN
    FOR v_inv_cur IN
      SELECT id, total, paid
      FROM public.sales_invoices
      WHERE customer_id = _customer_id
        AND total > paid
        AND status NOT IN ('cancelled'::public.invoice_status, 'returned'::public.invoice_status)
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_allocation := least(v_remaining, v_inv_cur.total - v_inv_cur.paid);

      UPDATE public.sales_invoices
      SET paid = paid + v_allocation,
          status = 'confirmed'::public.invoice_status,
          payment_status = public.derive_payment_status(paid + v_allocation, total),
          updated_at = now()
      WHERE id = v_inv_cur.id;

      v_remaining := v_remaining - v_allocation;
    END LOOP;
  END IF;

  IF jsonb_array_length(v_lines) > 0 THEN
    PERFORM public.create_journal_entry(
      'تحصيل من عميل — ' || coalesce(nullif(trim(_note), ''), ''),
      coalesce(_payment_date, current_date),
      'customer_payment', v_last_id, true, v_lines);
  END IF;

  RETURN v_last_id;
END $function$;

GRANT EXECUTE ON FUNCTION public.record_customer_payment_splits(uuid, uuid, numeric, date, text, jsonb) TO authenticated, service_role;

-- ── 8. تحصيل بطريقة واحدة: التوقيع الكامل (12 وسيطاً) يوجّه للتجزئة ────────
-- This is the overload the collection screen calls for a single tender. It owns
-- the treasury columns, so `record_customer_payment` exists exactly once and a
-- call with or without `_cashbox_id … _cheque_drawer` lands here.

CREATE OR REPLACE FUNCTION public.record_customer_payment(
  _customer_id uuid,
  _invoice_id uuid,
  _amount numeric,
  _method text,
  _payment_date date,
  _note text,
  _cashbox_id uuid DEFAULT NULL,
  _bank_account_id uuid DEFAULT NULL,
  _payment_method_id text DEFAULT NULL,
  _cheque_number text DEFAULT NULL,
  _cheque_bank text DEFAULT NULL,
  _cheque_due_date date DEFAULT NULL,
  _cheque_drawer text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_amount numeric := round(coalesce(_amount, 0), 2);
  v_method_id text;
  v_stored_method text;
  v_account text;
  v_payment_id uuid;
  v_customer_balance numeric;
  v_invoice record;
  v_remaining numeric;
  v_inv_cur record;
  v_allocation numeric;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'accountant')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to record customer payments';
  END IF;
  IF _customer_id IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'A customer and a positive amount are required';
  END IF;

  v_method_id := coalesce(_payment_method_id, _method);
  v_stored_method := public.resolve_writable_payment_method(
    v_method_id, 'customer_collection', true
  );
  IF v_stored_method = 'credit' THEN
    RAISE EXCEPTION 'A collection cannot record آجل — that is a deferred sale, not a receipt';
  END IF;

  SELECT balance INTO v_customer_balance
    FROM public.customers
   WHERE id = _customer_id AND is_active = true
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer is unavailable';
  END IF;

  v_account := public.resolve_document_settlement_account(
    v_stored_method, _cashbox_id, _bank_account_id, v_method_id
  );

  ------------------------------------------------------------------ one invoice
  IF _invoice_id IS NOT NULL THEN
    SELECT id, total, paid, customer_id INTO v_invoice
      FROM public.sales_invoices WHERE id = _invoice_id FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;
    IF v_invoice.customer_id IS DISTINCT FROM _customer_id THEN
      RAISE EXCEPTION 'Invoice does not belong to this customer';
    END IF;
    IF v_invoice.total - v_invoice.paid <= 0 THEN
      RAISE EXCEPTION 'Invoice has no outstanding balance';
    END IF;
    IF v_amount > (v_invoice.total - v_invoice.paid + 0.01) THEN
      RAISE EXCEPTION 'Payment exceeds the invoice outstanding balance';
    END IF;

    INSERT INTO public.customer_payments (
      customer_id, invoice_id, amount, payment_method, payment_date, note, created_by,
      cashbox_id, bank_account_id, payment_method_id, payment_reference
    )
    VALUES (
      _customer_id, _invoice_id, v_amount, v_stored_method::public.payment_method,
      coalesce(_payment_date, current_date), nullif(trim(_note), ''), v_user,
      _cashbox_id, _bank_account_id, v_method_id, _cheque_number
    )
    RETURNING id INTO v_payment_id;

    IF (v_stored_method = 'cheque' OR v_method_id = 'cheque') AND _cheque_number IS NOT NULL THEN
      INSERT INTO public.cheques_register (
        cheque_number, bank_name, drawer_name, due_date, amount, status,
        customer_id, invoice_id, payment_id, notes, created_by
      )
      VALUES (
        _cheque_number, coalesce(_cheque_bank, 'شيك مصرفي'), _cheque_drawer,
        coalesce(_cheque_due_date, CURRENT_DATE), v_amount, 'UNDER_COLLECTION',
        _customer_id, _invoice_id, v_payment_id, _note, v_user
      );
    END IF;

    INSERT INTO public.customer_ledger(
      customer_id, entry_type, credit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    )
    VALUES (
      _customer_id, 'payment', v_amount, v_payment_id, 'customer_payment',
      coalesce(_payment_date, current_date)::timestamptz, v_user,
      'payment:' || v_payment_id,
      coalesce(nullif(trim(_note), ''), 'دفعة عميل')
    )
    ON CONFLICT (source_key) DO NOTHING;

    UPDATE public.sales_invoices
    SET paid = paid + v_amount,
        status = 'confirmed'::public.invoice_status,
        payment_status = public.derive_payment_status(paid + v_amount, total),
        updated_at = now()
    WHERE id = _invoice_id;

  ----------------------------------------------------------------- auto allocation
  ELSE
    INSERT INTO public.customer_payments (
      customer_id, invoice_id, amount, payment_method, payment_date, note, created_by,
      cashbox_id, bank_account_id, payment_method_id, payment_reference
    )
    VALUES (
      _customer_id, NULL, v_amount, v_stored_method::public.payment_method,
      coalesce(_payment_date, current_date), nullif(trim(_note), ''), v_user,
      _cashbox_id, _bank_account_id, v_method_id, _cheque_number
    )
    RETURNING id INTO v_payment_id;

    IF (v_stored_method = 'cheque' OR v_method_id = 'cheque') AND _cheque_number IS NOT NULL THEN
      INSERT INTO public.cheques_register (
        cheque_number, bank_name, drawer_name, due_date, amount, status,
        customer_id, invoice_id, payment_id, notes, created_by
      )
      VALUES (
        _cheque_number, coalesce(_cheque_bank, 'شيك مصرفي'), _cheque_drawer,
        coalesce(_cheque_due_date, CURRENT_DATE), v_amount, 'UNDER_COLLECTION',
        _customer_id, NULL, v_payment_id, _note, v_user
      );
    END IF;

    v_remaining := v_amount;

    FOR v_inv_cur IN
      SELECT id, total, paid
      FROM public.sales_invoices
      WHERE customer_id = _customer_id
        AND total > paid
        AND status NOT IN ('cancelled'::public.invoice_status, 'returned'::public.invoice_status)
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_allocation := least(v_remaining, v_inv_cur.total - v_inv_cur.paid);

      UPDATE public.sales_invoices
      SET paid = paid + v_allocation,
          status = 'confirmed'::public.invoice_status,
          payment_status = public.derive_payment_status(paid + v_allocation, total),
          updated_at = now()
      WHERE id = v_inv_cur.id;

      v_remaining := v_remaining - v_allocation;
    END LOOP;

    INSERT INTO public.customer_ledger(
      customer_id, entry_type, credit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    )
    VALUES (
      _customer_id, 'payment', v_amount, v_payment_id, 'customer_payment',
      coalesce(_payment_date, current_date)::timestamptz, v_user,
      'payment:' || v_payment_id,
      coalesce(nullif(trim(_note), ''), 'دفعة عميل بتوزيع تلقائي')
    )
    ON CONFLICT (source_key) DO NOTHING;
  END IF;

  IF v_account IS NOT NULL THEN
    v_lines := v_lines
      || jsonb_build_object(
           'account_code', v_account, 'debit', v_amount,
           'memo', CASE WHEN v_account = '1221'
                        THEN 'أوراق قبض (شيك برسم التحصيل)'
                        ELSE 'تحصيل من عميل' END)
      || jsonb_build_object(
           'account_code', '1211', 'credit', v_amount,
           'memo', 'تحصيل ذمة عميل');

    PERFORM public.create_journal_entry(
      'تحصيل من عميل — ' || coalesce(nullif(trim(_note), ''), ''),
      coalesce(_payment_date, current_date),
      'customer_payment', v_payment_id, true, v_lines);
  END IF;

  RETURN v_payment_id;
END $function$;

GRANT EXECUTE ON FUNCTION public.record_customer_payment(
  uuid, uuid, numeric, text, date, text, uuid, uuid, text, text, text, date, text
) TO authenticated, service_role;

-- النسخة القديمة بستة وسائط تحوّل إلى التوقيع الكامل.
CREATE OR REPLACE FUNCTION public.record_customer_payment(
  _customer_id uuid,
  _invoice_id uuid,
  _amount numeric,
  _method text,
  _payment_date date,
  _note text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.record_customer_payment(
    _customer_id, _invoice_id, _amount, _method, _payment_date, _note
  );
$function$;

-- ── 9. الوصول لجدول التجزئة ─────────────────

ALTER TABLE public.payment_splits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_splits_read ON public.payment_splits;
CREATE POLICY payment_splits_read ON public.payment_splits
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS payment_splits_insert ON public.payment_splits;
CREATE POLICY payment_splits_insert ON public.payment_splits
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

COMMIT;
