-- ============================================================================
-- 12_platform_and_audit.sql
--
-- المنصة والاشتراكات وسجل التدقيق.
--
-- مُستخرج من الحالة النهائية الحقيقية لقاعدة البيانات، لا من تاريخ الملفات.
-- لا يحتوي أي بيانات أعمال أو تجارية. راجع supabase/MIGRATIONS_RULES.md
-- ============================================================================

-- ── TABLES ────────────────────────────────────────────────────────────────
CREATE TABLE public.platform_modules (
  id text NOT NULL,
  name jsonb NOT NULL,
  description jsonb,
  category text NOT NULL,
  dependencies text[] DEFAULT '{}'::text[] NOT NULL,
  nav_items text[] DEFAULT '{}'::text[] NOT NULL,
  routes text[] DEFAULT '{}'::text[] NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.platform_plans (
  id text NOT NULL,
  name jsonb NOT NULL,
  description jsonb,
  modules text[] DEFAULT '{}'::text[] NOT NULL,
  max_users integer DEFAULT 1 NOT NULL,
  max_warehouses integer DEFAULT 1 NOT NULL,
  max_products integer,
  price_monthly numeric(10,2) DEFAULT 0 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.tenant_subscriptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id text DEFAULT 'default'::text NOT NULL,
  plan_id text NOT NULL,
  extra_modules text[] DEFAULT '{}'::text[] NOT NULL,
  disabled_modules text[] DEFAULT '{}'::text[] NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.platform_audit_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  admin_id uuid,
  user_id uuid,
  action text NOT NULL,
  target_tenant_id text,
  payload jsonb,
  ip_address text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.audit_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  payload jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ── CONSTRAINTS ───────────────────────────────────────────────────────────
ALTER TABLE public.platform_modules ADD CONSTRAINT "platform_modules_category_check" CHECK ((category = ANY (ARRAY['core'::text, 'module'::text, 'addon'::text, 'enterprise'::text])));
ALTER TABLE public.platform_modules ADD CONSTRAINT "platform_modules_pkey" PRIMARY KEY (id);
ALTER TABLE public.platform_plans ADD CONSTRAINT "platform_plans_pkey" PRIMARY KEY (id);
ALTER TABLE public.tenant_subscriptions ADD CONSTRAINT "tenant_subscriptions_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'trialing'::text, 'past_due'::text, 'canceled'::text])));
ALTER TABLE public.tenant_subscriptions ADD CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY (id);
ALTER TABLE public.tenant_subscriptions ADD CONSTRAINT "uq_tenant_subscription" UNIQUE (tenant_id);
ALTER TABLE public.platform_audit_logs ADD CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY (id);
ALTER TABLE public.audit_logs ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY (id);

-- ── INDEXES ───────────────────────────────────────────────────────────────
CREATE INDEX idx_audit_created ON public.audit_logs USING btree (created_at DESC);
CREATE INDEX idx_audit_entity ON public.audit_logs USING btree (entity_type, entity_id);

-- ── SEQUENCES ─────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.expense_reference_seq START 1;

