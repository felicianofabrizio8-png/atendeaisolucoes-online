
-- 1) Restringir SELECT direto na tabela apenas a admins da empresa atual
DROP POLICY IF EXISTS "company select integrations" ON public.integrations;

CREATE POLICY "admin select integrations" ON public.integrations
  FOR SELECT TO authenticated
  USING (company_id = private.current_company_id()
         AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));

-- 2) View segura, sem colunas de token. Filtra por empresa atual no próprio SELECT.
--    security_invoker=off (default) faz a view rodar como owner, bypassando RLS da tabela base;
--    o filtro company_id=current_company_id garante isolamento entre empresas.
DROP VIEW IF EXISTS public.integrations_safe;

CREATE VIEW public.integrations_safe
WITH (security_invoker = off) AS
SELECT
  id,
  company_id,
  channel,
  display_name,
  active,
  external_account_id,
  account_metadata,
  has_access_token,
  has_webhook_secret,
  token_expires_at,
  last_synced_at,
  last_error,
  created_at,
  updated_at
FROM public.integrations
WHERE company_id = private.current_company_id();

REVOKE ALL ON public.integrations_safe FROM PUBLIC, anon;
GRANT SELECT ON public.integrations_safe TO authenticated;
GRANT ALL ON public.integrations_safe TO service_role;
