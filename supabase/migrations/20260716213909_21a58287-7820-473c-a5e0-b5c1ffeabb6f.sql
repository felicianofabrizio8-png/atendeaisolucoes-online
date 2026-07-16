
CREATE OR REPLACE FUNCTION public.get_publisher_tick_secret()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret
    FROM vault.decrypted_secrets
   WHERE name = 'PUBLISHER_TICK_SECRET'
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_publisher_tick_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_publisher_tick_secret() TO service_role;
