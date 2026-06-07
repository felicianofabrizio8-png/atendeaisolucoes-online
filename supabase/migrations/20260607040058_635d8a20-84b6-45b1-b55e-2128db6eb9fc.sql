
-- 1) Nova sobrecarga com escopo de empresa
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _company_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND company_id = _company_id
      AND role = _role
  )
$$;

-- 2) Recriar policies usando a sobrecarga com escopo de empresa

-- audit_log
DROP POLICY IF EXISTS "admin select audit_log" ON public.audit_log;
CREATE POLICY "admin select audit_log" ON public.audit_log
  FOR SELECT TO authenticated
  USING (company_id = private.current_company_id()
         AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));

-- campaigns
DROP POLICY IF EXISTS "admin delete campaigns" ON public.campaigns;
CREATE POLICY "admin delete campaigns" ON public.campaigns
  FOR DELETE TO authenticated
  USING (company_id = private.current_company_id()
         AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));

-- company_invites (INSERT, SELECT, UPDATE)
DROP POLICY IF EXISTS "admin insert company_invites" ON public.company_invites;
CREATE POLICY "admin insert company_invites" ON public.company_invites
  FOR INSERT TO authenticated
  WITH CHECK (company_id = private.current_company_id()
              AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin select company_invites" ON public.company_invites;
CREATE POLICY "admin select company_invites" ON public.company_invites
  FOR SELECT TO authenticated
  USING (company_id = private.current_company_id()
         AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin update company_invites" ON public.company_invites;
CREATE POLICY "admin update company_invites" ON public.company_invites
  FOR UPDATE TO authenticated
  USING (company_id = private.current_company_id()
         AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));

-- company_settings
DROP POLICY IF EXISTS "admin update settings" ON public.company_settings;
CREATE POLICY "admin update settings" ON public.company_settings
  FOR UPDATE TO authenticated
  USING (company_id = private.current_company_id()
         AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));

-- error_log
DROP POLICY IF EXISTS "admin select error_log" ON public.error_log;
CREATE POLICY "admin select error_log" ON public.error_log
  FOR SELECT TO authenticated
  USING (company_id = private.current_company_id()
         AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));

-- loss_reasons (DELETE, INSERT, UPDATE)
DROP POLICY IF EXISTS "admin delete reasons" ON public.loss_reasons;
CREATE POLICY "admin delete reasons" ON public.loss_reasons
  FOR DELETE TO authenticated
  USING (company_id = private.current_company_id()
         AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin insert reasons" ON public.loss_reasons;
CREATE POLICY "admin insert reasons" ON public.loss_reasons
  FOR INSERT TO authenticated
  WITH CHECK (company_id = private.current_company_id()
              AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin update reasons" ON public.loss_reasons;
CREATE POLICY "admin update reasons" ON public.loss_reasons
  FOR UPDATE TO authenticated
  USING (company_id = private.current_company_id()
         AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));

-- products
DROP POLICY IF EXISTS "admin delete products" ON public.products;
CREATE POLICY "admin delete products" ON public.products
  FOR DELETE TO authenticated
  USING (company_id = private.current_company_id()
         AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));

-- user_roles (DELETE, INSERT, UPDATE)
DROP POLICY IF EXISTS "admin delete user_roles" ON public.user_roles;
CREATE POLICY "admin delete user_roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (company_id = private.current_company_id()
         AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin insert user_roles" ON public.user_roles;
CREATE POLICY "admin insert user_roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (company_id = private.current_company_id()
              AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin update user_roles" ON public.user_roles;
CREATE POLICY "admin update user_roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (company_id = private.current_company_id()
         AND public.has_role(auth.uid(), private.current_company_id(), 'admin'::public.app_role));
