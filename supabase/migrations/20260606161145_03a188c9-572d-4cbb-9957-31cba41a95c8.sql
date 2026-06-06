
-- 1) Remove broad RLS policy that leaks unmapped WhatsApp events across companies.
DROP POLICY IF EXISTS "company select unmapped wa events recent" ON public.whatsapp_unmapped_events;

-- 2) Lock down EXECUTE on SECURITY DEFINER functions.
-- Trigger-only functions: no role needs EXECUTE.
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_agent_on_lead_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_pending_followups_on_reply() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_page_token_in_meta_integrations() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_company_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_integration_safe_flags() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_agent_maintenance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_audit(uuid, uuid, text, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- Helper functions used by RLS / app: revoke from anon + PUBLIC, keep authenticated.
REVOKE EXECUTE ON FUNCTION public.current_company_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.touch_last_seen() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_storage_quota(uuid, bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_storage_usage_bytes(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.count_company_admins(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_last_seen() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_storage_quota(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_storage_usage_bytes(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_company_admins(uuid) TO authenticated;
