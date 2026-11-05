-- ============================================================================
-- الترحيل 015_global_security.sql — مجال: global_security
-- جزء من خط الأساس الجديد: تعريف نهائي واحد لكل كائن، مبني من مخطط مرجعي
-- مستخرج من الترحيلات التاريخية الكاملة (راجع supabase/migrations/README.md).
-- ============================================================================

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO authenticated;

-- Keep the final security-invoker setting on every public view. This belongs
-- in the schema baseline because it changes view security behavior, not data.
DO $$
DECLARE
  v_view record;
BEGIN
  FOR v_view IN
    SELECT c.oid::regclass AS rel
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
  LOOP
    EXECUTE format('ALTER VIEW %s SET (security_invoker = true)', v_view.rel);
  END LOOP;
END $$;

-- Public clients may read only through the explicit RLS policies. Remove
-- direct write privileges from anon on all public relations in the baseline.
DO $$
DECLARE
  v_rel record;
BEGIN
  FOR v_rel IN
    SELECT c.oid::regclass AS rel
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON %s FROM anon',
      v_rel.rel
    );
  END LOOP;
END $$;
