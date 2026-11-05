-- Migration 70: restore the journal-posting entry point used by migration 64.
-- post_sales_invoice calls post_journal_entry with a generated document number,
-- while the accounting engine exposes create_journal_entry instead.

CREATE OR REPLACE FUNCTION public.post_journal_entry(
  p_entry_date date,
  p_memo text,
  p_lines jsonb,
  p_source_type text,
  p_source_id uuid,
  p_entry_number text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid;
BEGIN
  IF nullif(btrim(p_entry_number), '') IS NULL THEN
    RAISE EXCEPTION 'A journal entry number is required';
  END IF;

  v_entry_id := public.create_journal_entry(
    p_memo,
    p_entry_date,
    p_source_type,
    p_source_id,
    true,
    p_lines
  );

  UPDATE public.journal_entries
     SET entry_number = p_entry_number
   WHERE id = v_entry_id;

  RETURN v_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.post_journal_entry(date, text, jsonb, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_journal_entry(date, text, jsonb, text, uuid, text)
  TO authenticated, service_role;

-- Migration 64 also compares movement_type to the nonexistent enum value OUT.
-- The actual enum label for a sale issue is sale. Rebuild the installed
-- post_sales_invoice definition with that one enum correction, and fail loudly
-- if the expected old body ever changes so this migration cannot silently
-- patch the wrong implementation.
DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.post_sales_invoice(uuid)'::regprocedure)
    INTO v_definition;

  IF position('movement_type = ''OUT''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Expected post_sales_invoice enum comparison was not found';
  END IF;

  v_definition := replace(
    v_definition,
    'movement_type = ''OUT''',
    'movement_type = ''sale'''
  );
  EXECUTE v_definition;
END;
$$;
