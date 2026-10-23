-- Corrige a autenticação do dispatcher PostgreSQL -> agent-trigger.
-- O segredo nunca fica no código: é lido do Supabase Vault em runtime.

CREATE OR REPLACE FUNCTION public.get_hook_secret(_name text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret
    FROM vault.decrypted_secrets
   WHERE name = _name
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_hook_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hook_secret(text) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_agent_on_lead_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_ai_status text;
  v_ai_handling boolean;
  v_recent_trigger integer;
  v_url text;
  v_trigger_secret text;
  v_request_id bigint;
BEGIN
  -- Apenas mensagens recebidas do cliente.
  IF NEW.role <> 'lead' THEN
    RETURN NEW;
  END IF;

  -- Serializa callbacks da mesma conversa para que o debounce seja atômico
  -- entre INSERTs concorrentes.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.conversation_id::text, 0));

  SELECT ai_status, ai_handling
    INTO v_ai_status, v_ai_handling
    FROM public.conversations
   WHERE id = NEW.conversation_id;

  -- Preserva handoff humano e lock operacional existentes.
  IF v_ai_status IN ('assumido_humano', 'aguardando_humano') OR v_ai_handling = true THEN
    RETURN NEW;
  END IF;

  -- Preserva debounce por conversa antes de enfileirar novo callback.
  SELECT COUNT(*)
    INTO v_recent_trigger
    FROM public.ai_flow_events
   WHERE conversation_id = NEW.conversation_id
     AND event_type = 'trigger_enqueued'
     AND created_at > now() - interval '30 seconds';
  IF v_recent_trigger > 0 THEN
    RETURN NEW;
  END IF;

  -- URL e segredo são lidos do Vault em runtime. Ausência de configuração não
  -- cria evento de debounce, portanto o próximo INSERT poderá tentar de novo.
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
   WHERE name = 'agent_trigger_url' LIMIT 1;
  SELECT decrypted_secret INTO v_trigger_secret
    FROM vault.decrypted_secrets
   WHERE name = 'agent_trigger_secret' LIMIT 1;
  IF v_url IS NULL OR length(v_url) = 0
     OR v_trigger_secret IS NULL OR length(v_trigger_secret) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-trigger-secret', v_trigger_secret
    ),
    body := jsonb_build_object(
      'conversation_id', NEW.conversation_id::text,
      'message_id', NEW.id::text
    ),
    timeout_milliseconds := 5000
  ) INTO v_request_id;

  -- O evento só é criado depois que pg_net confirma a aceitação na fila.
  IF v_request_id IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.ai_flow_events (company_id, conversation_id, lead_id, event_type, payload)
  VALUES (
    NEW.company_id,
    NEW.conversation_id,
    NULL,
    'trigger_enqueued',
    jsonb_build_object('message_id', NEW.id, 'request_id', v_request_id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca quebra o insert da mensagem (inbox/WhatsApp continuam intactos).
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_agent_on_lead_message() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_agent_on_lead_message() TO service_role;

