-- Private storage for expense source documents.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-attachments', 'expense-attachments', false, 10485760,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp','text/plain']::text[]
)
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS expense_attachments_storage_read ON storage.objects;
CREATE POLICY expense_attachments_storage_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'expense-attachments' AND EXISTS (
  SELECT 1 FROM public.expense_attachments a
  WHERE a.bucket_id = storage.objects.bucket_id AND a.storage_path = storage.objects.name
));

DROP POLICY IF EXISTS expense_attachments_storage_insert ON storage.objects;
CREATE POLICY expense_attachments_storage_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'expense-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS expense_attachments_storage_delete ON storage.objects;
CREATE POLICY expense_attachments_storage_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'expense-attachments' AND EXISTS (
  SELECT 1 FROM public.expense_attachments a
  JOIN public.expense_entries e ON e.id = a.entry_id
  WHERE a.bucket_id = storage.objects.bucket_id AND a.storage_path = storage.objects.name
    AND a.uploaded_by = auth.uid() AND e.status IN ('DRAFT','REJECTED')
));

COMMIT;
