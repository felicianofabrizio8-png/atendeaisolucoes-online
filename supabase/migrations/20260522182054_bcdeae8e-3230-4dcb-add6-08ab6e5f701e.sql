CREATE OR REPLACE VIEW public.integrations_safe
WITH (security_invoker = true) AS
SELECT
  id,
  company_id,
  channel,
  display_name,
  active,
  external_account_id,
  account_metadata,
  (access_token IS NOT NULL) AS has_access_token,
  (webhook_secret IS NOT NULL) AS has_webhook_secret,
  last_synced_at,
  last_error,
  created_at,
  updated_at
FROM public.integrations;

GRANT SELECT ON public.integrations_safe TO authenticated;
REVOKE EXECUTE ON FUNCTION public.current_company_id() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.current_company_id() FROM PUBLIC;