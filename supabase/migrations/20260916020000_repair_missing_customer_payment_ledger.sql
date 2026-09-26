-- ============================================================================
-- Non-destructive repair: append missing customer payment ledger entries.
--
-- Does not update/delete customer_payments, invoices, customers, or ledger rows.
-- Existing payment ledger rows are detected by reference_id/reference_type.
-- source_key is unique and makes this repair safe to run more than once.
-- ============================================================================

INSERT INTO public.customer_ledger (
  customer_id,
  entry_type,
  debit,
  credit,
  reference_id,
  reference_type,
  occurred_at,
  created_by,
  source_key,
  note
)
SELECT
  p.customer_id,
  'payment',
 0,
  round(p.amount, 2),
  p.id,
  'customer_payment',
  p.payment_date::timestamptz,
  p.created_by,
  'repair:payment:' || p.id,
  coalesce(nullif(trim(p.note), ''), 'إصلاح دفتر العميل — دفعة سابقة')
FROM public.customer_payments AS p
WHERE p.customer_id IS NOT NULL
  AND coalesce(p.amount, 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.customer_ledger AS l
    WHERE l.reference_id = p.id
      AND l.reference_type = 'customer_payment'
      AND l.entry_type = 'payment'
  )
ON CONFLICT (source_key) DO NOTHING;

DO $$
DECLARE
  duplicate_sources integer;
BEGIN
  SELECT count(*) INTO duplicate_sources
  FROM (
    SELECT source_key
    FROM public.customer_ledger
    WHERE source_key IS NOT NULL
    GROUP BY source_key
    HAVING count(*) > 1
  ) AS duplicates;

  IF duplicate_sources > 0 THEN
    RAISE EXCEPTION
      'Payment ledger repair stopped: % duplicate source_key groups exist',
      duplicate_sources;
  END IF;
END;
$$;
