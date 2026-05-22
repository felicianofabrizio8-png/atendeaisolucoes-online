-- A policy RESTRICTIVE com USING(false) anula qualquer SELECT permissivo.
-- Remove-a; writes continuam negados por ausência de policy para authenticated,
-- e o endpoint /api/whatsapp/integration usa service role (bypass RLS).
DROP POLICY IF EXISTS "deny all client access to integrations" ON public.integrations;
DROP POLICY IF EXISTS "deny all client access to meta_pages" ON public.meta_pages;
