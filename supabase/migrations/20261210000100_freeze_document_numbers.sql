-- ============================================================================
-- DOCUMENT NUMBERING — SAFE MIGRATION / FROZEN NUMBERS
-- ----------------------------------------------------------------------------
-- Safety contract of this migration:
--   * NO existing document is renumbered.
--   * NO existing number loses uniqueness.
--   * NO column is renamed or dropped, so every current read path keeps working.
--
-- What it does:
--   1. Adds `document_number` as a GENERATED column on every numbered document
--      table. It resolves to `invoice_number` / `return_number` /
--      `transfer_number` today, so current readers are untouched, and it gives
--      every future document type ONE uniform column to read.
--   2. Backfills the informational counter in public.document_numbering from
--      the sequences, so the settings screen shows real values.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Uniform, read-only `document_number` alias on the numbered documents.
--    Generated columns cannot be written to, so this can never overwrite a
--    frozen document number.
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_invoices
  ADD COLUMN IF NOT EXISTS document_number text GENERATED ALWAYS AS (invoice_number) STORED;

ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS document_number text GENERATED ALWAYS AS (invoice_number) STORED;

ALTER TABLE public.sales_returns
  ADD COLUMN IF NOT EXISTS document_number text GENERATED ALWAYS AS (return_number) STORED;

ALTER TABLE public.purchase_returns
  ADD COLUMN IF NOT EXISTS document_number text GENERATED ALWAYS AS (return_number) STORED;

ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS document_number text GENERATED ALWAYS AS (transfer_number) STORED;

-- ---------------------------------------------------------------------------
-- 2. Refresh the informational counters from the live sequences.
--    current_value is display-only; allocation uses nextval() exclusively.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_last bigint;
  v_is_called boolean;
  v_seq text;
BEGIN
  FOR r IN SELECT id, document_type FROM public.document_numbering WHERE scope = 'global' LOOP
    v_seq := public.fn_document_numbering_sequence_name(r.document_type);
    IF v_seq IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('SELECT is_called, last_value FROM %s', v_seq)
      INTO v_is_called, v_last;

    UPDATE public.document_numbering
      SET current_value = CASE WHEN v_is_called THEN COALESCE(v_last, 0) ELSE 0 END,
          updated_at = now()
      WHERE id = r.id;
  END LOOP;
END $$;
