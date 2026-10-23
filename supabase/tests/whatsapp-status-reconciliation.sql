-- Reconciliation contract. Run only against a disposable local PostgreSQL.
BEGIN;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  c1 uuid := '00000000-0000-0000-0000-000000000301'; c2 uuid := '00000000-0000-0000-0000-000000000302';
  i1 uuid := '00000000-0000-0000-0000-000000000311'; i2 uuid := '00000000-0000-0000-0000-000000000312';
  l1 uuid := '00000000-0000-0000-0000-000000000321'; l2 uuid := '00000000-0000-0000-0000-000000000322';
  cv1 uuid := '00000000-0000-0000-0000-000000000331'; cv2 uuid := '00000000-0000-0000-0000-000000000332';
  a_accept uuid := '00000000-0000-0000-0000-000000000341'; a_complete uuid := '00000000-0000-0000-0000-000000000342';
  a_failed uuid := '00000000-0000-0000-0000-000000000343'; a_other uuid := '00000000-0000-0000-0000-000000000344';
  r public.whatsapp_send_attempts; v_count bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'whatsapp_send_attempts_provider_message_uidx' AND indexdef LIKE '%UNIQUE INDEX%') THEN
    RAISE EXCEPTION 'tenant-scoped provider id unique partial index missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'whatsapp_attempts_reconcile_status_events') THEN
    RAISE EXCEPTION 'provider id reconciliation trigger missing';
  END IF;

  INSERT INTO public.companies (id, name) VALUES (c1, 'reconcile-a'), (c2, 'reconcile-b');
  INSERT INTO public.integrations (id, company_id, channel, display_name) VALUES (i1, c1, 'whatsapp', 'reconcile-a'), (i2, c2, 'whatsapp', 'reconcile-b');
  INSERT INTO public.leads (id, company_id, name, channel) VALUES (l1, c1, 'reconcile-a', 'whatsapp'), (l2, c2, 'reconcile-b', 'whatsapp');
  INSERT INTO public.conversations (id, company_id, lead_id, channel) VALUES (cv1, c1, l1, 'whatsapp'), (cv2, c2, l2, 'whatsapp');
  INSERT INTO public.whatsapp_send_attempts (id, company_id, integration_id, conversation_id, lead_id, idempotency_key, request_fingerprint, status)
    VALUES (a_accept, c1, i1, cv1, l1, 'reconcile-accept', 'fp-accept', 'sending'),
           (a_complete, c1, i1, cv1, l1, 'reconcile-complete', 'fp-complete', 'accepted'),
           (a_failed, c1, i1, cv1, l1, 'reconcile-failed', 'fp-failed', 'sending'),
           (a_other, c2, i2, cv2, l2, 'reconcile-other', 'fp-other', 'sending');

  -- Out-of-order sent/delivered/read callbacks; the duplicate is deduped.
  INSERT INTO public.whatsapp_send_status_events (company_id, integration_id, provider_message_id, provider_status, status_at)
    VALUES (c1, i1, 'provider-shared', 'read', '2026-01-01 12:00:00+00'),
           (c1, i1, 'provider-shared', 'sent', '2026-01-01 10:00:00+00'),
           (c1, i1, 'provider-shared', 'delivered', '2026-01-01 11:00:00+00'),
           (c1, i1, 'provider-shared', 'sent', '2026-01-01 10:00:00+00')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.whatsapp_send_status_events (company_id, integration_id, provider_message_id, provider_status, status_at, error_code)
    VALUES (c1, i1, 'provider-failed', 'failed', '2026-01-01 13:00:00+00', 'E_TEST');
  INSERT INTO public.whatsapp_send_status_events (company_id, integration_id, provider_message_id, provider_status, status_at)
    VALUES (c1, i1, 'provider-complete', 'delivered', '2026-01-01 14:00:00+00'),
           (c2, i2, 'provider-shared', 'delivered', '2026-01-01 14:00:00+00');

  PERFORM public.accept_whatsapp_send_attempt(c1, a_accept, 'provider-shared');
  SELECT * INTO r FROM public.whatsapp_send_attempts WHERE id = a_accept;
  IF r.provider_status <> 'read' OR r.provider_status_at <> '2026-01-01 12:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'accept did not reconcile monotonic out-of-order statuses';
  END IF;
  SELECT count(*) INTO v_count FROM public.whatsapp_send_status_events WHERE company_id = c1 AND integration_id = i1 AND provider_message_id = 'provider-shared';
  IF v_count <> 3 THEN RAISE EXCEPTION 'duplicate status event was not idempotent'; END IF;

  PERFORM public.complete_whatsapp_send_attempt(c1, a_complete, 'provider-complete');
  SELECT * INTO r FROM public.whatsapp_send_attempts WHERE id = a_complete;
  IF r.provider_status <> 'delivered' OR r.status <> 'delivered' THEN
    RAISE EXCEPTION 'complete did not reconcile delivered event without changing send semantics (provider_status %, status %)', r.provider_status, r.status;
  END IF;
  PERFORM public.accept_whatsapp_send_attempt(c1, a_failed, 'provider-failed');
  SELECT * INTO r FROM public.whatsapp_send_attempts WHERE id = a_failed;
  IF r.provider_status <> 'failed' OR r.provider_status_error_code <> 'E_TEST' THEN RAISE EXCEPTION 'failed status was not reconciled'; END IF;

  -- Same provider id in another tenant/integration is not associated.
  SELECT * INTO r FROM public.whatsapp_send_attempts WHERE id = a_other;
  IF r.provider_message_id IS NOT NULL THEN RAISE EXCEPTION 'cross-tenant id leaked'; END IF;
  IF (SELECT count(*) FROM public.whatsapp_send_status_events WHERE company_id = c2 AND integration_id = i2 AND attempt_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'cross-tenant event was associated';
  END IF;
END $$;

ROLLBACK;
