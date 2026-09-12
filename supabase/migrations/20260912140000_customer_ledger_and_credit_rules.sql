-- Ledger foundation: customer_ledger is the auditable source for customer balances.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS enforce_customer_credit_limit boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.customer_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('sale','payment','return','adjustment','credit')),
  debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  reference_id uuid,
  reference_type text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  source_key text UNIQUE,
  CHECK (NOT (debit > 0 AND credit > 0)),
  CHECK (debit + credit > 0)
);

CREATE INDEX IF NOT EXISTS customer_ledger_customer_date_idx
  ON public.customer_ledger(customer_id, occurred_at, id);

ALTER TABLE public.customer_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_ledger_view ON public.customer_ledger;
CREATE POLICY customer_ledger_view ON public.customer_ledger
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.customer_ledger FROM authenticated, anon;
GRANT SELECT ON public.customer_ledger TO authenticated;

CREATE OR REPLACE VIEW public.customer_ledger_balances
WITH (security_invoker = true) AS
SELECT c.id AS customer_id,
       c.name,
       round(coalesce(sum(l.debit - l.credit), 0), 2) AS ledger_balance,
       c.balance AS legacy_balance,
       round(coalesce(sum(l.debit - l.credit), 0) - c.balance, 2) AS difference
FROM public.customers c
LEFT JOIN public.customer_ledger l ON l.customer_id = c.id
GROUP BY c.id, c.name, c.balance;

GRANT SELECT ON public.customer_ledger_balances TO authenticated;

-- Allow a zero limit to mean unlimited until the owner explicitly enables enforcement.
CREATE OR REPLACE FUNCTION public.customer_credit_limit_allows(
  p_customer_id uuid, p_new_due numeric
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.customers AS c
    CROSS JOIN public.company_settings AS s
    WHERE c.id = p_customer_id
      AND (
        NOT s.enforce_customer_credit_limit
        OR coalesce(c.credit_limit, 0) = 0
        OR coalesce(c.balance, 0) + greatest(coalesce(p_new_due, 0), 0) <= c.credit_limit
      )
  )
$$;
REVOKE ALL ON FUNCTION public.customer_credit_limit_allows(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_credit_limit_allows(uuid, numeric) TO authenticated;

-- Historical migration is idempotent and keeps a source key for auditability.
INSERT INTO public.customer_ledger(customer_id, entry_type, debit, credit, reference_id, reference_type, occurred_at, source_key, note)
SELECT s.customer_id, 'sale', round(greatest(s.total - s.paid, 0), 2), 0, s.id, 'sales_invoice', s.created_at,
       'migration:sale:' || s.id, 'ترحيل رصيد الفواتير السابقة'
FROM public.sales_invoices s
WHERE s.customer_id IS NOT NULL AND s.total > s.paid
ON CONFLICT (source_key) DO NOTHING;

INSERT INTO public.customer_ledger(customer_id, entry_type, debit, credit, reference_id, reference_type, occurred_at, source_key, note)
SELECT p.customer_id, 'payment', 0, round(p.amount, 2), p.id, 'customer_payment', p.payment_date::timestamptz,
       'migration:payment:' || p.id, 'ترحيل الدفعات السابقة'
FROM public.customer_payments p
WHERE p.customer_id IS NOT NULL AND p.amount > 0
ON CONFLICT (source_key) DO NOTHING;

-- Reconcile the legacy cache to the ledger without deleting historical data.
UPDATE public.customers c
SET balance = b.ledger_balance, updated_at = now()
FROM public.customer_ledger_balances b
WHERE b.customer_id = c.id AND c.balance IS DISTINCT FROM b.ledger_balance;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_credit_limit_nonnegative,
  ADD CONSTRAINT customers_credit_limit_nonnegative CHECK (credit_limit >= 0),
  DROP CONSTRAINT IF EXISTS customers_balance_nonnegative;

COMMENT ON COLUMN public.company_settings.enforce_customer_credit_limit IS 'عند false، الحد صفر يعني آجل بلا سقف. عند true، يطبّق السقف على الديون الجديدة.';
COMMENT ON VIEW public.customer_ledger_balances IS 'الرصيد المحسوب من دفتر حركة العميل ومقارنة الرصيد القديم.';

-- Keep function execution safe while the application migrates to ledger-aware RPCs.
CREATE OR REPLACE FUNCTION public.customer_ledger_balance(p_customer_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT round(coalesce(sum(l.debit - l.credit), 0), 2)
  FROM public.customer_ledger AS l
  WHERE l.customer_id = p_customer_id
$$;
REVOKE ALL ON FUNCTION public.customer_ledger_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_ledger_balance(uuid) TO authenticated;

-- Helpful audit query for reconciliation screens.
CREATE OR REPLACE VIEW public.customer_balance_reconciliation
WITH (security_invoker = true) AS
SELECT * FROM public.customer_ledger_balances WHERE difference <> 0;
GRANT SELECT ON public.customer_balance_reconciliation TO authenticated;

-- Future direct table writes remain blocked; financial RPCs should append ledger rows in-transaction.
