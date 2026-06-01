
-- ============ Fase 1: Agente automático ============

-- 1.1 conversations: estado da automação por conversa
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_handling boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_status text,
  ADD COLUMN IF NOT EXISTS human_takeover_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_auto_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_reply_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS detected_city text,
  ADD COLUMN IF NOT EXISTS detected_pool_size text,
  ADD COLUMN IF NOT EXISTS detected_intent text;

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_ai_status_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_ai_status_check
  CHECK (ai_status IS NULL OR ai_status IN ('pre_atendido_ia','aguardando_humano','assumido_humano'));

CREATE INDEX IF NOT EXISTS idx_conversations_ai_status
  ON public.conversations(company_id, ai_status) WHERE ai_status IS NOT NULL;

-- 1.2 company_settings: configuração do painel de automação
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS ai_auto_reply_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_after_hours_only boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_initial_message text,
  ADD COLUMN IF NOT EXISTS ai_max_auto_replies integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS ai_handoff_timeout_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS ai_agent_name text NOT NULL DEFAULT 'Fabrizio';

-- 1.3 ai_flow_events: log estruturado por turno do agente
CREATE TABLE IF NOT EXISTS public.ai_flow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  conversation_id uuid,
  lead_id uuid,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_flow_events_event_type_check CHECK (event_type IN (
    'auto_reply_sent','handoff_human','detected_city','detected_pool_size',
    'detected_intent','ai_flow_step','safety_block','skipped_business_hours',
    'skipped_human_active','skipped_disabled','skipped_rate_limit','agent_error'
  ))
);

CREATE INDEX IF NOT EXISTS idx_ai_flow_events_company_created
  ON public.ai_flow_events(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_flow_events_conversation
  ON public.ai_flow_events(conversation_id, created_at DESC);

GRANT SELECT, INSERT ON public.ai_flow_events TO authenticated;
GRANT ALL ON public.ai_flow_events TO service_role;

ALTER TABLE public.ai_flow_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select ai_flow_events"
  ON public.ai_flow_events FOR SELECT TO authenticated
  USING (company_id = private.current_company_id());

CREATE POLICY "company insert ai_flow_events"
  ON public.ai_flow_events FOR INSERT TO authenticated
  WITH CHECK (company_id = private.current_company_id());

-- 1.4 Realtime para conversations (badge ao vivo no inbox)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
END $$;

ALTER TABLE public.conversations REPLICA IDENTITY FULL;
