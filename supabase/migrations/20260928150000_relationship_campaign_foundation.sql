-- Relationship campaigns are operational outreach, intentionally separate from
-- public.campaigns (Meta/media campaigns).
CREATE TABLE public.relationship_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  definition jsonb NOT NULL DEFAULT '{"all":[]}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);

CREATE TABLE public.relationship_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'paused', 'ended')),
  segment_version integer NOT NULL DEFAULT 1 CHECK (segment_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  CONSTRAINT relationship_campaigns_segment_fk
    FOREIGN KEY (company_id, segment_id)
    REFERENCES public.relationship_segments(company_id, id)
);

CREATE TABLE public.relationship_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  relationship_campaign_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  conversation_id uuid,
  segment_version integer NOT NULL CHECK (segment_version > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ineligible', 'sent', 'delivered', 'failed', 'replied', 'suppressed')),
  phone_snapshot text,
  name_snapshot text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  replied_at timestamptz,
  UNIQUE (company_id, relationship_campaign_id, lead_id),
  CONSTRAINT relationship_recipients_campaign_fk
    FOREIGN KEY (company_id, relationship_campaign_id)
    REFERENCES public.relationship_campaigns(company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT relationship_recipients_lead_fk
    FOREIGN KEY (company_id, lead_id)
    REFERENCES public.leads(company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT relationship_recipients_conversation_fk
    FOREIGN KEY (company_id, conversation_id)
    REFERENCES public.conversations(company_id, id)
    ON DELETE SET NULL
);

-- Existing primary keys are not enough to enforce tenant-consistent composite
-- foreign keys used by the recipient read model.
ALTER TABLE public.leads
  ADD CONSTRAINT leads_company_id_id_key UNIQUE (company_id, id);
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_company_id_id_key UNIQUE (company_id, id);

CREATE INDEX relationship_segments_company_updated_idx
  ON public.relationship_segments(company_id, updated_at DESC);
CREATE INDEX relationship_campaigns_company_status_idx
  ON public.relationship_campaigns(company_id, status, updated_at DESC);
CREATE INDEX relationship_recipients_campaign_status_idx
  ON public.relationship_campaign_recipients(company_id, relationship_campaign_id, status);
CREATE INDEX relationship_recipients_company_lead_idx
  ON public.relationship_campaign_recipients(company_id, lead_id);

ALTER TABLE public.relationship_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_campaign_recipients ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.relationship_segments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relationship_campaigns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relationship_campaign_recipients TO authenticated;
GRANT ALL ON public.relationship_segments TO service_role;
GRANT ALL ON public.relationship_campaigns TO service_role;
GRANT ALL ON public.relationship_campaign_recipients TO service_role;

CREATE POLICY relationship_segments_company_policy ON public.relationship_segments
  FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());
CREATE POLICY relationship_campaigns_company_policy ON public.relationship_campaigns
  FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());
CREATE POLICY relationship_recipients_company_policy ON public.relationship_campaign_recipients
  FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE TRIGGER set_relationship_segments_updated_at
  BEFORE UPDATE ON public.relationship_segments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_relationship_campaigns_updated_at
  BEFORE UPDATE ON public.relationship_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_relationship_recipients_updated_at
  BEFORE UPDATE ON public.relationship_campaign_recipients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
