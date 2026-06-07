ALTER TABLE public.campaign_creatives
  ADD COLUMN IF NOT EXISTS source_image_url text,
  ADD COLUMN IF NOT EXISTS format text,
  ADD COLUMN IF NOT EXISTS variant_label text,
  ADD COLUMN IF NOT EXISTS analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS prompt text,
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS preserve_product boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_score integer,
  ADD COLUMN IF NOT EXISTS score_details jsonb,
  ADD COLUMN IF NOT EXISTS parent_creative_id uuid REFERENCES public.campaign_creatives(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS headline text,
  ADD COLUMN IF NOT EXISTS description text;

CREATE INDEX IF NOT EXISTS idx_campaign_creatives_company_created
  ON public.campaign_creatives(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_creatives_parent
  ON public.campaign_creatives(parent_creative_id);
CREATE INDEX IF NOT EXISTS idx_campaign_creatives_campaign
  ON public.campaign_creatives(campaign_id);