
-- 1) Permitir feed_4_5 nas tabelas de render/biblioteca
ALTER TABLE public.video_render_jobs
  DROP CONSTRAINT IF EXISTS video_render_jobs_video_format_check;
ALTER TABLE public.video_render_jobs
  ADD CONSTRAINT video_render_jobs_video_format_check
  CHECK (video_format = ANY (ARRAY['story','reels','feed_square','feed_4_5']));

ALTER TABLE public.video_library
  DROP CONSTRAINT IF EXISTS video_library_video_format_check;
ALTER TABLE public.video_library
  ADD CONSTRAINT video_library_video_format_check
  CHECK (video_format = ANY (ARRAY['story','reels','feed_square','feed_4_5']));

-- 2) Extensão de marketing_contents (todas nullable, retrocompatível)
ALTER TABLE public.marketing_contents
  ADD COLUMN IF NOT EXISTS campaign_id UUID,
  ADD COLUMN IF NOT EXISTS campaign_role TEXT,
  ADD COLUMN IF NOT EXISTS primary_image_media_id UUID,
  ADD COLUMN IF NOT EXISTS primary_image_product_ref JSONB,
  ADD COLUMN IF NOT EXISTS primary_audio_id UUID,
  ADD COLUMN IF NOT EXISTS audio_start_second INTEGER,
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS feed_video_id UUID,
  ADD COLUMN IF NOT EXISTS story_video_id UUID,
  ADD COLUMN IF NOT EXISTS feed_render_job_id UUID,
  ADD COLUMN IF NOT EXISTS story_render_job_id UUID;

ALTER TABLE public.marketing_contents
  DROP CONSTRAINT IF EXISTS marketing_contents_campaign_role_check;
ALTER TABLE public.marketing_contents
  ADD CONSTRAINT marketing_contents_campaign_role_check
  CHECK (campaign_role IS NULL OR campaign_role IN ('feed','story','reel','whatsapp'));

-- FKs (opcionais, SET NULL para não quebrar rows antigas se algum destino for removido)
ALTER TABLE public.marketing_contents
  DROP CONSTRAINT IF EXISTS mc_primary_image_media_fkey,
  ADD  CONSTRAINT mc_primary_image_media_fkey
       FOREIGN KEY (primary_image_media_id) REFERENCES public.marketing_media(id) ON DELETE SET NULL;
ALTER TABLE public.marketing_contents
  DROP CONSTRAINT IF EXISTS mc_primary_audio_fkey,
  ADD  CONSTRAINT mc_primary_audio_fkey
       FOREIGN KEY (primary_audio_id) REFERENCES public.audio_library(id) ON DELETE SET NULL;
ALTER TABLE public.marketing_contents
  DROP CONSTRAINT IF EXISTS mc_feed_video_fkey,
  ADD  CONSTRAINT mc_feed_video_fkey
       FOREIGN KEY (feed_video_id) REFERENCES public.video_library(id) ON DELETE SET NULL;
ALTER TABLE public.marketing_contents
  DROP CONSTRAINT IF EXISTS mc_story_video_fkey,
  ADD  CONSTRAINT mc_story_video_fkey
       FOREIGN KEY (story_video_id) REFERENCES public.video_library(id) ON DELETE SET NULL;
ALTER TABLE public.marketing_contents
  DROP CONSTRAINT IF EXISTS mc_feed_render_job_fkey,
  ADD  CONSTRAINT mc_feed_render_job_fkey
       FOREIGN KEY (feed_render_job_id) REFERENCES public.video_render_jobs(id) ON DELETE SET NULL;
ALTER TABLE public.marketing_contents
  DROP CONSTRAINT IF EXISTS mc_story_render_job_fkey,
  ADD  CONSTRAINT mc_story_render_job_fkey
       FOREIGN KEY (story_render_job_id) REFERENCES public.video_render_jobs(id) ON DELETE SET NULL;

-- 3) Índices
CREATE INDEX IF NOT EXISTS idx_mc_company_campaign
  ON public.marketing_contents(company_id, campaign_id)
  WHERE campaign_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mc_campaign_role
  ON public.marketing_contents(campaign_id, campaign_role)
  WHERE campaign_id IS NOT NULL AND campaign_role IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mc_feed_render_job
  ON public.marketing_contents(feed_render_job_id)
  WHERE feed_render_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mc_story_render_job
  ON public.marketing_contents(story_render_job_id)
  WHERE story_render_job_id IS NOT NULL;
