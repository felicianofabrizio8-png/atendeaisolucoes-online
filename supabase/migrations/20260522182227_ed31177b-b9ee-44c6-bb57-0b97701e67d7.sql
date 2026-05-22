ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS has_access_token boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_webhook_secret boolean NOT NULL DEFAULT false;

UPDATE public.integrations
SET
  has_access_token = access_token IS NOT NULL AND length(trim(access_token)) > 0,
  has_webhook_secret = webhook_secret IS NOT NULL AND length(trim(webhook_secret)) > 0;

CREATE OR REPLACE FUNCTION public.set_integration_safe_flags()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.has_access_token := NEW.access_token IS NOT NULL AND length(trim(NEW.access_token)) > 0;
  NEW.has_webhook_secret := NEW.webhook_secret IS NOT NULL AND length(trim(NEW.webhook_secret)) > 0;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_integrations_safe_flags ON public.integrations;
CREATE TRIGGER set_integrations_safe_flags
BEFORE INSERT OR UPDATE OF access_token, webhook_secret ON public.integrations
FOR EACH ROW
EXECUTE FUNCTION public.set_integration_safe_flags();

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
  has_access_token,
  has_webhook_secret,
  last_synced_at,
  last_error,
  created_at,
  updated_at
FROM public.integrations;

GRANT SELECT (
  id,
  company_id,
  channel,
  display_name,
  active,
  external_account_id,
  account_metadata,
  has_access_token,
  has_webhook_secret,
  last_synced_at,
  last_error,
  token_expires_at,
  created_at,
  updated_at
) ON public.integrations TO authenticated;

GRANT SELECT ON public.integrations_safe TO authenticated;