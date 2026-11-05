-- ============================================================================
-- الترحيل 003_catalog_reference.sql — مجال: catalog_reference
-- جزء من خط الأساس الجديد: تعريف نهائي واحد لكل كائن، مبني من مخطط مرجعي
-- مستخرج من الترحيلات التاريخية الكاملة (راجع supabase/migrations/README.md).
-- ============================================================================

--
-- Name: fn_format_document_number(text, bigint, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.fn_format_document_number(p_document_type text, p_sequence bigint, p_at timestamp with time zone DEFAULT now()) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.fn_resolve_document_numbering(p_document_type);
  IF NOT FOUND THEN
    RETURN p_sequence::text;
  END IF;
  RETURN public.fn_format_document_number(
    p_sequence, r.prefix, r.format_tokens, r.padding, r.separator, r.date_part, p_at
  );
END $$;

--
-- Name: fn_format_document_number(bigint, text, text, smallint, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.fn_format_document_number(p_sequence bigint, p_prefix text, p_format text, p_padding smallint, p_separator text, p_date_part text, p_at timestamp with time zone DEFAULT now()) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
DECLARE
  v_seq_text   text;
  v_padding    smallint := GREATEST(0, LEAST(COALESCE(p_padding, 0), 8));
  v_sep        text := COALESCE(NULLIF(p_separator, ''), '-');
  v_prefix     text := COALESCE(p_prefix, '');
  v_format     text := COALESCE(NULLIF(btrim(p_format), ''), '{PREFIX}{SEQ}');
  v_result     text;
BEGIN
  -- Padding is OPTIONAL. padding = 0 means "no leading zeros".
  v_seq_text := CASE
    WHEN v_padding = 0 THEN p_sequence::text
    WHEN length(p_sequence::text) < v_padding THEN lpad(p_sequence::text, v_padding, '0')
    ELSE p_sequence::text
  END;

  v_result := v_format;
  v_result := replace(v_result, '{PREFIX}',    v_prefix);
  v_result := replace(v_result, '{YYYY}',      to_char(p_at, 'YYYY'));
  v_result := replace(v_result, '{YY}',        to_char(p_at, 'YY'));
  v_result := replace(v_result, '{MM}',        to_char(p_at, 'MM'));
  v_result := replace(v_result, '{DD}',        to_char(p_at, 'DD'));
  v_result := replace(v_result, '{SEQ}',       v_seq_text);

  -- A separator written as "-" inside the template is normalised so an empty
  -- separator really collapses the parts instead of leaving stray dashes.
  IF v_sep <> '-' THEN
    v_result := replace(v_result, '-', v_sep);
  END IF;

  -- If the template mentions a date token that is empty (e.g. a preset with
  -- no date), collapse duplicated separators and trim stray edges.
  WHILE position(v_sep || v_sep IN v_result) > 0 LOOP
    v_result := replace(v_result, v_sep || v_sep, v_sep);
  END LOOP;
  v_result := btrim(v_result, v_sep || ' ');
  v_result := btrim(v_result);

  IF v_result = '' THEN
    v_result := v_seq_text;
  END IF;

  RETURN v_result;
END $$;

--
-- Name: document_numbering; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.document_numbering (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_type text NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL,
    scope_id uuid,
    section text DEFAULT 'general'::text NOT NULL,
    label_ar text DEFAULT ''::text NOT NULL,
    label_en text DEFAULT ''::text NOT NULL,
    prefix text DEFAULT ''::text NOT NULL,
    separator text DEFAULT '-'::text NOT NULL,
    format_tokens text DEFAULT '{PREFIX}-{SEQ}'::text NOT NULL,
    padding smallint DEFAULT 0 NOT NULL,
    date_part text DEFAULT 'none'::text NOT NULL,
    reset_policy text DEFAULT 'never'::text NOT NULL,
    current_value bigint DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_numbering_date_check CHECK ((date_part = ANY (ARRAY['none'::text, 'year'::text, 'year_month'::text, 'full'::text]))),
    CONSTRAINT document_numbering_padding_check CHECK (((padding >= 0) AND (padding <= 8))),
    CONSTRAINT document_numbering_reset_check CHECK ((reset_policy = ANY (ARRAY['never'::text, 'yearly'::text, 'monthly'::text, 'daily'::text]))),
    CONSTRAINT document_numbering_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'company'::text, 'branch'::text, 'pos'::text])))
);

