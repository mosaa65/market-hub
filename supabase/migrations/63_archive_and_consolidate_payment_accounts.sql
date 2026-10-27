-- بنية أرشيف حسابات الدفع والطرق التاريخية.
-- لا ينفذ بيانات تشغيلية؛ تنفيذ التوحيد والحذف موجود في سكربت يدوي منفصل
-- وفق قاعدة R-21 في دليل الترحيلات.

BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_account_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archived_account_id uuid NOT NULL,
  account_code text NOT NULL,
  target_account_id uuid NOT NULL,
  target_account_code text NOT NULL,
  account_snapshot jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archived_by uuid DEFAULT auth.uid(),
  CONSTRAINT payment_account_archive_identity_key UNIQUE (archived_account_id)
);

CREATE TABLE IF NOT EXISTS public.payment_account_journal_archive (
  journal_line_id uuid PRIMARY KEY,
  entry_id uuid NOT NULL,
  archived_account_id uuid NOT NULL,
  target_account_id uuid NOT NULL,
  debit numeric(18,2) NOT NULL,
  credit numeric(18,2) NOT NULL,
  memo text,
  partner_type text,
  partner_id uuid,
  line_created_at timestamptz NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payment_account_reference_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relation_name text NOT NULL,
  column_name text NOT NULL,
  row_snapshot jsonb NOT NULL,
  archived_account_id uuid NOT NULL,
  target_account_id uuid NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_account_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_account_journal_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_account_reference_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_account_archive_finance_read ON public.payment_account_archive;
CREATE POLICY payment_account_archive_finance_read ON public.payment_account_archive
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'accountant'));
DROP POLICY IF EXISTS payment_account_journal_archive_finance_read ON public.payment_account_journal_archive;
CREATE POLICY payment_account_journal_archive_finance_read ON public.payment_account_journal_archive
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'accountant'));
DROP POLICY IF EXISTS payment_account_reference_archive_finance_read ON public.payment_account_reference_archive;
CREATE POLICY payment_account_reference_archive_finance_read ON public.payment_account_reference_archive
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'accountant'));
REVOKE ALL ON public.payment_account_archive, public.payment_account_journal_archive,
  public.payment_account_reference_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_account_archive, public.payment_account_journal_archive,
  public.payment_account_reference_archive TO authenticated;
GRANT ALL ON public.payment_account_archive, public.payment_account_journal_archive,
  public.payment_account_reference_archive TO service_role;

CREATE OR REPLACE FUNCTION public.payment_method_ledger_account(p_stored text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE lower(btrim(coalesce(p_stored, '')))
    WHEN 'credit' THEN NULL
    WHEN 'split' THEN NULL
    WHEN 'cash' THEN '1101'
    WHEN 'bank' THEN '1111'
    WHEN 'bank_transfer' THEN '1111'
    WHEN 'card' THEN '1111'
    WHEN 'kuraimi_bank' THEN '1111'
    WHEN 'yemen_kuwait_bank' THEN '1111'
    WHEN 'cheque' THEN '1221'
    WHEN 'mobile_money' THEN '1131'
    WHEN 'wallet' THEN '1131'
    WHEN 'jawali' THEN '1131'
    WHEN 'jaib' THEN '1131'
    WHEN 'floosak' THEN '1131'
    WHEN 'one_cash' THEN '1131'
    ELSE m.default_account_code
  END
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.payment_methods m ON m.id = public.payment_method_resolve_id(p_stored);
$$;

REVOKE ALL ON FUNCTION public.payment_method_ledger_account(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_method_ledger_account(text) TO service_role;

COMMENT ON TABLE public.payment_account_archive IS
  'لقطة غير قابلة للتحرير من حسابات الدفع الموحّدة؛ تحفظ الكود والهوية والحساب الهدف.';
COMMENT ON TABLE public.payment_account_journal_archive IS
  'يحفظ الحساب التاريخي لكل سطر قيد قبل تحويله إلى حساب الدفع الموحد.';
COMMENT ON TABLE public.payment_account_reference_archive IS
  'يحفظ الصفوف التي تشير إلى حساب الدفع القديم قبل تحويل مراجعها إلى الحساب الموحد.';
COMMIT;

-- Rollback: drop the helper function and archive tables after restoring
-- any snapshots retained by the separate operational consolidation script.
