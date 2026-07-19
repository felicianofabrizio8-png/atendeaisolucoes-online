-- Fase 5.A — Brand Center → Render Engine
-- Adiciona snapshot imutável da identidade visual ao job de renderização.
-- Idempotência: retry usa o mesmo snapshot; publicar nova marca não altera jobs antigos.

ALTER TABLE public.video_render_jobs
  ADD COLUMN IF NOT EXISTS brand_version_id uuid NULL
    REFERENCES public.brand_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS video_brand jsonb NULL;

-- Índice leve para diagnóstico ("quantos jobs usam a versão X da marca")
CREATE INDEX IF NOT EXISTS idx_video_render_jobs_brand_version
  ON public.video_render_jobs(brand_version_id)
  WHERE brand_version_id IS NOT NULL;

-- Guard: brand_version_id deve pertencer à mesma company
CREATE OR REPLACE FUNCTION public.enforce_render_job_brand_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_c uuid;
BEGIN
  IF NEW.brand_version_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT company_id INTO v_c
    FROM public.brand_versions
   WHERE id = NEW.brand_version_id;
  IF v_c IS NULL THEN
    RAISE EXCEPTION 'render_job_brand_version_not_found';
  END IF;
  IF v_c <> NEW.company_id THEN
    RAISE EXCEPTION 'render_job_brand_cross_tenant';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_render_job_brand_ownership ON public.video_render_jobs;
CREATE TRIGGER trg_render_job_brand_ownership
  BEFORE INSERT OR UPDATE OF brand_version_id ON public.video_render_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_render_job_brand_ownership();

COMMENT ON COLUMN public.video_render_jobs.video_brand IS
  'Snapshot imutável (schemaVersion:1) da identidade visual usada por este job. NULL = empresa sem marca publicada no momento da criação (fallback: renderiza sem marca). Retry re-usa este snapshot; publicar nova versão de marca não afeta jobs já criados.';

COMMENT ON COLUMN public.video_render_jobs.brand_version_id IS
  'FK para brand_versions.id da versão publicada ativa no momento da criação. Usado para reassinar a logo em cada claim/retry sem persistir signed URL.';