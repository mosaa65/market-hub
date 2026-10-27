-- Structural acceptance checks for migration 67 retiring cheque as a new tender.
-- Read-only; no invoice, payment, or stock rows are written.
-- Run after migrations with psql "$DATABASE_URL" -f this file.

BEGIN;

DO $$
DECLARE
  v_definition text;
  v_post_definition text;
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
  v_post_definition := pg_get_functiondef('public.post_sales_invoice(uuid)'::regprocedure);

  IF position('cheque' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'FAIL: historical cheque guard coverage was lost';
  END IF;
  IF position('Split breakdown total (%) does not match paid amount (%)' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'FAIL: split create_sale does not reconcile tender total with recorded paid';
  END IF;
  IF position('A payment method may only be included once in a split' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'FAIL: split create_sale does not reject duplicate enum methods';
  END IF;
  IF position('resolve_document_settlement_account' IN v_post_definition) = 0
     OR position('customer_payment_splits' IN v_post_definition) = 0 THEN
    RAISE EXCEPTION 'FAIL: split tender amounts are not posted to their resolved ledger accounts';
  END IF;

  BEGIN
    PERFORM public.resolve_writable_payment_method('cheque', 'pos', true);
    RAISE EXCEPTION 'FAIL: retired cheque was accepted as a new tender';
  EXCEPTION
    WHEN raise_exception OR check_violation THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: cheque remains historical and is refused for new tenders';
END $$;

-- The deferred document guard rejects a split marker with no ledger-ready
-- tender rows, while letting the real RPC insert those rows before commit.
CREATE TEMP TABLE split_payment_document_probe (
  id uuid PRIMARY KEY,
  payment_method text NOT NULL,
  paid numeric NOT NULL
);
CREATE CONSTRAINT TRIGGER split_payment_document_probe_guard
  AFTER INSERT OR UPDATE ON split_payment_document_probe
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_split_payment_document_balance('sales');

DO $$
BEGIN
  BEGIN
    INSERT INTO split_payment_document_probe(id, payment_method, paid)
    VALUES (gen_random_uuid(), 'split', 100);
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'FAIL: split marker without tender rows was accepted';
  EXCEPTION
    WHEN raise_exception OR check_violation THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
END $$;

ROLLBACK;
