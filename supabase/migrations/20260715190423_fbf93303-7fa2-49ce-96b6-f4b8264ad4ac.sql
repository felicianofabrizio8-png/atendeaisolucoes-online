
REVOKE ALL ON FUNCTION public.prevent_environment_flip() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_staging_real_integration() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_staging_campaign_publish() FROM PUBLIC, anon, authenticated;
