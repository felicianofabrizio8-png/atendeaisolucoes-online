CREATE OR REPLACE VIEW public.integrations_safe
WITH (security_invoker = false) AS
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
FROM public.integrations
WHERE company_id = public.current_company_id();

GRANT SELECT ON public.integrations_safe TO authenticated;