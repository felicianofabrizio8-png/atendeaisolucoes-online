-- Volta a view ao modo recomendado (security_invoker=on)
ALTER VIEW public.integrations_safe SET (security_invoker = true);

-- Cria política de SELECT no integrations para membros da empresa.
-- A proteção dos tokens passa a ser por permissão de COLUNA (abaixo).
DROP POLICY IF EXISTS "company select integrations" ON public.integrations;
CREATE POLICY "company select integrations"
ON public.integrations
FOR SELECT
TO authenticated
USING (company_id = current_company_id());

-- Revoga acesso total das colunas para roles client-side e concede apenas
-- as colunas não-sensíveis. Tokens (access_token, webhook_secret,
-- verify_token) só podem ser lidos via service_role.
REVOKE SELECT ON public.integrations FROM anon, authenticated;
GRANT SELECT (
  id,
  company_id,
  channel,
  display_name,
  active,
  external_account_id,
  account_metadata,
  last_synced_at,
  last_error,
  token_expires_at,
  created_at,
  updated_at
) ON public.integrations TO authenticated;