-- 1) Remove the `integrations` table from realtime publication.
-- It contains secrets (access_token, verify_token, webhook_secret) that must never
-- be broadcast to clients via postgres_changes events.
ALTER PUBLICATION supabase_realtime DROP TABLE public.integrations;

-- 2) Defense-in-depth: a trigger that prevents any user (via authenticated role)
-- from ever changing their own profile's company_id. The existing WITH CHECK on
-- the RLS policy is not sufficient because current_company_id() may resolve from
-- the (about-to-be-updated) row. This trigger is the source of truth.
CREATE OR REPLACE FUNCTION public.prevent_profile_company_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'company_id is immutable on profiles';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'id is immutable on profiles';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_company_change ON public.profiles;
CREATE TRIGGER profiles_prevent_company_change
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_company_change();

-- 3) Explicit deny-all policies on `integrations` so the table is unreachable
-- from the client (PostgREST) under the anon/authenticated roles. All access
-- continues through the server-side endpoints (service role) and the
-- `integrations_safe` view. This also clears the linter info finding about
-- "RLS enabled but no policy".
DROP POLICY IF EXISTS "deny all client access to integrations" ON public.integrations;
CREATE POLICY "deny all client access to integrations"
ON public.integrations
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);