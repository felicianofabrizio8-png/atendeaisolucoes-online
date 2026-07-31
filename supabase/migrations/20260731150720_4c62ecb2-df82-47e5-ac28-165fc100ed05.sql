CREATE TYPE public.recovery_attempt_status AS ENUM (
  'draft','awaiting_confirmation','confirmed','sending','sent','delivered','read','replied','recovered','cancelled','failed','expired','not_recovered'
);

CREATE TABLE public.recovery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  status public.recovery_attempt_status NOT NULL DEFAULT 'draft',
  recovery_score integer,
  recovery_chance integer,
  recovery_tier text,
  strategy_fingerprint text,
  recovery_plan_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_message_style text,
  selected_message_text text,
  template_id uuid,
  template_name text,
  template_variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  window_state text,
  initiated_by uuid,
  initiated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  sent_at timestamptz,
  message_id uuid,
  external_message_id text,
  delivery_status text,
  response_status text,
  replied_at timestamptz,
  outcome text,
  outcome_at timestamptz,
  outcome_by uuid,
  failure_code text,
  failure_message text,
  send_attempts integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'recovery_queue',
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recovery_attempts_outcome_check CHECK (outcome IS NULL OR outcome IN ('recovered','not_recovered','cancelled')),
  CONSTRAINT recovery_attempts_response_check CHECK (response_status IS NULL OR response_status IN ('no_reply','replied'))
);

GRANT SELECT, INSERT, UPDATE ON public.recovery_attempts TO authenticated;
GRANT ALL ON public.recovery_attempts TO service_role;

ALTER TABLE public.recovery_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company read recovery_attempts" ON public.recovery_attempts
  FOR SELECT TO authenticated USING (company_id = private.current_company_id());
CREATE POLICY "company insert recovery_attempts" ON public.recovery_attempts
  FOR INSERT TO authenticated WITH CHECK (company_id = private.current_company_id());
CREATE POLICY "company update recovery_attempts" ON public.recovery_attempts
  FOR UPDATE TO authenticated USING (company_id = private.current_company_id())
  WITH CHECK (company_id = private.current_company_id());

CREATE UNIQUE INDEX recovery_attempts_idempotency_key_uidx
  ON public.recovery_attempts (company_id, idempotency_key);

CREATE UNIQUE INDEX recovery_attempts_one_active_uidx
  ON public.recovery_attempts (conversation_id)
  WHERE status IN ('draft','awaiting_confirmation','confirmed','sending');

CREATE INDEX recovery_attempts_company_created_idx
  ON public.recovery_attempts (company_id, created_at DESC);
CREATE INDEX recovery_attempts_conversation_idx
  ON public.recovery_attempts (conversation_id, created_at DESC);
CREATE INDEX recovery_attempts_company_status_idx
  ON public.recovery_attempts (company_id, status);

CREATE TABLE public.recovery_attempt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  attempt_id uuid REFERENCES public.recovery_attempts(id) ON DELETE CASCADE,
  conversation_id uuid,
  lead_id uuid,
  user_id uuid,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.recovery_attempt_events TO authenticated;
GRANT ALL ON public.recovery_attempt_events TO service_role;

ALTER TABLE public.recovery_attempt_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company read recovery_attempt_events" ON public.recovery_attempt_events
  FOR SELECT TO authenticated USING (company_id = private.current_company_id());
CREATE POLICY "company insert recovery_attempt_events" ON public.recovery_attempt_events
  FOR INSERT TO authenticated WITH CHECK (company_id = private.current_company_id());

CREATE INDEX recovery_attempt_events_attempt_idx
  ON public.recovery_attempt_events (attempt_id, created_at DESC);
CREATE INDEX recovery_attempt_events_conversation_idx
  ON public.recovery_attempt_events (conversation_id, created_at DESC);

CREATE TRIGGER recovery_attempts_set_updated_at
  BEFORE UPDATE ON public.recovery_attempts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();