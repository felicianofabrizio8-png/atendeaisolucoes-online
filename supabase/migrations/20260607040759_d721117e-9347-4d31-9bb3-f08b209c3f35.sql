
-- 1) Restringir SELECT direto na tabela apenas a admins da empresa atual
DROP POLICY IF EXISTS "company select meta_pages safe" ON public.meta_pages;

CREATE POLICY "admin select meta_pages" ON public.meta_pages
  FOR SELECT TO authenticated
  USING (company_id = private.current_company_id()
         AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));

-- 2) View segura sem colunas de token
DROP VIEW IF EXISTS public.meta_pages_safe;

CREATE VIEW public.meta_pages_safe
WITH (security_invoker = off) AS
SELECT
  id,
  company_id,
  integration_id,
  page_id,
  page_name,
  ig_business_account_id,
  ig_username,
  token_expires_at,
  active,
  last_error,
  created_at,
  updated_at
FROM public.meta_pages
WHERE company_id = private.current_company_id();

REVOKE ALL ON public.meta_pages_safe FROM PUBLIC, anon;
GRANT SELECT ON public.meta_pages_safe TO authenticated;
GRANT ALL ON public.meta_pages_safe TO service_role;
