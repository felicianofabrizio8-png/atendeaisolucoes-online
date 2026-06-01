-- =============================================================================
-- Fase 1: triggers + cron para o agente automático
-- =============================================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- Trigger: dispara agent-trigger quando chega mensagem do cliente
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_agent_on_lead_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ai_status text;
  v_ai_handling boolean;
  v_recent_trigger int;
  v_url text := 'https://project--23e14a46-10ac-4695-adc6-36e0ab29fd20.lovable.app/api/public/hooks/agent-trigger';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVibmx2eGtqZW16aHZtdWxvd2hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNTQ4OTIsImV4cCI6MjA5MjczMDg5Mn0.zU61FazwRdONAh0Y3IPF8Rp66e-MlTRqMOFzIjfMS3o';
BEGIN
  -- Apenas mensagens recebidas do cliente
  IF NEW.role <> 'lead' THEN
    RETURN NEW;
  END IF;

  -- Carrega estado atual da conversa
  SELECT ai_status, ai_handling
    INTO v_ai_status, v_ai_handling
    FROM public.conversations
   WHERE id = NEW.conversation_id;

  -- Não dispara se humano já assumiu ou se há tick em andamento (lock)
  IF v_ai_status = 'assumido_humano' OR v_ai_handling = true THEN
    RETURN NEW;
  END IF;

  -- Debounce: evita duplicar disparos em < 30s para a mesma conversa
  SELECT COUNT(*) INTO v_recent_trigger
    FROM public.ai_flow_events
   WHERE conversation_id = NEW.conversation_id
     AND event_type = 'trigger_enqueued'
     AND created_at > now() - interval '30 seconds';
  IF v_recent_trigger > 0 THEN
    RETURN NEW;
  END IF;

  -- Log estruturado
  INSERT INTO public.ai_flow_events (company_id, conversation_id, lead_id, event_type, payload)
  VALUES (
    NEW.company_id,
    NEW.conversation_id,
    NULL,
    'trigger_enqueued',
    jsonb_build_object('message_id', NEW.id)
  );

  -- Chama o webhook do agente (fire-and-forget)
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon
    ),
    body := jsonb_build_object('conversation_id', NEW.conversation_id::text),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca quebra o insert da mensagem (inbox/WhatsApp continuam intactos)
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_agent_on_lead_message ON public.messages;
CREATE TRIGGER trg_notify_agent_on_lead_message
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_agent_on_lead_message();

-- -----------------------------------------------------------------------------
-- Manutenção: destrava locks órfãos e alerta timeouts de handoff
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_agent_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unlocked int;
  v_timeouts int;
BEGIN
  -- Destrava conversas que ficaram com ai_handling=true há mais de 5 minutos
  WITH unlocked AS (
    UPDATE public.conversations
       SET ai_handling = false
     WHERE ai_handling = true
       AND last_auto_reply_at IS NOT NULL
       AND last_auto_reply_at < now() - interval '5 minutes'
    RETURNING id, company_id
  )
  INSERT INTO public.ai_flow_events (company_id, conversation_id, event_type, payload)
  SELECT company_id, id, 'lock_released_stale', '{}'::jsonb FROM unlocked;
  GET DIAGNOSTICS v_unlocked = ROW_COUNT;

  -- Também destrava locks que nunca tiveram resposta enviada mas estão presos
  UPDATE public.conversations c
     SET ai_handling = false
   WHERE ai_handling = true
     AND last_auto_reply_at IS NULL
     AND updated_at < now() - interval '5 minutes';

  -- Loga conversas em "aguardando_humano" há mais que o timeout configurado
  WITH timeouts AS (
    SELECT c.id, c.company_id, c.human_takeover_at, cs.ai_handoff_timeout_minutes
      FROM public.conversations c
      JOIN public.company_settings cs ON cs.company_id = c.company_id
     WHERE c.ai_status = 'aguardando_humano'
       AND c.human_takeover_at IS NULL
       AND c.updated_at < now() - make_interval(mins => COALESCE(cs.ai_handoff_timeout_minutes, 30))
       AND NOT EXISTS (
         SELECT 1 FROM public.ai_flow_events e
          WHERE e.conversation_id = c.id
            AND e.event_type = 'handoff_timeout_alert'
            AND e.created_at > now() - interval '1 hour'
       )
  )
  INSERT INTO public.ai_flow_events (company_id, conversation_id, event_type, payload)
  SELECT company_id, id, 'handoff_timeout_alert',
         jsonb_build_object('timeout_minutes', ai_handoff_timeout_minutes)
    FROM timeouts;
END;
$$;

-- Agenda o cron a cada 5 minutos
DO $$
BEGIN
  PERFORM cron.unschedule('ai-agent-maintenance');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'ai-agent-maintenance',
  '*/5 * * * *',
  $$ SELECT public.ai_agent_maintenance(); $$
);