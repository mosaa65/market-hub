-- ============================================================================
-- الترحيل 002_identity_settings_platform_audit.sql — مجال: identity_settings_platform_audit
-- جزء من خط الأساس الجديد: تعريف نهائي واحد لكل كائن، مبني من مخطط مرجعي
-- مستخرج من الترحيلات التاريخية الكاملة (راجع supabase/migrations/README.md).
-- ============================================================================

--
-- Name: backup_export_all(integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.backup_export_all(p_max_log_rows integer DEFAULT 5000) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_caller uuid := auth.uid();
  tbl record;
  v_result jsonb;
  v_tables_payload jsonb := '{}'::jsonb;
  v_row_count bigint;
  v_total_rows bigint := 0;
  v_table_count integer := 0;
  v_capped integer := 0;
  v_q text;
  v_rows jsonb;
BEGIN
  -- ⚠️ superadmin المنصة (المستخدمون في platform_admins) يملكون دور متجر 'owner'
  --    من البذرة، لكن لو أُنشئ حساب سوبر أدمن جديد بلا دور المتجر لُحجب عنه
  --    التصدير رغم أن كل صلاحيات المنصة له. القاعدة: إما دور مالك/مدير،
  --    أو سوبر أدمن منصة. (backup_restore_all يشترط owner فقط — بقصد الاستعادة.)
  IF v_caller IS NULL
     OR NOT (public.has_role(v_caller, 'owner')
             OR public.has_role(v_caller, 'manager')
             OR public.is_platform_superadmin(v_caller)) THEN
    RAISE EXCEPTION 'BACKUP_AUTH: backup export requires owner, manager or platform superadmin'
      USING HINT = 'لا يملك المستدعي صلاحية تصدير النسخ الاحتياطية';
  END IF;

  FOR tbl IN
    SELECT t.table_name
    FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name
  LOOP
    DECLARE
      v_cap integer := NULL;
    BEGIN
      -- جداول السجل الضخمة: أحدث N صفًا فقط (بترتيب created_at) لتجنب نفاد الذاكرة.
      IF tbl.table_name IN ('audit_logs', 'backup_logs', 'idempotency_keys') THEN
        v_cap := p_max_log_rows;
        v_capped := v_capped + 1;
      END IF;

      IF v_cap IS NOT NULL THEN
        v_q := format(
          'SELECT count(*)::bigint AS cnt, coalesce(jsonb_agg(to_jsonb(s)), ''[]''::jsonb) AS rows
           FROM (SELECT * FROM public.%I ORDER BY created_at DESC LIMIT %s) s',
          tbl.table_name, v_cap
        );
      ELSE
        v_q := format(
          'SELECT count(*)::bigint AS cnt, coalesce(jsonb_agg(to_jsonb(s)), ''[]''::jsonb) AS rows
           FROM public.%I s',
          tbl.table_name
        );
      END IF;

      EXECUTE v_q INTO v_row_count, v_rows;

      v_tables_payload := jsonb_set(v_tables_payload, ARRAY[tbl.table_name], v_rows);
      v_total_rows := v_total_rows + v_row_count;
      v_table_count := v_table_count + 1;
    END;
  END LOOP;

  v_result := jsonb_build_object(
    'kind', 'server_dynamic_export',
    'exported_at', now(),
    'schema_fingerprint', public.backup_schema_fingerprint(),
    'table_count', v_table_count,
    'total_rows', v_total_rows,
    'capped_log_tables', v_capped,
    'tables', v_tables_payload
  );

  RETURN v_result;
END;
$$;

--
-- Name: backup_restore_all(jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.backup_restore_all(p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_caller uuid := auth.uid();
  v_tables jsonb;
  v_t text;
  v_rows jsonb;
  v_inserted bigint;
  v_total bigint := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_payload_fingerprint text;
  v_current_fingerprint text;
  v_fingerprint_mismatch boolean := false;
  v_q text;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'owner') THEN
    RAISE EXCEPTION 'BACKUP_AUTH: backup restore requires owner role'
      USING HINT = 'الاستعادة متاحة لمالك المتجر فقط';
  END IF;

  IF p_payload->>'kind' IS DISTINCT FROM 'server_dynamic_export'
     OR jsonb_typeof(p_payload->'tables') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'BACKUP_FORMAT: payload is not a server_dynamic_export backup'
      USING HINT = 'صيغة الحمولة غير صالحة — استخدم نسخة من backup_export_all';
  END IF;

  v_payload_fingerprint := p_payload->>'schema_fingerprint';
  v_current_fingerprint := public.backup_schema_fingerprint();
  IF v_payload_fingerprint IS NOT NULL
     AND v_current_fingerprint IS NOT NULL
     AND v_payload_fingerprint <> v_current_fingerprint THEN
    v_fingerprint_mismatch := true;  -- تحذير لا إيقاف: قد تكون مهاجرة جديدة بعد النسخة
    RAISE NOTICE 'BACKUP_SCHEMA_DRIFT: backup fingerprint % != current % (tables/columns changed since backup)',
      v_payload_fingerprint, v_current_fingerprint;
  END IF;

  v_tables := p_payload->'tables';

  -- (ج) تعطيل مفاتيح التحقق مؤقتًا داخل الجلسة
  EXECUTE 'SET LOCAL session_replication_role = replica';

  -- (د-1) تفريغ كل جداول public الأساسية — حتى غير المذكورة في الحمولة
  EXECUTE format(
    'TRUNCATE TABLE %s RESTART IDENTITY CASCADE',
    (
      SELECT string_agg(quote_ident(t.table_name), ', ' ORDER BY t.table_name)
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    )
  );

  -- (د-2) إدراج الصفوف، جدولًا جدولًا، بالاسم لا بالترتيب
  FOR v_t, v_rows IN
    SELECT key, value FROM jsonb_each(v_tables)
  LOOP
    -- تجاهل الجداول غير الموجودة في المخطط الحالي (حُذف جدول بعد النسخة)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = v_t AND t.table_type = 'BASE TABLE'
    ) THEN
      RAISE NOTICE 'BACKUP_SKIP_TABLE: % not found in current schema', v_t;
      v_skipped := v_skipped || to_jsonb(v_t);
      CONTINUE;
    END IF;

    IF jsonb_typeof(v_rows) = 'array' AND jsonb_array_length(v_rows) > 0 THEN
      v_q := format(
        'INSERT INTO public.%I SELECT * FROM jsonb_populate_recordset(NULL::public.%I, $1)',
        v_t, v_t
      );
      EXECUTE v_q USING v_rows;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_total := v_total + v_inserted;
    END IF;
  END LOOP;

  -- (ج) إعادة المفاتيح
  EXECUTE 'SET LOCAL session_replication_role = DEFAULT';

  -- (هـ) إعادة ضبط sequences (serial/bigserial) لقيم الأعمدة المدرجة
  DECLARE
    v_col text;
  BEGIN
    FOR v_t, v_col IN
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.sequences s
        ON s.sequence_schema = 'public'
      WHERE c.table_schema = 'public'
        AND c.column_default LIKE 'nextval(%'
    LOOP
      EXECUTE format(
        'SELECT setval(pg_get_serial_sequence(%L::text, %L::text),
                       coalesce((SELECT max(%I) FROM public.%I), 1))',
        'public.' || v_t, v_col, v_col, v_t
      );
    END LOOP;
  END;

  RETURN jsonb_build_object(
    'restored_at', now(),
    'inserted_rows', v_total,
    'skipped_tables', v_skipped,
    'schema_fingerprint_mismatch', v_fingerprint_mismatch,
    'current_fingerprint', v_current_fingerprint
  );
