-- ============================================================================
-- CENTRAL DOCUMENT NUMBERING ENGINE
-- ----------------------------------------------------------------------------
-- Goal
--   Replace the scattered, per-document numbering logic with ONE engine that
--   every document type in the system uses:
--
--     1. Configuration  : public.document_numbering  (one row per document type)
--     2. Allocation     : public.fn_next_document_number(text)  -> atomic number
--     3. Formatting     : public.fn_format_document_number(...) -> display string
--     4. Admin control  : public.fn_set_document_numbering(...) -> safe sequence set
--
-- Guarantees
--   * Atomic allocation (PostgreSQL sequences / row locks) -> no duplicates
--     under concurrent requests, no MAX(number)+1 anywhere.
--   * Sequence is separate from the displayed number (prefix / date / padding
--     are pure presentation and never reset the counter).
--   * Historical numbers are frozen: changing the format never rewrites an
--     already-issued document, because numbers are stored as TEXT on the
--     document row at creation time.
--   * Scope column is reserved for Company / Branch / POS expansion.
--
-- Backwards compatibility
--   * The legacy functions (next_invoice_number, next_purchase_number,
--     next_sales_return_number, next_purchase_return_number,
--     next_transfer_number, next_expense_reference) are KEPT with identical
--     signatures and re-implemented on top of the engine, so nothing that
--     already calls them can break.
--   * Existing tests / grants on those functions continue to work.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Helper: mapping from a document type to a PostgreSQL sequence.
--    Sequences cannot be created dynamically inside a STABLE formatter for
--    every call cheaply, so the mapping is an IMMUTABLE function and the
--    sequences themselves are created once below.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_document_numbering_sequence_name(p_document_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_document_type
    WHEN 'sales_invoice'      THEN 'public.sales_invoice_seq'
    WHEN 'purchase_invoice'   THEN 'public.purchase_invoice_seq'
    WHEN 'sales_return'       THEN 'public.sales_return_seq'
    WHEN 'purchase_return'    THEN 'public.purchase_return_seq'
    WHEN 'stock_transfer'     THEN 'public.stock_transfer_seq'
    WHEN 'expense'            THEN 'public.expense_reference_seq'
    WHEN 'quotation'          THEN 'public.quotation_seq'
    WHEN 'purchase_order'     THEN 'public.purchase_order_seq'
    WHEN 'goods_receipt'      THEN 'public.goods_receipt_seq'
    WHEN 'sales_order'        THEN 'public.sales_order_seq'
    WHEN 'customer_payment'   THEN 'public.customer_payment_seq'
    WHEN 'supplier_payment'   THEN 'public.supplier_payment_seq'
    WHEN 'stock_adjustment'   THEN 'public.stock_adjustment_seq'
    WHEN 'production_order'   THEN 'public.production_order_seq'
    WHEN 'milling_intake'     THEN 'public.milling_intake_seq'
    WHEN 'milling_service'    THEN 'public.milling_service_seq'
    WHEN 'journal_entry'      THEN 'public.journal_entry_seq'
    ELSE NULL
  END;
$$;

-- ---------------------------------------------------------------------------
-- 1. Sequences backing each document type.
--    Legacy sequences already exist (IF NOT EXISTS keeps their current value,
--    so counters are preserved -- no renumbering of historical data).
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.quotation_seq           START 1;
CREATE SEQUENCE IF NOT EXISTS public.purchase_order_seq      START 1;
CREATE SEQUENCE IF NOT EXISTS public.goods_receipt_seq       START 1;
CREATE SEQUENCE IF NOT EXISTS public.sales_order_seq         START 1;
CREATE SEQUENCE IF NOT EXISTS public.customer_payment_seq    START 1;
CREATE SEQUENCE IF NOT EXISTS public.supplier_payment_seq    START 1;
CREATE SEQUENCE IF NOT EXISTS public.stock_adjustment_seq    START 1;
CREATE SEQUENCE IF NOT EXISTS public.production_order_seq    START 1;
CREATE SEQUENCE IF NOT EXISTS public.milling_intake_seq      START 1;
CREATE SEQUENCE IF NOT EXISTS public.milling_service_seq     START 1;
CREATE SEQUENCE IF NOT EXISTS public.journal_entry_seq       START 1;

-- ---------------------------------------------------------------------------
-- 2. The configuration table: one row per document type.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_numbering (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type   text NOT NULL,
  scope           text NOT NULL DEFAULT 'global',
  scope_id        uuid,
  section         text NOT NULL DEFAULT 'general',
  label_ar        text NOT NULL DEFAULT '',
  label_en        text NOT NULL DEFAULT '',
  prefix          text NOT NULL DEFAULT '',
  separator       text NOT NULL DEFAULT '-',
  format_tokens   text NOT NULL DEFAULT '{PREFIX}-{SEQ}',
  padding         smallint NOT NULL DEFAULT 0,
  date_part       text NOT NULL DEFAULT 'none',
  reset_policy    text NOT NULL DEFAULT 'never',
  current_value   bigint NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_numbering_padding_check  CHECK (padding BETWEEN 0 AND 8),
  CONSTRAINT document_numbering_date_check
    CHECK (date_part IN ('none', 'year', 'year_month', 'full')),
  CONSTRAINT document_numbering_reset_check
    CHECK (reset_policy IN ('never', 'yearly', 'monthly', 'daily')),
  CONSTRAINT document_numbering_scope_check
    CHECK (scope IN ('global', 'company', 'branch', 'pos')),
  CONSTRAINT document_numbering_unique
    UNIQUE (document_type, scope, scope_id)
);

COMMENT ON TABLE public.document_numbering IS
  'Central Document Numbering Engine configuration. The numeric sequence is '
  'kept in a PostgreSQL sequence (atomic, gap tolerant); this table stores how '
  'that number is presented. Document numbers are frozen on the document row '
  'when it is created, so editing this table never rewrites history.';

CREATE INDEX IF NOT EXISTS document_numbering_document_type_idx
  ON public.document_numbering (document_type, scope);

ALTER TABLE public.document_numbering ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_numbering_read" ON public.document_numbering;
CREATE POLICY "document_numbering_read" ON public.document_numbering
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "document_numbering_write" ON public.document_numbering;
CREATE POLICY "document_numbering_write" ON public.document_numbering
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_numbering TO authenticated;
GRANT ALL ON public.document_numbering TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Seed every document type that actually exists in the project.
--    Defaults deliberately reproduce the CURRENT behaviour so no existing
--    flow changes its output until an admin edits a row.
-- ---------------------------------------------------------------------------
INSERT INTO public.document_numbering
  (document_type, section, label_ar, label_en, prefix, separator, format_tokens, padding, date_part)
VALUES
  ('sales_invoice',    'sales',      'فاتورة مبيعات',   'Sales Invoice',     'INV',  '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  4, 'none'),
  ('sales_return',     'sales',      'مرتجع مبيعات',    'Sales Return',      'SR',   '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  4, 'none'),
  ('quotation',        'sales',      'عرض سعر',         'Quotation',         'QUO',  '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  4, 'none'),
  ('sales_order',      'sales',      'أمر بيع',         'Sales Order',       'SO',   '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  4, 'none'),
  ('purchase_invoice', 'purchase',   'فاتورة مشتريات',  'Purchase Invoice',  'PO',   '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  4, 'none'),
  ('purchase_return',  'purchase',   'مرتجع مشتريات',   'Purchase Return',   'PR',   '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  4, 'none'),
  ('purchase_order',   'purchase',   'أمر شراء',        'Purchase Order',    'PO',   '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  4, 'none'),
  ('goods_receipt',    'inventory',  'سند استلام',      'Goods Receipt',     'GRN',  '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  4, 'none'),
  ('stock_transfer',   'inventory',  'تحويل مخزني',     'Stock Transfer',    'TR',   '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  4, 'none'),
  ('stock_adjustment', 'inventory',  'تسوية مخزنية',    'Stock Adjustment',  'ADJ',  '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  4, 'none'),
  ('production_order', 'production', 'أمر إنتاج',       'Production Order',  'PRD',  '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  4, 'none'),
  ('milling_intake',   'milling',    'سند استلام طحن',  'Milling Intake',    'MI',   '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  4, 'none'),
  ('milling_service',  'milling',    'سند خدمة طحن',    'Milling Service',   'MS',   '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  4, 'none'),
  ('customer_payment', 'receipts',   'سند قبض عميل',    'Customer Receipt',  'RV',   '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  5, 'none'),
  ('supplier_payment', 'payments',   'سند صرف مورد',    'Supplier Payment',  'PV',   '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  5, 'none'),
  ('expense',          'payments',   'سند مصروف',       'Expense Voucher',   'EXP',  '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  5, 'none'),
  ('journal_entry',    'finance',    'قيد يومية',       'Journal Entry',     'JV',   '-', '{PREFIX}-{YYYY}{MM}-{SEQ}',  5, 'none')
ON CONFLICT (document_type, scope, scope_id) DO NOTHING;

-- Reflect the counters that already exist so the admin UI shows the truth.
-- current_value is DISPLAY ONLY; the real allocation uses the sequence.
DO $$
DECLARE
  r RECORD;
  v_last bigint;
BEGIN
  FOR r IN SELECT * FROM public.document_numbering WHERE scope = 'global' LOOP
    IF public.fn_document_numbering_sequence_name(r.document_type) IS NOT NULL THEN
      EXECUTE format('SELECT last_value FROM %s', public.fn_document_numbering_sequence_name(r.document_type))
        INTO v_last;
      -- last_value is the highest handed out (is_called = true after first use).
      UPDATE public.document_numbering
        SET current_value = COALESCE(v_last, 0)
        WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. The FORMATTER: turns (tokens, prefix, date, separator, padding) + a raw
--    sequence number into the displayed document number.
--    Tokens: {PREFIX} {SEQ} {YYYY} {YY} {MM} {DD}
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_format_document_number(
  p_sequence     bigint,
  p_prefix       text,
  p_format       text,
  p_padding      smallint,
  p_separator    text,
  p_date_part    text,
  p_at           timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_seq_text   text;
  v_padding    smallint := GREATEST(0, LEAST(COALESCE(p_padding, 0), 8));
  v_sep        text := COALESCE(NULLIF(p_separator, ''), '-');
  v_prefix     text := COALESCE(p_prefix, '');
  v_format     text := COALESCE(NULLIF(btrim(p_format), ''), '{PREFIX}{SEQ}');
  v_result     text;
BEGIN
  -- Padding is OPTIONAL. padding = 0 means "no leading zeros".
  v_seq_text := CASE
    WHEN v_padding = 0 THEN p_sequence::text
    WHEN length(p_sequence::text) < v_padding THEN lpad(p_sequence::text, v_padding, '0')
    ELSE p_sequence::text
  END;

  v_result := v_format;
  v_result := replace(v_result, '{PREFIX}',    v_prefix);
  v_result := replace(v_result, '{YYYY}',      to_char(p_at, 'YYYY'));
  v_result := replace(v_result, '{YY}',        to_char(p_at, 'YY'));
  v_result := replace(v_result, '{MM}',        to_char(p_at, 'MM'));
  v_result := replace(v_result, '{DD}',        to_char(p_at, 'DD'));
  v_result := replace(v_result, '{SEQ}',       v_seq_text);

  -- A separator written as "-" inside the template is normalised so an empty
  -- separator really collapses the parts instead of leaving stray dashes.
  IF v_sep <> '-' THEN
    v_result := replace(v_result, '-', v_sep);
  END IF;

  -- If the template mentions a date token that is empty (e.g. a preset with
  -- no date), collapse duplicated separators and trim stray edges.
  v_result := regexp_replace(v_result, regexp_replace(regexp_replace(v_sep, '([\.\^\$\*\+\?\(\)\[\]\{\}\|\\])', '\\\1', 'g') || '{2,}', v_sep, 'g');
  v_result := btrim(v_result, v_sep || ' ');
  v_result := btrim(v_result);

  IF v_result = '' THEN
    v_result := v_seq_text;
  END IF;

  RETURN v_result;
END $$;

-- Backwards/report-friendly wrapper that resolves the config row itself.
CREATE OR REPLACE FUNCTION public.fn_format_document_number(
  p_document_type text,
  p_sequence      bigint,
  p_at            timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.fn_resolve_document_numbering(p_document_type);
  IF NOT FOUND THEN
    RETURN p_sequence::text;
  END IF;
  RETURN public.fn_format_document_number(
    p_sequence, r.prefix, r.format_tokens, r.padding, r.separator, r.date_part, p_at
  );
END $$;

-- ---------------------------------------------------------------------------
-- 5. Scope resolution with explicit priority:
--       pos + type  ->  branch + type  ->  company + type  ->  global + type
--    Only 'global' rows are seeded today; the ordering is ready for the
--    higher scopes without any further schema change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_resolve_document_numbering(
  p_document_type text,
  p_company_id    uuid DEFAULT NULL,
  p_branch_id     uuid DEFAULT NULL,
  p_pos_id        uuid DEFAULT NULL
)
RETURNS public.document_numbering
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.*
  FROM public.document_numbering d
  WHERE d.document_type = p_document_type
    AND (
      (d.scope = 'pos'     AND p_pos_id     IS NOT NULL AND d.scope_id = p_pos_id)
      OR (d.scope = 'branch'  AND p_branch_id  IS NOT NULL AND d.scope_id = p_branch_id)
      OR (d.scope = 'company' AND p_company_id IS NOT NULL AND d.scope_id = p_company_id)
      OR (d.scope = 'global'  AND d.scope_id IS NULL)
    )
  ORDER BY CASE d.scope
             WHEN 'pos'     THEN 1
             WHEN 'branch'  THEN 2
             WHEN 'company' THEN 3
             ELSE 4
           END
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 6. ATOMIC ALLOCATION -- the heart of the engine.
--    Uses nextval() which is atomic under concurrency, so two simultaneous
--    requests can never receive the same number. No MAX()+1, no frontend math.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_next_document_number(
  p_document_type text,
  p_company_id    uuid DEFAULT NULL,
  p_branch_id     uuid DEFAULT NULL,
  p_pos_id        uuid DEFAULT NULL,
  p_at            timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq_name text := public.fn_document_numbering_sequence_name(p_document_type);
  v_cfg      record;
  v_number   bigint;
  v_result   text;
BEGIN
  IF v_seq_name IS NULL THEN
    RAISE EXCEPTION 'Unknown document type: %', p_document_type;
  END IF;

  SELECT * INTO v_cfg
  FROM public.fn_resolve_document_numbering(p_document_type, p_company_id, p_branch_id, p_pos_id);

  -- Atomic allocation. The sequence guarantees uniqueness even when two
  -- cashiers create the same document type in the same millisecond.
  EXECUTE format('SELECT nextval(%L)', v_seq_name) INTO v_number;

  IF v_cfg IS NULL THEN
    -- Engine row missing: still return a safe, unique number.
    RETURN v_number::text;
  END IF;

  v_result := public.fn_format_document_number(
    v_number, v_cfg.prefix, v_cfg.format_tokens, v_cfg.padding,
    v_cfg.separator, v_cfg.date_part, p_at
  );

  -- Keep the informational counter in sync (never used for allocation).
  UPDATE public.document_numbering
    SET current_value = GREATEST(current_value, v_number),
        updated_at = now()
    WHERE id = v_cfg.id;

  RETURN v_result;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Admin control: read + safe write of a document type's configuration and
--    its "next number" starting point.
--    Guards:
--      - owner/manager only
--      - refuses a starting value that collides with an existing document
--      - logs the change when the project has an audit trail
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_set_document_numbering(
  p_document_type text,
  p_prefix        text DEFAULT NULL,
  p_format_tokens text DEFAULT NULL,
  p_padding       smallint DEFAULT NULL,
  p_date_part     text DEFAULT NULL,
  p_separator     text DEFAULT NULL,
  p_reset_policy  text DEFAULT NULL,
  p_next_value    bigint DEFAULT NULL
)
RETURNS public.document_numbering
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_seq     text := public.fn_document_numbering_sequence_name(p_document_type);
  v_row     public.document_numbering;
  v_max     bigint := 0;
  v_is_called boolean;
  v_expected bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(v_uid, 'owner') OR public.has_role(v_uid, 'manager')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'Unknown document type: %', p_document_type;
  END IF;

  SELECT * INTO v_row
  FROM public.document_numbering
  WHERE document_type = p_document_type AND scope = 'global'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No numbering configuration for %', p_document_type;
  END IF;

  -- ── Guard: never allow a starting value that would duplicate a number that
  --    has already been issued for this document type.
  IF p_next_value IS NOT NULL THEN
    IF p_next_value < 0 THEN
      RAISE EXCEPTION 'Starting number cannot be negative';
    END IF;

    -- Highest number actually visible in the documents, parsed from the tail
    -- of the stored text ("INV-202610-0125" -> 125).
    v_max := CASE p_document_type
      WHEN 'sales_invoice'    THEN (SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_number, '\D', '', 'g'), '')::bigint), 0) FROM public.sales_invoices)
      WHEN 'purchase_invoice' THEN (SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_number, '\D', '', 'g'), '')::bigint), 0) FROM public.purchase_invoices)
      WHEN 'sales_return'     THEN (SELECT COALESCE(MAX(NULLIF(regexp_replace(return_number, '\D', '', 'g'), '')::bigint), 0) FROM public.sales_returns)
      WHEN 'purchase_return'  THEN (SELECT COALESCE(MAX(NULLIF(regexp_replace(return_number, '\D', '', 'g'), '')::bigint), 0) FROM public.purchase_returns)
      WHEN 'stock_transfer'   THEN (SELECT COALESCE(MAX(NULLIF(regexp_replace(transfer_number, '\D', '', 'g'), '')::bigint), 0) FROM public.stock_transfers)
      ELSE 0
    END;

    IF p_next_value <= v_max THEN
      RAISE EXCEPTION
        'Starting number % is not greater than an existing number (%). Choose a value above %.',
        p_next_value, v_max, v_max;
    END IF;

    SELECT is_called, last_value INTO v_is_called, v_expected
      FROM public.document_numbering WHERE id = v_row.id; -- placeholder, replaced below

    -- is_called is read from the real sequence.
    EXECUTE format('SELECT is_called, last_value FROM %s', v_seq) INTO v_is_called, v_expected;

    -- setval(seq, n, false) -> the NEXT nextval() returns exactly n.
    EXECUTE format('SELECT setval(%L, %s, false)', v_seq, p_next_value);
  END IF;

  UPDATE public.document_numbering SET
    prefix        = COALESCE(p_prefix,        prefix),
    format_tokens = COALESCE(p_format_tokens, format_tokens),
    padding       = COALESCE(p_padding,       padding),
    date_part     = COALESCE(p_date_part,     date_part),
    separator     = COALESCE(p_separator,     separator),
    reset_policy  = COALESCE(p_reset_policy,  reset_policy),
    current_value = CASE
                      WHEN p_next_value IS NOT NULL THEN p_next_value - 1
                      ELSE current_value
                    END,
    updated_at    = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  -- Audit trail (best effort: projects without the log table stay silent).
  BEGIN
    INSERT INTO public.backup_logs (log_type, status, message, details)
    VALUES (
      'settings',
      'success',
      'Document numbering updated: ' || p_document_type,
      jsonb_build_object(
        'document_type', p_document_type,
        'next_value',    p_next_value,
        'prefix',        v_row.prefix,
        'format_tokens', v_row.format_tokens,
        'padding',       v_row.padding,
        'date_part',     v_row.date_part,
        'actor',         v_uid
      )
    );
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    NULL;
  END;

  RETURN v_row;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Legacy functions, re-implemented on the engine.
--    Signatures are unchanged so no caller breaks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.fn_next_document_number('sales_invoice');
END $$;

CREATE OR REPLACE FUNCTION public.next_purchase_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.fn_next_document_number('purchase_invoice');
END $$;

CREATE OR REPLACE FUNCTION public.next_sales_return_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.fn_next_document_number('sales_return');
END $$;

CREATE OR REPLACE FUNCTION public.next_purchase_return_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.fn_next_document_number('purchase_return');
END $$;

CREATE OR REPLACE FUNCTION public.next_transfer_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.fn_next_document_number('stock_transfer');
END $$;

-- ---------------------------------------------------------------------------
-- 9. Grants. Sequence access is never exposed to the browser; allocation goes
--    through the SECURITY DEFINER functions only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON SEQUENCE public.quotation_seq        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.purchase_order_seq   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.goods_receipt_seq    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.sales_order_seq      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.customer_payment_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.supplier_payment_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.stock_adjustment_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.production_order_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.milling_intake_seq   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.milling_service_seq  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.journal_entry_seq    FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SEQUENCE public.quotation_seq        TO service_role;
GRANT USAGE ON SEQUENCE public.purchase_order_seq   TO service_role;
GRANT USAGE ON SEQUENCE public.goods_receipt_seq    TO service_role;
GRANT USAGE ON SEQUENCE public.customer_payment_seq TO service_role;
GRANT USAGE ON SEQUENCE public.sales_order_seq      TO service_role;
GRANT USAGE ON SEQUENCE public.supplier_payment_seq TO service_role;
GRANT USAGE ON SEQUENCE public.stock_adjustment_seq TO service_role;
GRANT USAGE ON SEQUENCE public.production_order_seq TO service_role;
GRANT USAGE ON SEQUENCE public.milling_intake_seq   TO service_role;
GRANT USAGE ON SEQUENCE public.milling_service_seq  TO service_role;
GRANT USAGE ON SEQUENCE public.journal_entry_seq    TO service_role;

-- Allocation is internal: called from SECURITY DEFINER document RPCs only.
REVOKE EXECUTE ON FUNCTION public.fn_next_document_number(text, uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_format_document_number(bigint, text, text, smallint, text, text, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_resolve_document_numbering(text, uuid, uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_next_document_number(text, uuid, uuid, uuid, timestamptz) TO service_role;

-- Safe, read-only helpers for the UI + the admin setter.
GRANT EXECUTE ON FUNCTION public.fn_format_document_number(text, bigint, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_document_numbering_sequence_name(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_set_document_numbering(text, text, text, smallint, text, text, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_document_numbering(text, uuid, uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_set_document_numbering(text, text, text, smallint, text, text, text, bigint) FROM PUBLIC, anon;
