-- ============================================================================
-- 09_accounting_ledger.sql
--
-- المحاسبة: دليل الحسابات، القيود المزدوجة، الأرصدة الافتتاحية.
--
-- مُستخرج من الحالة النهائية الحقيقية لقاعدة البيانات، لا من تاريخ الملفات.
-- لا يحتوي أي بيانات أعمال أو تجارية. راجع supabase/MIGRATIONS_RULES.md
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS public.opening_balance_seq START 1;

-- ── TABLES ────────────────────────────────────────────────────────────────
CREATE TABLE public.accounts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code varchar(20) NOT NULL,
  name_ar text NOT NULL,
  account_type public.account_type NOT NULL,
  parent_id uuid,
  is_system boolean DEFAULT false NOT NULL,
  is_postable boolean DEFAULT true NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  requires_reconciliation boolean DEFAULT false NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.journal_entries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  entry_number text NOT NULL,
  entry_date date DEFAULT CURRENT_DATE NOT NULL,
  memo text NOT NULL,
  status text DEFAULT 'DRAFT'::text NOT NULL,
  source_type text,
  source_id uuid,
  is_system boolean DEFAULT false NOT NULL,
  reverses_id uuid,
  total_debit numeric(18,2) DEFAULT 0 NOT NULL,
  total_credit numeric(18,2) DEFAULT 0 NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  posted_by uuid,
  posted_at timestamp with time zone
);

CREATE TABLE public.journal_lines (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  entry_id uuid NOT NULL,
  account_id uuid NOT NULL,
  debit numeric(18,2) DEFAULT 0 NOT NULL,
  credit numeric(18,2) DEFAULT 0 NOT NULL,
  memo text,
  partner_type text,
  partner_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.opening_balance_documents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  document_number text NOT NULL,
  effective_date date NOT NULL,
  status text DEFAULT 'DRAFT'::text NOT NULL,
  fiscal_year integer NOT NULL,
  total_assets numeric(18,2) DEFAULT 0 NOT NULL,
  total_liabilities numeric(18,2) DEFAULT 0 NOT NULL,
  capital_required numeric(18,2),
  reverses_document_id uuid,
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  posted_by uuid,
  posted_at timestamp with time zone
);

