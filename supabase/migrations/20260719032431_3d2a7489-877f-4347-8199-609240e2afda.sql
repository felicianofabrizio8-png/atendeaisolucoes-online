
-- 1) Garantir no banco: no máximo 1 versão publicada por perfil
CREATE UNIQUE INDEX IF NOT EXISTS brand_versions_one_published_per_profile
  ON public.brand_versions(profile_id)
  WHERE status = 'published';

-- 2) Publicação transacional (autorização, arquivamento e ativação em bloco)
CREATE OR REPLACE FUNCTION public.publish_brand_version(_version_id uuid)
RETURNS TABLE (
  version_id uuid,
  profile_id uuid,
  published_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_profile_id uuid;
  v_status text;
  v_current_company uuid;
  v_published_at timestamptz := now();
BEGIN
  v_current_company := public.current_company_id();
  IF v_current_company IS NULL THEN
    RAISE EXCEPTION 'brand_publish_no_company' USING ERRCODE = '42501';
  END IF;

  SELECT bv.company_id, bv.profile_id, bv.status
    INTO v_company_id, v_profile_id, v_status
  FROM public.brand_versions bv
  WHERE bv.id = _version_id
  FOR UPDATE;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'brand_version_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_company_id <> v_current_company THEN
    RAISE EXCEPTION 'brand_version_cross_tenant' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_role(auth.uid(), v_company_id, 'admin') THEN
    RAISE EXCEPTION 'brand_publish_forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'brand_version_not_draft' USING ERRCODE = '22023';
  END IF;

  -- Arquiva versão publicada anterior (se houver) — dentro da mesma transação.
  UPDATE public.brand_versions
     SET status = 'archived', updated_at = now()
   WHERE profile_id = v_profile_id
     AND status = 'published'
     AND id <> _version_id;

  -- Publica a nova versão.
  UPDATE public.brand_versions
     SET status = 'published',
         published_at = v_published_at,
         updated_at = now()
   WHERE id = _version_id;

  -- Atualiza active_version_id no perfil.
  UPDATE public.brand_profiles
     SET active_version_id = _version_id,
         status = 'active',
         updated_at = now()
   WHERE id = v_profile_id
     AND company_id = v_company_id;

  RETURN QUERY SELECT _version_id, v_profile_id, v_published_at;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_brand_version(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_brand_version(uuid) TO authenticated;
