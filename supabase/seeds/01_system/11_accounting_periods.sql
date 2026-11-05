-- ============================================================================
-- 11_accounting_periods.sql — current-year open accounting periods
-- ============================================================================
-- These are calendar reference periods, not company identity or transaction
-- data. A fresh installation needs an open period before it can post entries.

BEGIN;

INSERT INTO public.fiscal_periods (code, fiscal_year, period_no, start_date, end_date, status)
SELECT
  to_char(month_start, 'YYYY-MM'),
  EXTRACT(YEAR FROM month_start)::integer,
  EXTRACT(MONTH FROM month_start)::integer,
  month_start::date,
  (date_trunc('month', month_start) + interval '1 month - 1 day')::date,
  'OPEN'
FROM generate_series(
       date_trunc('year', CURRENT_DATE),
       date_trunc('year', CURRENT_DATE) + interval '11 months',
       interval '1 month'
     ) AS periods(month_start)
ON CONFLICT (code) DO NOTHING;

COMMIT;