END;
$_$;

--
-- Name: backup_schema_fingerprint(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.backup_schema_fingerprint() RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT encode(sha256(
    convert_to(
      coalesce(string_agg(
      t.table_name || '(' ||
      (
        SELECT string_agg(c.column_name || ':' || c.data_type, ',' ORDER BY c.ordinal_position)
        FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = t.table_name
      ) || ')'
    , '|' ORDER BY t.table_name), ''), 'UTF8')
  ), 'hex')
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE';
$$;

--
-- Name: business_now(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.business_now() RETURNS timestamp with time zone
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT now();
$$;

--
-- Name: business_timezone(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.business_timezone() RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  -- المنطقة الزمنية نظامية للدولة، لا تفضيلاً شخصياً؛ يُسمح بتغييرها لاحقاً
  -- من إعداد واحد دون لمس عشرات الدوال.
  SELECT coalesce(
    nullif(current_setting('app.business_timezone', true), ''),
    'Asia/Aden'
  );
$$;

--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: has_any_role(uuid, public.app_role[]); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[]) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF public.is_platform_superadmin(_user_id) THEN RETURN true; END IF;
  IF NOT COALESCE((SELECT p.is_active FROM public.profiles p WHERE p.id = _user_id), false) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND (
        ur.role = ANY(_roles)
        OR ur.role = 'owner'::public.app_role
        OR (ur.role = 'manager'::public.app_role
            AND ('cashier'::public.app_role = ANY(_roles)
                 OR 'warehouse'::public.app_role = ANY(_roles)))
      )
  );
END;
$$;

--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF public.is_platform_superadmin(_user_id) THEN RETURN true; END IF;
  IF NOT COALESCE((SELECT p.is_active FROM public.profiles p WHERE p.id = _user_id), false) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND (
        ur.role = _role
        OR ur.role = 'owner'::public.app_role
        OR (ur.role = 'manager'::public.app_role AND _role IN ('cashier', 'warehouse'))
      )
  );
END;
$$;

