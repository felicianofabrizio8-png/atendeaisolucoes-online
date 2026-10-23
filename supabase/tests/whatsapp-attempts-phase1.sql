-- WhatsApp attempts / Phase 1 contract tests.
-- Run against a disposable local Supabase database only. No remote or deploy
-- command is part of this file. The transaction is rolled back at the end.

BEGIN;
SET LOCAL ROLE postgres;

DO $$
BEGIN
  IF to_regclass('public.whatsapp_send_attempts') IS NULL THEN RAISE EXCEPTION 'attempt table missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'whatsapp_send_attempts_company_idempotency_uidx') THEN
    RAISE EXCEPTION 'tenant-scoped idempotency index missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_whatsapp_attempts_context_guard') THEN
    RAISE EXCEPTION 'multi-company context trigger missing';
  END IF;
  IF to_regclass('public.whatsapp_send_status_events') IS NULL THEN
    RAISE EXCEPTION 'durable WhatsApp status event table missing';
  END IF;
  IF to_regprocedure('public.record_whatsapp_send_status(uuid,uuid,text,text,timestamptz,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'durable WhatsApp status RPC missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'whatsapp_send_attempts'
      AND policyname = 'company select whatsapp attempts'
      AND qual LIKE '%current_company_id%'
  ) THEN
    RAISE EXCEPTION 'tenant-scoped read RLS policy missing';
  END IF;
END $$;

DO $$
DECLARE v_fn regprocedure;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.create_whatsapp_send_attempt(uuid,uuid,uuid,uuid,text,text,jsonb)'::regprocedure,
    'public.claim_whatsapp_send_attempt(uuid,uuid)'::regprocedure,
    'public.accept_whatsapp_send_attempt(uuid,uuid,text)'::regprocedure,
    'public.complete_whatsapp_send_attempt(uuid,uuid,text)'::regprocedure,
    'public.fail_whatsapp_send_attempt(uuid,uuid,text,text)'::regprocedure,
    'public.mark_whatsapp_send_attempt_uncertain(uuid,uuid,text)'::regprocedure,
    'public.record_whatsapp_send_status(uuid,uuid,text,text,timestamptz,text,text,jsonb)'::regprocedure
  ] LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated can execute backend-only RPC %', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role grant missing for %', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN RAISE EXCEPTION 'anon can execute %', v_fn; END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'private.validate_whatsapp_attempt_context(uuid,uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'private validator is exposed';
  END IF;
END $$;

-- Exercise the real role boundary, not only catalog privileges: authenticated
-- can read the table through RLS, but cannot invoke any write RPC or write the
-- table directly. The SELECT is intentionally tenant-empty in this harness;
-- company scoping remains enforced by the policy's current_company_id check.
DO $$
DECLARE
  v_count bigint;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SELECT count(*) INTO v_count FROM public.whatsapp_send_attempts;
  BEGIN
    PERFORM public.claim_whatsapp_send_attempt(
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000105'
    );
    RAISE EXCEPTION 'authenticated invoked backend-only state RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.accept_whatsapp_send_attempt(
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000105', 'auth-provider-id'
    );
    RAISE EXCEPTION 'authenticated accepted an attempt';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.complete_whatsapp_send_attempt(
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000105', 'auth-provider-id'
    );
    RAISE EXCEPTION 'authenticated completed an attempt';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.whatsapp_send_attempts
      (company_id, integration_id, conversation_id, lead_id, idempotency_key, request_fingerprint)
    VALUES ('00000000-0000-0000-0000-000000000101',
            '00000000-0000-0000-0000-000000000102',
            '00000000-0000-0000-0000-000000000104',
            '00000000-0000-0000-0000-000000000103', 'auth-direct', 'auth-direct');
    RAISE EXCEPTION 'authenticated inserted an attempt directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  c1 uuid := '00000000-0000-0000-0000-000000000101'; c2 uuid := '00000000-0000-0000-0000-000000000201';
  i1 uuid := '00000000-0000-0000-0000-000000000102'; i2 uuid := '00000000-0000-0000-0000-000000000202';
  l1 uuid := '00000000-0000-0000-0000-000000000103'; l2 uuid := '00000000-0000-0000-0000-000000000203';
  cv1 uuid := '00000000-0000-0000-0000-000000000104'; cv2 uuid := '00000000-0000-0000-0000-000000000204';
  a1 uuid := '00000000-0000-0000-0000-000000000105'; a2 uuid := '00000000-0000-0000-0000-000000000205';
  r public.whatsapp_send_attempts;
