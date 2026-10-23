-- Observação Railway em silent é terminal para deduplicação, mas não é envio.
ALTER TABLE public.runtime_message_claims
  DROP CONSTRAINT IF EXISTS runtime_message_claims_status_check;

ALTER TABLE public.runtime_message_claims
  ADD CONSTRAINT runtime_message_claims_status_check
  CHECK (status IN ('processing', 'observed', 'sent', 'failed_retryable', 'uncertain'));

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
  INSERT INTO public.runtime_message_claims (company_id, message_id, status, lease_expires_at)
  VALUES (_company_id, _message_id, 'processing', v_lease)
  ON CONFLICT (company_id, message_id) DO NOTHING;
  v_inserted := FOUND;

  IF v_inserted THEN
    SELECT * INTO v_row FROM public.runtime_message_claims
     WHERE company_id = _company_id AND message_id = _message_id;
    RETURN jsonb_build_object('claimed', true, 'status', v_row.status,
      'claim_token', v_row.claim_token, 'attempt_count', v_row.attempt_count);
  END IF;

  SELECT * INTO v_row FROM public.runtime_message_claims
   WHERE company_id = _company_id AND message_id = _message_id FOR UPDATE;

  IF v_row.status IN ('observed', 'sent', 'uncertain') THEN
    RETURN jsonb_build_object('claimed', false, 'status', v_row.status, 'attempt_count', v_row.attempt_count);
  END IF;

  IF v_row.status = 'processing' AND v_row.lease_expires_at > v_now THEN
    RETURN jsonb_build_object('claimed', false, 'status', v_row.status, 'attempt_count', v_row.attempt_count);
  END IF;

  IF v_row.status = 'processing' AND v_row.lease_expires_at <= v_now AND v_row.outbound_started_at IS NULL THEN
    UPDATE public.runtime_message_claims
       SET claim_token = gen_random_uuid(), attempt_count = attempt_count + 1,
           lease_expires_at = v_lease, updated_at = v_now, last_error = NULL
     WHERE id = v_row.id RETURNING * INTO v_row;
    RETURN jsonb_build_object('claimed', true, 'status', v_row.status,
      'claim_token', v_row.claim_token, 'attempt_count', v_row.attempt_count);
  END IF;

  IF v_row.status = 'failed_retryable' AND (v_row.next_retry_at IS NULL OR v_row.next_retry_at <= v_now) THEN
    UPDATE public.runtime_message_claims
       SET status = 'processing', claim_token = gen_random_uuid(), attempt_count = attempt_count + 1,
           lease_expires_at = v_lease, outbound_started_at = NULL, next_retry_at = NULL,
           updated_at = v_now, last_error = NULL
     WHERE id = v_row.id RETURNING * INTO v_row;
    RETURN jsonb_build_object('claimed', true, 'status', v_row.status,
      'claim_token', v_row.claim_token, 'attempt_count', v_row.attempt_count);
  END IF;

  RETURN jsonb_build_object('claimed', false, 'status', v_row.status, 'attempt_count', v_row.attempt_count);
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
  IF _status NOT IN ('observed', 'sent', 'failed_retryable', 'uncertain') THEN RETURN false; END IF;
  UPDATE public.runtime_message_claims
     SET status = _status,
         last_error = NULLIF(left(COALESCE(_error, ''), 500), ''),
         next_retry_at = CASE WHEN _status = 'failed_retryable' THEN now() ELSE NULL END,
         completed_at = CASE WHEN _status IN ('observed', 'sent') THEN now() ELSE NULL END,
         updated_at = now()
   WHERE company_id = _company_id AND message_id = _message_id
     AND claim_token = _claim_token AND status = 'processing';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.runtime_claim_message(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.runtime_finish_message_claim(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_claim_message(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.runtime_finish_message_claim(uuid, text, uuid, text, text) TO service_role;
