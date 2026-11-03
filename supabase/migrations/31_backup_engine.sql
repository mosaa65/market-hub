-- ============================================================================
-- 31_backup_engine.sql
--
-- محرك النسخ الاحتياطي الديناميكي (Server-Side Backup Engine).
--
-- الفكرة: بدلاً من قائمة جداول مكتوبة يدويًا في الواجهة (القديمة كانت 37 جدولًا
-- فقط وتفوّت الوحدات المحاسبية)، تُقرأ قائمة الجداول وأعمدتها ديناميكيًا من
-- information_schema وقت النسخ — أي يتكيف تلقائيًا مع أي مهاجرة جديدة.
--
-- الدوال:
--   1. backup_schema_fingerprint()   بصمة المخطط (لتكشف تغيّر الجداول/الأعمدة)
--   2. backup_export_all()           تفريغ JSONB لكل جداول public (مع حدود صفوف)
--   3. backup_restore_all()          استعادة كاملة داخل Transaction واحد
--
-- الصلاحيات: الاستدعاء يتطلب دور owner أو manager (الاستعادة: owner فقط).
-- لا يحتوي أي بيانات أعمال أو تجارية. راجع supabase/MIGRATIONS_RULES.md
-- ============================================================================

BEGIN;

-- دالة sha256 مدمجة في PostgreSQL (PG11+) — لا تحتاج أي إضافة (pgcrypto
-- قد لا يكون متاحًا باسم digest في مخطط extensions على بيئات الدوكر المحلية).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. بصمة المخطط: هاش تجميعي لأسماء الجداول والأعمدة وأنواعها في public.
--    إذا اختلف بين وقت النسخ ووقت الاستعادة → السكيما تغيّرت، نُعِر المستخدم.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.backup_schema_fingerprint()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
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

-- ────────────────────────────────────────────────────────────────────────────
-- 2. تفريغ كامل ديناميكي.
--    - يقرأ كل جداول public من information_schema (لا قائمة يدوية).
--    - يجمع كل صفوفها كـ JSONB (الأعمدة تُستخرج كما هي، `select *` ديناميكي).
--    - جداول السجل الضخم (audit_logs / backup_logs / idempotency_keys) تُفرَّغ
--      بأحدث N صفًا فقط لتجنب نفاد الذاكرة — عدد الجداول والصفوف يُعاد في الملخص.
--    - SECURITY DEFINER: تتجاوز RLS لتفريغ كل الصفوف، لكنها محصورة بدور
--      owner/manager عبر فحص صريح داخل الدالة.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.backup_export_all(
  p_max_log_rows integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
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

-- ────────────────────────────────────────────────────────────────────────────
-- 3. الاستعادة الكاملة داخل Transaction.
--
--    الترتيب:
--      أ. فحص دور owner فقط (استعادة خارقة، لا تُمنح لأي دور آخر).
--      ب. التحقق من البنية: الحمولة يجب أن تحمل kind + tables + fingerprint.
--      ج. تعطيل المفاتيح مؤقتًا (session_replication_role = replica) حتى تُدرج
--         الصفوف بأي ترتيب دون انكسار المفاتيح الخارجية، ثم إعادتها فورًا.
--      د. TRUNCATE لكل جداول public (بما فيها غير المذكورة في الحمولة — حتى لا
--         يبقى بيانات قديمة مزيفة)، ثم INSERT عبر jsonb_populate_recordset
--         الذي يطابق الأعمدة بالاسم لا بالترتيب (يتكيف مع ترتيب الأعمدة الجديد).
--      هـ. إعادة ضبط sequences إلى قيم الأعمدة المدرجة.
--
--    ملاحظة معلنة: الجداول ذات أعمدة IDENTITY GENERATED ALWAYS لا تقبل إدراج
--    معرّفات صريحة — الكتالوج الحالي لا يستخدمها (تستخدم gen_random_uuid أو serial).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.backup_restore_all(
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

-- ── الصلاحيات ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.backup_schema_fingerprint() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.backup_export_all(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.backup_restore_all(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.backup_schema_fingerprint() TO authenticated;
GRANT EXECUTE ON FUNCTION public.backup_export_all(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backup_restore_all(jsonb) TO authenticated;

COMMENT ON FUNCTION public.backup_export_all(integer) IS
  'Server-side dynamic full backup: reads every public base table from information_schema at call time (adapts to any migration), guarded to owner/manager.';
COMMENT ON FUNCTION public.backup_restore_all(jsonb) IS
  'Server-side full restore in a single transaction: truncates all public tables, reinserts by column name, resets sequences. Owner-only.';
COMMENT ON FUNCTION public.backup_schema_fingerprint() IS
  'SHA-256 fingerprint of the public schema (tables + columns + types). Differing fingerprints between backup and restore signal schema drift.';

COMMIT;
