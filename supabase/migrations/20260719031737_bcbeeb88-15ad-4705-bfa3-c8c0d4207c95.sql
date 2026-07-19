
-- =====================================================================
-- BRAND CENTER — Fase 1: Fundação (tabelas, RLS, storage policies)
-- =====================================================================

-- 1) brand_profiles
CREATE TABLE public.brand_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Identidade principal',
  description text,
  visual_style text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  active_version_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brand_profiles_company ON public.brand_profiles(company_id);
CREATE INDEX idx_brand_profiles_company_active
  ON public.brand_profiles(company_id) WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_profiles TO authenticated;
GRANT ALL ON public.brand_profiles TO service_role;

ALTER TABLE public.brand_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_profiles_select_own_company"
  ON public.brand_profiles FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "brand_profiles_insert_own_company"
  ON public.brand_profiles FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), company_id, 'admin')
  );

CREATE POLICY "brand_profiles_update_own_company_admin"
  ON public.brand_profiles FOR UPDATE TO authenticated
  USING (company_id = public.current_company_id()
     AND public.has_role(auth.uid(), company_id, 'admin'))
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "brand_profiles_delete_own_company_admin"
  ON public.brand_profiles FOR DELETE TO authenticated
  USING (company_id = public.current_company_id()
     AND public.has_role(auth.uid(), company_id, 'admin'));

CREATE TRIGGER trg_brand_profiles_updated
  BEFORE UPDATE ON public.brand_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) brand_versions
CREATE TABLE public.brand_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.brand_profiles(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  typography jsonb NOT NULL DEFAULT '{}'::jsonb,
  tokens jsonb NOT NULL DEFAULT '{}'::jsonb,
  assets jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  published_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, version_number)
);

CREATE INDEX idx_brand_versions_profile ON public.brand_versions(profile_id);
CREATE INDEX idx_brand_versions_company ON public.brand_versions(company_id);
CREATE INDEX idx_brand_versions_published
  ON public.brand_versions(profile_id, status)
  WHERE status = 'published';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_versions TO authenticated;
GRANT ALL ON public.brand_versions TO service_role;

ALTER TABLE public.brand_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_versions_select_own_company"
  ON public.brand_versions FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "brand_versions_insert_own_company_admin"
  ON public.brand_versions FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), company_id, 'admin')
  );

CREATE POLICY "brand_versions_update_own_company_admin"
  ON public.brand_versions FOR UPDATE TO authenticated
  USING (company_id = public.current_company_id()
     AND public.has_role(auth.uid(), company_id, 'admin'))
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "brand_versions_delete_own_company_admin"
  ON public.brand_versions FOR DELETE TO authenticated
  USING (company_id = public.current_company_id()
     AND public.has_role(auth.uid(), company_id, 'admin'));

CREATE TRIGGER trg_brand_versions_updated
  BEFORE UPDATE ON public.brand_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.brand_profiles
  ADD CONSTRAINT brand_profiles_active_version_fkey
  FOREIGN KEY (active_version_id) REFERENCES public.brand_versions(id) ON DELETE SET NULL;

-- 3) brand_assets
CREATE TABLE public.brand_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.brand_profiles(id) ON DELETE CASCADE,
  asset_type text NOT NULL CHECK (asset_type IN (
    'logo_primary','logo_light','logo_dark','symbol','favicon',
    'watermark','decorative_element','texture','background_pattern'
  )),
  storage_bucket text NOT NULL DEFAULT 'brand-assets',
  storage_path text NOT NULL,
  original_filename text,
  mime_type text NOT NULL CHECK (mime_type IN (
    'image/png','image/jpeg','image/webp','image/svg+xml',
    'image/x-icon','image/vnd.microsoft.icon'
  )),
  file_size_bytes bigint,
  width integer,
  height integer,
  sha256 text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, storage_path)
);

CREATE INDEX idx_brand_assets_company ON public.brand_assets(company_id);
CREATE INDEX idx_brand_assets_profile ON public.brand_assets(profile_id);
CREATE INDEX idx_brand_assets_type_active
  ON public.brand_assets(profile_id, asset_type)
  WHERE is_active = true;
CREATE UNIQUE INDEX brand_assets_company_sha256_unique
  ON public.brand_assets(company_id, sha256)
  WHERE sha256 IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_assets TO authenticated;
GRANT ALL ON public.brand_assets TO service_role;

ALTER TABLE public.brand_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_assets_select_own_company"
  ON public.brand_assets FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "brand_assets_insert_own_company_admin"
  ON public.brand_assets FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), company_id, 'admin')
    AND created_by = auth.uid()
  );

CREATE POLICY "brand_assets_update_own_company_admin"
  ON public.brand_assets FOR UPDATE TO authenticated
  USING (company_id = public.current_company_id()
     AND public.has_role(auth.uid(), company_id, 'admin'))
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "brand_assets_delete_own_company_admin"
  ON public.brand_assets FOR DELETE TO authenticated
  USING (company_id = public.current_company_id()
     AND public.has_role(auth.uid(), company_id, 'admin'));

CREATE TRIGGER trg_brand_assets_updated
  BEFORE UPDATE ON public.brand_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) Ownership triggers (bloqueio de vazamento cross-tenant)
CREATE OR REPLACE FUNCTION public.enforce_brand_version_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_profile_company uuid;
BEGIN
  SELECT company_id INTO v_profile_company
    FROM public.brand_profiles WHERE id = NEW.profile_id;
  IF v_profile_company IS NULL THEN
    RAISE EXCEPTION 'brand_version_profile_not_found';
  END IF;
  IF v_profile_company <> NEW.company_id THEN
    RAISE EXCEPTION 'brand_version_cross_tenant';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_brand_versions_ownership
  BEFORE INSERT OR UPDATE ON public.brand_versions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_brand_version_ownership();

CREATE OR REPLACE FUNCTION public.enforce_brand_asset_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_company uuid;
  v_expected_prefix text;
BEGIN
  SELECT company_id INTO v_profile_company
    FROM public.brand_profiles WHERE id = NEW.profile_id;
  IF v_profile_company IS NULL THEN
    RAISE EXCEPTION 'brand_asset_profile_not_found';
  END IF;
  IF v_profile_company <> NEW.company_id THEN
    RAISE EXCEPTION 'brand_asset_cross_tenant';
  END IF;
  v_expected_prefix := NEW.company_id::text || '/';
  IF NEW.storage_path IS NULL OR position(v_expected_prefix in NEW.storage_path) <> 1 THEN
    RAISE EXCEPTION 'brand_asset_storage_path_must_be_company_scoped';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_brand_assets_ownership
  BEFORE INSERT OR UPDATE ON public.brand_assets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_brand_asset_ownership();

-- 5) Storage RLS (bucket brand-assets já criado)
CREATE POLICY "brand_assets_storage_select_own"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );

CREATE POLICY "brand_assets_storage_insert_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND (storage.foldername(name))[1] = public.current_company_id()::text
    AND public.has_role(auth.uid(), public.current_company_id(), 'admin')
  );

CREATE POLICY "brand_assets_storage_update_own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND (storage.foldername(name))[1] = public.current_company_id()::text
    AND public.has_role(auth.uid(), public.current_company_id(), 'admin')
  );

CREATE POLICY "brand_assets_storage_delete_own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND (storage.foldername(name))[1] = public.current_company_id()::text
    AND public.has_role(auth.uid(), public.current_company_id(), 'admin')
  );
