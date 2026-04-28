
-- 1. Attach the prevent_profile_company_change trigger so company_id and id on profiles are immutable.
DROP TRIGGER IF EXISTS profiles_prevent_company_change ON public.profiles;
CREATE TRIGGER profiles_prevent_company_change
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_company_change();

-- 2. Revoke EXECUTE on internal trigger functions from anon/authenticated.
-- These are SECURITY DEFINER and only need to run as triggers, not via the API.
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_company_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- current_company_id() is required by RLS policies, so authenticated must keep EXECUTE.
-- Make sure anon cannot call it.
REVOKE EXECUTE ON FUNCTION public.current_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated;

-- 3. Realtime authorization: restrict subscriptions on realtime.messages so only
-- members of the company that owns the row receive change events.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company members can receive realtime" ON realtime.messages;
CREATE POLICY "company members can receive realtime"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- Only allow if the topic equals "inbox-<company_id>" of the subscribed user.
  realtime.topic() = ('inbox-' || public.current_company_id()::text)
);
