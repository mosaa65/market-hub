-- Structural acceptance checks for migration 46 POS split-cheque support.
-- Read-only; no invoice, payment, or stock rows are written.
-- Run after migrations with psql "$DATABASE_URL" -f this file.

BEGIN;

DO $$
DECLARE
  v_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'payment_method'
      AND e.enumlabel = 'cheque'
  ) THEN
    RAISE EXCEPTION 'FAIL: public.payment_method.cheque is missing';
  END IF;

  v_definition := pg_get_functiondef(
    'public.create_sale(uuid,uuid,text,numeric,numeric,text,jsonb,date,jsonb)'::regprocedure
  );

  IF position('cheque' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'FAIL: split create_sale does not accept cheque';
  END IF;
  IF position('Payment breakdown cannot exceed the invoice total' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'FAIL: split create_sale does not guard tender total against invoice total';
  END IF;
  IF position('Tender breakdown does not match the recorded paid amount' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'FAIL: split create_sale does not reconcile tender total with recorded paid';
  END IF;
  IF position('A payment method may only be included once in a split' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'FAIL: split create_sale does not reject duplicate enum methods';
  END IF;
  IF position('Multi-method payment requires split-aware ledger posting' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'FAIL: multi-method tender is not gated until ledger posting supports split accounts';
  END IF;

  RAISE NOTICE 'PASS: cheque is supported in split tenders and total/duplicate guards are present';
END $$;

ROLLBACK;
