REVOKE ALL ON FUNCTION public.notify_agent_on_lead_message() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_agent_maintenance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_agent_on_lead_message() TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_agent_maintenance() TO service_role;