-- =========================================================================
-- Marketing IA — múltiplas imagens + focal point (aditivo, retrocompatível)
-- =========================================================================

ALTER TABLE public.video_render_jobs
  ADD COLUMN IF NOT EXISTS image_sequence jsonb NULL,
  ADD COLUMN IF NOT EXISTS focal_point    jsonb NULL;

COMMENT ON COLUMN public.video_render_jobs.image_sequence IS
  'Optional ordered list of images for slideshow rendering. Each item: { position:int, primary:bool, source:"marketing_media"|"product_image", image_id?:uuid, product_id?:uuid, product_image_path?:text, focal_point?:{x:0..1,y:0..1,zoom:1..3} }. NULL = legacy single-image job using image_source/image_id/product_id/product_image_path.';

COMMENT ON COLUMN public.video_render_jobs.focal_point IS
  'Optional focal point for the primary image crop: { x:0..1, y:0..1, zoom:1..3 }. NULL = centered crop (legacy behavior).';

-- -------------------------------------------------------------------------
-- Extended ownership trigger: validates every item in image_sequence when set,
-- and keeps the legacy single-image validation for jobs without a sequence.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_render_job_ownership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_c uuid;
  v_active boolean;
  v_media_type text;
  v_images jsonb;
  v_item jsonb;
  v_item_source text;
  v_item_image_id uuid;
  v_item_product_id uuid;
  v_item_product_path text;
BEGIN
  -- 1. Legacy single-image ownership (always required — the "primary" image
  --    is also mirrored into these columns even when a sequence exists).
  IF NEW.image_source = 'marketing_media' THEN
    SELECT company_id, active, media_type
      INTO v_c, v_active, v_media_type
      FROM public.marketing_media
     WHERE id = NEW.image_id;
    IF v_c IS NULL THEN RAISE EXCEPTION 'render_job_image_not_found'; END IF;
    IF v_c <> NEW.company_id THEN RAISE EXCEPTION 'render_job_image_cross_tenant'; END IF;
    IF v_active IS NOT TRUE THEN RAISE EXCEPTION 'render_job_image_inactive'; END IF;
    IF v_media_type IS DISTINCT FROM 'image' THEN
      RAISE EXCEPTION 'render_job_image_wrong_type';
    END IF;
  ELSIF NEW.image_source = 'product_image' THEN
    SELECT company_id, active, COALESCE(images, '[]'::jsonb)
      INTO v_c, v_active, v_images
      FROM public.products
     WHERE id = NEW.product_id;
    IF v_c IS NULL THEN RAISE EXCEPTION 'render_job_product_not_found'; END IF;
    IF v_c <> NEW.company_id THEN RAISE EXCEPTION 'render_job_product_cross_tenant'; END IF;
    IF v_active IS NOT TRUE THEN RAISE EXCEPTION 'render_job_product_inactive'; END IF;
    IF NOT (v_images ? NEW.product_image_path) THEN
      RAISE EXCEPTION 'render_job_product_image_not_owned';
    END IF;
  ELSE
    RAISE EXCEPTION 'render_job_invalid_image_source';
  END IF;

  -- 2. Áudio (comum às duas origens).
  SELECT company_id, is_active INTO v_c, v_active
    FROM public.audio_library WHERE id = NEW.audio_id;
  IF v_c IS NULL THEN RAISE EXCEPTION 'render_job_audio_not_found'; END IF;
  IF v_c <> NEW.company_id THEN RAISE EXCEPTION 'render_job_audio_cross_tenant'; END IF;
  IF v_active IS NOT TRUE THEN RAISE EXCEPTION 'render_job_audio_inactive'; END IF;

  -- 3. Sequência opcional — quando presente, valida cada item.
  IF NEW.image_sequence IS NOT NULL THEN
    IF jsonb_typeof(NEW.image_sequence) <> 'array' THEN
      RAISE EXCEPTION 'render_job_image_sequence_invalid';
    END IF;
    IF jsonb_array_length(NEW.image_sequence) < 1
       OR jsonb_array_length(NEW.image_sequence) > 8 THEN
      RAISE EXCEPTION 'render_job_image_sequence_out_of_range';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.image_sequence) LOOP
      v_item_source := v_item->>'source';
      IF v_item_source = 'marketing_media' THEN
        v_item_image_id := NULLIF(v_item->>'image_id','')::uuid;
        IF v_item_image_id IS NULL THEN
          RAISE EXCEPTION 'render_job_sequence_item_missing_image_id';
        END IF;
        SELECT company_id, active, media_type
          INTO v_c, v_active, v_media_type
          FROM public.marketing_media
         WHERE id = v_item_image_id;
        IF v_c IS NULL THEN RAISE EXCEPTION 'render_job_sequence_image_not_found'; END IF;
        IF v_c <> NEW.company_id THEN RAISE EXCEPTION 'render_job_sequence_image_cross_tenant'; END IF;
        IF v_active IS NOT TRUE THEN RAISE EXCEPTION 'render_job_sequence_image_inactive'; END IF;
        IF v_media_type IS DISTINCT FROM 'image' THEN
          RAISE EXCEPTION 'render_job_sequence_image_wrong_type';
        END IF;
      ELSIF v_item_source = 'product_image' THEN
        v_item_product_id := NULLIF(v_item->>'product_id','')::uuid;
        v_item_product_path := v_item->>'product_image_path';
        IF v_item_product_id IS NULL OR v_item_product_path IS NULL THEN
          RAISE EXCEPTION 'render_job_sequence_item_missing_product_ref';
        END IF;
        SELECT company_id, active, COALESCE(images, '[]'::jsonb)
          INTO v_c, v_active, v_images
          FROM public.products
         WHERE id = v_item_product_id;
        IF v_c IS NULL THEN RAISE EXCEPTION 'render_job_sequence_product_not_found'; END IF;
        IF v_c <> NEW.company_id THEN RAISE EXCEPTION 'render_job_sequence_product_cross_tenant'; END IF;
        IF v_active IS NOT TRUE THEN RAISE EXCEPTION 'render_job_sequence_product_inactive'; END IF;
        IF NOT (v_images ? v_item_product_path) THEN
          RAISE EXCEPTION 'render_job_sequence_product_image_not_owned';
        END IF;
      ELSE
        RAISE EXCEPTION 'render_job_sequence_item_invalid_source';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;
