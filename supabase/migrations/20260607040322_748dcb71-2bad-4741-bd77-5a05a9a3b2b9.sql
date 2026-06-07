
DROP POLICY IF EXISTS "members update company" ON public.companies;

CREATE POLICY "admin update company" ON public.companies
  FOR UPDATE TO authenticated
  USING (id = private.current_company_id()
         AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role))
  WITH CHECK (id = private.current_company_id()
              AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));
