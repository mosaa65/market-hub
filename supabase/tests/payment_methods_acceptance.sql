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
  -- 1. The catalogue covers every value the ENUM can hold AND the application
  --    uses. A stored value with no catalogue row means historic invoices can
  --    no longer be labelled and the upgrade has lost information.
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_count
  FROM unnest(ARRAY['cash','card','bank_transfer','credit','mobile_money','split','cheque']) AS v
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
  -- 3. A NAMED Yemeni method must land in the bank/wallet account, NOT in cash.
  --    This is the check that catches the ledger treating an unknown method as
  --    cash and inflating the till.
  -- -------------------------------------------------------------------------
  IF public.payment_method_legacy_id('kuraimi_bank') <> 'bank_transfer' THEN
    RAISE EXCEPTION 'FAIL: kuraimi_bank -> % (expected bank_transfer)',
      public.payment_method_legacy_id('kuraimi_bank');
  END IF;

  IF public.payment_method_legacy_id('jaib') <> 'mobile_money' THEN
    RAISE EXCEPTION 'FAIL: jaib -> % (expected mobile_money)',
      public.payment_method_legacy_id('jaib');
  END IF;

  IF public.payment_method_legacy_id('jawali') <> 'mobile_money' THEN
    RAISE EXCEPTION 'FAIL: jawali -> % (expected mobile_money)',
      public.payment_method_legacy_id('jawali');
  END IF;

  IF public.payment_method_legacy_id('one_cash') <> 'mobile_money' THEN
    RAISE EXCEPTION 'FAIL: one_cash -> % (expected mobile_money)',
      public.payment_method_legacy_id('one_cash');
  END IF;

  -- -------------------------------------------------------------------------
  -- 4. Ledger account resolution. بنك الكريمي must reach the bank, not 1101.
  -- -------------------------------------------------------------------------
  IF public.payment_method_ledger_account('kuraimi_bank') <> '1111' THEN
    RAISE EXCEPTION 'FAIL: kuraimi_bank settles to % (expected 1111)',
      public.payment_method_ledger_account('kuraimi_bank');
  END IF;

  IF public.payment_method_ledger_account('jaib') <> '1111' THEN
    RAISE EXCEPTION 'FAIL: jaib settles to % (expected 1111)',
      public.payment_method_ledger_account('jaib');
  END IF;

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

  IF public.payment_method_is_allowed('jaib', 'sales_returns') THEN
    RAISE EXCEPTION 'FAIL: jaib must not be allowed in sales_returns';
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
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- -------------------------------------------------------------------------
  -- 7. The write guard must refuse a method the business disabled.
  -- -------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.payment_method_settings (payment_method_id, enabled, enabled_contexts)
    VALUES ('one_cash', false, ARRAY['pos'])
    ON CONFLICT (payment_method_id) DO UPDATE
      SET enabled = false, enabled_contexts = ARRAY['pos'];

    BEGIN
      PERFORM public.resolve_writable_payment_method('one_cash', 'pos', true);
      RAISE EXCEPTION 'FAIL: the write guard accepted a disabled method';
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    END;

    BEGIN
      PERFORM public.resolve_writable_payment_method('one_cash', 'pos', false);
      RAISE EXCEPTION 'FAIL: the non-strict guard should also refuse a disabled method';
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    END;

    -- Restore, so re-running this file is idempotent.
    DELETE FROM public.payment_method_settings WHERE payment_method_id = 'one_cash';
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
    WHEN raise_exception THEN
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
  FROM public.payment_method_catalog_view();

  IF v_count < 12 THEN
    RAISE EXCEPTION 'FAIL: the catalogue view returned only % rows', v_count;
  END IF;

  SELECT enabled INTO v_allowed
  FROM public.payment_method_catalog_view()
  WHERE id = 'kuraimi_bank';

  IF v_allowed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: kuraimi_bank should default to enabled, got %', v_allowed;
  END IF;

  RAISE NOTICE 'payment_methods_acceptance: ALL CHECKS PASSED';
END $$;
