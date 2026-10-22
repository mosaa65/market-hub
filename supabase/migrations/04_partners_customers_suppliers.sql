-- ============================================================================
-- 05_partners_customers_suppliers.sql
--
-- المخزون وحركاته: الأرصدة، الحركات، طبقات التكلفة، الدفعات، التحويلات، الأرصدة الافتتاحية، التسويات.
--
-- مُستخرج من الحالة النهائية الحقيقية لقاعدة البيانات، لا من تاريخ الملفات.
-- لا يحتوي أي بيانات أعمال أو تجارية. راجع supabase/MIGRATIONS_RULES.md
-- ============================================================================

-- ── TABLES ────────────────────────────────────────────────────────────────
CREATE TABLE public.customers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  phone text,
  email text,
  address text,
  credit_limit numeric(14,2) DEFAULT 0 NOT NULL,
  balance numeric(14,2) DEFAULT 0 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  loyalty_points numeric DEFAULT 0 NOT NULL,
  -- P1-6: كيان نظامي (العميل النقدي). العلامة أساس الحماية، لا الاسم.
  is_system boolean DEFAULT false NOT NULL,
  system_key text
);

CREATE TABLE public.suppliers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  phone text,
  email text,
  address text,
  balance numeric(14,2) DEFAULT 0 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  is_system boolean DEFAULT false NOT NULL,
  system_key text
);

CREATE TABLE public.customer_ledger (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  customer_id uuid NOT NULL,
  entry_type text NOT NULL,
  debit numeric(14,2) DEFAULT 0 NOT NULL,
  credit numeric(14,2) DEFAULT 0 NOT NULL,
  reference_id uuid,
  reference_type text,
  occurred_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid,
  note text,
  source_key text
);

CREATE TABLE public.loyalty_transactions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  customer_id uuid NOT NULL,
  points numeric NOT NULL,
  kind text NOT NULL,
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ── CONSTRAINTS ───────────────────────────────────────────────────────────
ALTER TABLE public.customers ADD CONSTRAINT "customers_credit_limit_nonnegative" CHECK ((credit_limit >= (0)::numeric));
ALTER TABLE public.customers ADD CONSTRAINT "customers_pkey" PRIMARY KEY (id);
ALTER TABLE public.suppliers ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY (id);
ALTER TABLE public.customer_ledger ADD CONSTRAINT "customer_ledger_check" CHECK ((NOT ((debit > (0)::numeric) AND (credit > (0)::numeric))));
ALTER TABLE public.customer_ledger ADD CONSTRAINT "customer_ledger_check1" CHECK (((debit + credit) > (0)::numeric));
ALTER TABLE public.customer_ledger ADD CONSTRAINT "customer_ledger_credit_check" CHECK ((credit >= (0)::numeric));
ALTER TABLE public.customer_ledger ADD CONSTRAINT "customer_ledger_debit_check" CHECK ((debit >= (0)::numeric));
ALTER TABLE public.customer_ledger ADD CONSTRAINT "customer_ledger_entry_type_check" CHECK ((entry_type = ANY (ARRAY['sale'::text, 'payment'::text, 'return'::text, 'adjustment'::text, 'credit'::text])));
ALTER TABLE public.customer_ledger ADD CONSTRAINT "customer_ledger_pkey" PRIMARY KEY (id);
ALTER TABLE public.customer_ledger ADD CONSTRAINT "customer_ledger_source_key_key" UNIQUE (source_key);
ALTER TABLE public.loyalty_transactions ADD CONSTRAINT "loyalty_transactions_kind_check" CHECK ((kind = ANY (ARRAY['earn'::text, 'redeem'::text, 'adjust'::text])));
ALTER TABLE public.loyalty_transactions ADD CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY (id);
ALTER TABLE public.customers ADD CONSTRAINT "customers_system_key_unique" UNIQUE (system_key);
ALTER TABLE public.suppliers ADD CONSTRAINT "suppliers_system_key_unique" UNIQUE (system_key);
-- العلامة والمفتاح وجهان لحالة واحدة، فلا صف نظامي بلا مفتاح ولا مفتاح بلا علامة.
ALTER TABLE public.customers ADD CONSTRAINT "customers_system_flag_shape" CHECK (is_system = (system_key IS NOT NULL));
ALTER TABLE public.suppliers ADD CONSTRAINT "suppliers_system_flag_shape" CHECK (is_system = (system_key IS NOT NULL));

COMMENT ON COLUMN public.customers.is_system IS
  'P1-6: كيان نظامي (العميل النقدي) — اسمه وحالته وحذفه محمية في القاعدة، ومخفي من دليل العملاء.';
