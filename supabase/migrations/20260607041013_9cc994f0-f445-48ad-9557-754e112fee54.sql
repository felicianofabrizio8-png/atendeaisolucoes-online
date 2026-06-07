-- Onda 5: hardening do bucket whatsapp-media
-- Adiciona policies de INSERT/UPDATE/DELETE em storage.objects para o bucket
-- whatsapp-media, exigindo usuário autenticado E que o primeiro segmento do
-- path corresponda ao company_id atual do usuário.
-- SELECT permanece inalterado (policy existente "wa-media: company members read").
-- service_role bypassa RLS, portanto webhook, send-audio e send-media continuam intactos.

DROP POLICY IF EXISTS "wa-media: company members insert" ON storage.objects;
DROP POLICY IF EXISTS "wa-media: company members update" ON storage.objects;
DROP POLICY IF EXISTS "wa-media: company members delete" ON storage.objects;

CREATE POLICY "wa-media: company members insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'whatsapp-media'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = (private.current_company_id())::text
);

CREATE POLICY "wa-media: company members update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'whatsapp-media'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = (private.current_company_id())::text
)
WITH CHECK (
  bucket_id = 'whatsapp-media'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = (private.current_company_id())::text
);

CREATE POLICY "wa-media: company members delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'whatsapp-media'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = (private.current_company_id())::text
);