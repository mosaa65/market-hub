-- Enforce the four operator choices across every financial write path.
--
-- Supported choices: cash, credit, bank transfer, mobile wallet.
-- `split` remains a document result written by the split RPCs, not a selectable
-- method. Retired catalogue rows and enum values stay available for historical
-- records, while new settings and financial writes reject them.

BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_method_settings_archive (
  payment_method_id text PRIMARY KEY,
  settings_snapshot jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archived_by uuid DEFAULT auth.uid()
);

ALTER TABLE public.payment_method_settings_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_method_settings_archive_finance_read
  ON public.payment_method_settings_archive;
CREATE POLICY payment_method_settings_archive_finance_read
  ON public.payment_method_settings_archive
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'owner') OR
    public.has_role(auth.uid(), 'manager') OR
    public.has_role(auth.uid(), 'accountant')
  );
REVOKE ALL ON public.payment_method_settings_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_method_settings_archive TO authenticated;
GRANT ALL ON public.payment_method_settings_archive TO service_role;

-- Keep retired catalogue identities for history, but never let a new active
-- tender enter through direct SQL or a future authoring path.
CREATE OR REPLACE FUNCTION public.guard_four_payment_method_catalogue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active AND NEW.id NOT IN (
    'cash', 'credit', 'bank_transfer', 'mobile_money', 'split'
  ) THEN
    RAISE EXCEPTION 'Only four payment methods and the split document state may remain active: %', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_four_payment_method_catalogue ON public.payment_methods;
CREATE TRIGGER trg_four_payment_method_catalogue
  BEFORE INSERT OR UPDATE OF id, is_active ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_catalogue();

-- Settings can only be created for the four operator-facing methods.
CREATE OR REPLACE FUNCTION public.payment_method_settings_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed text[];
BEGIN
  IF NEW.payment_method_id NOT IN ('cash', 'credit', 'bank_transfer', 'mobile_money') THEN
    RAISE EXCEPTION 'Only the four approved payment methods may have settings: %', NEW.payment_method_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT allowed_contexts INTO v_allowed
    FROM public.payment_methods
   WHERE id = NEW.payment_method_id AND is_active = true;

  IF v_allowed IS NULL THEN
    RAISE EXCEPTION 'Payment method is missing or inactive: %', NEW.payment_method_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.enabled_contexts IS NOT NULL AND NOT (NEW.enabled_contexts <@ v_allowed) THEN
    RAISE EXCEPTION 'Payment method contexts exceed the catalogue policy: %', NEW.payment_method_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- A central server-side write guard. Historical rows remain readable; the