CREATE TABLE public.opening_balance_lines (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  document_id uuid NOT NULL,
  section text NOT NULL,
  side text NOT NULL,
  ref_type text,
  ref_id uuid,
  product_id uuid,
  warehouse_id uuid,
  customer_id uuid,
  supplier_id uuid,
  description text NOT NULL,
  quantity numeric(18,3),
  unit_cost numeric(18,4),
  amount numeric(18,2) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ── CONSTRAINTS ───────────────────────────────────────────────────────────
ALTER TABLE public.accounts ADD CONSTRAINT "accounts_pkey" PRIMARY KEY (id);
ALTER TABLE public.accounts ADD CONSTRAINT "accounts_code_key" UNIQUE (code);
ALTER TABLE public.journal_entries ADD CONSTRAINT "journal_entries_status_check" CHECK ((status = ANY (ARRAY['DRAFT'::text, 'POSTED'::text, 'REVERSED'::text])));
ALTER TABLE public.journal_entries ADD CONSTRAINT "journal_no_self_reversal" CHECK ((reverses_id IS DISTINCT FROM id));
ALTER TABLE public.journal_entries ADD CONSTRAINT "journal_posted_has_totals" CHECK (((status <> 'POSTED'::text) OR ((total_debit > (0)::numeric) AND (total_debit = total_credit))));
ALTER TABLE public.journal_entries ADD CONSTRAINT "journal_entries_pkey" PRIMARY KEY (id);
ALTER TABLE public.journal_entries ADD CONSTRAINT "journal_entries_entry_number_key" UNIQUE (entry_number);
ALTER TABLE public.journal_lines ADD CONSTRAINT "journal_lines_credit_check" CHECK ((credit >= (0)::numeric));
ALTER TABLE public.journal_lines ADD CONSTRAINT "journal_lines_debit_check" CHECK ((debit >= (0)::numeric));
ALTER TABLE public.journal_lines ADD CONSTRAINT "journal_lines_one_side" CHECK ((((debit > (0)::numeric) AND (credit = (0)::numeric)) OR ((credit > (0)::numeric) AND (debit = (0)::numeric))));
ALTER TABLE public.journal_lines ADD CONSTRAINT "journal_lines_pkey" PRIMARY KEY (id);
ALTER TABLE public.opening_balance_documents ADD CONSTRAINT "opening_balance_documents_status_check" CHECK ((status = ANY (ARRAY['DRAFT'::text, 'POSTED'::text, 'REVERSED'::text])));
ALTER TABLE public.opening_balance_documents ADD CONSTRAINT "opening_balance_posted_has_date" CHECK (((status = 'DRAFT'::text) OR (posted_at IS NOT NULL)));
ALTER TABLE public.opening_balance_documents ADD CONSTRAINT "opening_balance_documents_pkey" PRIMARY KEY (id);
ALTER TABLE public.opening_balance_documents ADD CONSTRAINT "opening_balance_documents_document_number_key" UNIQUE (document_number);
ALTER TABLE public.opening_balance_lines ADD CONSTRAINT "opening_balance_lines_amount_check" CHECK ((amount >= (0)::numeric));
ALTER TABLE public.opening_balance_lines ADD CONSTRAINT "opening_balance_lines_section_check" CHECK ((section = ANY (ARRAY['STOCK'::text, 'RECEIVABLE'::text, 'PAYABLE'::text, 'CASH'::text, 'BANK'::text, 'ASSET'::text, 'LIABILITY'::text, 'CAPITAL'::text])));
ALTER TABLE public.opening_balance_lines ADD CONSTRAINT "opening_balance_lines_side_check" CHECK ((side = ANY (ARRAY['DEBIT'::text, 'CREDIT'::text])));
ALTER TABLE public.opening_balance_lines ADD CONSTRAINT "opening_balance_lines_stock_shape" CHECK (((section <> 'STOCK'::text) OR ((product_id IS NOT NULL) AND (warehouse_id IS NOT NULL) AND (quantity IS NOT NULL))));
ALTER TABLE public.opening_balance_lines ADD CONSTRAINT "opening_balance_lines_pkey" PRIMARY KEY (id);

-- ── INDEXES ───────────────────────────────────────────────────────────────
CREATE INDEX ix_journal_date ON public.journal_entries USING btree (entry_date DESC);
CREATE INDEX ix_journal_source ON public.journal_entries USING btree (source_type, source_id);
CREATE INDEX ix_journal_lines_account ON public.journal_lines USING btree (account_id);
CREATE INDEX ix_journal_lines_entry ON public.journal_lines USING btree (entry_id);
CREATE INDEX ix_opening_lines_doc ON public.opening_balance_lines USING btree (document_id);
CREATE INDEX ix_opening_lines_ref ON public.opening_balance_lines USING btree (ref_type, ref_id);

-- ── SEQUENCES ─────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.sales_invoice_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.sales_return_seq START 1;

-- ── FUNCTIONS ─────────────────────────────────────────────────────────────
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
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
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

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.create_opening_balance(_effective_date date, _lines jsonb, _notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_id   uuid;
  v_num  text;
  l      jsonb;
  v_side text;
  v_section text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
          OR public.has_role(v_user,'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may open the books';
  END IF;
  IF _effective_date IS NULL THEN
    RAISE EXCEPTION 'Effective date is required';
  END IF;
  IF _lines IS NULL OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'An opening entry needs at least one line';
  END IF;

  v_num := 'OB-' || to_char(_effective_date,'YYYYMMDD') || '-' ||
           lpad(nextval('public.opening_balance_seq')::text,3,'0');

  INSERT INTO public.opening_balance_documents
    (document_number, effective_date, status, fiscal_year, notes, created_by)
  VALUES (v_num, _effective_date, 'DRAFT',
          EXTRACT(YEAR FROM _effective_date)::int,
          nullif(btrim(coalesce(_notes,'')),''), v_user)
  RETURNING id INTO v_id;

  FOR l IN SELECT * FROM jsonb_array_elements(_lines)
  LOOP
    v_section := l->>'section';
    IF v_section NOT IN ('STOCK','RECEIVABLE','PAYABLE','CASH','BANK','ASSET','LIABILITY','CAPITAL') THEN
      RAISE EXCEPTION 'Unknown opening section: %', v_section;
    END IF;

    -- The side is DERIVED, never supplied. A line that claims to be an asset
    -- on the credit side is the exact error a balance check exists to catch,
    -- and accepting it would defeat the purpose.
    v_side := CASE WHEN v_section IN ('STOCK','RECEIVABLE','CASH','BANK','ASSET')
                   THEN 'DEBIT' ELSE 'CREDIT' END;

    IF coalesce((l->>'amount')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Line amount must be greater than zero (section %)', v_section;
    END IF;

    INSERT INTO public.opening_balance_lines
      (document_id, section, side, ref_type, ref_id, product_id, warehouse_id,
       customer_id, supplier_id, description, quantity, unit_cost, amount)
    VALUES
      (v_id, v_section, v_side, l->>'ref_type', (l->>'ref_id')::uuid,
       (l->>'product_id')::uuid, (l->>'warehouse_id')::uuid,
       (l->>'customer_id')::uuid, (l->>'supplier_id')::uuid,
       coalesce(nullif(btrim(coalesce(l->>'description','')),''), v_section),
       (l->>'quantity')::numeric, (l->>'unit_cost')::numeric,
       (l->>'amount')::numeric);
  END LOOP;

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.next_journal_number(p_date date)
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  SELECT 'JE-' || to_char(p_date, 'YYYYMMDD') || '-' ||
         lpad((count(*) + 1)::text, 4, '0')
    FROM public.journal_entries
   WHERE entry_date = p_date;
$function$;

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

    ELSIF l.section = 'PAYABLE' THEN
      IF l.supplier_id IS NULL THEN
        RAISE EXCEPTION 'Payable line "%" has no supplier', l.description;
      END IF;
      UPDATE public.suppliers
         SET balance = coalesce(balance, 0) + l.amount
       WHERE id = l.supplier_id;

    ELSE
      -- CASH, BANK, ASSET, LIABILITY: recorded, not posted. This schema has no
      -- chart of accounts and no cash/bank table, so there is no ledger entry
      -- to make. The line is real, queryable and reversible; pretending
      -- otherwise would be a fiction.
      NULL;
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'opening_balance.posted', 'opening_balance', _document_id,
          jsonb_build_object('document_number', v_doc.document_number,
                             'debits', v_debit, 'credits', v_credit));
  RETURN _document_id;
END $function$;

-- NOTE: post_purchase_invoice and post_sales_invoice are defined ONCE, in 16_payment_methods.sql,
-- because their payment-account branch needs the payment_methods catalogue.

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
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.reverse_opening_balance(_document_id uuid, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_doc  record;
  v_new  uuid;
  v_num  text;
  l      record;
BEGIN
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'Reversing an opening entry requires a reason';
  END IF;

  SELECT * INTO v_doc FROM public.opening_balance_documents WHERE id = _document_id FOR UPDATE;
  IF NOT FOUND OR v_doc.status <> 'POSTED' THEN
    RAISE EXCEPTION 'Only a posted opening document can be reversed';
  END IF;

  v_num := 'OBR-' || v_doc.document_number;
  INSERT INTO public.opening_balance_documents
    (document_number, effective_date, status, fiscal_year, reverses_document_id,
     notes, created_by, posted_at, posted_by)
  VALUES (v_num, v_doc.effective_date, 'POSTED', v_doc.fiscal_year, _document_id,
          'عكس القيد الافتتاحي ' || v_doc.document_number || ': ' || btrim(_reason),
          v_user, now(), v_user)
  RETURNING id INTO v_new;

  -- Mirrored at the same amount, so the reversal balances by construction
  -- rather than by arithmetic the caller has to get right.
  INSERT INTO public.opening_balance_lines
    (document_id, section, side, ref_type, ref_id, product_id, warehouse_id,
     customer_id, supplier_id, description, quantity, unit_cost, amount)
  SELECT v_new, section,
         CASE WHEN side='DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END,
         ref_type, ref_id, product_id, warehouse_id, customer_id, supplier_id,
         'عكس: ' || description, quantity, unit_cost, amount
    FROM public.opening_balance_lines WHERE document_id = _document_id;

  FOR l IN SELECT * FROM public.opening_balance_lines WHERE document_id = _document_id
  LOOP
    IF l.section = 'STOCK' THEN
      PERFORM public.post_stock_delta(
        p_product_id => l.product_id, p_warehouse_id => l.warehouse_id,
        p_signed_qty => -l.quantity, p_unit_cost => coalesce(l.unit_cost, 0),
        p_movement_kind => 'ADJUSTMENT', p_movement_type_legacy => 'opening',
        p_source_type => 'opening_balance_reversal', p_source_id => v_new,
        p_note => 'عكس رصيد افتتاحي ' || v_doc.document_number,
        p_owner_type => 'COMPANY', p_owner_id => NULL);
      PERFORM public.apply_cost_movement(
        p_product_id => l.product_id, p_warehouse_id => l.warehouse_id,
        p_signed_qty => -l.quantity, p_incoming_cost => NULL,
        p_source_type => 'opening_balance_reversal', p_source_id => v_new,
        p_note => 'عكس رصيد افتتاحي ' || v_doc.document_number);
    ELSIF l.section = 'RECEIVABLE' THEN
      INSERT INTO public.customer_ledger
        (customer_id, entry_type, debit, credit, reference_id, reference_type,
         occurred_at, created_by, note)
      VALUES (l.customer_id, 'adjustment', 0, l.amount, v_new,
              'opening_balance_reversal', now(), v_user,
              'عكس رصيد افتتاحي ' || v_doc.document_number);
    ELSIF l.section = 'PAYABLE' THEN
      UPDATE public.suppliers SET balance = coalesce(balance,0) - l.amount
       WHERE id = l.supplier_id;
    END IF;
  END LOOP;

  UPDATE public.opening_balance_documents
     SET status = 'REVERSED'
   WHERE id = _document_id;

  RETURN v_new;
END $function$;

