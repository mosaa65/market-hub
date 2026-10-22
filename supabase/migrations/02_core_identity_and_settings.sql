-- ============================================================================
-- 02_core_identity_and_settings.sql
--
-- الهوية والإعدادات: المستخدمون، الأدوار، إعدادات الشركة، المستودعات، الأجهزة، مفاتيح المزامنة.
--
-- مُستخرج من الحالة النهائية الحقيقية لقاعدة البيانات، لا من تاريخ الملفات.
-- لا يحتوي أي بيانات أعمال أو تجارية. راجع supabase/MIGRATIONS_RULES.md
-- ============================================================================

-- ── TABLES ────────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  full_name text,
  avatar_url text,
  phone text,
  language text DEFAULT 'en'::text NOT NULL,
  theme text DEFAULT 'dark'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  is_active boolean DEFAULT true NOT NULL
);

CREATE TABLE public.user_roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.platform_admins (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  mfa_required boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_login timestamp with time zone
);

CREATE TABLE public.company_settings (
  id integer DEFAULT 1 NOT NULL,
  name text DEFAULT 'My Company'::text NOT NULL,
  legal_name text,
  tax_number text,
  currency text DEFAULT 'YER'::text NOT NULL,
  currency_symbol text DEFAULT 'ر.ي'::text NOT NULL,
  tax_rate numeric(6,3) DEFAULT 0 NOT NULL,
  logo_url text,
  address text,
  phone text,
  email text,
  invoice_prefix text DEFAULT 'INV-'::text NOT NULL,
  barcode_enabled boolean DEFAULT true NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  enforce_customer_credit_limit boolean DEFAULT false NOT NULL,
  catalog_modules jsonb DEFAULT '{"profile": "spare_parts", "enableUnits": true, "enableBrands": true, "enableOrigins": true, "enableQualityGrades": true, "enableMakesAndModels": true}'::jsonb NOT NULL,
  purchase_invoice_prefix text DEFAULT 'PO-'::text NOT NULL,
  invoice_number_period text DEFAULT 'year_month'::text NOT NULL,
  invoice_number_digits smallint DEFAULT 4 NOT NULL,
  name_ar text,
  name_en text,
  contact_numbers text,
  footer_contact text,
  footer_text text
);

CREATE TABLE public.company_costing_settings (
  id smallint DEFAULT 1 NOT NULL,
  costing_method public.costing_method DEFAULT 'MOVING_AVERAGE'::costing_method NOT NULL,
  standard_cost_source text DEFAULT 'CATALOGUE'::text NOT NULL,
  effective_from date DEFAULT CURRENT_DATE NOT NULL,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  notes text
);

CREATE TABLE public.warehouses (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  code text,
  address text,
  is_default boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  name_ar text
);