--
-- Name: normalize_auth_user_token_columns(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.normalize_auth_user_token_columns() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
$$;

--
-- Name: policy_runtime_functions(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.policy_runtime_functions() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT ARRAY[
    'is_staff', 'has_role', 'has_any_role',
    'is_platform_admin', 'is_platform_superadmin',
    'can_read_finance', 'can_read_expense_entry', 'can_read_milling',
    'can_view_milling', 'can_operate_milling', 'can_author_payment_methods',
    'expense_role_rank', 'expense_actor',
    'expense_assert_capability', 'expense_can_write_document',
    'is_system_customer', 'is_system_supplier'
  ];
$$;

--
-- Name: prevent_last_active_store_owner_removal(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.prevent_last_active_store_owner_removal() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.role = 'owner'::public.app_role THEN
    PERFORM pg_advisory_xact_lock(9915, hashtext('active-owner-status'));
    IF COALESCE((SELECT p.is_active FROM public.profiles p WHERE p.id = OLD.user_id), false)
       AND NOT EXISTS (
         SELECT 1
         FROM public.user_roles ur
         JOIN public.profiles p ON p.id = ur.user_id
         WHERE ur.role = 'owner'::public.app_role
           AND p.is_active
       ) THEN
      RAISE EXCEPTION 'The last active store owner cannot be removed or demoted'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

--
-- Name: rpc_allowlist(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.rpc_allowlist() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT ARRAY[
    -- ── البيع والشراء والمخزون ──
    'create_sale', 'create_sales_return', 'create_purchase',
    'create_purchase_return', 'create_stock_transfer',
    'post_sales_invoice', 'post_purchase_invoice',
    'post_stock_delta',
    'post_stock_settlement',
    'post_stock_adjustment',
    'post_opening_stock',
    'receive_customer_owned_stock', 'release_customer_owned_stock',
    'create_opening_balance', 'post_opening_balance', 'reverse_opening_balance',
    'search_products',
    'item_line_type', 'item_stock_effect', 'item_effective_policy',
    'item_has_stock_history', 'resolve_unit_cost',
    'product_reference_counts', 'warehouse_reference_counts',
    'save_item_policy', 'approve_item_policy_change',
    -- ── الدفعات والشيكات والتشغيل المالي ──
    'clear_cheque', 'bounce_cheque',
    -- ── إدارة الدفعات / التشغيلات ──
    'reconcile_batches_with_inventory', 'save_product_batch',
    'get_batch_kpis', 'delete_product_batch', 'save_batch_settings',
    -- ── الذمم والمدفوعات ──
    'record_customer_payment', 'record_supplier_payment', 'get_supplier_statement',
    'adjust_loyalty', 'customer_credit_limit_allows',
    -- ── أرصدة العملاء: المصدر الوحيد هو الدفتر (9913/9914/9915) ──
    'recalculate_customer_balance',
    'recalculate_all_customer_balances',
    'customer_balance_reconciliation_report',
    'customer_ledger_time_mismatches',
    -- ── أمانات المطحنة ──
    'custody_intake', 'custody_milling', 'custody_deliver', 'custody_adjust',
    'custody_balances', 'custody_link_invoice',
    'create_milling_service_document', 'smart_manufacture', 'consume_internal_supplies',
    'milling_custody_intake', 'milling_custody_issue_milling', 'milling_custody_deliver',
    'milling_custody_adjust',
    -- ── المحاسبة والأصول والضرائب ──
    'create_journal_entry', 'reverse_journal_entry', 'get_chart_of_accounts_tree',
    'activate_fixed_asset', 'dispose_fixed_asset',
    'run_depreciation', 'run_batch_depreciation',
    'run_contract_amortization', 'run_batch_amortization',
    'close_fiscal_year', 'open_fiscal_year', 'set_period_status',
    'generate_tax_declaration', 'settle_tax_period', 'pay_tax_settlement',
    -- ── المصروفات ──
    'create_expense', 'update_expense', 'submit_expense', 'decide_expense',
    'post_expense', 'close_expense', 'cancel_expense', 'reverse_expense',
    'record_expense_payment', 'reverse_expense_payment',
    'list_expenses', 'expense_detail', 'expense_summary', 'expense_report',
    'expense_lookups', 'save_expense_category', 'delete_expense_category',
    -- ── طرق الدفع والأطراف ──
    'create_tenant_payment_method', 'update_payment_method_identity',
    'remove_tenant_payment_method',
    'is_system_customer', 'is_system_supplier',
    -- ── الترقيم ──
    'fn_format_document_number', 'fn_resolve_document_numbering',
    'fn_set_document_numbering', 'fn_document_numbering_sequence_name',
    -- ── النسخ الاحتياطي ──
    'backup_export_all', 'backup_restore_all', 'backup_schema_fingerprint',
    -- ── مساعدات الفحص ──
    'has_role', 'is_staff', 'is_platform_admin', 'is_platform_superadmin',
    'can_read_finance', 'can_read_expense_entry', 'can_author_payment_methods',
    'can_operate_milling', 'can_view_milling',
    'platform_admin_audit_self'
  ];
$$;

--
-- Name: save_batch_settings(jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.save_batch_settings(p_settings jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_merged jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')) THEN
    RAISE EXCEPTION 'Not authorized to change company settings';
  END IF;

  UPDATE public.company_settings
  SET batch_settings = coalesce(batch_settings, '{}'::jsonb) || p_settings,
      updated_at = now()
  RETURNING batch_settings INTO v_merged;

  RETURN v_merged;
END $$;

--
-- Name: set_profile_active(uuid, boolean); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.set_profile_active(p_user_id uuid, p_is_active boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'User and active status are required' USING ERRCODE = '22023';
  END IF;
  IF NOT (
    public.has_role(v_actor, 'owner'::public.app_role)
    OR public.is_platform_superadmin(v_actor)
  ) THEN
    RAISE EXCEPTION 'Only a store owner or platform superadmin may change account status'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id = v_actor AND NOT p_is_active THEN
    RAISE EXCEPTION 'You cannot deactivate your own account' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'Manage platform access through the platform admin registry' USING ERRCODE = '42501';
  END IF;

  -- Serialize deactivation checks so two concurrent requests cannot each
  -- observe the other active owner and deactivate the last two accounts.
  PERFORM pg_advisory_xact_lock(9915, hashtext('active-owner-status'));
  IF NOT p_is_active
     AND EXISTS (
       SELECT 1 FROM public.user_roles
       WHERE user_id = p_user_id AND role = 'owner'::public.app_role
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.user_roles ur
       JOIN public.profiles p ON p.id = ur.user_id
       WHERE ur.role = 'owner'::public.app_role
         AND p.is_active
         AND ur.user_id <> p_user_id
     ) THEN
    RAISE EXCEPTION 'The last active store owner cannot be deactivated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles SET is_active = p_is_active WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

--
-- Name: sync_apply_operation(text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.sync_apply_operation(p_idempotency_key text, p_entity_name text, p_operation_type text, p_origin_device_id text, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: sync_item_class_from_policy(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.sync_item_class_from_policy() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.item_nature IS DISTINCT FROM OLD.item_nature
     OR NEW.inventory_policy IS DISTINCT FROM OLD.inventory_policy THEN

    -- الطبيعة تحكم أولاً: الخدمة خدمة.
    IF NEW.item_nature = 'SERVICE' THEN
      NEW.item_class := 'SERVICE';

    ELSIF NEW.item_nature = 'GOOD' THEN
      -- الأصناف التي تصنيفها *خاصية جوهرية* لا تُدهَس بالمنتج النهائي:
      -- خام قابل للاستهلاك، ناتج جانبي، وتعبئة تُشترى وتُستهلك.
      IF NEW.item_class IS NULL
         OR NEW.item_class NOT IN ('RAW_MATERIAL', 'BY_PRODUCT', 'PACKAGING') THEN
        NEW.item_class := 'FINISHED_GOOD';
      END IF;
    END IF;

    -- السياسة تحدّ الحالة التي لا تُمسك رصيداً.
    IF NEW.inventory_policy = 'CUSTOMER_OWNED' THEN
      -- أمانات العميل ليست مخزوناً تجارياً؛ تبقى ماديّةً في تصنيفها الأصلي.
      IF NEW.item_class IS NULL THEN
        NEW.item_class := 'NON_STOCK_ITEM';
      END IF;
    ELSIF NEW.inventory_policy = 'UNTRACKED' AND NEW.item_nature = 'GOOD' THEN
      -- صنف مادي غير متتبَّع: لا رصيد له مهما كان نوعه.
      NEW.item_class := 'NON_STOCK_ITEM';
    END IF;
  END IF;
  RETURN NEW;
END $$;

--
-- Name: tg_customers_system_guard(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.tg_customers_system_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
END $$;

--
-- Name: tg_platform_admins_keep_superadmin(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.tg_platform_admins_keep_superadmin() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_remaining integer;
BEGIN
  SELECT count(*) INTO v_remaining
  FROM public.platform_admins
  WHERE role = 'superadmin' AND is_active;

  IF v_remaining = 0 THEN
    RAISE EXCEPTION 'PLATFORM_LOCKOUT: لا يمكن ترك المنصة بلا سوبر أدمن نشط'
      USING ERRCODE = '23514',
            HINT = 'أضف سوبر أدمن آخر أو فعّل الحساب قبل تعطيل الأخير';
  END IF;

  RETURN NULL;  -- AFTER trigger
END;
$$;

--
-- Name: tg_set_updated_at(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.tg_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id)
);

--
-- Name: backup_logs; Type: TABLE; Schema: public; Owner: supabase_admin
--

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
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT backup_logs_action_type_check CHECK ((action_type = ANY (ARRAY['manual_local'::text, 'manual_cloud'::text, 'auto_scheduled'::text, 'pre_restore_safety'::text]))),
    CONSTRAINT backup_logs_status_check CHECK ((status = ANY (ARRAY['success'::text, 'failed'::text, 'in_progress'::text, 'pending'::text]))),
    CONSTRAINT backup_logs_storage_type_check CHECK ((storage_type = ANY (ARRAY['local'::text, 'cloud'::text, 'both'::text]))),
    CONSTRAINT backup_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: company_costing_settings; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.company_costing_settings (
    id smallint DEFAULT 1 NOT NULL,
    costing_method public.costing_method DEFAULT 'MOVING_AVERAGE'::public.costing_method NOT NULL,
    standard_cost_source text DEFAULT 'CATALOGUE'::text NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    CONSTRAINT company_costing_settings_singleton CHECK ((id = 1)),
    CONSTRAINT company_costing_settings_standard_cost_source_check CHECK ((standard_cost_source = ANY (ARRAY['CATALOGUE'::text, 'ROLLING_AVERAGE'::text, 'MANUAL'::text]))),
    CONSTRAINT company_costing_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id)
);

--
-- Name: company_items; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.company_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id integer DEFAULT 1 NOT NULL,
    item_id uuid NOT NULL,
    inventory_policy public.inventory_policy,
    costing_method public.costing_method,
    default_cost numeric(14,2),
    default_sale_price numeric(14,2),
    tax_rate numeric(6,3),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_items_cost_nonnegative CHECK (((default_cost IS NULL) OR (default_cost >= (0)::numeric))),
    CONSTRAINT company_items_price_nonnegative CHECK (((default_sale_price IS NULL) OR (default_sale_price >= (0)::numeric))),
    CONSTRAINT company_items_tax_valid CHECK (((tax_rate IS NULL) OR ((tax_rate >= (0)::numeric) AND (tax_rate <= (100)::numeric))))
);

--
-- Name: company_settings; Type: TABLE; Schema: public; Owner: supabase_admin
--

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
    footer_text text,
    batch_settings jsonb DEFAULT '{"warning_days": 30, "dispatch_strategy": "FEFO", "auto_sync_inventory": true, "enforce_on_purchase": true, "prevent_selling_expired": true, "enforce_batch_selection_on_pos": false}'::jsonb,
    allow_negative_sales boolean DEFAULT false NOT NULL,
    CONSTRAINT company_settings_invoice_number_digits_check CHECK (((invoice_number_digits >= 1) AND (invoice_number_digits <= 8))),
    CONSTRAINT company_settings_invoice_number_period_check CHECK ((invoice_number_period = ANY (ARRAY['none'::text, 'year'::text, 'year_month'::text]))),
    CONSTRAINT only_one_row CHECK ((id = 1))
);

--
-- Name: costing_policy_history; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.costing_policy_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    costing_method public.costing_method NOT NULL,
    previous_method public.costing_method,
    reason text,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT costing_policy_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id)
);

--
-- Name: device_registrations; Type: TABLE; Schema: public; Owner: supabase_admin
--

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

--
-- Name: platform_admins; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.platform_admins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    mfa_required boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login timestamp with time zone,
    CONSTRAINT platform_admins_role_check CHECK ((role = ANY (ARRAY['superadmin'::text, 'support'::text]))),
    CONSTRAINT platform_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

--
-- Name: platform_audit_logs; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.platform_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid,
    user_id uuid,
    action text NOT NULL,
    target_tenant_id text,
    payload jsonb,
    ip_address text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: platform_modules; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.platform_modules (
    id text NOT NULL,
    name jsonb NOT NULL,
    description jsonb,
    category text NOT NULL,
    dependencies text[] DEFAULT '{}'::text[] NOT NULL,
    nav_items text[] DEFAULT '{}'::text[] NOT NULL,
    routes text[] DEFAULT '{}'::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_modules_category_check CHECK ((category = ANY (ARRAY['core'::text, 'module'::text, 'addon'::text, 'enterprise'::text])))
);

--
-- Name: platform_plans; Type: TABLE; Schema: public; Owner: supabase_admin
--

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

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text,
    avatar_url text,
    phone text,
    language text DEFAULT 'en'::text NOT NULL,
    theme text DEFAULT 'dark'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

--
-- Name: sync_idempotency_keys; Type: TABLE; Schema: public; Owner: supabase_admin
--

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

--
-- Name: tenant_subscriptions; Type: TABLE; Schema: public; Owner: supabase_admin
--

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
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'trialing'::text, 'past_due'::text, 'canceled'::text])))
);

--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);


