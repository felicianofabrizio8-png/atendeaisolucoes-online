-- Fatia 1.1: video_render_jobs aceita imagens de marketing_media OU products.images.

ALTER TABLE public.video_render_jobs
  ADD COLUMN IF NOT EXISTS image_source text NOT NULL DEFAULT 'marketing_media',
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_image_path text;

-- Backfill defensivo (linhas pré-existentes ficam como marketing_media).
UPDATE public.video_render_jobs SET image_source = 'marketing_media' WHERE image_source IS NULL;

-- Torna image_id opcional (product_image jobs não possuem marketing_media).
ALTER TABLE public.video_render_jobs ALTER COLUMN image_id DROP NOT NULL;

-- Enum-like check + shape check (exatamente 1 origem preenchida).
ALTER TABLE public.video_render_jobs
  DROP CONSTRAINT IF EXISTS video_render_jobs_image_source_chk,
  ADD CONSTRAINT video_render_jobs_image_source_chk
    CHECK (image_source IN ('marketing_media', 'product_image'));

ALTER TABLE public.video_render_jobs
  DROP CONSTRAINT IF EXISTS video_render_jobs_image_origin_shape,
  ADD CONSTRAINT video_render_jobs_image_origin_shape CHECK (
    (image_source = 'marketing_media'
      AND image_id IS NOT NULL
      AND product_id IS NULL
      AND product_image_path IS NULL)
    OR
    (image_source = 'product_image'
      AND image_id IS NULL
      AND product_id IS NOT NULL
      AND product_image_path IS NOT NULL
      AND length(product_image_path) > 0)
  );

CREATE INDEX IF NOT EXISTS idx_video_render_jobs_product
  ON public.video_render_jobs (product_id)
  WHERE product_id IS NOT NULL;

-- Trigger de ownership: substitui a versão anterior (que só aceitava marketing_media).
CREATE OR REPLACE FUNCTION public.enforce_render_job_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_c uuid;
  v_active boolean;
  v_media_type text;
  v_images jsonb;
BEGIN
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
    -- jsonb `?` matches string elements inside jsonb arrays.
    IF NOT (v_images ? NEW.product_image_path) THEN
      RAISE EXCEPTION 'render_job_product_image_not_owned';
    END IF;
  ELSE
    RAISE EXCEPTION 'render_job_invalid_image_source';
  END IF;

  -- Áudio (comum às duas origens).
  SELECT company_id, is_active INTO v_c, v_active
    FROM public.audio_library WHERE id = NEW.audio_id;
  IF v_c IS NULL THEN RAISE EXCEPTION 'render_job_audio_not_found'; END IF;
  IF v_c <> NEW.company_id THEN RAISE EXCEPTION 'render_job_audio_cross_tenant'; END IF;
  IF v_active IS NOT TRUE THEN RAISE EXCEPTION 'render_job_audio_inactive'; END IF;

  RETURN NEW;
END;
$function$;