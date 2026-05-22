CREATE UNIQUE INDEX IF NOT EXISTS integrations_company_channel_external_uniq
  ON public.integrations(company_id, channel, external_account_id)
  WHERE external_account_id IS NOT NULL;