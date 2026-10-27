-- ============================================================================
-- supabase/tests/payment_methods_acceptance.sql
--
-- Acceptance checks for
--   supabase/migrations/20261208000000_payment_methods_catalog_unified.sql
--
-- These are ASSERTIONS, not a dataset. Every block raises on failure and the
-- file ends with a single success notice. Nothing here writes business data.
--
-- Usage:
--   psql "$DATABASE_URL" -f supabase/tests/payment_methods_acceptance.sql
-- ============================================================================

DO $$
DECLARE
  v_count   integer;
  v_value   text;
  v_allowed boolean;
BEGIN
  -- -------------------------------------------------------------------------
  -- 1. The new catalogue covers only the four accepted methods and the split
  --    document marker. Historical card/cheque enum labels remain in schema,
  --    but a clean installation does not seed them as payment choices.
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_count
  FROM unnest(ARRAY['cash','bank_transfer','credit','mobile_money','split']) AS v
  WHERE public.payment_method_catalog_id(v) IS NULL;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'FAIL: % stored values have no catalogue row', v_count;
  END IF;

  -- -------------------------------------------------------------------------
  -- 2. The methods the application already used must resolve EXACTLY.
  --    'credit' collapsing onto 'cash' would change how an invoice posts.
  -- -------------------------------------------------------------------------
  IF public.payment_method_legacy_id('cash') <> 'cash' THEN
    RAISE EXCEPTION 'FAIL: cash -> %', public.payment_method_legacy_id('cash');
  END IF;
  IF public.payment_method_legacy_id('credit') <> 'credit' THEN
    RAISE EXCEPTION 'FAIL: credit -> %', public.payment_method_legacy_id('credit');
  END IF;
  IF public.payment_method_legacy_id('bank_transfer') <> 'bank_transfer' THEN
    RAISE EXCEPTION 'FAIL: bank_transfer -> %', public.payment_method_legacy_id('bank_transfer');
  END IF;
  IF public.payment_method_legacy_id('card') <> 'card' THEN
    RAISE EXCEPTION 'FAIL: card -> %', public.payment_method_legacy_id('card');
  END IF;
  IF public.payment_method_legacy_id('mobile_money') <> 'mobile_money' THEN
    RAISE EXCEPTION 'FAIL: mobile_money -> %', public.payment_method_legacy_id('mobile_money');
  END IF;
  IF public.payment_method_legacy_id('split') <> 'split' THEN
    RAISE EXCEPTION 'FAIL: split -> %', public.payment_method_legacy_id('split');
  END IF;

  -- -------------------------------------------------------------------------
  -- -------------------------------------------------------------------------
  -- 3. Canonical methods resolve to their chart accounts.
  -- -------------------------------------------------------------------------
  IF public.payment_method_ledger_account('cash') <> '1101' THEN
    RAISE EXCEPTION 'FAIL: cash settles to % (expected 1101)',
      public.payment_method_ledger_account('cash');
  END IF;

  -- آجل collects nothing, so there is no cash or bank line to write.
  IF public.payment_method_ledger_account('credit') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: credit must settle to NULL, got %',
      public.payment_method_ledger_account('credit');
  END IF;

  -- -------------------------------------------------------------------------
  -- 5. Context scoping. آجل must never be offered while collecting cash.
  -- -------------------------------------------------------------------------
  IF NOT public.payment_method_is_allowed('cash', 'customer_collection') THEN
    RAISE EXCEPTION 'FAIL: cash should be allowed in customer_collection';
  END IF;

  IF public.payment_method_is_allowed('credit', 'customer_collection') THEN
    RAISE EXCEPTION 'FAIL: credit must not be allowed in customer_collection';
  END IF;

  IF public.payment_method_is_allowed('kuraimi_bank', 'pos') THEN
    RAISE EXCEPTION 'FAIL: retired provider-specific methods must not be allowed';
  END IF;

  -- -------------------------------------------------------------------------
  -- 6. An unknown method must be REFUSED, never silently defaulted to cash.
  -- -------------------------------------------------------------------------
  IF public.payment_method_catalog_id('not_a_real_method') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: an unknown method resolved to a catalogue id';
  END IF;

  IF public.payment_method_is_allowed('not_a_real_method', 'pos') THEN
    RAISE EXCEPTION 'FAIL: an unknown method was reported as allowed in pos';
  END IF;

  BEGIN
    PERFORM public.resolve_writable_payment_method('not_a_real_method', 'pos', true);
    RAISE EXCEPTION 'FAIL: the write guard accepted an unknown method';
  EXCEPTION
    WHEN raise_exception OR check_violation OR foreign_key_violation THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- -------------------------------------------------------------------------
  -- 7. Retired methods cannot receive new settings or payment writes.
  -- -------------------------------------------------------------------------
  BEGIN
    PERFORM public.resolve_writable_payment_method('one_cash', 'pos', true);
    RAISE EXCEPTION 'FAIL: the write guard accepted a retired method';
  EXCEPTION
    WHEN raise_exception OR check_violation OR foreign_key_violation THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO public.payment_method_settings (payment_method_id, enabled, enabled_contexts)
    VALUES ('one_cash', false, ARRAY['pos']);
    RAISE EXCEPTION 'FAIL: settings accepted a retired method';
  EXCEPTION
    WHEN raise_exception OR check_violation OR foreign_key_violation THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- -------------------------------------------------------------------------
  -- 8. A tenant may not widen the developers' context list.
  -- -------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.payment_method_settings (payment_method_id, enabled_contexts)
    VALUES ('credit', ARRAY['pos','customer_collection'])
    ON CONFLICT (payment_method_id) DO UPDATE
      SET enabled_contexts = EXCLUDED.enabled_contexts;

    RAISE EXCEPTION 'FAIL: the guard allowed credit into customer_collection';
  EXCEPTION
    WHEN raise_exception OR check_violation OR foreign_key_violation THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- -------------------------------------------------------------------------
  -- 9. HISTORICAL DOCUMENTS ARE INTACT.
  --
  -- The whole point of not migrating the ENUM is that no stored value moved.
  -- Assert that directly: every distinct payment_method on real documents must
  -- still be one the catalogue knows how to label.
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_count
  FROM (
    SELECT DISTINCT payment_method::text AS v FROM public.sales_invoices
    UNION SELECT DISTINCT payment_method::text FROM public.purchase_invoices
    UNION SELECT DISTINCT payment_method::text FROM public.customer_payments
    UNION SELECT DISTINCT payment_method::text FROM public.expenses
  ) d
  WHERE public.payment_method_catalog_id(d.v) IS NULL;

  IF v_count > 0 THEN
    RAISE EXCEPTION
      'FAIL: % payment values exist on live documents with no catalogue row', v_count;
  END IF;

  -- -------------------------------------------------------------------------
  -- 10. The catalogue view returns a consistent, ordered, coalesced shape.
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_count
  FROM public.payment_method_catalog_view()
  WHERE id IN ('cash','credit','bank_transfer','mobile_money','split');

  IF v_count <> 5 THEN
    RAISE EXCEPTION 'FAIL: expected the four canonical methods and split marker, got %', v_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_method_catalog_view()
    WHERE id NOT IN ('cash','credit','bank_transfer','mobile_money','split')
      AND is_active
  ) THEN
    RAISE EXCEPTION 'FAIL: retired payment method is active';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.payment_method_catalog_view()
  WHERE is_active;

  IF v_count <> 5 THEN
    RAISE EXCEPTION 'FAIL: expected four selectable methods plus split document state, found % active rows', v_count;
  END IF;

  IF public.payment_method_ledger_account('cash') <> '1101'
     OR public.payment_method_ledger_account('bank_transfer') <> '1111'
     OR public.payment_method_ledger_account('mobile_money') <> '1131'
     OR public.payment_method_ledger_account('credit') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: canonical payment methods do not map to the expected chart accounts';
  END IF;

  RAISE NOTICE 'payment_methods_acceptance: ALL CHECKS PASSED';
END $$;

-- Exercise the generic row trigger without inserting business data. A temporary
-- relation has the same payment columns and invokes the production guard.
BEGIN;
CREATE TEMP TABLE payment_method_guard_probe (
  method text,
  payment_method_id text
);
CREATE TRIGGER payment_method_guard_probe_before_write
  BEFORE INSERT OR UPDATE ON payment_method_guard_probe
  FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write(
    'method','payment_method_id','pos','false','false'
  );

INSERT INTO payment_method_guard_probe(method, payment_method_id)
VALUES ('cash', 'cash');

DO $$
BEGIN
  BEGIN
    INSERT INTO payment_method_guard_probe(method, payment_method_id)
    VALUES ('cash', 'cheque');
    RAISE EXCEPTION 'FAIL: the row guard accepted a retired ID for cash';
  EXCEPTION
    WHEN raise_exception OR check_violation THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO payment_method_guard_probe(method, payment_method_id)
    VALUES (NULL, 'card');
    RAISE EXCEPTION 'FAIL: the row guard accepted an ID without a method';
  EXCEPTION
    WHEN raise_exception OR check_violation THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
