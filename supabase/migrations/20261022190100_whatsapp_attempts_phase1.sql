-- Bruna WhatsApp durable attempts - Phase 1
-- Additive only: this migration does not change adapters, routes, functions, or
-- existing production tables. An uncertain provider outcome is terminal here;
-- Phase 1 deliberately has no automatic retry transition.

CREATE TABLE public.whatsapp_send_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE RESTRICT,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  provider_message_id text,
  provider_error_code text,
  provider_error_message text,
  uncertain_reason text,
  provider_status text,
  provider_status_at timestamptz,
  provider_status_error_code text,
  provider_status_error_message text,
  claimed_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_send_attempts_idempotency_key_nonempty
    CHECK (length(btrim(idempotency_key)) > 0),
  CONSTRAINT whatsapp_send_attempts_fingerprint_nonempty
    CHECK (length(btrim(request_fingerprint)) > 0),
  CONSTRAINT whatsapp_send_attempts_status_check
    CHECK (status IN ('queued', 'sending', 'accepted', 'delivered', 'failed', 'uncertain', 'cancelled')),
  CONSTRAINT whatsapp_send_attempts_uncertain_reason_check
    CHECK (status <> 'uncertain' OR length(btrim(coalesce(uncertain_reason, ''))) > 0),
  CONSTRAINT whatsapp_send_attempts_provider_id_check
    CHECK (status <> 'delivered' OR length(btrim(coalesce(provider_message_id, ''))) > 0)
);

CREATE UNIQUE INDEX whatsapp_send_attempts_company_idempotency_uidx
  ON public.whatsapp_send_attempts (company_id, idempotency_key);
CREATE INDEX whatsapp_send_attempts_company_status_created_idx
  ON public.whatsapp_send_attempts (company_id, status, created_at DESC);
CREATE INDEX whatsapp_send_attempts_integration_created_idx
  ON public.whatsapp_send_attempts (integration_id, created_at DESC);
CREATE INDEX whatsapp_send_attempts_conversation_created_idx
  ON public.whatsapp_send_attempts (conversation_id, created_at DESC);
CREATE INDEX whatsapp_send_attempts_lead_created_idx
  ON public.whatsapp_send_attempts (lead_id, created_at DESC);

ALTER TABLE public.whatsapp_send_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select whatsapp attempts"
  ON public.whatsapp_send_attempts FOR SELECT TO authenticated
  USING (company_id = private.current_company_id());

-- Clients cannot insert/update attempts directly. State changes go through the
-- SECURITY DEFINER RPCs below, which re-check every company-owned reference.
REVOKE ALL ON public.whatsapp_send_attempts FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_send_attempts TO authenticated;
GRANT SELECT ON public.whatsapp_send_attempts TO service_role;

