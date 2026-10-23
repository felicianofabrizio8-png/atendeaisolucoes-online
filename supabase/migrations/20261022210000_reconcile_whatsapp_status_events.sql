ALTER TABLE public.whatsapp_send_attempts ADD COLUMN IF NOT EXISTS provider_status text, ADD COLUMN IF NOT EXISTS provider_status_at timestamptz, ADD COLUMN IF NOT EXISTS provider_status_error_code text, ADD COLUMN IF NOT EXISTS provider_status_error_message text;

-- Reconcile a partially-applied 20261022190100_whatsapp_attempts_phase1.
-- Additive and idempotent: preserve prior migration history and attempt rows.

-- Provider ids must be unambiguous within their tenant/integration scope.
DO $$
DECLARE
  v_duplicate record;
BEGIN
  SELECT company_id, integration_id, provider_message_id, count(*) AS duplicate_count
    INTO v_duplicate
    FROM public.whatsapp_send_attempts
   WHERE NULLIF(btrim(provider_message_id), '') IS NOT NULL
   GROUP BY company_id, integration_id, provider_message_id
  HAVING count(*) > 1
   ORDER BY count(*) DESC
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'ambiguous WhatsApp provider_message_id; resolve duplicate attempts before migration (company %, integration %, provider_message_id %, count %)',
      v_duplicate.company_id, v_duplicate.integration_id,
      v_duplicate.provider_message_id, v_duplicate.duplicate_count
      USING ERRCODE = '23505';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_send_attempts_provider_message_uidx
  ON public.whatsapp_send_attempts (company_id, integration_id, btrim(provider_message_id))
  WHERE NULLIF(btrim(provider_message_id), '') IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.whatsapp_send_status_events (
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

CREATE INDEX IF NOT EXISTS whatsapp_status_events_lookup_idx
  ON public.whatsapp_send_status_events
    (company_id, integration_id, provider_message_id, status_at DESC);

ALTER TABLE public.whatsapp_send_status_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'whatsapp_send_status_events'
      AND policyname = 'company select whatsapp status events'
  ) THEN
    CREATE POLICY "company select whatsapp status events"
      ON public.whatsapp_send_status_events FOR SELECT TO authenticated
      USING (company_id = private.current_company_id());
  END IF;
END $$;

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
     AND btrim(provider_message_id) = btrim(p_provider_message_id)
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

CREATE OR REPLACE FUNCTION private.reconcile_whatsapp_send_status_events(p_attempt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_attempt public.whatsapp_send_attempts;
  v_candidate record;
  v_current_rank integer;
BEGIN
  SELECT * INTO v_attempt
    FROM public.whatsapp_send_attempts
   WHERE id = p_attempt_id
   FOR UPDATE;

  IF NOT FOUND OR NULLIF(btrim(v_attempt.provider_message_id), '') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.whatsapp_send_status_events
     SET attempt_id = v_attempt.id
   WHERE attempt_id IS NULL
     AND company_id = v_attempt.company_id
     AND integration_id = v_attempt.integration_id
     AND provider_message_id = btrim(v_attempt.provider_message_id);

  -- Progression wins over callback arrival order. Failed is a side branch and
  -- cannot regress a confirmed delivered/read state; status_at breaks ties.
  SELECT e.provider_status, e.status_at, e.error_code, e.error_message,
         CASE e.provider_status
           WHEN 'read' THEN 3
           WHEN 'delivered' THEN 2
           WHEN 'sent' THEN 1
           WHEN 'failed' THEN 1
           ELSE 0
         END AS status_rank
    INTO v_candidate
    FROM public.whatsapp_send_status_events e
   WHERE e.attempt_id = v_attempt.id
   ORDER BY CASE e.provider_status
              WHEN 'read' THEN 3
              WHEN 'delivered' THEN 2
              WHEN 'sent' THEN 1
              WHEN 'failed' THEN 1
              ELSE 0
            END DESC,
            e.status_at DESC,
            e.id DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_current_rank := CASE v_attempt.provider_status
    WHEN 'read' THEN 3
    WHEN 'delivered' THEN 2
    WHEN 'sent' THEN 1
    WHEN 'failed' THEN 1
    ELSE 0
  END;

  IF v_candidate.status_rank > v_current_rank
     OR (v_candidate.status_rank = v_current_rank AND
         (v_attempt.provider_status_at IS NULL OR v_candidate.status_at > v_attempt.provider_status_at)) THEN
    UPDATE public.whatsapp_send_attempts
       SET provider_status = v_candidate.provider_status,
           provider_status_at = v_candidate.status_at,
           provider_status_error_code = v_candidate.error_code,
           provider_status_error_message = v_candidate.error_message
     WHERE id = v_attempt.id
       AND company_id = v_attempt.company_id
       AND integration_id = v_attempt.integration_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.reconcile_whatsapp_send_status_events(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.reconcile_whatsapp_send_status_events_after_attempt_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id THEN
    PERFORM private.reconcile_whatsapp_send_status_events(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reconcile_whatsapp_send_status_events_after_attempt_id() FROM PUBLIC;

DROP TRIGGER IF EXISTS whatsapp_attempts_reconcile_status_events
  ON public.whatsapp_send_attempts;
CREATE TRIGGER whatsapp_attempts_reconcile_status_events
  AFTER UPDATE OF provider_message_id ON public.whatsapp_send_attempts
  FOR EACH ROW
  WHEN (NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id)
  EXECUTE FUNCTION private.reconcile_whatsapp_send_status_events_after_attempt_id();