--
-- Name: grain_types_output_map_ratio_is_valid(jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.grain_types_output_map_ratio_is_valid(p_output_map jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_output_map) <> 'array' THEN false
    ELSE COALESCE((
      SELECT SUM((entry->>'ratio')::numeric)
      FROM jsonb_array_elements(p_output_map) AS entry
    ), 0) <= 100
  END;
$$;

--
-- Name: touch_grain_type_updated_at(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.touch_grain_type_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

--
-- Name: brands; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.brands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    name_ar text
);

--
-- Name: categories; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    name_ar text,
    parent_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: countries_of_origin; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.countries_of_origin (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character(2) NOT NULL,
    name text NOT NULL,
    name_ar text NOT NULL
);

--
-- Name: units; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.units (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    short_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    name_ar text,
    dimension_code text DEFAULT 'CUSTOM'::text NOT NULL,
    factor_to_reference numeric(30,12),
    CONSTRAINT units_dimension_code_check CHECK ((dimension_code = ANY (ARRAY['COUNT'::text, 'MASS'::text, 'VOLUME'::text, 'LENGTH'::text, 'AREA'::text, 'TIME'::text, 'PACKAGING'::text, 'CUSTOM'::text]))),
    CONSTRAINT units_factor_to_reference_positive CHECK (((factor_to_reference IS NULL) OR (factor_to_reference > (0)::numeric)))
);

--
-- Name: packaging_types; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.packaging_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(20) NOT NULL,
    name_ar character varying(60) NOT NULL,
    name_en character varying(60),
    is_active boolean DEFAULT true NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

--
-- Name: product_compatibilities; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.product_compatibilities (
    product_id uuid NOT NULL,
    vehicle_model_id uuid NOT NULL
);

--
-- Name: quality_grades; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.quality_grades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    name_ar text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);

--
-- Name: vehicle_makes; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.vehicle_makes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    name_ar text NOT NULL
);

--
-- Name: vehicle_models; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.vehicle_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    make_id uuid NOT NULL,
    name text NOT NULL,
    name_ar text
);



--
-- Name: FUNCTION fn_format_document_number(p_document_type text, p_sequence bigint, p_at timestamp with time zone); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.fn_format_document_number(p_document_type text, p_sequence bigint, p_at timestamp with time zone) FROM PUBLIC;

GRANT ALL ON FUNCTION public.fn_format_document_number(p_document_type text, p_sequence bigint, p_at timestamp with time zone) TO service_role;

GRANT ALL ON FUNCTION public.fn_format_document_number(p_document_type text, p_sequence bigint, p_at timestamp with time zone) TO authenticated;

--
-- Name: FUNCTION fn_format_document_number(p_sequence bigint, p_prefix text, p_format text, p_padding smallint, p_separator text, p_date_part text, p_at timestamp with time zone); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.fn_format_document_number(p_sequence bigint, p_prefix text, p_format text, p_padding smallint, p_separator text, p_date_part text, p_at timestamp with time zone) FROM PUBLIC;

GRANT ALL ON FUNCTION public.fn_format_document_number(p_sequence bigint, p_prefix text, p_format text, p_padding smallint, p_separator text, p_date_part text, p_at timestamp with time zone) TO service_role;

GRANT ALL ON FUNCTION public.fn_format_document_number(p_sequence bigint, p_prefix text, p_format text, p_padding smallint, p_separator text, p_date_part text, p_at timestamp with time zone) TO authenticated;


--
-- Name: TABLE document_numbering; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.document_numbering IS 'Central Document Numbering Engine configuration. The numeric sequence is kept in a PostgreSQL sequence (atomic, gap tolerant); this table stores how that number is presented. Document numbers are frozen on the document row when it is created, so editing this table never rewrites history.';