CREATE TABLE public.device_registrations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  device_id text NOT NULL,
  device_name text NOT NULL,
  platform text DEFAULT 'browser'::text NOT NULL,
  assigned_warehouse_id uuid,
  is_active boolean DEFAULT true NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sync_idempotency_keys (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  idempotency_key text NOT NULL,
  entity_name text NOT NULL,
  operation_type text NOT NULL,
  origin_device_id text NOT NULL,
  status text DEFAULT 'processing'::text NOT NULL,
  response_payload jsonb,
  error_message text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.backup_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id text DEFAULT 'default'::text NOT NULL,
  actor_id uuid,
  actor_name text DEFAULT 'المالك (Owner)'::text NOT NULL,
  action_type text NOT NULL,
  storage_type text NOT NULL,
  status text NOT NULL,
  file_name text NOT NULL,
  file_size_bytes bigint DEFAULT 0 NOT NULL,
  metadata jsonb,
  error_message text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ── CORE AUTHORIZATION HELPERS ────────────────────────────────────────
-- is_staff / has_role: every RLS policy in this and every later file
-- calls one of these. They read public.user_roles, so they are defined
-- here, immediately after that table.
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
    AND COALESCE((SELECT is_active FROM public.profiles WHERE id = _user_id), false)
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$function$;

CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins
    WHERE user_id = p_user_id
      AND is_active = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_platform_superadmin(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- 'superadmin' only — not 'admin'. The table's CHECK constraint allows
  -- exactly two roles, superadmin and support, so a predicate accepting
  -- 'admin' could never be satisfied by a stored row: it was dead code that
  -- read as if a third role existed. 'support' is deliberately excluded —
  -- it is read-only and must not satisfy superadmin-only policies.
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins
    WHERE user_id = p_user_id
      AND role = 'superadmin'
      AND is_active = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.expense_role_rank(p_user uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.has_role(p_user, 'owner')      THEN 50
    WHEN public.has_role(p_user, 'manager')    THEN 40
    WHEN public.has_role(p_user, 'accountant') THEN 30
    WHEN public.has_role(p_user, 'cashier')    THEN 20
    WHEN public.has_role(p_user, 'warehouse')  THEN 10
    ELSE 0
  END
$function$;

CREATE OR REPLACE FUNCTION public.can_read_finance(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_staff(p_user) AND public.expense_role_rank(p_user) >= 30
$function$;

CREATE OR REPLACE FUNCTION public.can_operate_milling()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_staff(auth.uid())
     AND EXISTS (
       SELECT 1
       FROM public.user_roles ur
       WHERE ur.user_id = auth.uid()
         AND ur.role IN ('owner', 'manager', 'warehouse', 'cashier')
     );
$function$;

CREATE OR REPLACE FUNCTION public.can_view_milling()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_staff(auth.uid())
     AND EXISTS (
       SELECT 1
       FROM public.user_roles ur
       WHERE ur.user_id = auth.uid()
         AND ur.role IN ('owner', 'manager', 'accountant', 'warehouse', 'cashier')
     );
$function$;

-- ── IDENTITY TRIGGERS ─────────────────────────────────────────────────
-- tg_set_updated_at is attached to nearly every table by later migrations;
-- handle_new_user is the auth trigger that writes to public.profiles, which
-- exists above.
--
-- There is deliberately NO "first user becomes owner" trigger here. It was
-- removed: it granted a tenant role on a race rather than on a decision, so
-- whoever happened to sign up first — a customer, a typo, an abandoned test
-- account — silently became the owner of the deployment, and the grant could
-- not be withdrawn afterwards because the rule lived in the trigger, not in
-- the data. Roles are now assigned explicitly by someone who already holds
-- authority to assign them. See supabase/seeds/01_system/06_platform_admins.sql
-- for how the initial platform administrators are provisioned instead.
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END $function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, language, theme)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url',
    'ar',
    'dark'
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);

  RETURN NEW;
END;
$function$;

-- ── CONSTRAINTS ───────────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD CONSTRAINT "profiles_pkey" PRIMARY KEY (id);
ALTER TABLE public.user_roles ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY (id);
ALTER TABLE public.user_roles ADD CONSTRAINT "user_roles_user_id_role_key" UNIQUE (user_id, role);
ALTER TABLE public.platform_admins ADD CONSTRAINT "platform_admins_role_check" CHECK ((role = ANY (ARRAY['superadmin'::text, 'support'::text])));
ALTER TABLE public.platform_admins ADD CONSTRAINT "platform_admins_pkey" PRIMARY KEY (id);
ALTER TABLE public.platform_admins ADD CONSTRAINT "uq_platform_admin_user" UNIQUE (user_id);
ALTER TABLE public.company_settings ADD CONSTRAINT "company_settings_invoice_number_digits_check" CHECK (((invoice_number_digits >= 1) AND (invoice_number_digits <= 8)));
ALTER TABLE public.company_settings ADD CONSTRAINT "company_settings_invoice_number_period_check" CHECK ((invoice_number_period = ANY (ARRAY['none'::text, 'year'::text, 'year_month'::text])));
ALTER TABLE public.company_settings ADD CONSTRAINT "only_one_row" CHECK ((id = 1));
ALTER TABLE public.company_settings ADD CONSTRAINT "company_settings_pkey" PRIMARY KEY (id);
ALTER TABLE public.company_costing_settings ADD CONSTRAINT "company_costing_settings_singleton" CHECK ((id = 1));
ALTER TABLE public.company_costing_settings ADD CONSTRAINT "company_costing_settings_standard_cost_source_check" CHECK ((standard_cost_source = ANY (ARRAY['CATALOGUE'::text, 'ROLLING_AVERAGE'::text, 'MANUAL'::text])));
ALTER TABLE public.company_costing_settings ADD CONSTRAINT "company_costing_settings_pkey" PRIMARY KEY (id);
ALTER TABLE public.warehouses ADD CONSTRAINT "warehouses_pkey" PRIMARY KEY (id);
ALTER TABLE public.warehouses ADD CONSTRAINT "warehouses_code_key" UNIQUE (code);
ALTER TABLE public.device_registrations ADD CONSTRAINT "device_registrations_pkey" PRIMARY KEY (id);
ALTER TABLE public.device_registrations ADD CONSTRAINT "device_registrations_device_id_key" UNIQUE (device_id);
ALTER TABLE public.sync_idempotency_keys ADD CONSTRAINT "sync_idempotency_keys_pkey" PRIMARY KEY (id);
ALTER TABLE public.sync_idempotency_keys ADD CONSTRAINT "sync_idempotency_keys_idempotency_key_key" UNIQUE (idempotency_key);
ALTER TABLE public.backup_logs ADD CONSTRAINT "backup_logs_action_type_check" CHECK ((action_type = ANY (ARRAY['manual_local'::text, 'manual_cloud'::text, 'auto_scheduled'::text, 'pre_restore_safety'::text])));
ALTER TABLE public.backup_logs ADD CONSTRAINT "backup_logs_status_check" CHECK ((status = ANY (ARRAY['success'::text, 'failed'::text, 'in_progress'::text, 'pending'::text])));
ALTER TABLE public.backup_logs ADD CONSTRAINT "backup_logs_storage_type_check" CHECK ((storage_type = ANY (ARRAY['local'::text, 'cloud'::text, 'both'::text])));
ALTER TABLE public.backup_logs ADD CONSTRAINT "backup_logs_pkey" PRIMARY KEY (id);

-- ── INDEXES ───────────────────────────────────────────────────────────────
CREATE INDEX idx_sync_device_origin ON public.sync_idempotency_keys USING btree (origin_device_id, created_at);
CREATE INDEX idx_sync_idempotency_key ON public.sync_idempotency_keys USING btree (idempotency_key);
CREATE INDEX idx_backup_logs_tenant_created ON public.backup_logs USING btree (tenant_id, created_at DESC);

-- ── FUNCTIONS ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.normalize_auth_user_token_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.confirmation_token IS NULL THEN
    NEW.confirmation_token := '';
  END IF;
  IF NEW.recovery_token IS NULL THEN
    NEW.recovery_token := '';
  END IF;
  IF NEW.email_change_token_new IS NULL THEN
    NEW.email_change_token_new := '';
  END IF;
  IF NEW.email_change_token_current IS NULL THEN
    NEW.email_change_token_current := '';
  END IF;
  IF NEW.email_change IS NULL THEN
    NEW.email_change := '';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_apply_operation(p_idempotency_key text, p_entity_name text, p_operation_type text, p_origin_device_id text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing RECORD;
  v_result JSONB;
BEGIN
  -- ⚠️ المدخلات إلزامية: بلا هذا الفحص كان NULL يمر إلى idempotency_key
  --    (NOT NULL) فيظهر الخطأ كـ «null value in column ... violates not-null
  --    constraint» ملفوفًا برسالة غير مفهومة بدل رفض واضح للمدخل.
  IF nullif(btrim(coalesce(p_idempotency_key, '')), '') IS NULL
     OR nullif(btrim(coalesce(p_entity_name, '')), '') IS NULL
     OR nullif(btrim(coalesce(p_operation_type, '')), '') IS NULL
     OR nullif(btrim(coalesce(p_origin_device_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Sync operation requires idempotency_key, entity_name, operation_type and origin_device_id'
      USING ERRCODE = '22023';
  END IF;

  -- 1. Check if idempotency key exists
  SELECT * INTO v_existing
  FROM public.sync_idempotency_keys
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.status = 'completed' THEN
      RETURN jsonb_build_object(
        'status', 'DUPLICATE_ACK',
        'idempotency_key', p_idempotency_key,
        'message', 'Operation already processed previously',
        'result', v_existing.response_payload
      );
    ELSIF v_existing.status = 'processing' THEN
      -- In-flight request concurrent lock
      RETURN jsonb_build_object(
        'status', 'IN_FLIGHT',
        'idempotency_key', p_idempotency_key,
        'message', 'Operation is currently being processed by server'
      );
    END IF;
  END IF;

  -- 2. Insert processing lock
  INSERT INTO public.sync_idempotency_keys (
    idempotency_key,
    entity_name,
    operation_type,
    origin_device_id,
    status
  ) VALUES (
    p_idempotency_key,
    p_entity_name,
    p_operation_type,
    p_origin_device_id,
    'processing'
  );

  -- 3. Return success acknowledgment payload template
  v_result := jsonb_build_object(
    'acknowledged', true,
    'entity_name', p_entity_name,
    'operation_type', p_operation_type,
    'processed_at', now()
  );

  -- Mark completed
  UPDATE public.sync_idempotency_keys
  SET status = 'completed',
      response_payload = v_result,
      updated_at = now()
  WHERE idempotency_key = p_idempotency_key;

  RETURN jsonb_build_object(
    'status', 'PROCESSED',
    'idempotency_key', p_idempotency_key,
    'result', v_result
  );

EXCEPTION WHEN OTHERS THEN
  UPDATE public.sync_idempotency_keys
  SET status = 'failed',
      error_message = SQLERRM,
      updated_at = now()
  WHERE idempotency_key = p_idempotency_key;

  RAISE EXCEPTION 'Sync Apply Operation Failed: %', SQLERRM;
END;
$function$;
