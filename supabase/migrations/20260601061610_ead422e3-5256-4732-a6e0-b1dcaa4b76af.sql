
-- ============================================================================
-- Follow-up Automático v2: humanização, score, reativação, anti-ban
-- Camada isolada: NÃO altera inbox, meta-send, meta-webhook, integrations.
-- ============================================================================

-- 1. company_settings: novas flags e parâmetros
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS ai_followup_humanize boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_followup_delay_jitter_minutes integer NOT NULL DEFAULT 35,
  ADD COLUMN IF NOT EXISTS ai_followup_daily_limit integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS ai_followup_min_response_rate numeric NOT NULL DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS ai_followup_warmup_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_followup_warmup_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_followup_reactivation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_followup_reactivation_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS ai_followup_reactivation_daily_max integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS ai_followup_reactivation_hours_start time NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS ai_followup_reactivation_hours_end time NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS ai_followup_reactivation_template text NOT NULL DEFAULT 'Oi {{nome}}, faz um tempinho que não nos falamos. Posso te ajudar com algo hoje?';

-- 2. leads: campos de score (não tocam status/value/etc existentes)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lead_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_temperature_cached text,
  ADD COLUMN IF NOT EXISTS last_score_at timestamptz,
  ADD COLUMN IF NOT EXISTS reactivated_at timestamptz;

-- 3. follow_ups: cancelamento e rastreabilidade
ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS trigger_reason text,
  ADD COLUMN IF NOT EXISTS variant_seed integer,
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;

CREATE INDEX IF NOT EXISTS idx_follow_ups_company_sent_at
  ON public.follow_ups (company_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_ups_conv_status
  ON public.follow_ups (conversation_id, status);

-- 4. Trigger: ao receber mensagem do cliente, cancelar follow-ups pendentes
--    SECURITY DEFINER + EXCEPTION WHEN OTHERS → nunca quebra insert.
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

DROP TRIGGER IF EXISTS trg_cancel_followups_on_reply ON public.messages;
CREATE TRIGGER trg_cancel_followups_on_reply
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.cancel_pending_followups_on_reply();
