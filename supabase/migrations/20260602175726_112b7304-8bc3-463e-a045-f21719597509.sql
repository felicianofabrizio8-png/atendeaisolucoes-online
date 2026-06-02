CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  objective text NOT NULL DEFAULT 'whatsapp',
  product text,
  city text,
  radius_km integer,
  daily_budget numeric,
  start_date date,
  media_url text,
  media_type text,
  primary_text text,
  headline text,
  cta text,
  status text NOT NULL DEFAULT 'draft',
  meta_campaign_id text,
  leads_count integer NOT NULL DEFAULT 0,
  messages_count integer NOT NULL DEFAULT 0,
  spent numeric NOT NULL DEFAULT 0,
  ai_diagnosis text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT ALL ON public.campaigns TO service_role;

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select campaigns" ON public.campaigns
  FOR SELECT TO authenticated USING (company_id = private.current_company_id());
CREATE POLICY "company insert campaigns" ON public.campaigns
  FOR INSERT TO authenticated WITH CHECK (company_id = private.current_company_id());
CREATE POLICY "company update campaigns" ON public.campaigns
  FOR UPDATE TO authenticated USING (company_id = private.current_company_id());
CREATE POLICY "company delete campaigns" ON public.campaigns
  FOR DELETE TO authenticated USING (company_id = private.current_company_id());

CREATE TRIGGER set_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_campaigns_company ON public.campaigns(company_id, created_at DESC);