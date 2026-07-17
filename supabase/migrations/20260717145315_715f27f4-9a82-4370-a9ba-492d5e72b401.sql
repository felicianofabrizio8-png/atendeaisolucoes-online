DROP POLICY IF EXISTS "Company read product images" ON storage.objects;

CREATE POLICY "Company read product images"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] = (private.current_company_id())::text
);