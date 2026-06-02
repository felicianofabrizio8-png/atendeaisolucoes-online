-- =====================================================================
-- FASE 1: PAPÉIS, QUOTA E STORAGE SCOPED POR EMPRESA
-- =====================================================================

-- 1. Enum de papéis
CREATE TYPE public.app_role AS ENUM ('admin', 'atendente', 'financeiro');

-- 2. Tabela user_roles
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read company roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (company_id = private.current_company_id());

CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX idx_user_roles_company ON public.user_roles(company_id);

-- 3. has_role (SECURITY DEFINER — sem recursão)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- 4. Backfill: todo usuário existente vira admin da sua empresa
INSERT INTO public.user_roles (company_id, user_id, role)
SELECT p.company_id, p.id, 'admin'::public.app_role
FROM public.profiles p
ON CONFLICT DO NOTHING;

-- 5. Novos cadastros: admin automático
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_company_id uuid;
  v_company_name text;
BEGIN
  v_company_name := COALESCE(NEW.raw_user_meta_data->>'company_name', 'Minha Empresa');

  INSERT INTO public.companies (name) VALUES (v_company_name) RETURNING id INTO new_company_id;

  INSERT INTO public.profiles (id, company_id, display_name, email)
  VALUES (
    NEW.id,
    new_company_id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.email
  );

  INSERT INTO public.company_settings (company_id) VALUES (new_company_id);

  INSERT INTO public.loss_reasons (company_id, label) VALUES
    (new_company_id, 'Preço acima do orçamento'),
    (new_company_id, 'Comprou do concorrente'),
    (new_company_id, 'Sem retorno do cliente'),
    (new_company_id, 'Não era o cliente ideal'),
    (new_company_id, 'Problema de prazo');

  INSERT INTO public.user_roles (company_id, user_id, role)
  VALUES (new_company_id, NEW.id, 'admin');

  RETURN NEW;
END;
$$;

-- 6. Quota de armazenamento
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS storage_quota_mb integer NOT NULL DEFAULT 500;

CREATE OR REPLACE FUNCTION public.get_storage_usage_bytes(_company_id uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, storage
AS $$
  SELECT COALESCE(SUM((metadata->>'size')::bigint), 0)
  FROM storage.objects
  WHERE bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = _company_id::text
$$;

GRANT EXECUTE ON FUNCTION public.get_storage_usage_bytes(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_storage_quota(_company_id uuid, _new_size bigint)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_quota_mb int;
  v_used bigint;
BEGIN
  SELECT storage_quota_mb INTO v_quota_mb FROM public.companies WHERE id = _company_id;
  IF v_quota_mb IS NULL THEN
    RETURN false;
  END IF;
  v_used := public.get_storage_usage_bytes(_company_id);
  RETURN (v_used + COALESCE(_new_size, 0)) <= (v_quota_mb::bigint * 1024 * 1024);
END;
$$;

-- 7. RLS sensíveis: apenas admin
-- Campaigns: DELETE somente admin
DROP POLICY IF EXISTS "company delete campaigns" ON public.campaigns;
CREATE POLICY "admin delete campaigns" ON public.campaigns
  FOR DELETE TO authenticated
  USING (
    company_id = private.current_company_id()
    AND public.has_role(auth.uid(), 'admin')
  );

-- company_settings: UPDATE somente admin
DROP POLICY IF EXISTS "company update settings" ON public.company_settings;
CREATE POLICY "admin update settings" ON public.company_settings
  FOR UPDATE TO authenticated
  USING (
    company_id = private.current_company_id()
    AND public.has_role(auth.uid(), 'admin')
  );

-- loss_reasons: write somente admin
DROP POLICY IF EXISTS "company insert reasons" ON public.loss_reasons;
DROP POLICY IF EXISTS "company update reasons" ON public.loss_reasons;
DROP POLICY IF EXISTS "company delete reasons" ON public.loss_reasons;
CREATE POLICY "admin insert reasons" ON public.loss_reasons
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = private.current_company_id()
    AND public.has_role(auth.uid(), 'admin')
  );
CREATE POLICY "admin update reasons" ON public.loss_reasons
  FOR UPDATE TO authenticated
  USING (
    company_id = private.current_company_id()
    AND public.has_role(auth.uid(), 'admin')
  );
CREATE POLICY "admin delete reasons" ON public.loss_reasons
  FOR DELETE TO authenticated
  USING (
    company_id = private.current_company_id()
    AND public.has_role(auth.uid(), 'admin')
  );

-- products: DELETE somente admin
DROP POLICY IF EXISTS "company delete products" ON public.products;
CREATE POLICY "admin delete products" ON public.products
  FOR DELETE TO authenticated
  USING (
    company_id = private.current_company_id()
    AND public.has_role(auth.uid(), 'admin')
  );

-- 8. Storage policies: scope por company_id no path + quota
DROP POLICY IF EXISTS "Auth upload product images" ON storage.objects;
DROP POLICY IF EXISTS "Auth update product images" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete product images" ON storage.objects;
DROP POLICY IF EXISTS "Public read product images" ON storage.objects;

CREATE POLICY "Company upload product images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = private.current_company_id()::text
    AND public.check_storage_quota(
      private.current_company_id(),
      COALESCE((metadata->>'size')::bigint, 0)
    )
  );

CREATE POLICY "Company update product images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = private.current_company_id()::text
  );

CREATE POLICY "Company delete product images" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = private.current_company_id()::text
  );

-- Leitura: empresa lê os próprios arquivos. Legacy (sem pasta) fica
-- temporariamente acessível a qualquer autenticado para não quebrar
-- imagens existentes durante a transição.
CREATE POLICY "Company read product images" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (
      (storage.foldername(name))[1] = private.current_company_id()::text
      OR array_length(storage.foldername(name), 1) IS NULL
    )
  );