--
-- Name: fn_resolve_document_numbering(text, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.fn_resolve_document_numbering(p_document_type text, p_company_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid, p_pos_id uuid DEFAULT NULL::uuid) RETURNS public.document_numbering
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT d.*
  FROM public.document_numbering d
  WHERE d.document_type = p_document_type
    AND (
      (d.scope = 'pos'     AND p_pos_id     IS NOT NULL AND d.scope_id = p_pos_id)
      OR (d.scope = 'branch'  AND p_branch_id  IS NOT NULL AND d.scope_id = p_branch_id)
      OR (d.scope = 'company' AND p_company_id IS NOT NULL AND d.scope_id = p_company_id)
      OR (d.scope = 'global'  AND d.scope_id IS NULL)
    )
  ORDER BY CASE d.scope
             WHEN 'pos'     THEN 1
             WHEN 'branch'  THEN 2
             WHEN 'company' THEN 3
             ELSE 4
           END
  LIMIT 1;
$$;

--
-- Name: document_numbering document_numbering_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.document_numbering
    ADD CONSTRAINT document_numbering_pkey PRIMARY KEY (id);

--
-- Name: document_numbering_document_type_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX document_numbering_document_type_idx ON public.document_numbering USING btree (document_type, scope);

--
-- Name: document_numbering_scope_unique; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX document_numbering_scope_unique ON public.document_numbering USING btree (document_type, scope, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));

--
-- Name: document_numbering; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.document_numbering ENABLE ROW LEVEL SECURITY;

--
-- Name: document_numbering document_numbering_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY document_numbering_read ON public.document_numbering FOR SELECT TO authenticated USING (true);

--
-- Name: document_numbering document_numbering_write; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY document_numbering_write ON public.document_numbering TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: TABLE document_numbering; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.document_numbering TO service_role;


