-- Atendimento 2.0: claims recuperáveis por mensagem, cutoff do GERAL e
-- bloqueio de webhook quando a conversa já aguarda atendimento humano.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS ai_general_activated_at timestamptz;

-- Empresas legadas que já estavam habilitadas entram em GERAL a partir da
-- aplicação desta migration; mensagens anteriores não podem ser reprocessadas.
UPDATE public.company_settings
SET ai_general_activated_at = COALESCE(ai_general_activated_at, now())
WHERE ai_auto_reply_scope = 'geral';

CREATE OR REPLACE FUNCTION public.set_ai_general_activation_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ai_auto_reply_scope = 'geral'
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.ai_auto_reply_scope, '') <> 'geral') THEN
    NEW.ai_general_activated_at := now();
  ELSIF NEW.ai_auto_reply_scope <> 'geral' THEN
    NEW.ai_general_activated_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_settings_general_activation
  ON public.company_settings;
CREATE TRIGGER trg_company_settings_general_activation
BEFORE INSERT OR UPDATE OF ai_auto_reply_scope ON public.company_settings
FOR EACH ROW
EXECUTE FUNCTION public.set_ai_general_activation_timestamp();

CREATE TABLE IF NOT EXISTS public.runtime_message_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  message_id text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  claim_token uuid NOT NULL DEFAULT gen_random_uuid(),
  attempt_count integer NOT NULL DEFAULT 1,
  lease_expires_at timestamptz NOT NULL,
  outbound_started_at timestamptz,
  next_retry_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT runtime_message_claims_status_check
    CHECK (status IN ('processing', 'sent', 'failed_retryable', 'uncertain')),
  CONSTRAINT runtime_message_claims_attempt_check
    CHECK (attempt_count > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS runtime_message_claims_message_uidx
  ON public.runtime_message_claims (company_id, message_id);
CREATE INDEX IF NOT EXISTS runtime_message_claims_retry_idx
  ON public.runtime_message_claims (status, next_retry_at, lease_expires_at);

ALTER TABLE public.runtime_message_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.runtime_message_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.runtime_message_claims TO service_role;

CREATE OR REPLACE FUNCTION public.runtime_claim_message(
  _company_id uuid,
  _message_id text,
  _lease_seconds integer DEFAULT 600
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.runtime_message_claims;
  v_inserted boolean;
  v_now timestamptz := now();
  v_lease timestamptz := v_now + make_interval(secs => GREATEST(30, _lease_seconds));
BEGIN
  INSERT INTO public.runtime_message_claims (
    company_id, message_id, status, lease_expires_at
  ) VALUES (_company_id, _message_id, 'processing', v_lease)
  ON CONFLICT (company_id, message_id) DO NOTHING;
  v_inserted := FOUND;

  IF v_inserted THEN
    SELECT * INTO v_row
      FROM public.runtime_message_claims
     WHERE company_id = _company_id AND message_id = _message_id;
    RETURN jsonb_build_object('claimed', true, 'status', v_row.status,
      'claim_token', v_row.claim_token, 'attempt_count', v_row.attempt_count);
  END IF;

  SELECT * INTO v_row
    FROM public.runtime_message_claims
   WHERE company_id = _company_id AND message_id = _message_id
   FOR UPDATE;

  IF v_row.status IN ('sent', 'uncertain') THEN
    RETURN jsonb_build_object('claimed', false, 'status', v_row.status, 'attempt_count', v_row.attempt_count);
  END IF;

  -- Só recupera lease expirado quando ainda não houve tentativa de saída.
  -- Após iniciar o envio, o resultado pode ser desconhecido; não repetimos
  -- automaticamente para não duplicar a mensagem no WhatsApp.
  IF v_row.status = 'processing' AND v_row.lease_expires_at > v_now THEN
    RETURN jsonb_build_object('claimed', false, 'status', v_row.status, 'attempt_count', v_row.attempt_count);
  END IF;

  IF v_row.status = 'processing' AND v_row.lease_expires_at <= v_now
     AND v_row.outbound_started_at IS NULL THEN
    UPDATE public.runtime_message_claims
       SET claim_token = gen_random_uuid(),
           attempt_count = attempt_count + 1,
           lease_expires_at = v_lease,
           updated_at = v_now,
           last_error = NULL
     WHERE id = v_row.id
     RETURNING * INTO v_row;
    RETURN jsonb_build_object('claimed', true, 'status', v_row.status,
      'claim_token', v_row.claim_token, 'attempt_count', v_row.attempt_count);
  END IF;

  IF v_row.status = 'failed_retryable'
     AND (v_row.next_retry_at IS NULL OR v_row.next_retry_at <= v_now) THEN
    UPDATE public.runtime_message_claims
       SET status = 'processing',
           claim_token = gen_random_uuid(),
           attempt_count = attempt_count + 1,
           lease_expires_at = v_lease,
           outbound_started_at = NULL,
           next_retry_at = NULL,
           updated_at = v_now,
           last_error = NULL
     WHERE id = v_row.id
     RETURNING * INTO v_row;
    RETURN jsonb_build_object('claimed', true, 'status', v_row.status,
      'claim_token', v_row.claim_token, 'attempt_count', v_row.attempt_count);
  END IF;

  RETURN jsonb_build_object('claimed', false, 'status', v_row.status, 'attempt_count', v_row.attempt_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.runtime_mark_message_outbound_started(
  _company_id uuid, _message_id text, _claim_token uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.runtime_message_claims
     SET outbound_started_at = COALESCE(outbound_started_at, now()), updated_at = now()
   WHERE company_id = _company_id AND message_id = _message_id
     AND claim_token = _claim_token AND status = 'processing';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.runtime_finish_message_claim(
  _company_id uuid, _message_id text, _claim_token uuid,
  _status text, _error text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _status NOT IN ('sent', 'failed_retryable', 'uncertain') THEN
    RETURN false;
  END IF;
  UPDATE public.runtime_message_claims
     SET status = _status,
         last_error = NULLIF(left(COALESCE(_error, ''), 500), ''),
         next_retry_at = CASE WHEN _status = 'failed_retryable' THEN now() ELSE NULL END,
         completed_at = CASE WHEN _status = 'sent' THEN now() ELSE NULL END,
         updated_at = now()
   WHERE company_id = _company_id AND message_id = _message_id
     AND claim_token = _claim_token AND status = 'processing';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.runtime_claim_message(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.runtime_mark_message_outbound_started(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.runtime_finish_message_claim(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_claim_message(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.runtime_mark_message_outbound_started(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.runtime_finish_message_claim(uuid, text, uuid, text, text) TO service_role;

-- Atualiza o trigger existente sem bloquear o INSERT da mensagem. O webhook
-- passa o message_id para que callbacks atrasados não possam escolher outra
-- mensagem da conversa.
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
  v_url text;
  v_trigger_secret text;
  v_request_id bigint;
BEGIN
  IF NEW.role <> 'lead' THEN RETURN NEW; END IF;

  -- Serializa callbacks da mesma conversa. Sem isso, dois INSERTs concorrentes
  -- podem passar pelo debounce antes que o primeiro evento seja visível.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.conversation_id::text, 0));

  SELECT ai_status, ai_handling INTO v_ai_status, v_ai_handling
    FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_ai_status IN ('assumido_humano', 'aguardando_humano') OR v_ai_handling = true THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*) INTO v_recent_trigger FROM public.ai_flow_events
   WHERE conversation_id = NEW.conversation_id
     AND event_type = 'trigger_enqueued'
     AND created_at > now() - interval '30 seconds';
  IF v_recent_trigger > 0 THEN RETURN NEW; END IF;

  -- URL e credencial são configuração operacional no Vault. Se qualquer uma
  -- estiver ausente, não há marcador de enfileiramento: o próximo INSERT pode
  -- tentar novamente.
  SELECT decrypted_secret
    INTO v_url
    FROM vault.decrypted_secrets
   WHERE name = 'agent_trigger_url'
   LIMIT 1;
  SELECT decrypted_secret
    INTO v_trigger_secret
    FROM vault.decrypted_secrets
   WHERE name = 'agent_trigger_secret'
   LIMIT 1;
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
    body := jsonb_build_object('conversation_id', NEW.conversation_id::text, 'message_id', NEW.id::text),
    timeout_milliseconds := 5000
  ) INTO v_request_id;

  -- pg_net retorna o id somente quando aceitou o request para a fila. O
  -- debounce/auditoria só pode nascer depois dessa confirmação.
  IF v_request_id IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.ai_flow_events (company_id, conversation_id, lead_id, event_type, payload)
  VALUES (NEW.company_id, NEW.conversation_id, NULL, 'trigger_enqueued',
          jsonb_build_object('message_id', NEW.id, 'request_id', v_request_id));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

