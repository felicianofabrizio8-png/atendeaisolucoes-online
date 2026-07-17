-- =====================================================================
-- Render Engine — Phase 1 (MVP)
-- =====================================================================

-- ---------------- video_render_jobs ----------------
CREATE TABLE public.video_render_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  image_id UUID NOT NULL REFERENCES public.marketing_media(id) ON DELETE RESTRICT,
  audio_id UUID NOT NULL REFERENCES public.audio_library(id) ON DELETE RESTRICT,
  video_format TEXT NOT NULL CHECK (video_format IN ('story','reels','feed_square')),
  audio_start_second NUMERIC NOT NULL CHECK (audio_start_second >= 0),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds IN (8,10,15,30,60)),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error_code TEXT,
  error_message_sanitized TEXT,
  output_video_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vrj_company_created ON public.video_render_jobs(company_id, created_at DESC);
CREATE INDEX idx_vrj_status_created  ON public.video_render_jobs(status, created_at);
CREATE INDEX idx_vrj_pending         ON public.video_render_jobs(available_at) WHERE status = 'queued';
CREATE INDEX idx_vrj_output          ON public.video_render_jobs(output_video_id) WHERE output_video_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON public.video_render_jobs TO authenticated;
GRANT ALL ON public.video_render_jobs TO service_role;

ALTER TABLE public.video_render_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vrj_select_own" ON public.video_render_jobs
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "vrj_insert_own" ON public.video_render_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND status = 'queued'
    AND progress = 0
    AND attempt_count = 0
    AND locked_at IS NULL
    AND locked_by IS NULL
    AND started_at IS NULL
    AND completed_at IS NULL
    AND failed_at IS NULL
    AND output_video_id IS NULL
  );

-- Só permite cancelar jobs que ainda estão na fila.
CREATE POLICY "vrj_cancel_own_queued" ON public.video_render_jobs
  FOR UPDATE TO authenticated
  USING (company_id = public.current_company_id() AND status = 'queued')
  WITH CHECK (company_id = public.current_company_id() AND status IN ('queued','cancelled'));

CREATE TRIGGER trg_vrj_updated_at
  BEFORE UPDATE ON public.video_render_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Defense-in-depth: valida posse da imagem e áudio pela mesma empresa
CREATE OR REPLACE FUNCTION public.enforce_render_job_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_img_company UUID;
  v_aud_company UUID;
  v_img_active  BOOLEAN;
  v_aud_active  BOOLEAN;
BEGIN
  SELECT company_id, active INTO v_img_company, v_img_active
    FROM public.marketing_media WHERE id = NEW.image_id;
  IF v_img_company IS NULL THEN
    RAISE EXCEPTION 'render_job_image_not_found';
  END IF;
  IF v_img_company <> NEW.company_id THEN
    RAISE EXCEPTION 'render_job_image_cross_tenant';
  END IF;
  IF v_img_active IS NOT TRUE THEN
    RAISE EXCEPTION 'render_job_image_inactive';
  END IF;

  SELECT company_id, is_active INTO v_aud_company, v_aud_active
    FROM public.audio_library WHERE id = NEW.audio_id;
  IF v_aud_company IS NULL THEN
    RAISE EXCEPTION 'render_job_audio_not_found';
  END IF;
  IF v_aud_company <> NEW.company_id THEN
    RAISE EXCEPTION 'render_job_audio_cross_tenant';
  END IF;
  IF v_aud_active IS NOT TRUE THEN
    RAISE EXCEPTION 'render_job_audio_inactive';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vrj_ownership
  BEFORE INSERT ON public.video_render_jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_render_job_ownership();

-- ---------------- video_library ----------------
CREATE TABLE public.video_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  thumbnail_path TEXT,
  source_type TEXT NOT NULL DEFAULT 'render_engine'
    CHECK (source_type IN ('render_engine','upload','external')),
  source_image_id UUID REFERENCES public.marketing_media(id) ON DELETE SET NULL,
  source_audio_id UUID REFERENCES public.audio_library(id) ON DELETE SET NULL,
  render_job_id UUID,
  video_format TEXT NOT NULL CHECK (video_format IN ('story','reels','feed_square')),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  duration_seconds NUMERIC NOT NULL CHECK (duration_seconds > 0),
  file_size_bytes BIGINT,
  video_codec TEXT,
  audio_codec TEXT,
  mime_type TEXT NOT NULL DEFAULT 'video/mp4',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_vl_render_job UNIQUE (render_job_id)
);

CREATE INDEX idx_vl_company_created ON public.video_library(company_id, created_at DESC);
CREATE INDEX idx_vl_active ON public.video_library(company_id) WHERE is_active = true;

GRANT SELECT, UPDATE, DELETE ON public.video_library TO authenticated;
GRANT ALL ON public.video_library TO service_role;

ALTER TABLE public.video_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vl_select_own" ON public.video_library
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "vl_update_own" ON public.video_library
  FOR UPDATE TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "vl_delete_own" ON public.video_library
  FOR DELETE TO authenticated
  USING (company_id = public.current_company_id());

CREATE TRIGGER trg_vl_updated_at
  BEFORE UPDATE ON public.video_library
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- FK opcional: job -> vídeo produzido
ALTER TABLE public.video_render_jobs
  ADD CONSTRAINT fk_vrj_output_video
  FOREIGN KEY (output_video_id)
  REFERENCES public.video_library(id) ON DELETE SET NULL;

-- FK: vídeo -> job de origem
ALTER TABLE public.video_library
  ADD CONSTRAINT fk_vl_render_job
  FOREIGN KEY (render_job_id)
  REFERENCES public.video_render_jobs(id) ON DELETE SET NULL;

-- ---------------- claim_render_job ----------------
-- Atômico: dois workers nunca pegam o mesmo job.
CREATE OR REPLACE FUNCTION public.claim_render_job(_worker_id TEXT, _lock_seconds INTEGER DEFAULT 600)
RETURNS SETOF public.video_render_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id FROM public.video_render_jobs
     WHERE status = 'queued'
       AND available_at <= now()
       AND attempt_count < max_attempts
     ORDER BY created_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.video_render_jobs j
     SET status = 'processing',
         attempt_count = j.attempt_count + 1,
         locked_at = now(),
         locked_by = _worker_id,
         started_at = COALESCE(j.started_at, now()),
         available_at = now() + make_interval(secs => GREATEST(1, _lock_seconds)),
         progress = 5
    FROM picked
   WHERE j.id = picked.id
   RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_render_job(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_render_job(TEXT, INTEGER) TO service_role;

-- ---------------- Storage policies: video-library bucket ----------------
-- (Bucket é criado via tool storage_create_bucket; políticas ficam aqui.)
CREATE POLICY "video_library_select_own_company"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'video-library'
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );

-- Uploads e deletes só via service_role (worker). Não criamos policy para authenticated.