BEGIN
  INSERT INTO public.companies (id, name) VALUES (c1, 'phase1-test-a'), (c2, 'phase1-test-b');
  INSERT INTO public.integrations (id, company_id, channel, display_name) VALUES (i1, c1, 'whatsapp', 'phase1-a'), (i2, c2, 'whatsapp', 'phase1-b');
  INSERT INTO public.leads (id, company_id, name, channel) VALUES (l1, c1, 'phase1-a', 'whatsapp'), (l2, c2, 'phase1-b', 'whatsapp');
  INSERT INTO public.conversations (id, company_id, lead_id, channel) VALUES (cv1, c1, l1, 'whatsapp'), (cv2, c2, l2, 'whatsapp');

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT * INTO r FROM public.create_whatsapp_send_attempt(c1, i1, cv1, l1, 'same-key', 'fp-a', '{"body":"a"}');
  IF r.id IS NULL OR r.company_id <> c1 THEN RAISE EXCEPTION 'service_role create failed'; END IF;
  SELECT * INTO r FROM public.create_whatsapp_send_attempt(c2, i2, cv2, l2, 'same-key', 'fp-b', '{"body":"b"}');
  IF r.id IS NULL OR r.company_id <> c2 THEN RAISE EXCEPTION 'idempotency leaked across tenants'; END IF;

  BEGIN
    PERFORM public.create_whatsapp_send_attempt(c1, i2, cv1, l1, 'same-key', 'fp-a', '{"body":"a"}');
    RAISE EXCEPTION 'cross-tenant integration context accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL; END;
  BEGIN
    PERFORM public.create_whatsapp_send_attempt(c1, i1, cv1, l1, 'same-key', 'fp-a', '{"body":"different"}');
    RAISE EXCEPTION 'divergent payload accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.create_whatsapp_send_attempt(c1, i1, cv1, l1, 'auth-key', 'fp-auth', '{}');
    RAISE EXCEPTION 'unauthorized authenticated call accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SET LOCAL ROLE postgres;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  BEGIN
    PERFORM public.create_whatsapp_send_attempt(c1, i2, cv1, l1, 'bad-context', 'fp-bad', '{}');
    RAISE EXCEPTION 'mixed-company context accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  SELECT * INTO r FROM public.create_whatsapp_send_attempt(c1, i1, cv1, l1, 'transition-key', 'fp-t', '{}'); a1 := r.id;
  BEGIN
    PERFORM public.complete_whatsapp_send_attempt(c1, a1, 'provider-1');
    RAISE EXCEPTION 'queued -> delivered accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  SELECT * INTO r FROM public.claim_whatsapp_send_attempt(c1, a1);
  SELECT * INTO r FROM public.mark_whatsapp_send_attempt_uncertain(c1, a1, 'provider timeout');
  IF r.status <> 'uncertain' THEN RAISE EXCEPTION 'uncertain transition failed'; END IF;
  BEGIN
    PERFORM public.claim_whatsapp_send_attempt(c1, a1);
    RAISE EXCEPTION 'uncertain attempt became retryable';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;

  INSERT INTO public.whatsapp_send_attempts (id, company_id, integration_id, conversation_id, lead_id, idempotency_key, request_fingerprint)
    VALUES (a2, c1, i1, cv1, l1, 'direct-key', 'fp-direct');
  BEGIN
    UPDATE public.whatsapp_send_attempts SET company_id = c2 WHERE id = a2;
    RAISE EXCEPTION 'identity mutation accepted';
  EXCEPTION WHEN SQLSTATE '25006' THEN NULL; END;
END $$;

-- Actual two-session race. dblink is used only by this disposable test; both
-- calls use the same tenant/key and must return the same single row.
CREATE EXTENSION IF NOT EXISTS dblink;
DO $$
DECLARE
  db text := format('dbname=%I', current_database());
  suffix text := replace(gen_random_uuid()::text, '-', '');
  conn1 text := 'wa_race_1_' || suffix;
  conn2 text := 'wa_race_2_' || suffix;
  c uuid := gen_random_uuid();
  i uuid := gen_random_uuid();
  l uuid := gen_random_uuid();
  v uuid := gen_random_uuid();
  r1 uuid;
  r2 uuid;
  n integer := 0;
  cleanup_sql text;
