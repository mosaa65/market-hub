-- ============================================================================
-- الترحيل 001_extensions_and_types.sql — مجال: extensions_and_types
-- جزء من خط الأساس الجديد: تعريف نهائي واحد لكل كائن، مبني من مخطط مرجعي
-- مستخرج من الترحيلات التاريخية الكاملة (راجع supabase/migrations/README.md).
-- ============================================================================

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'كل العروض في هذا المخطط تعمل بـ security_invoker = true: صلاحيات القارئ وRLS الجداول الأساسية هي المرجع، لا صلاحيات المالك.';

--
-- Name: account_type; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.account_type AS ENUM (
    'ASSET',
    'LIABILITY',
    'EQUITY',
    'REVENUE',
    'EXPENSE'
);


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.app_role AS ENUM (
    'owner',
    'manager',
    'accountant',
    'cashier',
    'warehouse'
);


--
-- Name: costing_method; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.costing_method AS ENUM (
    'MOVING_AVERAGE',
    'FIFO',
    'STANDARD',
    'NONE'
);


--
-- Name: custody_entry_type; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.custody_entry_type AS ENUM (
    'INTAKE',
    'MILLING',
    'DELIVERY',
    'ADJUSTMENT'
);


--
-- Name: expense_entry_type; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.expense_entry_type AS ENUM (
    'DIRECT',
    'EMPLOYEE',
    'SUPPLIER',
    'RECURRING',
    'ADVANCE'
);


--
-- Name: expense_payee_type; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.expense_payee_type AS ENUM (
    'NONE',
    'SUPPLIER',
    'EMPLOYEE',
    'OTHER'
);


--
-- Name: expense_source_kind; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.expense_source_kind AS ENUM (
    'MANUAL',
    'LEGACY',
    'RECURRING',
    'IMPORT'
);


--
-- Name: expense_status; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.expense_status AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'APPROVED',
    'REJECTED',
    'POSTED',
    'PARTIALLY_PAID',
    'PAID',
    'CLOSED',
    'CANCELLED',
    'REVERSED'
);


--
-- Name: expense_tax_mode; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.expense_tax_mode AS ENUM (
    'NONE',
    'INCLUSIVE',
    'EXCLUSIVE'
);


--
-- Name: inventory_policy; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.inventory_policy AS ENUM (
    'TRACKED',
    'UNTRACKED',
    'CUSTOMER_OWNED'
);


--
-- Name: invoice_status; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.invoice_status AS ENUM (
    'draft',
    'confirmed',
    'cancelled',
    'returned'
);


--
-- Name: item_class; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.item_class AS ENUM (
    'RAW_MATERIAL',
    'FINISHED_GOOD',
    'BY_PRODUCT',
    'SERVICE',
    'NON_STOCK_ITEM',
    'PACKAGING'
);


--
-- Name: item_nature; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.item_nature AS ENUM (
    'GOOD',
    'SERVICE'
);


--
-- Name: item_status; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.item_status AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'ARCHIVED'
);


--
-- Name: item_tracking; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.item_tracking AS ENUM (
    'NONE',
    'BATCH',
    'SERIAL'
);


--
-- Name: movement_type; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.movement_type AS ENUM (
    'purchase',
    'sale',
    'adjustment',
    'transfer_in',
    'transfer_out',
    'sale_return',
    'purchase_return',
    'opening',
    'production_in',
    'production_out'
);


--
-- Name: owner_type; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.owner_type AS ENUM (
    'COMPANY',
    'CUSTOMER',
    'SUPPLIER',
    'OTHER'
);


--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.payment_method AS ENUM (
    'cash',
    'card',
    'bank_transfer',
    'mobile_money',
    'cheque',
    'credit',
    'split'
);


--
-- Name: TYPE payment_method; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TYPE public.payment_method IS 'القيمة المخزّنة على المستند. لا تُستخدم للعرض ولا للتفعيل؛ العرض والتفعيل والأقسام تأتي من public.payment_methods.';

--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.payment_status AS ENUM (
    'unpaid',
    'partial',
    'paid',
    'overpaid'
);


--
-- Name: stock_movement_kind; Type: TYPE; Schema: public; Owner: supabase_admin
--

CREATE TYPE public.stock_movement_kind AS ENUM (
    'RECEIPT',
    'ISSUE',
    'TRANSFER_IN',
    'TRANSFER_OUT',
    'ADJUSTMENT',
    'OPENING',
    'PRODUCTION'
);
