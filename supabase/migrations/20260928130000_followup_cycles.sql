-- Follow-up V2: ciclos de negociação.
--
-- Até aqui o follow-up era decidido a cada tick, com limite VITALÍCIO por
-- lead e sem próxima data registrada. Um ciclo nasce quando uma mensagem
-- nossa (ou orçamento/visita) fica sem resposta e guarda motivo, referência,
-- tentativas, próxima data e estado. Resposta do cliente, venda fechada/
-- perdida ou fim das tentativas encerram o ciclo; uma nova negociação abre
-- outro para o mesmo lead.
--
-- Só acrescenta estrutura e amplia uma restrição — nenhum dado é apagado.
BEGIN;

-- 1) Calendário comercial da empresa. O servidor roda em UTC; sem o fuso o
--    "09:00–18:00" configurado virava 06:00–15:00 em Brasília.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS ai_followup_timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  ADD COLUMN IF NOT EXISTS ai_followup_business_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}';

-- 2) Ciclos.
CREATE TABLE IF NOT EXISTS public.followup_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN (
    'quote_no_reply','visit_no_return','hot_lead_idle','lead_silent'
  )),
  -- quote:<id> | visit:<id> | msg:<id da nossa mensagem sem resposta>
  reference_key text NOT NULL,
  reference_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','closed')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 5),
  next_followup_at timestamptz,
  schedule_source text NOT NULL DEFAULT 'policy' CHECK (schedule_source IN (
    'client_deadline','ai_suggestion','policy','manual'
  )),
  last_contact_at timestamptz,
  failures integer NOT NULL DEFAULT 0,
  close_reason text CHECK (close_reason IS NULL OR close_reason IN (
    'client_replied','sale_closed','sale_lost','max_attempts','human_takeover',
    'disinterest','conversation_missing','send_failed','template_missing','superseded'
  )),
  closed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT followup_cycles_closed_consistency CHECK (
    (state = 'active' AND closed_at IS NULL AND close_reason IS NULL)
    OR (state = 'closed' AND closed_at IS NOT NULL AND close_reason IS NOT NULL)
  )
);

-- Uma referência nunca reabre; no máximo um ciclo ativo por conversa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_followup_cycles_reference
  ON public.followup_cycles (company_id, conversation_id, reference_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_followup_cycles_active_conversation
  ON public.followup_cycles (conversation_id) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS idx_followup_cycles_due
  ON public.followup_cycles (company_id, next_followup_at) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS idx_followup_cycles_conversation_recent
  ON public.followup_cycles (conversation_id, created_at DESC);

GRANT SELECT ON public.followup_cycles TO authenticated;
GRANT ALL ON public.followup_cycles TO service_role;
ALTER TABLE public.followup_cycles ENABLE ROW LEVEL SECURITY;
-- Leitura pela empresa; escrita só pelo servidor (service_role).
CREATE POLICY "company select followup_cycles"
  ON public.followup_cycles FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

-- 3) follow_ups: vínculo com o ciclo e status que o código já gravava.
--    'blocked' e 'simulated' eram rejeitados pelo CHECK original e os
--    inserts falhavam em silêncio; 'cancelled' é lido pelo painel.
ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.followup_cycles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_follow_ups_cycle ON public.follow_ups (cycle_id);

ALTER TABLE public.follow_ups DROP CONSTRAINT IF EXISTS follow_ups_status_check;
ALTER TABLE public.follow_ups
  ADD CONSTRAINT follow_ups_status_check CHECK (status IN (
    'sent','responded','recovered','ignored','failed','blocked','simulated','cancelled'
  ));

-- 4) Resposta do cliente encerra o ciclo ativo (além de marcar os envios).
CREATE OR REPLACE FUNCTION public.cancel_pending_followups_on_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role <> 'lead' THEN
    RETURN NEW;
  END IF;

  UPDATE public.follow_ups
     SET status = 'responded',
         responded_at = NEW.at,
         response_outcome = 'auto_cancelled',
         cancel_reason = 'client_replied',
         cancelled_at = now()
   WHERE conversation_id = NEW.conversation_id
     AND status = 'sent'
     AND responded_at IS NULL
     AND sent_at < NEW.at;

  UPDATE public.followup_cycles
     SET state = 'closed',
         close_reason = 'client_replied',
         closed_at = now(),
         next_followup_at = NULL,
         updated_at = now()
   WHERE conversation_id = NEW.conversation_id
     AND state = 'active'
     AND reference_at < NEW.at;

  INSERT INTO public.ai_flow_events (company_id, conversation_id, event_type, payload)
  SELECT NEW.company_id, NEW.conversation_id, 'followup_auto_cancelled',
         jsonb_build_object('message_id', NEW.id, 'trigger', 'client_replied')
   WHERE EXISTS (
     SELECT 1 FROM public.follow_ups
      WHERE conversation_id = NEW.conversation_id
        AND cancelled_at IS NOT NULL
        AND cancelled_at > now() - interval '5 seconds'
   );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_pending_followups_on_reply() FROM PUBLIC, anon, authenticated;

COMMIT;
