-- تدقيق مباشر ومتعدد النتائج: كل فحص يُرجَع كصف في JSONB
WITH a AS (
  SELECT
    count(*) AS customers_total,
    count(*) FILTER (WHERE abs(difference) < 0.005) AS matched,
    count(*) FILTER (WHERE abs(difference) >= 0.005) AS mismatched,
    round(coalesce(sum(difference), 0), 2) AS net_difference
  FROM public.customer_ledger_balances
), b AS (
  SELECT jsonb_agg(jsonb_build_object(
           'customer', name, 'ledger', ledger_balance,
           'stored', legacy_balance, 'diff', difference)
         ORDER BY abs(difference) DESC) AS top
  FROM (SELECT * FROM public.customer_ledger_balances
         WHERE abs(difference) >= 0.005
         ORDER BY abs(difference) DESC LIMIT 15) t
), c AS (
  SELECT jsonb_agg(jsonb_build_object(
           'entry_type', entry_type, 'reference_type', reference_type,
           'rows', n, 'debit', debit, 'credit', credit))
         AS sources
  FROM (SELECT entry_type, reference_type, count(*) AS n,
               round(sum(debit), 2) AS debit, round(sum(credit), 2) AS credit
          FROM public.customer_ledger
         GROUP BY 1, 2 ORDER BY n DESC) s
), d AS (
  SELECT jsonb_agg(jsonb_build_object('entry_type', entry_type, 'reference_type', reference_type, 'rows', n)) AS no_source_key
  FROM (SELECT entry_type, reference_type, count(*) AS n
          FROM public.customer_ledger WHERE source_key IS NULL
         GROUP BY 1, 2) s
), e AS (
  SELECT count(*) AS returns_rows, round(coalesce(sum(credit), 0), 2) AS returns_credit
  FROM public.customer_ledger WHERE reference_type = 'sales_return'
), f AS (
  SELECT count(*) AS opening_rows, round(coalesce(sum(debit), 0), 2) AS opening_debit,
         round(coalesce(sum(credit), 0), 2) AS opening_credit
  FROM public.customer_ledger
  WHERE reference_type IN ('opening_balance', 'opening_balance_reversal')
), g AS (
  SELECT count(*) AS payments_without_ledger
  FROM public.customer_payments p
  WHERE NOT EXISTS (SELECT 1 FROM public.customer_ledger l
                     WHERE l.reference_type = 'customer_payment' AND l.reference_id = p.id)
), h AS (
  SELECT count(*) AS ledger_rows_with_missing_payment
  FROM public.customer_ledger l
  WHERE l.reference_type = 'customer_payment'
    AND NOT EXISTS (SELECT 1 FROM public.customer_payments p WHERE p.id = l.reference_id)
), i AS (
  SELECT count(*) AS journal_lines_customer_partner FROM public.journal_lines
  WHERE partner_type = 'customer'
), j AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object('trigger', tgname)), '[]'::jsonb) AS ledger_triggers
  FROM pg_trigger t JOIN pg_class cl ON cl.oid = t.tgrelid
  WHERE cl.relname = 'customer_ledger' AND NOT t.tgisinternal
), k AS (
  SELECT coalesce(jsonb_agg(proname ORDER BY proname), '[]'::jsonb) AS functions_updating_balance
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND pg_get_functiondef(p.oid) ILIKE '%UPDATE public.customers%'
), l AS (
  SELECT count(*) AS invoices_with_returns FROM public.sales_returns WHERE invoice_id IS NOT NULL
), m AS (
  SELECT count(*) AS negative_stored_balances FROM public.customers WHERE balance < 0
)
SELECT jsonb_build_object(
  'summary', (SELECT to_jsonb(a) FROM a),
  'top_differences', (SELECT top FROM b),
  'ledger_sources', (SELECT sources FROM c),
  'rows_without_source_key', (SELECT no_source_key FROM d),
  'returns', (SELECT to_jsonb(e) FROM e),
  'opening', (SELECT to_jsonb(f) FROM f),
  'payments_without_ledger', (SELECT to_jsonb(g) FROM g),
  'ledger_without_payment', (SELECT to_jsonb(h) FROM h),
  'journal_lines_customer_partner', (SELECT to_jsonb(i) FROM i),
  'ledger_triggers', (SELECT ledger_triggers FROM j),
  'functions_updating_balance', (SELECT functions_updating_balance FROM k),
  'invoices_with_returns', (SELECT to_jsonb(l) FROM l),
  'negative_stored_balances', (SELECT to_jsonb(m) FROM m)
) AS audit;
