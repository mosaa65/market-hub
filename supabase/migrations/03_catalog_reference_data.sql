-- ============================================================================
-- 03_catalog_reference_data.sql
--
-- بيانات مرجعية للكتالوج: تصنيفات، علامات، وحدات، بلدان منشأ، درجات جودة، طرازات مركبات.
--
-- مُستخرج من الحالة النهائية الحقيقية لقاعدة البيانات، لا من تاريخ الملفات.
-- لا يحتوي أي بيانات أعمال أو تجارية. راجع supabase/MIGRATIONS_RULES.md
-- ============================================================================

-- ── TABLES ────────────────────────────────────────────────────────────────
CREATE TABLE public.categories (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  name_ar text,
  parent_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.brands (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  name_ar text
);

CREATE TABLE public.units (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  short_name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  name_ar text
);

CREATE TABLE public.countries_of_origin (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code char(2) NOT NULL,
  name text NOT NULL,
  name_ar text NOT NULL
);

CREATE TABLE public.quality_grades (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  name_ar text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.vehicle_makes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  name_ar text NOT NULL
);

CREATE TABLE public.vehicle_models (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  make_id uuid NOT NULL,
  name text NOT NULL,
  name_ar text
);

CREATE TABLE public.packaging_types (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code varchar(20) NOT NULL,
  name_ar varchar(60) NOT NULL,
  name_en varchar(60),
  is_active boolean DEFAULT true NOT NULL,
  sort_order smallint DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ── CONSTRAINTS ───────────────────────────────────────────────────────────
ALTER TABLE public.categories ADD CONSTRAINT "categories_pkey" PRIMARY KEY (id);
ALTER TABLE public.brands ADD CONSTRAINT "brands_pkey" PRIMARY KEY (id);
ALTER TABLE public.units ADD CONSTRAINT "units_pkey" PRIMARY KEY (id);
ALTER TABLE public.units ADD CONSTRAINT "units_name_key" UNIQUE (name);
ALTER TABLE public.countries_of_origin ADD CONSTRAINT "countries_of_origin_pkey" PRIMARY KEY (id);
ALTER TABLE public.countries_of_origin ADD CONSTRAINT "countries_of_origin_code_key" UNIQUE (code);
ALTER TABLE public.quality_grades ADD CONSTRAINT "quality_grades_pkey" PRIMARY KEY (id);
ALTER TABLE public.quality_grades ADD CONSTRAINT "quality_grades_code_key" UNIQUE (code);
ALTER TABLE public.vehicle_makes ADD CONSTRAINT "vehicle_makes_pkey" PRIMARY KEY (id);
ALTER TABLE public.vehicle_makes ADD CONSTRAINT "vehicle_makes_name_key" UNIQUE (name);
ALTER TABLE public.vehicle_models ADD CONSTRAINT "vehicle_models_pkey" PRIMARY KEY (id);
ALTER TABLE public.vehicle_models ADD CONSTRAINT "vehicle_models_make_id_name_key" UNIQUE (make_id, name);
ALTER TABLE public.packaging_types ADD CONSTRAINT "packaging_types_pkey" PRIMARY KEY (id);
ALTER TABLE public.packaging_types ADD CONSTRAINT "packaging_types_code_key" UNIQUE (code);

