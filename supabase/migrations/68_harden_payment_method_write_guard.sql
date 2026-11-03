-- Close two edge cases in the generic payment-column trigger:
-- 1. reject a payment_method_id supplied without its matching stored method;
-- 2. accept the split marker only when its optional ID is also `split`.

BEGIN;

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

  IF v_method IS NULL AND v_method_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_method IS NULL THEN
    RAISE EXCEPTION 'A catalogue ID cannot be supplied without a stored payment method'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_method = 'split' AND v_allow_split THEN
    IF v_method_id IS NOT NULL AND v_method_id <> 'split' THEN
      RAISE EXCEPTION 'The split document state cannot use a tender catalogue ID'
        USING ERRCODE = 'check_violation';
    END IF;
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

COMMIT;

-- Rollback: restore guard_four_payment_method_write() from migration 67.