BEGIN
  -- These sessions have no transaction inherited from this test's outer
  -- transaction. Each dblink_exec statement commits independently, so the
  -- race cannot wait on locks held by the caller's transaction.
  PERFORM dblink_connect(conn1, db);
  PERFORM dblink_connect(conn2, db);
  PERFORM dblink_exec(conn1, 'SET SESSION ROLE postgres');
  PERFORM dblink_exec(conn2, 'SET SESSION ROLE postgres');
  PERFORM dblink_exec(conn1, 'SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED');
  PERFORM dblink_exec(conn2, 'SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED');
  PERFORM dblink_exec(conn1, format($sql$
    INSERT INTO public.companies(id,name) VALUES ('%s','race-company');
    INSERT INTO public.integrations(id,company_id,channel,display_name) VALUES ('%s','%s','whatsapp','race');
    INSERT INTO public.leads(id,company_id,name,channel) VALUES ('%s','%s','race','whatsapp');
    INSERT INTO public.conversations(id,company_id,lead_id,channel) VALUES ('%s','%s','%s','whatsapp');
  $sql$, c, i, c, l, c, v, c, l));
  PERFORM dblink_exec(conn1, $q$SET request.jwt.claim.role = 'service_role'$q$);
  PERFORM dblink_exec(conn2, $q$SET request.jwt.claim.role = 'service_role'$q$);
  PERFORM dblink_send_query(conn1, format($sql$SELECT id::text FROM public.create_whatsapp_send_attempt('%s','%s','%s','%s','race-key','race-fp','{}')$sql$, c, i, v, l));
  PERFORM dblink_send_query(conn2, format($sql$SELECT id::text FROM public.create_whatsapp_send_attempt('%s','%s','%s','%s','race-key','race-fp','{}')$sql$, c, i, v, l));
  WHILE (dblink_is_busy(conn1) = 1 OR dblink_is_busy(conn2) = 1) AND n < 500 LOOP
    PERFORM pg_sleep(0.01); n := n + 1;
  END LOOP;
  IF dblink_is_busy(conn1) = 1 OR dblink_is_busy(conn2) = 1 THEN RAISE EXCEPTION 'concurrency calls timed out'; END IF;
  SELECT id INTO r1 FROM dblink_get_result(conn1) AS x(id uuid);
  SELECT id INTO r2 FROM dblink_get_result(conn2) AS x(id uuid);
  -- Drena o fim do resultado de cada conexão antes do próximo comando.
  PERFORM 1 FROM dblink_get_result(conn1) AS x(id uuid);
  PERFORM 1 FROM dblink_get_result(conn2) AS x(id uuid);
  IF r1 IS NULL OR r1 <> r2 THEN RAISE EXCEPTION 'concurrent idempotent calls returned different ids'; END IF;
  IF (SELECT count(*) FROM public.whatsapp_send_attempts WHERE company_id = c AND idempotency_key = 'race-key') <> 1 THEN
    RAISE EXCEPTION 'concurrent calls created more than one attempt';
  END IF;
  cleanup_sql := format('DELETE FROM public.whatsapp_send_attempts WHERE company_id = ''%s'' AND idempotency_key = ''race-key''; DELETE FROM public.conversations WHERE id = ''%s''; DELETE FROM public.leads WHERE id = ''%s''; DELETE FROM public.integrations WHERE id = ''%s''; DELETE FROM public.companies WHERE id = ''%s'';', c, v, l, i, c);
  PERFORM dblink_exec(conn1, cleanup_sql);
  PERFORM dblink_disconnect(conn1);
  PERFORM dblink_disconnect(conn2);
EXCEPTION WHEN OTHERS THEN
  -- Never leave externally committed fixtures behind when an assertion fails.
  IF conn1 = ANY(coalesce(dblink_get_connections(), ARRAY[]::text[])) THEN
    BEGIN PERFORM dblink_cancel_query(conn1); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM dblink_get_result(conn1); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF conn2 = ANY(coalesce(dblink_get_connections(), ARRAY[]::text[])) THEN
    BEGIN PERFORM dblink_cancel_query(conn2); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM dblink_get_result(conn2); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  -- Both racing transactions are drained/cancelled before cleanup, so the
  -- cleanup connection can never wait on the other dblink session.
  IF conn1 = ANY(coalesce(dblink_get_connections(), ARRAY[]::text[])) THEN
    BEGIN PERFORM dblink_exec(conn1, format('DELETE FROM public.whatsapp_send_attempts WHERE company_id = ''%s'' AND idempotency_key = ''race-key''; DELETE FROM public.conversations WHERE id = ''%s''; DELETE FROM public.leads WHERE id = ''%s''; DELETE FROM public.integrations WHERE id = ''%s''; DELETE FROM public.companies WHERE id = ''%s'';', c, v, l, i, c)); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM dblink_disconnect(conn1); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF conn2 = ANY(coalesce(dblink_get_connections(), ARRAY[]::text[])) THEN
    BEGIN PERFORM dblink_disconnect(conn2); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RAISE;
END $$;

ROLLBACK;