CREATE OR REPLACE FUNCTION private.assert_whatsapp_attempt_actor(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  -- service_role is the only trusted cross-tenant caller. Every other caller
  -- must derive its tenant from auth.uid(), never from a function argument.
  IF coalesce(auth.jwt() ->> 'role', auth.role()) = 'service_role' THEN
    RETURN;
  END IF;
  IF private.current_company_id() IS NULL
     OR private.current_company_id() IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'company authorization failed' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_whatsapp_attempt_actor(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.validate_whatsapp_attempt_context(
  p_company_id uuid,
  p_integration_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_current_company uuid;
  v_integration_company uuid;
  v_integration_channel public.channel;
  v_conversation_company uuid;
  v_conversation_lead uuid;
  v_conversation_channel public.channel;
  v_lead_company uuid;
BEGIN
  PERFORM private.assert_whatsapp_attempt_actor(p_company_id);

  SELECT company_id, channel INTO v_integration_company, v_integration_channel
    FROM public.integrations WHERE id = p_integration_id;
  SELECT company_id, lead_id, channel INTO v_conversation_company, v_conversation_lead, v_conversation_channel
    FROM public.conversations WHERE id = p_conversation_id;
  SELECT company_id INTO v_lead_company FROM public.leads WHERE id = p_lead_id;

  IF v_integration_company IS DISTINCT FROM p_company_id
     OR v_integration_channel IS DISTINCT FROM 'whatsapp'::public.channel
     OR v_conversation_company IS DISTINCT FROM p_company_id
     OR v_conversation_channel IS DISTINCT FROM 'whatsapp'::public.channel
     OR v_conversation_lead IS DISTINCT FROM p_lead_id
     OR v_lead_company IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'integration, conversation, lead and company must belong to the same WhatsApp tenant'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.assert_whatsapp_attempt_references(
  p_company_id uuid,
  p_integration_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_integration_company uuid;
  v_integration_channel public.channel;
  v_conversation_company uuid;
  v_conversation_lead uuid;
  v_conversation_channel public.channel;
  v_lead_company uuid;
BEGIN
  SELECT company_id, channel INTO v_integration_company, v_integration_channel
    FROM public.integrations WHERE id = p_integration_id;
  SELECT company_id, lead_id, channel INTO v_conversation_company, v_conversation_lead, v_conversation_channel
    FROM public.conversations WHERE id = p_conversation_id;
  SELECT company_id INTO v_lead_company FROM public.leads WHERE id = p_lead_id;

  IF v_integration_company IS DISTINCT FROM p_company_id
     OR v_integration_channel IS DISTINCT FROM 'whatsapp'::public.channel
     OR v_conversation_company IS DISTINCT FROM p_company_id
     OR v_conversation_channel IS DISTINCT FROM 'whatsapp'::public.channel
     OR v_conversation_lead IS DISTINCT FROM p_lead_id
     OR v_lead_company IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'integration, conversation, lead and company must belong to the same WhatsApp tenant'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_whatsapp_attempt_references(uuid, uuid, uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.guard_whatsapp_attempt_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM private.assert_whatsapp_attempt_references(
    NEW.company_id, NEW.integration_id, NEW.conversation_id, NEW.lead_id
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_whatsapp_attempt_context() FROM PUBLIC;

CREATE TRIGGER zz_whatsapp_attempts_context_guard
  BEFORE INSERT OR UPDATE OF company_id, integration_id, conversation_id, lead_id
  ON public.whatsapp_send_attempts
  FOR EACH ROW EXECUTE FUNCTION private.guard_whatsapp_attempt_context();

CREATE OR REPLACE FUNCTION private.validate_existing_whatsapp_attempt(
  p_company_id uuid,
  p_attempt_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_integration uuid;
  v_conversation uuid;
  v_lead uuid;
  v_attempt_company uuid;
BEGIN
  SELECT company_id, integration_id, conversation_id, lead_id
    INTO v_attempt_company, v_integration, v_conversation, v_lead
    FROM public.whatsapp_send_attempts WHERE id = p_attempt_id;
  IF v_attempt_company IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'attempt company validation failed' USING ERRCODE = '42501';
  END IF;
  PERFORM private.validate_whatsapp_attempt_context(
    p_company_id, v_integration, v_conversation, v_lead
  );
END;
$$;

REVOKE ALL ON FUNCTION private.validate_whatsapp_attempt_context(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_existing_whatsapp_attempt(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.guard_whatsapp_attempt_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.integration_id IS DISTINCT FROM OLD.integration_id
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint THEN
    RAISE EXCEPTION 'whatsapp attempt identity is immutable' USING ERRCODE = '25006';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'queued' AND NEW.status IN ('sending', 'cancelled')) OR
    (OLD.status = 'sending' AND NEW.status IN ('accepted', 'failed', 'uncertain', 'cancelled')) OR
    (OLD.status = 'accepted' AND NEW.status IN ('delivered', 'failed', 'uncertain'))
  ) THEN
    RAISE EXCEPTION 'invalid whatsapp attempt transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'sending' AND NEW.claimed_at IS NULL THEN
    RAISE EXCEPTION 'sending attempts require claimed_at' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('accepted', 'delivered') AND NEW.accepted_at IS NULL THEN
    RAISE EXCEPTION 'accepted/delivered attempts require accepted_at' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('failed', 'uncertain', 'cancelled', 'delivered') AND NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'terminal attempts require completed_at' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER whatsapp_attempts_guard_update
  BEFORE UPDATE ON public.whatsapp_send_attempts
  FOR EACH ROW EXECUTE FUNCTION private.guard_whatsapp_attempt_update();

CREATE TRIGGER whatsapp_attempts_updated_at
  BEFORE UPDATE ON public.whatsapp_send_attempts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.create_whatsapp_send_attempt(
  p_company_id uuid,
  p_integration_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS public.whatsapp_send_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_attempt public.whatsapp_send_attempts;
BEGIN
  IF nullif(btrim(p_idempotency_key), '') IS NULL
     OR nullif(btrim(p_request_fingerprint), '') IS NULL THEN
    RAISE EXCEPTION 'idempotency key and request fingerprint are required' USING ERRCODE = '22023';
  END IF;
  PERFORM private.validate_whatsapp_attempt_context(p_company_id, p_integration_id, p_conversation_id, p_lead_id);
  INSERT INTO public.whatsapp_send_attempts
    (company_id, integration_id, conversation_id, lead_id, idempotency_key, request_fingerprint, payload)
  VALUES (p_company_id, p_integration_id, p_conversation_id, p_lead_id,
          btrim(p_idempotency_key), p_request_fingerprint, coalesce(p_payload, '{}'::jsonb))
  ON CONFLICT (company_id, idempotency_key) DO NOTHING
  RETURNING * INTO v_attempt;

  IF NOT FOUND THEN
    -- The unique index serializes concurrent creators. The following read is
    -- after the conflicting transaction has committed and locks that row.
    SELECT * INTO v_attempt FROM public.whatsapp_send_attempts
      WHERE company_id = p_company_id AND idempotency_key = btrim(p_idempotency_key)
      FOR UPDATE;
    IF v_attempt.integration_id IS DISTINCT FROM p_integration_id
       OR v_attempt.conversation_id IS DISTINCT FROM p_conversation_id
       OR v_attempt.lead_id IS DISTINCT FROM p_lead_id
       OR v_attempt.request_fingerprint IS DISTINCT FROM p_request_fingerprint
       OR v_attempt.payload IS DISTINCT FROM coalesce(p_payload, '{}'::jsonb) THEN
      RAISE EXCEPTION 'idempotency key already has a different request context' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN v_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_whatsapp_send_attempt(p_company_id uuid, p_attempt_id uuid)
RETURNS public.whatsapp_send_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE v_attempt public.whatsapp_send_attempts;
BEGIN
  PERFORM private.validate_existing_whatsapp_attempt(p_company_id, p_attempt_id);
  UPDATE public.whatsapp_send_attempts
     SET status = 'sending', claimed_at = now()
   WHERE id = p_attempt_id AND company_id = p_company_id AND status = 'queued'
   RETURNING * INTO v_attempt;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt is not queued' USING ERRCODE = '55000'; END IF;
  RETURN v_attempt;
END; $$;

CREATE OR REPLACE FUNCTION public.accept_whatsapp_send_attempt(
  p_company_id uuid, p_attempt_id uuid, p_provider_message_id text)
RETURNS public.whatsapp_send_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE v_attempt public.whatsapp_send_attempts;
BEGIN
  PERFORM private.validate_existing_whatsapp_attempt(p_company_id, p_attempt_id);
  UPDATE public.whatsapp_send_attempts SET status = 'accepted', provider_message_id = p_provider_message_id, accepted_at = now()
   WHERE id = p_attempt_id AND company_id = p_company_id AND status = 'sending' RETURNING * INTO v_attempt;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt is not sending' USING ERRCODE = '55000'; END IF;
  RETURN v_attempt;
END; $$;

CREATE OR REPLACE FUNCTION public.complete_whatsapp_send_attempt(
  p_company_id uuid, p_attempt_id uuid, p_provider_message_id text DEFAULT NULL)
RETURNS public.whatsapp_send_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE v_attempt public.whatsapp_send_attempts;
BEGIN
  PERFORM private.validate_existing_whatsapp_attempt(p_company_id, p_attempt_id);
  UPDATE public.whatsapp_send_attempts SET status = 'delivered', provider_message_id = coalesce(p_provider_message_id, provider_message_id), completed_at = now()
   WHERE id = p_attempt_id AND company_id = p_company_id AND status = 'accepted' RETURNING * INTO v_attempt;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt is not accepted' USING ERRCODE = '55000'; END IF;
  RETURN v_attempt;
END; $$;

CREATE OR REPLACE FUNCTION public.fail_whatsapp_send_attempt(
  p_company_id uuid, p_attempt_id uuid, p_error_code text, p_error_message text)
RETURNS public.whatsapp_send_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE v_attempt public.whatsapp_send_attempts;
BEGIN
  PERFORM private.validate_existing_whatsapp_attempt(p_company_id, p_attempt_id);
  UPDATE public.whatsapp_send_attempts SET status = 'failed', provider_error_code = p_error_code, provider_error_message = p_error_message, completed_at = now()
   WHERE id = p_attempt_id AND company_id = p_company_id AND status IN ('sending', 'accepted') RETURNING * INTO v_attempt;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt is not active' USING ERRCODE = '55000'; END IF;
  RETURN v_attempt;
END; $$;

CREATE OR REPLACE FUNCTION public.mark_whatsapp_send_attempt_uncertain(
  p_company_id uuid, p_attempt_id uuid, p_reason text)
RETURNS public.whatsapp_send_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE v_attempt public.whatsapp_send_attempts;
BEGIN
  PERFORM private.validate_existing_whatsapp_attempt(p_company_id, p_attempt_id);
  UPDATE public.whatsapp_send_attempts SET status = 'uncertain', uncertain_reason = p_reason, completed_at = now()
   WHERE id = p_attempt_id AND company_id = p_company_id AND status IN ('sending', 'accepted') RETURNING * INTO v_attempt;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt is not active' USING ERRCODE = '55000'; END IF;
  RETURN v_attempt;
END; $$;

-- All writes, including creation and state transitions, are backend-owned.
-- authenticated retains read-only RLS access to the attempt table below, but
-- cannot create, claim, accept, complete, fail, or mark an attempt uncertain.
GRANT EXECUTE ON FUNCTION public.create_whatsapp_send_attempt(uuid, uuid, uuid, uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_send_attempt(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_whatsapp_send_attempt(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_whatsapp_send_attempt(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_whatsapp_send_attempt(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_whatsapp_send_attempt_uncertain(uuid, uuid, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.create_whatsapp_send_attempt(uuid, uuid, uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_whatsapp_send_attempt(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_whatsapp_send_attempt(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_whatsapp_send_attempt(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fail_whatsapp_send_attempt(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_whatsapp_send_attempt_uncertain(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Status callbacks are durable and idempotent, including callbacks received
-- before the local message/attempt exists.  They are history, not a retry
-- queue: an uncertain attempt is never made sendable by this RPC.
CREATE TABLE public.whatsapp_send_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  provider_message_id text NOT NULL,
  provider_status text NOT NULL,
  status_at timestamptz NOT NULL,
  error_code text,
  error_message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_id uuid REFERENCES public.whatsapp_send_attempts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_status_event_identity
    UNIQUE (company_id, integration_id, provider_message_id, provider_status, status_at)
);

CREATE INDEX whatsapp_status_events_lookup_idx
  ON public.whatsapp_send_status_events
    (company_id, integration_id, provider_message_id, status_at DESC);

ALTER TABLE public.whatsapp_send_status_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company select whatsapp status events"
  ON public.whatsapp_send_status_events FOR SELECT TO authenticated
  USING (company_id = private.current_company_id());
REVOKE ALL ON public.whatsapp_send_status_events FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_send_status_events TO authenticated;
GRANT SELECT ON public.whatsapp_send_status_events TO service_role;

CREATE OR REPLACE FUNCTION public.record_whatsapp_send_status(
  p_company_id uuid,
  p_integration_id uuid,
  p_provider_message_id text,
  p_provider_status text,
  p_status_at timestamptz,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(event_recorded boolean, attempt_updated boolean, orphan boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_attempt public.whatsapp_send_attempts;
  v_event boolean := false;
  v_updated boolean := false;
  v_status text := lower(btrim(p_provider_status));
  v_at timestamptz := coalesce(p_status_at, now());
BEGIN
  IF nullif(btrim(p_provider_message_id), '') IS NULL
     OR v_status NOT IN ('sent', 'delivered', 'read', 'failed') THEN
    RETURN QUERY SELECT false, false, true;
    RETURN;
  END IF;

  PERFORM private.assert_whatsapp_attempt_actor(p_company_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.integrations
     WHERE id = p_integration_id
       AND company_id = p_company_id
       AND channel = 'whatsapp'::public.channel
  ) THEN
    RAISE EXCEPTION 'WhatsApp integration does not belong to company'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_attempt
    FROM public.whatsapp_send_attempts
   WHERE company_id = p_company_id
     AND integration_id = p_integration_id
     AND provider_message_id = btrim(p_provider_message_id)
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  INSERT INTO public.whatsapp_send_status_events
    (company_id, integration_id, provider_message_id, provider_status,
     status_at, error_code, error_message, payload, attempt_id)
  VALUES
    (p_company_id, p_integration_id, btrim(p_provider_message_id), v_status,
     v_at, p_error_code, p_error_message, coalesce(p_payload, '{}'::jsonb),
     v_attempt.id)
  ON CONFLICT (company_id, integration_id, provider_message_id, provider_status, status_at)
  DO NOTHING;
  v_event := FOUND;

  IF v_attempt.id IS NULL THEN
    RETURN QUERY SELECT v_event, false, true;
    RETURN;
  END IF;

  -- Delivery state is monotonic. `failed` is a side branch and cannot
  -- regress a confirmed delivered/read status. Uncertain remains terminal.
  IF v_attempt.status = 'uncertain' OR v_attempt.status IN ('failed', 'cancelled') THEN
    RETURN QUERY SELECT v_event, false, false;
    RETURN;
  END IF;

  UPDATE public.whatsapp_send_attempts
     SET provider_status = v_status,
         provider_status_at = v_at,
         provider_status_error_code = p_error_code,
         provider_status_error_message = p_error_message
   WHERE id = v_attempt.id
     AND company_id = p_company_id
     AND (
       provider_status IS NULL
       OR (provider_status = 'sent' AND v_status IN ('delivered', 'read'))
       OR (provider_status = 'delivered' AND v_status = 'read')
       OR (v_status = 'failed' AND provider_status IN ('sent', 'failed'))
     );
  v_updated := FOUND;
  RETURN QUERY SELECT v_event, v_updated, false;
END;
$$;

REVOKE ALL ON FUNCTION public.record_whatsapp_send_status(uuid, uuid, text, text, timestamptz, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_send_status(uuid, uuid, text, text, timestamptz, text, text, jsonb)
  TO service_role;
