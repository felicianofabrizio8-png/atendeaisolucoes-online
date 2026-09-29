ALTER TABLE public.relationship_campaigns
  ADD COLUMN IF NOT EXISTS template_purpose text NOT NULL DEFAULT 'reactivation';

CREATE INDEX IF NOT EXISTS relationship_campaigns_template_idx
  ON public.relationship_campaigns(company_id, template_purpose);
