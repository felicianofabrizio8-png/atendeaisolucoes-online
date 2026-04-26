-- 1) profiles: impedir troca de company_id pelo próprio usuário
DROP POLICY IF EXISTS "update own profile" ON public.profiles;
CREATE POLICY "update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND company_id = public.current_company_id()
);

-- 2) integrations: revogar SELECT/INSERT/UPDATE/DELETE do cliente para tokens.
-- Mantemos a tabela como fonte da verdade no servidor (service role bypassa RLS).
-- Para o cliente, expomos uma view sem colunas sensíveis.

DROP POLICY IF EXISTS "company select integrations" ON public.integrations;
DROP POLICY IF EXISTS "company insert integrations" ON public.integrations;
DROP POLICY IF EXISTS "company update integrations" ON public.integrations;
DROP POLICY IF EXISTS "company delete integrations" ON public.integrations;

-- Sem políticas, RLS bloqueia 100% pelo cliente. Service role continua passando.

-- View segura para o cliente — nunca expõe access_token/webhook_secret/verify_token
CREATE OR REPLACE VIEW public.integrations_safe
WITH (security_invoker = true)
AS
SELECT
  id,
  company_id,
  channel,
  display_name,
  active,
  external_account_id,
  account_metadata,
  (access_token IS NOT NULL) AS has_access_token,
  (webhook_secret IS NOT NULL) AS has_webhook_secret,
  last_synced_at,
  last_error,
  created_at,
  updated_at
FROM public.integrations
WHERE company_id = public.current_company_id();

GRANT SELECT ON public.integrations_safe TO authenticated;