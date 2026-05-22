GRANT USAGE ON SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated;

GRANT SELECT (
  id,
  company_id,
  channel,
  display_name,
  active,
  external_account_id,
  account_metadata,
  last_synced_at,
  last_error,
  token_expires_at,
  created_at,
  updated_at
) ON public.integrations TO authenticated;

GRANT SELECT ON public.integrations_safe TO authenticated;