COMMENT ON COLUMN public.suppliers.is_system IS
  'P1-6: كيان نظامي (المورد النقدي) — اسمه وحالته وحذفه محمية في القاعدة، ومخفي من دليل الموردين.';

-- ── FUNCTIONS ────────────────────────────────────────────────────────────
-- P1-6 — حراس الكيانات النظامية. العلامة is_system لا تُكتب من الواجهة: أي
-- تعديل يمحوها (حتى من service_role) يُرفض، فلا مخرج للحماية عبر API.
CREATE OR REPLACE FUNCTION public.is_system_customer(p_customer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce((SELECT c.is_system FROM public.customers c WHERE c.id = p_customer_id), false);
$function$;

CREATE OR REPLACE FUNCTION public.is_system_supplier(p_supplier_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce((SELECT s.is_system FROM public.suppliers s WHERE s.id = p_supplier_id), false);
$function$;

CREATE OR REPLACE FUNCTION public.tg_customers_system_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION
        'The system cash customer is a protected system entity and cannot be deleted'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_system THEN
    IF NEW.is_system IS DISTINCT FROM true OR NEW.system_key IS DISTINCT FROM OLD.system_key THEN
      RAISE EXCEPTION
        'The system cash customer flag cannot be cleared or re-keyed'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      RAISE EXCEPTION
        'The system cash customer cannot be renamed'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'The system cash customer cannot be deactivated'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF coalesce(NEW.balance, 0) <> 0 THEN
      RAISE EXCEPTION
        'The system cash customer must keep a zero balance (got %)', NEW.balance
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.is_system THEN
      RAISE EXCEPTION
        'System entities are provisioned by the seed, not created through the API'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.name IN ('عميل نقدي') THEN
      RAISE EXCEPTION
        'That name is reserved for the system cash customer'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.tg_suppliers_system_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION
        'The system cash supplier is a protected system entity and cannot be deleted'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_system THEN
    IF NEW.is_system IS DISTINCT FROM true OR NEW.system_key IS DISTINCT FROM OLD.system_key THEN
      RAISE EXCEPTION
        'The system cash supplier flag cannot be cleared or re-keyed'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      RAISE EXCEPTION
        'The system cash supplier cannot be renamed'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'The system cash supplier cannot be deactivated'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF coalesce(NEW.balance, 0) <> 0 THEN
      RAISE EXCEPTION
        'The system cash supplier must keep a zero balance (got %)', NEW.balance
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.is_system THEN
      RAISE EXCEPTION
        'System entities are provisioned by the seed, not created through the API'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.name IN ('مورد نقدي') THEN
      RAISE EXCEPTION
        'That name is reserved for the system cash supplier'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  RETURN NEW;
END $function$;

-- حراس النظاميين على قيود الذمة: لا بيع آجل ولا شراء آجل ولا مرتجع يترك
-- رصيداً على الكيان النقدي. سطر التسوية (صفر الصافي) مسموح.
CREATE OR REPLACE FUNCTION public.tg_customer_ledger_system_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(NEW.debit, 0) - coalesce(NEW.credit, 0) <> 0 AND public.is_system_customer(NEW.customer_id) THEN
    RAISE EXCEPTION
      'The system cash customer can only carry settlement lines, never a credit balance'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $function$;

-- ── TRIGGERS ─────────────────────────────────────────────────────────────
CREATE TRIGGER tg_customers_system_guard
  BEFORE UPDATE OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.tg_customers_system_guard();

CREATE TRIGGER tg_suppliers_system_guard
  BEFORE UPDATE OR DELETE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.tg_suppliers_system_guard();

CREATE TRIGGER tg_customer_ledger_system_guard
  BEFORE INSERT ON public.customer_ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_customer_ledger_system_guard();

-- ── INDEXES ───────────────────────────────────────────────────────────────
CREATE INDEX customer_ledger_customer_date_idx ON public.customer_ledger USING btree (customer_id, occurred_at, id);
CREATE INDEX idx_loyalty_customer ON public.loyalty_transactions USING btree (customer_id, created_at DESC);
-- فهرس جزئي: قائمة العملاء/الموردين العادية تفلتر is_system=false في كل استعلام.
CREATE INDEX idx_customers_is_system ON public.customers USING btree (is_system) WHERE is_system;
CREATE INDEX idx_suppliers_is_system ON public.suppliers USING btree (is_system) WHERE is_system;

-- ── SEQUENCES ─────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.stock_adjustment_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.stock_opening_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.stock_transfer_seq START 1;

