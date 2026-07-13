
-- =============================================================================
-- conversation_facts — fatos estruturados anônimos extraídos das conversas
-- =============================================================================
CREATE TABLE public.conversation_facts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  analyzer_version text NOT NULL,
  content_hash text NOT NULL,

  -- Ciclo de vida
  lifecycle_status text,
  primary_intent text,

  -- Sinais estruturados (JSON — nunca contém PII)
  intents_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  objections_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  buying_signals_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  negative_signals_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  products_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  topics_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  quality_warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Sentimento (determinístico)
  sentiment_label text,
  sentiment_score numeric,

  -- Metadados
  lead_source text,
  channel text,
  message_count integer NOT NULL DEFAULT 0,
  lead_message_count integer NOT NULL DEFAULT 0,
  agent_message_count integer NOT NULL DEFAULT 0,

  -- Temporais
  first_message_at timestamptz,
  last_message_at timestamptz,
  first_response_minutes numeric,
  negotiation_duration_minutes numeric,

  -- Resultado comercial
  quote_detected boolean NOT NULL DEFAULT false,
  sale_detected boolean NOT NULL DEFAULT false,
  loss_detected boolean NOT NULL DEFAULT false,

  -- Qualidade / auditoria
  confidence numeric NOT NULL DEFAULT 0,
  extraction_method text NOT NULL DEFAULT 'deterministic',

  analyzed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT conversation_facts_unique_version
    UNIQUE (company_id, conversation_id, analyzer_version, content_hash)
);

CREATE INDEX idx_conv_facts_company ON public.conversation_facts (company_id);
CREATE INDEX idx_conv_facts_company_conv ON public.conversation_facts (company_id, conversation_id);
CREATE INDEX idx_conv_facts_lifecycle ON public.conversation_facts (company_id, lifecycle_status);
CREATE INDEX idx_conv_facts_analyzed_at ON public.conversation_facts (company_id, analyzed_at DESC);
CREATE INDEX idx_conv_facts_channel ON public.conversation_facts (company_id, channel);

GRANT SELECT ON public.conversation_facts TO authenticated;
GRANT ALL ON public.conversation_facts TO service_role;

ALTER TABLE public.conversation_facts ENABLE ROW LEVEL SECURITY;

-- Somente admin da própria empresa pode ler
CREATE POLICY "conv_facts_admin_select"
  ON public.conversation_facts FOR SELECT
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), company_id, 'admin'::app_role)
  );

-- Nenhuma política de INSERT/UPDATE/DELETE para authenticated —
-- writes apenas via service_role em jobs server-side controlados.

CREATE TRIGGER trg_conv_facts_updated_at
  BEFORE UPDATE ON public.conversation_facts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- conversation_analyzer_state — watermark de processamento por conversa
-- =============================================================================
CREATE TABLE public.conversation_analyzer_state (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  analyzer_version text NOT NULL,

  last_content_hash text,
  last_message_at timestamptz,
  last_analyzed_at timestamptz,

  processing_status text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending','processing','completed','skipped','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  next_retry_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT conv_analyzer_state_unique
    UNIQUE (company_id, conversation_id, analyzer_version)
);

CREATE INDEX idx_conv_state_company ON public.conversation_analyzer_state (company_id);
CREATE INDEX idx_conv_state_status ON public.conversation_analyzer_state (company_id, processing_status);
CREATE INDEX idx_conv_state_retry ON public.conversation_analyzer_state (next_retry_at)
  WHERE processing_status = 'failed';

GRANT SELECT ON public.conversation_analyzer_state TO authenticated;
GRANT ALL ON public.conversation_analyzer_state TO service_role;

ALTER TABLE public.conversation_analyzer_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conv_state_admin_select"
  ON public.conversation_analyzer_state FOR SELECT
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), company_id, 'admin'::app_role)
  );

CREATE TRIGGER trg_conv_state_updated_at
  BEFORE UPDATE ON public.conversation_analyzer_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
