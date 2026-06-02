CREATE TABLE public.campaign_creatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  campaign_id uuid,
  product_id uuid,
  title text NOT NULL,
  primary_text text,
  cta text,
  social_caption text,
  audience_suggestion text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_creatives TO authenticated;
GRANT ALL ON public.campaign_creatives TO service_role;

ALTER TABLE public.campaign_creatives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select campaign_creatives"
ON public.campaign_creatives FOR SELECT TO authenticated
USING (company_id = private.current_company_id());

CREATE POLICY "company insert campaign_creatives"
ON public.campaign_creatives FOR INSERT TO authenticated
WITH CHECK (company_id = private.current_company_id());

CREATE POLICY "company update campaign_creatives"
ON public.campaign_creatives FOR UPDATE TO authenticated
USING (company_id = private.current_company_id());

CREATE POLICY "company delete campaign_creatives"
ON public.campaign_creatives FOR DELETE TO authenticated
USING (company_id = private.current_company_id());

CREATE TRIGGER set_campaign_creatives_updated_at
BEFORE UPDATE ON public.campaign_creatives
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_campaign_creatives_company ON public.campaign_creatives(company_id, created_at DESC);