--
-- Name: grain_types; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.grain_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name_ar text NOT NULL,
    name_en text,
    default_loss_rate_pct numeric(5,2) DEFAULT 0 NOT NULL,
    default_output_map jsonb DEFAULT '[]'::jsonb NOT NULL,
    representative_product_id uuid,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grain_types_default_loss_rate_pct_check CHECK (((default_loss_rate_pct >= (0)::numeric) AND (default_loss_rate_pct <= (100)::numeric))),
    CONSTRAINT grain_types_output_map_ratio_check CHECK (public.grain_types_output_map_ratio_is_valid(default_output_map)),
    CONSTRAINT grain_types_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: FUNCTION grain_types_output_map_ratio_is_valid(p_output_map jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.grain_types_output_map_ratio_is_valid(p_output_map jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.grain_types_output_map_ratio_is_valid(p_output_map jsonb) TO service_role;


--
-- Name: FUNCTION touch_grain_type_updated_at(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.touch_grain_type_updated_at() FROM PUBLIC;

GRANT ALL ON FUNCTION public.touch_grain_type_updated_at() TO service_role;


--
-- Name: brands brands_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (id);

--
-- Name: brands brand_manage; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY brand_manage ON public.brands TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: brands brand_view; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY brand_view ON public.brands FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: brands; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE brands; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.brands TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.brands TO authenticated;


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);

--
-- Name: categories cat_manage; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY cat_manage ON public.categories TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: categories cat_view; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY cat_view ON public.categories FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE categories; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.categories TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.categories TO authenticated;


--
-- Name: countries_of_origin countries_of_origin_code_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.countries_of_origin
    ADD CONSTRAINT countries_of_origin_code_key UNIQUE (code);

--
-- Name: countries_of_origin countries_of_origin_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.countries_of_origin
    ADD CONSTRAINT countries_of_origin_pkey PRIMARY KEY (id);

--
-- Name: countries_of_origin; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.countries_of_origin ENABLE ROW LEVEL SECURITY;

--
-- Name: countries_of_origin origin_staff; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY origin_staff ON public.countries_of_origin TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: TABLE countries_of_origin; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.countries_of_origin TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.countries_of_origin TO authenticated;


--
-- Name: units units_name_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_name_key UNIQUE (name);

--
-- Name: units units_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_pkey PRIMARY KEY (id);

--
-- Name: units unit_manage; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY unit_manage ON public.units TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: units unit_view; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY unit_view ON public.units FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: units; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE units; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.units TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.units TO authenticated;


--
-- Name: packaging_types packaging_types_code_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.packaging_types
    ADD CONSTRAINT packaging_types_code_key UNIQUE (code);

--
-- Name: packaging_types packaging_types_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.packaging_types
    ADD CONSTRAINT packaging_types_pkey PRIMARY KEY (id);

--
-- Name: packaging_types; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.packaging_types ENABLE ROW LEVEL SECURITY;

--
-- Name: packaging_types packaging_types_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY packaging_types_read ON public.packaging_types FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: packaging_types packaging_types_write; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY packaging_types_write ON public.packaging_types TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: TABLE packaging_types; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.packaging_types TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.packaging_types TO authenticated;


--
-- Name: product_compatibilities product_compatibilities_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.product_compatibilities
    ADD CONSTRAINT product_compatibilities_pkey PRIMARY KEY (product_id, vehicle_model_id);

--
-- Name: product_compatibilities fitment_staff; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY fitment_staff ON public.product_compatibilities TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: product_compatibilities; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.product_compatibilities ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE product_compatibilities; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.product_compatibilities TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.product_compatibilities TO authenticated;


--
-- Name: quality_grades quality_grades_code_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.quality_grades
    ADD CONSTRAINT quality_grades_code_key UNIQUE (code);

--
-- Name: quality_grades quality_grades_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.quality_grades
    ADD CONSTRAINT quality_grades_pkey PRIMARY KEY (id);

--
-- Name: quality_grades; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.quality_grades ENABLE ROW LEVEL SECURITY;

--
-- Name: quality_grades quality_staff; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY quality_staff ON public.quality_grades TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: TABLE quality_grades; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.quality_grades TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.quality_grades TO authenticated;


--
-- Name: vehicle_makes vehicle_makes_name_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.vehicle_makes
    ADD CONSTRAINT vehicle_makes_name_key UNIQUE (name);

--
-- Name: vehicle_makes vehicle_makes_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.vehicle_makes
    ADD CONSTRAINT vehicle_makes_pkey PRIMARY KEY (id);

--
-- Name: vehicle_makes make_staff; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY make_staff ON public.vehicle_makes TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: vehicle_makes; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.vehicle_makes ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE vehicle_makes; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vehicle_makes TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.vehicle_makes TO authenticated;


--
-- Name: vehicle_models vehicle_models_make_id_name_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.vehicle_models
    ADD CONSTRAINT vehicle_models_make_id_name_key UNIQUE (make_id, name);

--
-- Name: vehicle_models vehicle_models_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.vehicle_models
    ADD CONSTRAINT vehicle_models_pkey PRIMARY KEY (id);

--
-- Name: vehicle_models model_staff; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY model_staff ON public.vehicle_models TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: vehicle_models; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.vehicle_models ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE vehicle_models; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vehicle_models TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.vehicle_models TO authenticated;


--
-- Name: FUNCTION fn_resolve_document_numbering(p_document_type text, p_company_id uuid, p_branch_id uuid, p_pos_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.fn_resolve_document_numbering(p_document_type text, p_company_id uuid, p_branch_id uuid, p_pos_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.fn_resolve_document_numbering(p_document_type text, p_company_id uuid, p_branch_id uuid, p_pos_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.fn_resolve_document_numbering(p_document_type text, p_company_id uuid, p_branch_id uuid, p_pos_id uuid) TO authenticated;


--
-- Name: grain_types grain_types_name_ar_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.grain_types
    ADD CONSTRAINT grain_types_name_ar_key UNIQUE (name_ar);

--
-- Name: grain_types grain_types_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.grain_types
    ADD CONSTRAINT grain_types_pkey PRIMARY KEY (id);

--
-- Name: idx_grain_types_active; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_grain_types_active ON public.grain_types USING btree (is_active, name_ar);

--
-- Name: uq_grain_types_name_en; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX uq_grain_types_name_en ON public.grain_types USING btree (name_en) WHERE (name_en IS NOT NULL);

--
-- Name: grain_types trg_grain_types_touch; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER trg_grain_types_touch BEFORE UPDATE ON public.grain_types FOR EACH ROW EXECUTE FUNCTION public.touch_grain_type_updated_at();

--
-- Name: grain_types; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.grain_types ENABLE ROW LEVEL SECURITY;

--
-- Name: grain_types grain_types_manage; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY grain_types_manage ON public.grain_types TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

--
-- Name: grain_types grain_types_service_all; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY grain_types_service_all ON public.grain_types TO service_role USING (true) WITH CHECK (true);
