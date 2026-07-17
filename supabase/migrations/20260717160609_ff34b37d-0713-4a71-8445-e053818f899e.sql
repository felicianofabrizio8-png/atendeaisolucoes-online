
CREATE OR REPLACE FUNCTION public.get_facebook_publish_readiness()
RETURNS TABLE(channel text, granted_scopes jsonb, external_account_id text, fb_page_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT company_id FROM public.profiles WHERE id = auth.uid()
  )
  SELECT
    i.channel::text,
    COALESCE(i.account_metadata->'granted_scopes', i.account_metadata->'scopes', '[]'::jsonb) AS granted_scopes,
    i.external_account_id,
    (i.account_metadata->>'fb_page_id') AS fb_page_id
  FROM public.integrations i
  JOIN me ON me.company_id = i.company_id
  WHERE i.channel IN ('facebook','instagram')
    AND i.active = true
    AND i.is_primary_publisher = true;
$$;

REVOKE ALL ON FUNCTION public.get_facebook_publish_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_facebook_publish_readiness() TO authenticated;
