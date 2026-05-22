ALTER VIEW public.integrations_safe SET (security_invoker = false);
GRANT SELECT ON public.integrations_safe TO authenticated;