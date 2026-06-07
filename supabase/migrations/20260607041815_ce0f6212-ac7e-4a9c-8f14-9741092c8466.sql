-- Revoke EXECUTE on sensitive SECURITY DEFINER functions from anon role
-- These functions are for authenticated/admin use only.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.latest_messages_per_conversation(uuid) FROM anon;