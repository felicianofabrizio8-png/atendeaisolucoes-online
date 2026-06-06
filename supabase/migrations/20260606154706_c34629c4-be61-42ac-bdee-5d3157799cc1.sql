CREATE TABLE public.campaign_ai_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  summary text,
  diagnosis jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  creative_ideas jsonb NOT NULL DEFAULT '[]'::jsonb,
  copy_ideas jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_ai_analyses_campaign ON public.campaign_ai_analyses(campaign_id, created_at DESC);
CREATE INDEX idx_campaign_ai_analyses_company ON public.campaign_ai_analyses(company_id, created_at DESC);

GRANT SELECT, INSERT ON public.campaign_ai_analyses TO authenticated;
GRANT ALL ON public.campaign_ai_analyses TO service_role;

ALTER TABLE public.campaign_ai_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members can read ai analyses"
ON public.campaign_ai_analyses FOR SELECT
TO authenticated
USING (
  company_id IN (
    SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()
  )
);

CREATE POLICY "company members can insert ai analyses"
ON public.campaign_ai_analyses FOR INSERT
TO authenticated
WITH CHECK (
  company_id IN (
    SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()
  )
);