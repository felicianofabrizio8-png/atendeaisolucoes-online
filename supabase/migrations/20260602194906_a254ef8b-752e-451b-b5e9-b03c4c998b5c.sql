REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_storage_usage_bytes(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_storage_quota(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_storage_usage_bytes(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_storage_quota(uuid, bigint) TO authenticated;