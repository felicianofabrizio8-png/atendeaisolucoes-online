CREATE OR REPLACE FUNCTION public.publish_brand_version(_version_id uuid)
 RETURNS TABLE(version_id uuid, profile_id uuid, published_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  FROM public.brand_versions AS bv
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
  UPDATE public.brand_versions AS bv
     SET status = 'archived', updated_at = now()
   WHERE bv.profile_id = v_profile_id
     AND bv.status = 'published'
     AND bv.id <> _version_id;

  -- Publica a nova versão.
  UPDATE public.brand_versions AS bv
     SET status = 'published',
         published_at = v_published_at,
         updated_at = now()
   WHERE bv.id = _version_id;

  -- Atualiza active_version_id no perfil.
  UPDATE public.brand_profiles AS bp
     SET active_version_id = _version_id,
         status = 'active',
         updated_at = now()
   WHERE bp.id = v_profile_id
     AND bp.company_id = v_company_id;

  RETURN QUERY SELECT _version_id AS version_id, v_profile_id AS profile_id, v_published_at AS published_at;
END;
$function$;