DROP VIEW IF EXISTS public.integrations_safe;
CREATE VIEW public.integrations_safe
WITH (security_invoker = true) AS
SELECT
  id, company_id, channel, display_name, active,
  external_account_id, account_metadata,
  has_access_token, has_webhook_secret,
  last_synced_at, last_error,
  token_expires_at,
  created_at, updated_at
FROM public.integrations;