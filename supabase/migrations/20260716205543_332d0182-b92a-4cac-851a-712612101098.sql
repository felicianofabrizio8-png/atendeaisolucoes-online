
ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS is_primary_publisher boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS integrations_primary_publisher_uidx
  ON public.integrations (company_id, channel)
  WHERE is_primary_publisher = true AND active = true;

DROP VIEW IF EXISTS public.integrations_safe;
CREATE VIEW public.integrations_safe AS
  SELECT id, company_id, channel, display_name, active, external_account_id,
         account_metadata, has_access_token, has_webhook_secret,
         is_primary_publisher, token_expires_at, last_synced_at, last_error,
         created_at, updated_at
    FROM public.integrations
   WHERE company_id = private.current_company_id();

GRANT SELECT ON public.integrations_safe TO authenticated;

UPDATE public.integrations
   SET is_primary_publisher = true
 WHERE id = '29649742-a728-4c86-b96d-f3c7c43b63be'
   AND company_id = '3a7e989c-2e1c-425d-8fc6-0feecbeb48fd'
   AND channel = 'instagram';
