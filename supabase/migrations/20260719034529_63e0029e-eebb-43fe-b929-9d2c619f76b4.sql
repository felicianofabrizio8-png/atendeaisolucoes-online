
-- 1. schema_version
ALTER TABLE public.brand_versions
  ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.brand_versions
  DROP CONSTRAINT IF EXISTS brand_versions_schema_version_check;
ALTER TABLE public.brand_versions
  ADD CONSTRAINT brand_versions_schema_version_check
  CHECK (schema_version >= 1 AND schema_version <= 1);

-- 2. sha256 + file_size obrigatórios + formato + dedup
ALTER TABLE public.brand_assets ALTER COLUMN sha256 SET NOT NULL;
ALTER TABLE public.brand_assets ALTER COLUMN file_size_bytes SET NOT NULL;
ALTER TABLE public.brand_assets DROP CONSTRAINT IF EXISTS brand_assets_sha256_format;
ALTER TABLE public.brand_assets ADD CONSTRAINT brand_assets_sha256_format
  CHECK (sha256 ~ '^[a-f0-9]{64}$');

DROP INDEX IF EXISTS public.brand_assets_company_type_sha_uniq;
CREATE UNIQUE INDEX brand_assets_company_type_sha_uniq
  ON public.brand_assets (company_id, asset_type, sha256);

-- 3. Concorrência
DROP INDEX IF EXISTS public.brand_profiles_one_active_per_company;
CREATE UNIQUE INDEX brand_profiles_one_active_per_company
  ON public.brand_profiles (company_id) WHERE status = 'active';

DROP INDEX IF EXISTS public.brand_versions_one_draft_per_profile;
CREATE UNIQUE INDEX brand_versions_one_draft_per_profile
  ON public.brand_versions (profile_id) WHERE status = 'draft';

-- 4. Guard: active_version_id íntegro
CREATE OR REPLACE FUNCTION public.brand_profile_active_version_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text; v_profile uuid; v_company uuid;
BEGIN
  IF NEW.active_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT status, profile_id, company_id INTO v_status, v_profile, v_company
    FROM public.brand_versions WHERE id = NEW.active_version_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'brand_active_version_not_found'; END IF;
  IF v_profile IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'brand_active_version_wrong_profile'; END IF;
  IF v_company IS DISTINCT FROM NEW.company_id THEN RAISE EXCEPTION 'brand_active_version_cross_tenant'; END IF;
  IF v_status <> 'published' THEN RAISE EXCEPTION 'brand_active_version_not_published'; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_brand_profile_active_version_guard ON public.brand_profiles;
CREATE TRIGGER trg_brand_profile_active_version_guard
  BEFORE INSERT OR UPDATE OF active_version_id ON public.brand_profiles
  FOR EACH ROW EXECUTE FUNCTION public.brand_profile_active_version_guard();

-- 5. Prevent destructive delete
CREATE OR REPLACE FUNCTION public.brand_version_prevent_destructive_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_referenced boolean;
BEGIN
  IF OLD.status = 'published' THEN RAISE EXCEPTION 'brand_version_cannot_delete_published'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.brand_profiles WHERE active_version_id = OLD.id) INTO v_referenced;
  IF v_referenced THEN RAISE EXCEPTION 'brand_version_still_referenced_as_active'; END IF;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_brand_version_prevent_destructive_delete ON public.brand_versions;
CREATE TRIGGER trg_brand_version_prevent_destructive_delete
  BEFORE DELETE ON public.brand_versions
  FOR EACH ROW EXECUTE FUNCTION public.brand_version_prevent_destructive_delete();

ALTER TABLE public.brand_profiles DROP CONSTRAINT IF EXISTS brand_profiles_active_version_fkey;
ALTER TABLE public.brand_profiles ADD CONSTRAINT brand_profiles_active_version_fkey
  FOREIGN KEY (active_version_id) REFERENCES public.brand_versions(id) ON DELETE RESTRICT;

-- 6. RPC: metadados reais do Storage (para revalidação server-side)
CREATE OR REPLACE FUNCTION public.brand_asset_storage_metadata(
  _bucket text, _path text
)
RETURNS TABLE(exists_flag boolean, size_bytes bigint, mimetype text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE v_size bigint; v_mime text; v_found boolean;
BEGIN
  SELECT true,
         NULLIF(o.metadata->>'size','')::bigint,
         NULLIF(o.metadata->>'mimetype','')
    INTO v_found, v_size, v_mime
    FROM storage.objects o
   WHERE o.bucket_id = _bucket AND o.name = _path
   LIMIT 1;
  IF v_found IS NULL THEN
    exists_flag := false; size_bytes := NULL; mimetype := NULL;
  ELSE
    exists_flag := true;  size_bytes := v_size; mimetype := v_mime;
  END IF;
  RETURN NEXT;
END; $$;

REVOKE ALL ON FUNCTION public.brand_asset_storage_metadata(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.brand_asset_storage_metadata(text, text) TO authenticated, service_role;
