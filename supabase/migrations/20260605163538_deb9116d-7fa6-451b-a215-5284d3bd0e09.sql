
-- Leitura restrita à empresa do usuário (path = "<company_id>/...")
CREATE POLICY "wa-media: company members read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'whatsapp-media'
  AND (storage.foldername(name))[1] = (private.current_company_id())::text
);
