
-- Runtime Learning Loop persistence
CREATE TABLE public.runtime_learning_cycles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  agent_id text NOT NULL,
  execution_id text NOT NULL,
  job_id uuid,
  hypothesis_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('accepted','rejected','consolidated')),
  reason text,
  confidence numeric(4,3) NOT NULL DEFAULT 0,
  signature text NOT NULL,
  duration_ms integer,
  topics_used text[] NOT NULL DEFAULT '{}',
  published_topics text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_runtime_learning_cycles_company_created
  ON public.runtime_learning_cycles (company_id, created_at DESC);
CREATE INDEX idx_runtime_learning_cycles_company_agent
  ON public.runtime_learning_cycles (company_id, agent_id, created_at DESC);

GRANT SELECT ON public.runtime_learning_cycles TO authenticated;
GRANT ALL ON public.runtime_learning_cycles TO service_role;

ALTER TABLE public.runtime_learning_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select runtime_learning_cycles"
  ON public.runtime_learning_cycles FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

-- Runtime Knowledge Bus envelope metadata (no payload / no PII)
CREATE TABLE public.runtime_knowledge_envelopes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  envelope_id text NOT NULL,
  company_id uuid NOT NULL,
  topic text NOT NULL,
  agent_id text NOT NULL,
  priority text,
  confidence numeric(4,3),
  version integer,
  ttl_ms integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX idx_runtime_knowledge_envelopes_company_created
  ON public.runtime_knowledge_envelopes (company_id, created_at DESC);
CREATE INDEX idx_runtime_knowledge_envelopes_company_topic
  ON public.runtime_knowledge_envelopes (company_id, topic, created_at DESC);
CREATE UNIQUE INDEX uq_runtime_knowledge_envelopes_envelope
  ON public.runtime_knowledge_envelopes (company_id, envelope_id);

GRANT SELECT ON public.runtime_knowledge_envelopes TO authenticated;
GRANT ALL ON public.runtime_knowledge_envelopes TO service_role;

ALTER TABLE public.runtime_knowledge_envelopes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select runtime_knowledge_envelopes"
  ON public.runtime_knowledge_envelopes FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());
