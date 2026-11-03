-- Private storage for encrypted browser-generated backups. Each authenticated
-- user can access only objects stored beneath their own user-id folder.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tenant-backups',
  'tenant-backups',
  false,
  104857600,
  ARRAY['application/json']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS tenant_backups_select_own ON storage.objects;
CREATE POLICY tenant_backups_select_own
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'tenant-backups'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS tenant_backups_insert_own ON storage.objects;
CREATE POLICY tenant_backups_insert_own
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'tenant-backups'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS tenant_backups_delete_own ON storage.objects;
CREATE POLICY tenant_backups_delete_own
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'tenant-backups'
  AND (storage.foldername(name))[1] = auth.uid()::text
);