--
-- Name: FUNCTION backup_export_all(p_max_log_rows integer); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.backup_export_all(p_max_log_rows integer) IS 'Server-side dynamic full backup: reads every public base table from information_schema at call time (adapts to any migration), guarded to owner/manager.';

--
-- Name: FUNCTION backup_export_all(p_max_log_rows integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.backup_export_all(p_max_log_rows integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.backup_export_all(p_max_log_rows integer) TO service_role;

GRANT ALL ON FUNCTION public.backup_export_all(p_max_log_rows integer) TO authenticated;


--
-- Name: FUNCTION backup_restore_all(p_payload jsonb); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.backup_restore_all(p_payload jsonb) IS 'Server-side full restore in a single transaction: truncates all public tables, reinserts by column name, resets sequences. Owner-only.';

--
-- Name: FUNCTION backup_restore_all(p_payload jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.backup_restore_all(p_payload jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.backup_restore_all(p_payload jsonb) TO service_role;

GRANT ALL ON FUNCTION public.backup_restore_all(p_payload jsonb) TO authenticated;


--
-- Name: FUNCTION backup_schema_fingerprint(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.backup_schema_fingerprint() IS 'SHA-256 fingerprint of the public schema (tables + columns + types). Differing fingerprints between backup and restore signal schema drift.';

--
-- Name: FUNCTION backup_schema_fingerprint(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.backup_schema_fingerprint() FROM PUBLIC;

GRANT ALL ON FUNCTION public.backup_schema_fingerprint() TO service_role;

GRANT ALL ON FUNCTION public.backup_schema_fingerprint() TO authenticated;


--
-- Name: FUNCTION business_now(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.business_now() IS 'لحظة الكتابة الحقيقية (timestamptz). استخدمها لـ occurred_at بدل now() المتناثر، فتصبح نقطة الضبط واحدة.';

--
-- Name: FUNCTION business_now(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.business_now() FROM PUBLIC;

GRANT ALL ON FUNCTION public.business_now() TO authenticated;

GRANT ALL ON FUNCTION public.business_now() TO service_role;


--
-- Name: FUNCTION business_timezone(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.business_timezone() IS 'المنطقة الزمنية المحاسبية الوحيدة للنظام. تُقرأ من إعداد الجلسة app.business_timezone وتعود إلى Asia/Aden.';

--
-- Name: business_today(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.business_today() RETURNS date
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT (now() AT TIME ZONE public.business_timezone())::date;
$$;

--
-- Name: FUNCTION business_timezone(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.business_timezone() FROM PUBLIC;

GRANT ALL ON FUNCTION public.business_timezone() TO authenticated;

GRANT ALL ON FUNCTION public.business_timezone() TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION has_any_role(_user_id uuid, _roles public.app_role[]); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[]) IS 'فحص هرمي متعدد: يتحقق من وجود أي دور من القائمة مع احترام وراثة المالك والمدير.';

--
-- Name: FUNCTION has_any_role(_user_id uuid, _roles public.app_role[]); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[]) TO authenticated;

GRANT ALL ON FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[]) TO service_role;


--
-- Name: FUNCTION has_role(_user_id uuid, _role public.app_role); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) IS 'فحص هرمي للدور: المالك وسوبر أدمن المنصة يرثان كل الأدوار، والمدير يرث الكاشير والمستودع.';

--
-- Name: FUNCTION has_role(_user_id uuid, _role public.app_role); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) FROM PUBLIC;

GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO service_role;

GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO authenticated;


--
-- Name: FUNCTION normalize_auth_user_token_columns(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.normalize_auth_user_token_columns() FROM PUBLIC;

GRANT ALL ON FUNCTION public.normalize_auth_user_token_columns() TO service_role;


--
-- Name: FUNCTION policy_runtime_functions(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.policy_runtime_functions() IS 'دوال تُستدعى داخل سياسات RLS أو مشغّلاتها، فتجب أن تبقى قابلة للتنفيذ من مستخدم السياسة. لا تُعاد تسمية دون مراجعة كل سياسة.';

--
-- Name: FUNCTION policy_runtime_functions(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.policy_runtime_functions() FROM PUBLIC;

GRANT ALL ON FUNCTION public.policy_runtime_functions() TO service_role;


--
-- Name: FUNCTION prevent_last_active_store_owner_removal(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.prevent_last_active_store_owner_removal() FROM PUBLIC;

GRANT ALL ON FUNCTION public.prevent_last_active_store_owner_removal() TO service_role;


--
-- Name: FUNCTION rpc_allowlist(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.rpc_allowlist() FROM PUBLIC;


--
-- Name: FUNCTION save_batch_settings(p_settings jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.save_batch_settings(p_settings jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.save_batch_settings(p_settings jsonb) TO service_role;

GRANT ALL ON FUNCTION public.save_batch_settings(p_settings jsonb) TO authenticated;


--
-- Name: FUNCTION set_profile_active(p_user_id uuid, p_is_active boolean); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.set_profile_active(p_user_id uuid, p_is_active boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.set_profile_active(p_user_id uuid, p_is_active boolean) TO authenticated;

GRANT ALL ON FUNCTION public.set_profile_active(p_user_id uuid, p_is_active boolean) TO service_role;


--
-- Name: FUNCTION sync_apply_operation(p_idempotency_key text, p_entity_name text, p_operation_type text, p_origin_device_id text, p_payload jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.sync_apply_operation(p_idempotency_key text, p_entity_name text, p_operation_type text, p_origin_device_id text, p_payload jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.sync_apply_operation(p_idempotency_key text, p_entity_name text, p_operation_type text, p_origin_device_id text, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION sync_item_class_from_policy(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.sync_item_class_from_policy() FROM PUBLIC;

GRANT ALL ON FUNCTION public.sync_item_class_from_policy() TO service_role;


--
-- Name: FUNCTION tg_customers_system_guard(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.tg_customers_system_guard() FROM PUBLIC;

GRANT ALL ON FUNCTION public.tg_customers_system_guard() TO service_role;


--
-- Name: FUNCTION tg_platform_admins_keep_superadmin(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.tg_platform_admins_keep_superadmin() IS 'R-40: يمنع ترك platform_admins بلا سوبر أدمن نشط — لا يوجد من يصلحه من الواجهة إن وقع.';

--
-- Name: FUNCTION tg_platform_admins_keep_superadmin(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.tg_platform_admins_keep_superadmin() FROM PUBLIC;

GRANT ALL ON FUNCTION public.tg_platform_admins_keep_superadmin() TO service_role;


--
-- Name: FUNCTION tg_set_updated_at(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.tg_set_updated_at() FROM PUBLIC;

GRANT ALL ON FUNCTION public.tg_set_updated_at() TO service_role;


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

--
-- Name: idx_audit_created; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_audit_created ON public.audit_logs USING btree (created_at DESC);

--
-- Name: idx_audit_entity; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_audit_entity ON public.audit_logs USING btree (entity_type, entity_id);

--
-- Name: audit_logs Owners/managers read audit; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "Owners/managers read audit" ON public.audit_logs FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.audit_logs TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.audit_logs TO service_role;


--
-- Name: backup_logs backup_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.backup_logs
    ADD CONSTRAINT backup_logs_pkey PRIMARY KEY (id);

--
-- Name: idx_backup_logs_tenant_created; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_backup_logs_tenant_created ON public.backup_logs USING btree (tenant_id, created_at DESC);

--
-- Name: backup_logs; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.backup_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: backup_logs backup_logs_owner_manager_insert; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY backup_logs_owner_manager_insert ON public.backup_logs FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: backup_logs backup_logs_owner_manager_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY backup_logs_owner_manager_read ON public.backup_logs FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: TABLE backup_logs; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.backup_logs TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.backup_logs TO authenticated;

--
-- Name: company_costing_method(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.company_costing_method() RETURNS public.costing_method
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT coalesce(
    (SELECT costing_method FROM public.company_costing_settings WHERE id = 1),
    'MOVING_AVERAGE'::public.costing_method
  );
$$;


--
-- Name: company_costing_settings company_costing_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.company_costing_settings
    ADD CONSTRAINT company_costing_settings_pkey PRIMARY KEY (id);

--
-- Name: company_costing_settings; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.company_costing_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE company_costing_settings; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.company_costing_settings TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.company_costing_settings TO authenticated;


--
-- Name: company_items company_items_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.company_items
    ADD CONSTRAINT company_items_pkey PRIMARY KEY (id);

--
-- Name: company_items company_items_unique; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.company_items
    ADD CONSTRAINT company_items_unique UNIQUE (company_id, item_id);

--
-- Name: idx_company_items_company; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_company_items_company ON public.company_items USING btree (company_id);

--
-- Name: idx_company_items_item; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_company_items_item ON public.company_items USING btree (item_id);

--
-- Name: company_items company_items_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER company_items_updated BEFORE UPDATE ON public.company_items FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: company_items; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.company_items ENABLE ROW LEVEL SECURITY;

--
-- Name: company_items company_items_manage; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY company_items_manage ON public.company_items TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: TABLE company_items; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.company_items TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.company_items TO authenticated;

--
-- Name: get_batch_settings(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.get_batch_settings() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT coalesce(
    batch_settings,
    '{
      "dispatch_strategy": "FEFO",
      "prevent_selling_expired": true,
      "warning_days": 30,
      "enforce_on_purchase": false,
      "enforce_batch_selection_on_pos": false,
      "auto_sync_inventory": true
    }'::jsonb
  )
  FROM public.company_settings
  LIMIT 1;
$$;


--
-- Name: COLUMN company_settings.allow_negative_sales; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.company_settings.allow_negative_sales IS 'Allows only posted sales-invoice issues to create negative company stock. It never authorizes production, transfer, adjustment, or custody stock to go negative.';

--
-- Name: company_settings company_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.company_settings
    ADD CONSTRAINT company_settings_pkey PRIMARY KEY (id);

--
-- Name: company_settings company insert; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "company insert" ON public.company_settings FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: company_settings; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: company_settings company_update; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY company_update ON public.company_settings FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: company_settings company_view; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY company_view ON public.company_settings FOR SELECT TO authenticated USING (true);

--
-- Name: TABLE company_settings; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.company_settings TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.company_settings TO authenticated;


--
-- Name: costing_policy_history costing_policy_history_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.costing_policy_history
    ADD CONSTRAINT costing_policy_history_pkey PRIMARY KEY (id);

--
-- Name: costing_policy_history; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.costing_policy_history ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE costing_policy_history; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.costing_policy_history TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.costing_policy_history TO authenticated;


--
-- Name: device_registrations device_registrations_device_id_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.device_registrations
    ADD CONSTRAINT device_registrations_device_id_key UNIQUE (device_id);

--
-- Name: device_registrations device_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.device_registrations
    ADD CONSTRAINT device_registrations_pkey PRIMARY KEY (id);

--
-- Name: device_registrations Authenticated users can read device registrations; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "Authenticated users can read device registrations" ON public.device_registrations FOR SELECT TO authenticated USING (true);

--
-- Name: device_registrations; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.device_registrations ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE device_registrations; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.device_registrations TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.device_registrations TO authenticated;

--
-- Name: is_platform_admin(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.is_platform_admin(p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins
    WHERE user_id = p_user_id
      AND is_active = true
  );
$$;

--
-- Name: is_platform_superadmin(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.is_platform_superadmin(p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
$$;


--
-- Name: platform_admins platform_admins_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (id);

--
-- Name: platform_admins uq_platform_admin_user; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT uq_platform_admin_user UNIQUE (user_id);

--
-- Name: platform_admins trg_platform_admins_keep_superadmin; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE CONSTRAINT TRIGGER trg_platform_admins_keep_superadmin AFTER INSERT OR DELETE OR UPDATE ON public.platform_admins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.tg_platform_admins_keep_superadmin();

--
-- Name: platform_admins; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_admins platform_admins_self_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY platform_admins_self_read ON public.platform_admins FOR SELECT TO authenticated USING ((user_id = auth.uid()));

--
-- Name: TABLE platform_admins; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.platform_admins TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_admins TO authenticated;


--
-- Name: platform_audit_logs platform_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.platform_audit_logs
    ADD CONSTRAINT platform_audit_logs_pkey PRIMARY KEY (id);

--
-- Name: platform_audit_logs; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE platform_audit_logs; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.platform_audit_logs TO service_role;

GRANT SELECT,INSERT ON TABLE public.platform_audit_logs TO authenticated;


--
-- Name: platform_modules platform_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.platform_modules
    ADD CONSTRAINT platform_modules_pkey PRIMARY KEY (id);

--
-- Name: platform_modules; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.platform_modules ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_modules platform_modules_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY platform_modules_read ON public.platform_modules FOR SELECT TO authenticated USING (true);

--
-- Name: TABLE platform_modules; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.platform_modules TO service_role;

GRANT SELECT ON TABLE public.platform_modules TO authenticated;


--
-- Name: platform_plans platform_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.platform_plans
    ADD CONSTRAINT platform_plans_pkey PRIMARY KEY (id);

--
-- Name: platform_plans; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.platform_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_plans platform_plans_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY platform_plans_read ON public.platform_plans FOR SELECT TO authenticated USING (true);

--
-- Name: TABLE platform_plans; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.platform_plans TO service_role;

GRANT SELECT ON TABLE public.platform_plans TO authenticated;


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

--
-- Name: profiles profiles_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "profiles read" ON public.profiles FOR SELECT TO authenticated USING (((id = auth.uid()) OR public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: profiles profiles_self_update; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid()));

--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.profiles TO service_role;

GRANT SELECT ON TABLE public.profiles TO authenticated;

--
-- Name: COLUMN profiles.full_name; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT UPDATE(full_name) ON TABLE public.profiles TO authenticated;

--
-- Name: COLUMN profiles.phone; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT UPDATE(phone) ON TABLE public.profiles TO authenticated;

--
-- Name: COLUMN profiles.language; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT UPDATE(language) ON TABLE public.profiles TO authenticated;


--
-- Name: sync_idempotency_keys sync_idempotency_keys_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sync_idempotency_keys
    ADD CONSTRAINT sync_idempotency_keys_idempotency_key_key UNIQUE (idempotency_key);

--
-- Name: sync_idempotency_keys sync_idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sync_idempotency_keys
    ADD CONSTRAINT sync_idempotency_keys_pkey PRIMARY KEY (id);

--
-- Name: idx_sync_device_origin; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_sync_device_origin ON public.sync_idempotency_keys USING btree (origin_device_id, created_at);

--
-- Name: idx_sync_idempotency_key; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_sync_idempotency_key ON public.sync_idempotency_keys USING btree (idempotency_key);

--
-- Name: sync_idempotency_keys Idempotency keys are service managed; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "Idempotency keys are service managed" ON public.sync_idempotency_keys FOR SELECT TO authenticated USING ((origin_device_id = ((COALESCE(NULLIF(current_setting('request.jwt.claims'::text, true), ''::text), '{}'::text))::jsonb ->> 'device_id'::text)));

--
-- Name: sync_idempotency_keys; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.sync_idempotency_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE sync_idempotency_keys; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.sync_idempotency_keys TO service_role;


--
-- Name: tenant_subscriptions tenant_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.tenant_subscriptions
    ADD CONSTRAINT tenant_subscriptions_pkey PRIMARY KEY (id);

--
-- Name: tenant_subscriptions uq_tenant_subscription; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.tenant_subscriptions
    ADD CONSTRAINT uq_tenant_subscription UNIQUE (tenant_id);

--
-- Name: tenant_subscriptions; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_subscriptions tenant_subscriptions_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY tenant_subscriptions_read ON public.tenant_subscriptions FOR SELECT TO authenticated USING (true);

--
-- Name: tenant_subscriptions tenant_subscriptions_select; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY tenant_subscriptions_select ON public.tenant_subscriptions FOR SELECT TO authenticated USING (true);

--
-- Name: TABLE tenant_subscriptions; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.tenant_subscriptions TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_subscriptions TO authenticated;


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);

--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);

--
-- Name: user_roles user_roles_keep_active_store_owner; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE CONSTRAINT TRIGGER user_roles_keep_active_store_owner AFTER DELETE OR UPDATE ON public.user_roles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.prevent_last_active_store_owner_removal();

--
-- Name: user_roles owner manage roles del; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "owner manage roles del" ON public.user_roles FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'owner'::public.app_role));

--
-- Name: user_roles owner manage roles ins; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "owner manage roles ins" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'owner'::public.app_role));

--
-- Name: user_roles owner manage roles upd; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "owner manage roles upd" ON public.user_roles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'owner'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'owner'::public.app_role));

--
-- Name: user_roles roles_self_view; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY roles_self_view ON public.user_roles FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE user_roles; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.user_roles TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_roles TO authenticated;

--
-- Name: business_timestamp(date, time without time zone); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.business_timestamp(p_date date, p_time time without time zone DEFAULT NULL::time without time zone) RETURNS timestamp with time zone
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT ((coalesce(p_date, public.business_today()) + coalesce(p_time, time '00:00'))::timestamp
          AT TIME ZONE public.business_timezone());
$$;


--
-- Name: FUNCTION business_today(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.business_today() IS 'اليوم التشغيلي للمنشأة. لا تستخدم current_date بدلاً منها: current_date يتبع TIMEZONE الجلسة، وهو من مصدر الاختلاف في تواريخ التحصيل.';

--
-- Name: FUNCTION business_today(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.business_today() FROM PUBLIC;

GRANT ALL ON FUNCTION public.business_today() TO authenticated;

GRANT ALL ON FUNCTION public.business_today() TO service_role;


--
-- Name: FUNCTION company_costing_method(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.company_costing_method() FROM PUBLIC;

GRANT ALL ON FUNCTION public.company_costing_method() TO service_role;


--
-- Name: FUNCTION get_batch_settings(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.get_batch_settings() FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_batch_settings() TO service_role;


--
-- Name: profiles platform admin reads profiles; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "platform admin reads profiles" ON public.profiles FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));

--
-- Name: user_roles platform admin reads user_roles; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "platform admin reads user_roles" ON public.user_roles FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));

--
-- Name: platform_admins platform_admins_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY platform_admins_read ON public.platform_admins FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));

--
-- Name: platform_audit_logs platform_audit_logs_select; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY platform_audit_logs_select ON public.platform_audit_logs FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));

--
-- Name: FUNCTION is_platform_admin(p_user_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.is_platform_admin(p_user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.is_platform_admin(p_user_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.is_platform_admin(p_user_id uuid) TO authenticated;

--
-- Name: expense_role_rank(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_role_rank(p_user uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE
    WHEN public.is_platform_superadmin(p_user) THEN 100
    WHEN public.has_role(p_user, 'owner')      THEN 50
    WHEN public.has_role(p_user, 'manager')    THEN 40
    WHEN public.has_role(p_user, 'accountant') THEN 30
    WHEN public.has_role(p_user, 'cashier')    THEN 20
    WHEN public.has_role(p_user, 'warehouse')  THEN 10
    ELSE 0
  END;
$$;


--
-- Name: is_staff(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.is_staff(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  SELECT public.is_platform_superadmin(_user_id)
    OR (
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
      AND COALESCE((SELECT is_active FROM public.profiles WHERE id = _user_id), false)
    );
$$;

--
-- Name: platform_admin_audit(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.platform_admin_audit() RETURNS TABLE(user_id uuid, email text, platform_role text, is_active boolean, has_email_id boolean, has_phone_id boolean, has_profile boolean, has_store_role boolean, is_superadmin boolean, problems text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
        SELECT
          pa.user_id,
          u.email::text,
          pa.role,
          pa.is_active,
          EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = pa.user_id AND i.provider = 'email'),
          EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = pa.user_id AND i.provider = 'phone'),
          EXISTS (SELECT 1 FROM public.profiles p       WHERE p.id      = pa.user_id),
          EXISTS (SELECT 1 FROM public.user_roles r     WHERE r.user_id = pa.user_id),
          public.is_platform_superadmin(pa.user_id),
          array_remove(ARRAY[
            CASE WHEN u.id IS NULL                THEN 'missing auth.users'                END,
            CASE WHEN u.deleted_at IS NOT NULL     THEN 'auth user deleted'                 END,
            CASE WHEN u.email_confirmed_at IS NULL THEN 'email not confirmed'                END,
            CASE WHEN u.banned_until > now()       THEN 'auth user banned'                  END,
            CASE WHEN NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = pa.user_id AND i.provider = 'email')
                                                   THEN 'missing email identity'            END,
            CASE WHEN NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = pa.user_id AND i.provider = 'phone')
                                                   THEN 'missing phone identity'            END,
            CASE WHEN NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = pa.user_id)
                                                   THEN 'missing profile'                   END,
            CASE WHEN NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = pa.user_id AND p.is_active)
                                                   THEN 'profile inactive (is_staff = false)' END,
            CASE WHEN NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = pa.user_id)
                                                   THEN 'missing store role (RLS hides everything)' END,
            CASE WHEN pa.role = 'superadmin' AND NOT public.is_platform_superadmin(pa.user_id)
                                                   THEN 'superadmin row does not satisfy the predicate' END,
            CASE WHEN pa.role = 'support' AND public.is_platform_superadmin(pa.user_id)
                                                   THEN 'support account satisfies superadmin predicate' END
          ], NULL) AS problems
        FROM public.platform_admins pa
        LEFT JOIN auth.users u ON u.id = pa.user_id
        -- P1-7: صلاحية القراءة داخل الدالة، لا بالاعتماد على منحة EXECUTE.
        WHERE public.is_platform_admin(auth.uid())
        ORDER BY pa.role DESC, u.email
      $$;

--
-- Name: platform_admins platform_admins_delete; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY platform_admins_delete ON public.platform_admins FOR DELETE TO authenticated USING (public.is_platform_superadmin(auth.uid()));

--
-- Name: platform_admins platform_admins_insert; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY platform_admins_insert ON public.platform_admins FOR INSERT TO authenticated WITH CHECK (public.is_platform_superadmin(auth.uid()));

--
-- Name: platform_admins platform_admins_update; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY platform_admins_update ON public.platform_admins FOR UPDATE TO authenticated USING (public.is_platform_superadmin(auth.uid())) WITH CHECK (public.is_platform_superadmin(auth.uid()));

--
-- Name: platform_audit_logs platform_audit_logs_insert; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY platform_audit_logs_insert ON public.platform_audit_logs FOR INSERT TO authenticated WITH CHECK (public.is_platform_superadmin(auth.uid()));

--
-- Name: profiles profiles_owner_edit_profile; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY profiles_owner_edit_profile ON public.profiles FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.is_platform_superadmin(auth.uid()))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.is_platform_superadmin(auth.uid())));

--
-- Name: tenant_subscriptions tenant_subscriptions_insert; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY tenant_subscriptions_insert ON public.tenant_subscriptions FOR INSERT TO authenticated WITH CHECK (public.is_platform_superadmin(auth.uid()));

--
-- Name: tenant_subscriptions tenant_subscriptions_update; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY tenant_subscriptions_update ON public.tenant_subscriptions FOR UPDATE TO authenticated USING (public.is_platform_superadmin(auth.uid())) WITH CHECK (public.is_platform_superadmin(auth.uid()));

--
-- Name: FUNCTION is_platform_superadmin(p_user_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.is_platform_superadmin(p_user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.is_platform_superadmin(p_user_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.is_platform_superadmin(p_user_id uuid) TO authenticated;


--
-- Name: FUNCTION business_timestamp(p_date date, p_time time without time zone); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.business_timestamp(p_date date, p_time time without time zone) IS 'يحوّل تاريخ مستند (date) إلى لحظة (timestamptz) بتوقيت المنشأة. هو البديل الصحيح لـ date::timestamptz.';

--
-- Name: FUNCTION business_timestamp(p_date date, p_time time without time zone); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.business_timestamp(p_date date, p_time time without time zone) FROM PUBLIC;

GRANT ALL ON FUNCTION public.business_timestamp(p_date date, p_time time without time zone) TO authenticated;

GRANT ALL ON FUNCTION public.business_timestamp(p_date date, p_time time without time zone) TO service_role;


--
-- Name: FUNCTION expense_role_rank(p_user uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_role_rank(p_user uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_role_rank(p_user uuid) TO service_role;

GRANT ALL ON FUNCTION public.expense_role_rank(p_user uuid) TO authenticated;

--
-- Name: can_read_finance(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.can_read_finance(p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.is_staff(p_user) AND public.expense_role_rank(p_user) >= 30
$$;


--
-- Name: FUNCTION is_staff(_user_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.is_staff(_user_id uuid) IS 'يتحقق أن المستخدم عضو نشط في طاقم المتجر أو سوبر أدمن منصة نشط؛ دعم المنصة لا يرث وصول المتجر.';

--
-- Name: audit_logs Staff insert audit; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "Staff insert audit" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

--
-- Name: company_items company_items_staff_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY company_items_staff_read ON public.company_items FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: costing_policy_history costing_history_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY costing_history_read ON public.costing_policy_history FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: company_costing_settings costing_settings_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY costing_settings_read ON public.company_costing_settings FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: FUNCTION is_staff(_user_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.is_staff(_user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.is_staff(_user_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.is_staff(_user_id uuid) TO authenticated;


--
-- Name: FUNCTION platform_admin_audit(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.platform_admin_audit() IS 'تقرير اكتمال حسابات المنصة — service_role فقط (يقرأ auth.users). للواجهة استخدم platform_admin_audit_self().';

--
-- Name: platform_admin_audit_self(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.platform_admin_audit_self() RETURNS TABLE(user_id uuid, email text, platform_role text, is_active boolean, has_email_id boolean, has_phone_id boolean, has_profile boolean, has_store_role boolean, is_superadmin boolean, problems text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
        SELECT * FROM public.platform_admin_audit()
        WHERE public.is_platform_admin(auth.uid())
      $$;

--
-- Name: FUNCTION platform_admin_audit(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.platform_admin_audit() FROM PUBLIC;

GRANT ALL ON FUNCTION public.platform_admin_audit() TO service_role;


--
-- Name: FUNCTION can_read_finance(p_user uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.can_read_finance(p_user uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.can_read_finance(p_user uuid) TO service_role;

GRANT ALL ON FUNCTION public.can_read_finance(p_user uuid) TO authenticated;


--
-- Name: FUNCTION platform_admin_audit_self(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.platform_admin_audit_self() FROM PUBLIC;

GRANT ALL ON FUNCTION public.platform_admin_audit_self() TO service_role;

GRANT ALL ON FUNCTION public.platform_admin_audit_self() TO authenticated;
