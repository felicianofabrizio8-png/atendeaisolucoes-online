-- 1) Configurações de follow-up por empresa
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS ai_followup_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_followup_max_per_lead int NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS ai_followup_min_hours_between int NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS ai_followup_quote_delay_hours int NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS ai_followup_silence_delay_hours int NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS ai_followup_visit_delay_hours int NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS ai_followup_hot_delay_hours int NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS ai_followup_business_hours_only boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_followup_tone text NOT NULL DEFAULT 'amigavel',
  ADD COLUMN IF NOT EXISTS ai_followup_templates jsonb NOT NULL DEFAULT jsonb_build_object(
    'quote_no_reply', 'Oi {{nome}} 😊 Passando para saber se conseguiu analisar o orçamento. Qualquer dúvida posso te ajudar.',
    'lead_silent', 'Oi {{nome}}! Tudo bem? Continuo à disposição se quiser retomar a conversa.',
    'visit_no_return', 'Oi {{nome}}, espero que a visita tenha sido boa. Quer que eu te passe os próximos passos?',
    'hot_lead_idle', 'Oi {{nome}}, separei tudo aqui para você. Posso te enviar a proposta agora?',
    'returning_customer', 'Que bom te ver por aqui de novo, {{nome}}! Como posso ajudar?'
  );

-- 2) Tabela de follow-ups enviados
CREATE TABLE IF NOT EXISTS public.follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  lead_id uuid,
  rule_type text NOT NULL CHECK (rule_type IN (
    'quote_no_reply','lead_silent','visit_no_return','hot_lead_idle','returning_customer'
  )),
  attempt_number int NOT NULL DEFAULT 1,
  message_text text NOT NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','responded','recovered','ignored','failed')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  response_outcome text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.follow_ups TO authenticated;
GRANT ALL ON public.follow_ups TO service_role;

ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select follow_ups"
  ON public.follow_ups FOR SELECT TO authenticated
  USING (company_id = private.current_company_id());

CREATE POLICY "company insert follow_ups"
  ON public.follow_ups FOR INSERT TO authenticated
  WITH CHECK (company_id = private.current_company_id());

CREATE POLICY "company update follow_ups"
  ON public.follow_ups FOR UPDATE TO authenticated
  USING (company_id = private.current_company_id());

CREATE POLICY "company delete follow_ups"
  ON public.follow_ups FOR DELETE TO authenticated
  USING (company_id = private.current_company_id());

CREATE INDEX IF NOT EXISTS idx_follow_ups_company_sent_at
  ON public.follow_ups (company_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_ups_conversation
  ON public.follow_ups (conversation_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_ups_lead
  ON public.follow_ups (lead_id, sent_at DESC);

CREATE TRIGGER follow_ups_set_updated_at
  BEFORE UPDATE ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
