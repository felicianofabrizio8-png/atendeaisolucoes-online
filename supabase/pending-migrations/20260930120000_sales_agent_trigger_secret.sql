-- =============================================================================
-- PENDENTE (não aplicada automaticamente) — Vendedora IA · Fase 0
--
-- Disparo do agente a partir de mensagens recebidas:
--   1. `get_hook_secret(_name)` — as rotas agent-trigger, followup-tick e
--      runtime-tick já chamam esta RPC (src/lib/runtime/HookSecretVault.server.ts),
--      mas ela não estava versionada em nenhuma migration. A allowlist cobre
--      os quatro nomes usados pelo código; se a versão viva aceitar outros,
--      incluí-los antes de aplicar.
--   2. `notify_agent_on_lead_message()` passa a enviar o header
--      `x-agent-trigger-secret` exigido pela rota (a versão anterior mandava só
--      a anon key e recebia 401), com URL e segredo lidos do Vault — sem URL de
--      preview nem JWT embutidos no SQL.
--   3. Remove o debounce de 30s: ele descartava a resposta rápida do cliente
--      ("sim" logo após a resposta da IA). A idempotência agora está no tick
--      (lock + "última mensagem do cliente já respondida" + recuperação de
--      mensagens que chegam durante o turno).
--   4. Não dispara quando a conversa está `aguardando_humano` (a IA já
--      encaminhou para humano e não deve voltar a responder sozinha).
--
-- Pré-requisitos no Vault (por ambiente; nunca commitar valores):
--   select vault.create_secret('<https://host>/api/public/hooks/agent-trigger', 'agent_trigger_url');
--   select vault.create_secret('<segredo forte>', 'agent_trigger_secret');
-- O mesmo segredo deve estar acessível à rota (Vault via get_hook_secret ou
-- env AGENT_TRIGGER_SECRET no Worker).
--
-- Antes de aplicar em produção: comparar com a definição viva
-- (`select pg_get_functiondef('public.notify_agent_on_lead_message'::regproc)`),
-- porque o banco pode ter sido ajustado fora das migrations.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_hook_secret(_name text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret
    FROM vault.decrypted_secrets
   WHERE name = _name
     AND _name IN (
       'agent_trigger_secret',
       'agent_trigger_url',
       'followup_tick_secret',
       'runtime_tick_secret'
     )
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_hook_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hook_secret(text) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_agent_on_lead_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ai_status text;
  v_ai_handling boolean;
  v_url text;
  v_secret text;
BEGIN
  IF NEW.role <> 'lead' THEN
    RETURN NEW;
  END IF;

  SELECT ai_status, ai_handling
    INTO v_ai_status, v_ai_handling
    FROM public.conversations
   WHERE id = NEW.conversation_id
     AND company_id = NEW.company_id;

  -- Humano assumiu/foi acionado, ou há turno em andamento (o próprio turno
  -- reprocessa mensagens que chegarem enquanto roda).
  IF v_ai_status IN ('assumido_humano', 'aguardando_humano') OR v_ai_handling = true THEN
    RETURN NEW;
  END IF;

  v_url := public.get_hook_secret('agent_trigger_url');
  v_secret := public.get_hook_secret('agent_trigger_secret');
  IF v_url IS NULL OR v_secret IS NULL THEN
    INSERT INTO public.ai_flow_events (company_id, conversation_id, lead_id, event_type, payload)
    VALUES (NEW.company_id, NEW.conversation_id, NULL, 'trigger_not_configured',
            jsonb_build_object('message_id', NEW.id));
    RETURN NEW;
  END IF;

  INSERT INTO public.ai_flow_events (company_id, conversation_id, lead_id, event_type, payload)
  VALUES (NEW.company_id, NEW.conversation_id, NULL, 'trigger_enqueued',
          jsonb_build_object('message_id', NEW.id));

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-trigger-secret', v_secret
    ),
    body := jsonb_build_object('conversation_id', NEW.conversation_id::text),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca quebra o insert da mensagem (inbox/WhatsApp continuam intactos).
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_agent_on_lead_message() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_agent_on_lead_message() TO service_role;
