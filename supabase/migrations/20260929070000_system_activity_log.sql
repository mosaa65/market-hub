-- Centralized, human-readable activity log for every data change in public tables.
CREATE TABLE IF NOT EXISTS public.system_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  entity_type text NOT NULL,
  entity_id text,
  old_data jsonb,
  new_data jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_activity_logs_created_at_idx
  ON public.system_activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS system_activity_logs_entity_idx
  ON public.system_activity_logs (entity_type, entity_id);

ALTER TABLE public.system_activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Managers can read system activity" ON public.system_activity_logs;
CREATE POLICY "Managers can read system activity"
  ON public.system_activity_logs FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

GRANT SELECT ON public.system_activity_logs TO authenticated;
GRANT ALL ON public.system_activity_logs TO service_role;

CREATE OR REPLACE FUNCTION public.record_system_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_id text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;
  v_id := COALESCE(v_new->>'id', v_old->>'id');

  INSERT INTO public.system_activity_logs
    (actor_id, action, entity_type, entity_id, old_data, new_data, details)
  VALUES (
    auth.uid(), TG_OP, TG_TABLE_NAME, v_id, v_old, v_new,
    jsonb_build_object(
      'message_key', lower(TG_OP) || '_' || TG_TABLE_NAME,
      'table', TG_TABLE_NAME,
      'record_id', v_id
    )
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT IN ('system_activity_logs', 'audit_logs', 'platform_audit_logs')
      AND c.relname NOT LIKE 'pg_%'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS system_activity_%I ON public.%I', r.relname, r.relname);
    EXECUTE format(
      'CREATE TRIGGER system_activity_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.record_system_activity()',
      r.relname, r.relname
    );
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'system_activity_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.system_activity_logs;
  END IF;
END;
$$;

COMMENT ON TABLE public.system_activity_logs IS 'Central audit trail of all INSERT, UPDATE, and DELETE operations in public business tables.';
COMMENT ON COLUMN public.system_activity_logs.details IS 'Stable translation keys and display metadata for the client UI.';