-- operator and financial RPCs can only resolve one of the four canonical IDs.
CREATE OR REPLACE FUNCTION public.resolve_writable_payment_method(
  p_value text,
  p_context text,
  p_strict_context boolean DEFAULT true
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text;
  v_stored text;
  v_enabled boolean;
BEGIN
  v_id := public.payment_method_resolve_id(p_value);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'طريقة دفع غير صالحة: %', coalesce(p_value, '(فارغ)')
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_id NOT IN ('cash', 'credit', 'bank_transfer', 'mobile_money') THEN
    RAISE EXCEPTION 'طريقة الدفع متوقفة. الخيارات المعتمدة: نقداً، آجل، تحويل بنكي، محفظة إلكترونية.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(s.enabled, true) AND m.is_active
    INTO v_enabled
    FROM public.payment_methods m
    LEFT JOIN public.payment_method_settings s ON s.payment_method_id = m.id
   WHERE m.id = v_id;
  IF v_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'طريقة الدفع غير مفعّلة: %', p_value
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_strict_context AND NOT public.payment_method_is_allowed(v_id, coalesce(p_context, 'pos')) THEN
    RAISE EXCEPTION 'طريقة الدفع غير مسموح بها في هذا القسم: %', p_value
      USING ERRCODE = 'check_violation';
  END IF;

  v_stored := public.payment_method_legacy_id(v_id);
  IF v_stored IS NULL THEN
    RAISE EXCEPTION 'تعذّر تحويل طريقة الدفع إلى قيمة قاعدة بيانات: %', p_value
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_stored;
END $$;

-- Financial table triggers close legacy RPC/direct-write gaps. Unchanged
-- historical values remain editable for unrelated fields; changing or adding
-- a payment value must pass the same four-method guard.
CREATE OR REPLACE FUNCTION public.guard_four_payment_method_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_method text := nullif(lower(btrim(to_jsonb(NEW) ->> TG_ARGV[0])), '');
  v_method_id text;
  v_context text := TG_ARGV[2];
  v_old_method text;
  v_old_id text;
  v_allow_split boolean := coalesce(TG_ARGV[3], 'false')::boolean;
  v_allow_credit boolean := coalesce(TG_ARGV[4], 'false')::boolean;
  v_resolved text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_method := nullif(lower(btrim(to_jsonb(OLD) ->> TG_ARGV[0])), '');
    IF TG_ARGV[1] <> '' THEN
      v_old_id := nullif(to_jsonb(OLD) ->> TG_ARGV[1], '');
    END IF;
  END IF;
  IF TG_ARGV[1] <> '' THEN
    v_method_id := nullif(to_jsonb(NEW) ->> TG_ARGV[1], '');
  END IF;
  IF TG_OP = 'UPDATE'
     AND v_method IS NOT DISTINCT FROM v_old_method
     AND v_method_id IS NOT DISTINCT FROM v_old_id THEN
    RETURN NEW;
  END IF;
  IF v_method IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_method = 'split' AND v_allow_split THEN
    RETURN NEW;
  END IF;
  IF v_method = 'credit' AND NOT v_allow_credit THEN
    RAISE EXCEPTION 'Credit is not a tender for this transaction type'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_context = 'document' THEN
    v_context := CASE to_jsonb(NEW) ->> 'document_type'
      WHEN 'purchase_invoice' THEN 'purchases'
      WHEN 'milling_service_document' THEN 'sales'
      ELSE NULL
    END;
  END IF;
  v_resolved := public.resolve_writable_payment_method(
    coalesce(v_method_id, v_method), v_context, true
  );
  IF v_resolved IS DISTINCT FROM v_method THEN
    RAISE EXCEPTION 'Payment method identity does not match stored value (%)', v_method
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_four_payment_methods_sales_invoice ON public.sales_invoices;
CREATE TRIGGER trg_four_payment_methods_sales_invoice
  BEFORE INSERT OR UPDATE ON public.sales_invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('payment_method','payment_method_id','sales','true','true');

DROP TRIGGER IF EXISTS trg_four_payment_methods_purchase_invoice ON public.purchase_invoices;
CREATE TRIGGER trg_four_payment_methods_purchase_invoice
  BEFORE INSERT OR UPDATE ON public.purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('payment_method','payment_method_id','purchases','true','true');

DROP TRIGGER IF EXISTS trg_four_payment_methods_customer_payment ON public.customer_payments;
CREATE TRIGGER trg_four_payment_methods_customer_payment
  BEFORE INSERT OR UPDATE ON public.customer_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('payment_method','payment_method_id','customer_collection','false','false');

DROP TRIGGER IF EXISTS trg_four_payment_methods_customer_split ON public.customer_payment_splits;
CREATE TRIGGER trg_four_payment_methods_customer_split
  BEFORE INSERT OR UPDATE ON public.customer_payment_splits
  FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('method','payment_method_id','customer_collection','false','false');

DROP TRIGGER IF EXISTS trg_four_payment_methods_purchase_milling_split ON public.payment_splits;
CREATE TRIGGER trg_four_payment_methods_purchase_milling_split
  BEFORE INSERT OR UPDATE ON public.payment_splits
  FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('method','payment_method_id','document','false','false');

DROP TRIGGER IF EXISTS trg_four_payment_methods_expense ON public.expenses;
CREATE TRIGGER trg_four_payment_methods_expense
  BEFORE INSERT OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('payment_method','','expenses','false','false');

DROP TRIGGER IF EXISTS trg_four_payment_methods_expense_payment ON public.expense_payments;
CREATE TRIGGER trg_four_payment_methods_expense_payment
  BEFORE INSERT OR UPDATE ON public.expense_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('payment_method','payment_method_id','expenses','false','false');

DROP TRIGGER IF EXISTS trg_four_payment_methods_sales_return ON public.sales_returns;
CREATE TRIGGER trg_four_payment_methods_sales_return
  BEFORE INSERT OR UPDATE ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('refund_method','payment_method_id','sales_returns','false','false');

DROP TRIGGER IF EXISTS trg_four_payment_methods_purchase_return ON public.purchase_returns;
CREATE TRIGGER trg_four_payment_methods_purchase_return
  BEFORE INSERT OR UPDATE ON public.purchase_returns
  FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('refund_method','payment_method_id','purchase_returns','false','true');

DROP TRIGGER IF EXISTS trg_four_payment_methods_supplier_payment ON public.supplier_payments;
CREATE TRIGGER trg_four_payment_methods_supplier_payment
  BEFORE INSERT OR UPDATE ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_four_payment_method_write('payment_method','','purchases','false','false');

REVOKE ALL ON FUNCTION public.guard_four_payment_method_write() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_four_payment_method_catalogue() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_tenant_payment_method(text, text, text, text, text, text[], boolean)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

-- Rollback: restore payment_method_settings_guard() and
-- resolve_writable_payment_method() from migration 16; drop the listed guards
-- and trigger function, restore execute on create_tenant_payment_method, and
-- retain payment_method_settings_archive until any archived settings are restored.
