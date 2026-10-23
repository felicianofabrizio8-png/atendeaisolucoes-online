\set ON_ERROR_STOP on

-- Homologacao isolada de whatsapp_attempts_phase1.
--
-- PRE-CONDICOES:
--   * conectar explicitamente ao banco descartavel bruna_attempts_phase1_test;
--   * executar como o usuario existente bruna_test;
--   * aplicar a migration 20261022190100_whatsapp_attempts_phase1.sql antes;
--   * roles anon, authenticated e service_role ja devem existir;
--   * dblink ja deve estar instalado.
--
-- Este arquivo NAO cria roles, NAO cria a extensao dblink, NAO conecta a outro
-- banco e NAO chama WhatsApp. A fixture local e revertida pelo ROLLBACK final;
-- auth.users/profiles sao reais e nenhuma funcao auth/private e substituida.
-- A corrida dblink faz commits proprios e e limpa explicitamente antes de
-- terminar.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF current_database() <> 'bruna_attempts_phase1_test' THEN
    RAISE EXCEPTION 'ABORTADO: banco inesperado: %, esperado bruna_attempts_phase1_test', current_database();
  END IF;
  IF current_user <> 'bruna_test' THEN
    RAISE EXCEPTION 'ABORTADO: usuario inesperado: %, esperado bruna_test', current_user;
  END IF;
  IF current_setting('server_version_num')::int / 10000 <> 17 THEN
    RAISE EXCEPTION 'ABORTADO: PostgreSQL 17 e obrigatorio; encontrado %', current_setting('server_version');
  END IF;
  IF to_regclass('public.whatsapp_send_attempts') IS NULL THEN
    RAISE EXCEPTION 'migration whatsapp_attempts_phase1 nao aplicada';
  END IF;
  IF to_regprocedure('public.create_whatsapp_send_attempt(uuid,uuid,uuid,uuid,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'RPCs da migration nao encontradas';
  END IF;
  IF to_regprocedure('dblink_connect(text)') IS NULL
     OR to_regprocedure('dblink_send_query(text,text)') IS NULL THEN
    RAISE EXCEPTION 'dblink precisa estar instalado no banco de teste';
  END IF;
  IF to_regclass('auth.users') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regprocedure('private.current_company_id()') IS NULL THEN
    RAISE EXCEPTION 'auth.users, profiles e private.current_company_id() sao obrigatorios';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) <> 3 THEN
    RAISE EXCEPTION 'roles anon, authenticated e service_role precisam existir';
  END IF;
  IF NOT pg_has_role(current_user, 'authenticated', 'SET')
     OR NOT pg_has_role(current_user, 'service_role', 'SET') THEN
    RAISE EXCEPTION 'bruna_test precisa poder SET ROLE authenticated e service_role para este roteiro';
  END IF;
END
$guard$;

-- auth.uid() e private.current_company_id() permanecem as implementacoes
-- reais do banco; os usuarios abaixo sao fixtures de auth.users/profiles.
/* REMOVED: auth.jwt() mock; use the database auth function. */
/*
CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb LANGUAGE sql STABLE
AS $auth$ SELECT jsonb_build_object(
  'role', current_setting('request.jwt.claim.role', true),
  'sub',  current_setting('request.jwt.claim.sub', true),
  'company_id', current_setting('request.jwt.claim.company_id', true)
)$auth$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text LANGUAGE sql STABLE
AS $auth$ SELECT current_setting('request.jwt.claim.role', true) $auth$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $auth$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $auth$;

-- O antigo mock de private.current_company_id() foi removido: a funcao real
-- precisa resolver o tenant por auth.uid() e profiles.
*/

DO $catalog$
DECLARE
  v_fn regprocedure;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.create_whatsapp_send_attempt(uuid,uuid,uuid,uuid,text,text,jsonb)'::regprocedure,
    'public.claim_whatsapp_send_attempt(uuid,uuid)'::regprocedure,
    'public.accept_whatsapp_send_attempt(uuid,uuid,text)'::regprocedure,
    'public.complete_whatsapp_send_attempt(uuid,uuid,text)'::regprocedure,
    'public.fail_whatsapp_send_attempt(uuid,uuid,text,text)'::regprocedure,
    'public.mark_whatsapp_send_attempt_uncertain(uuid,uuid,text)'::regprocedure
  ] LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'RPC backend-only exposta: %', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role sem EXECUTE: %', v_fn;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.whatsapp_send_attempts', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated deve possuir SELECT para RLS';
  END IF;
END
$catalog$;

-- Fixture de duas empresas: os dados auxiliares sao criados pelo login real
-- bruna_test. service_role e exercitado por SET ROLE real somente nas RPCs.

DO $fixture$
DECLARE
  c1 uuid := '10000000-0000-0000-0000-000000000001';
  c2 uuid := '20000000-0000-0000-0000-000000000001';
  u1 uuid := '10000000-0000-0000-0000-000000000010';
  u2 uuid := '20000000-0000-0000-0000-000000000010';
  i1 uuid := '10000000-0000-0000-0000-000000000002';
  i2 uuid := '20000000-0000-0000-0000-000000000002';
  l1 uuid := '10000000-0000-0000-0000-000000000003';
  l2 uuid := '20000000-0000-0000-0000-000000000003';
  v1 uuid := '10000000-0000-0000-0000-000000000004';
  v2 uuid := '20000000-0000-0000-0000-000000000004';
  a public.whatsapp_send_attempts;
  first_id uuid;
BEGIN
  INSERT INTO public.companies(id, name) VALUES (c1, 'homolog phase1 A'), (c2, 'homolog phase1 B');

  -- O banco local nao possui os triggers/objetos de membership do Supabase.
  -- Criamos explicitamente somente as linhas necessarias; a funcao real
  -- private.current_company_id() continua resolvendo o tenant por auth.uid()
  -- e profiles.
  INSERT INTO auth.users
    (id, email, raw_user_meta_data, created_at)
  VALUES
    (u1, 'wa-homolog-a@example.test', '{"display_name":"Homolog A"}'::jsonb, now());
  INSERT INTO public.profiles(id, company_id, display_name, email, created_at, updated_at)
    VALUES (u1, c1, 'Homolog A', 'wa-homolog-a@example.test', now(), now())
    ON CONFLICT (id) DO UPDATE
      SET company_id = EXCLUDED.company_id,
          display_name = EXCLUDED.display_name,
          email = EXCLUDED.email,
          updated_at = EXCLUDED.updated_at;

  INSERT INTO auth.users
    (id, email, raw_user_meta_data, created_at)
  VALUES
    (u2, 'wa-homolog-b@example.test', '{"display_name":"Homolog B"}'::jsonb, now());
  INSERT INTO public.profiles(id, company_id, display_name, email, created_at, updated_at)
    VALUES (u2, c2, 'Homolog B', 'wa-homolog-b@example.test', now(), now())
    ON CONFLICT (id) DO UPDATE
      SET company_id = EXCLUDED.company_id,
          display_name = EXCLUDED.display_name,
          email = EXCLUDED.email,
          updated_at = EXCLUDED.updated_at;

  IF (SELECT count(*) FROM auth.users WHERE id IN (u1, u2)) <> 2
     OR (SELECT count(*) FROM public.profiles WHERE id IN (u1, u2)) <> 2
     OR (SELECT count(*) FROM public.profiles WHERE company_id IN (c1, c2)) <> 2 THEN
    RAISE EXCEPTION 'fixture auth.users/profiles incompleta';
  END IF;
  INSERT INTO public.integrations(id, company_id, channel, display_name)
    VALUES (i1, c1, 'whatsapp', 'homolog A'), (i2, c2, 'whatsapp', 'homolog B');
  INSERT INTO public.leads(id, company_id, name, channel)
    VALUES (l1, c1, 'homolog A', 'whatsapp'), (l2, c2, 'homolog B', 'whatsapp');
  INSERT INTO public.conversations(id, company_id, lead_id, channel)
    VALUES (v1, c1, l1, 'whatsapp'), (v2, c2, l2, 'whatsapp');

END
$fixture$;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $service_rpc$
DECLARE
  c1 uuid := '10000000-0000-0000-0000-000000000001';
  c2 uuid := '20000000-0000-0000-0000-000000000001';
  u1 uuid := '10000000-0000-0000-0000-000000000010';
  u2 uuid := '20000000-0000-0000-0000-000000000010';
  i1 uuid := '10000000-0000-0000-0000-000000000002';
  i2 uuid := '20000000-0000-0000-0000-000000000002';
  l1 uuid := '10000000-0000-0000-0000-000000000003';
  l2 uuid := '20000000-0000-0000-0000-000000000003';
  v1 uuid := '10000000-0000-0000-0000-000000000004';
  v2 uuid := '20000000-0000-0000-0000-000000000004';
  a public.whatsapp_send_attempts;
  first_id uuid;
  second_id uuid;
BEGIN
  SELECT * INTO a FROM public.create_whatsapp_send_attempt(c1, i1, v1, l1, 'same-key', 'fp-a', '{"body":"a"}');
  IF a.company_id <> c1 OR a.status <> 'queued' THEN RAISE EXCEPTION 'create/service_role falhou'; END IF;
  first_id := a.id;
  SELECT * INTO a FROM public.create_whatsapp_send_attempt(c1, i1, v1, l1, 'same-key', 'fp-a', '{"body":"a"}');
  second_id := a.id;
  IF second_id <> first_id THEN
    RAISE EXCEPTION 'idempotencia nao retornou a mesma tentativa: first_id=%, segundo_id=%',
      first_id, second_id;
  END IF;
  BEGIN
    PERFORM public.create_whatsapp_send_attempt(c1, i1, v1, l1, 'same-key', 'fp-different', '{"body":"different"}');
    RAISE EXCEPTION 'payload divergente aceito para a mesma idempotency key';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  SELECT * INTO a FROM public.create_whatsapp_send_attempt(c2, i2, v2, l2, 'same-key', 'fp-b', '{"body":"b"}');
  IF a.company_id <> c2 THEN RAISE EXCEPTION 'idempotencia vazou entre tenants'; END IF;

  BEGIN
    PERFORM public.create_whatsapp_send_attempt(c1, i2, v1, l1, 'bad-context', 'fp', '{}');
    RAISE EXCEPTION 'contexto cross-tenant aceito';
  EXCEPTION WHEN check_violation THEN NULL; END;

  SELECT * INTO a FROM public.claim_whatsapp_send_attempt(c1, first_id);
  IF a.status <> 'sending' OR a.claimed_at IS NULL THEN RAISE EXCEPTION 'queued -> sending falhou'; END IF;
  SELECT * INTO a FROM public.accept_whatsapp_send_attempt(c1, first_id, 'provider-accepted');
  IF a.status <> 'accepted' OR a.accepted_at IS NULL THEN RAISE EXCEPTION 'sending -> accepted falhou'; END IF;
  SELECT * INTO a FROM public.complete_whatsapp_send_attempt(c1, first_id, 'provider-delivered');
  IF a.status <> 'delivered' OR a.completed_at IS NULL THEN RAISE EXCEPTION 'accepted -> delivered falhou'; END IF;
  BEGIN
    PERFORM public.claim_whatsapp_send_attempt(c1, first_id);
    RAISE EXCEPTION 'tentativa entregue foi reenviada/reclamada';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;

  SELECT * INTO a FROM public.create_whatsapp_send_attempt(c1, i1, v1, l1, 'uncertain-key', 'fp-u', '{}');
  SELECT * INTO a FROM public.claim_whatsapp_send_attempt(c1, a.id);
  SELECT * INTO a FROM public.mark_whatsapp_send_attempt_uncertain(c1, a.id, 'provider timeout');
  IF a.status <> 'uncertain' OR a.completed_at IS NULL THEN RAISE EXCEPTION 'transicao uncertain falhou'; END IF;
  BEGIN
    PERFORM public.claim_whatsapp_send_attempt(c1, a.id);
    RAISE EXCEPTION 'uncertain ficou retryable/reenvio permitido';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END
$service_rpc$;

-- A cardinalidade e verificada como bruna_test: no banco local, service_role
-- nao enxerga essas linhas diretamente via RLS, embora as RPCs reais sejam
-- executadas acima com SET ROLE service_role.
SET LOCAL ROLE bruna_test;
DO $idempotency_cardinality$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n
    FROM public.whatsapp_send_attempts
   WHERE company_id = '10000000-0000-0000-0000-000000000001'
     AND idempotency_key = 'same-key';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idempotencia criou quantidade inesperada: esperado 1, obtido %', n;
  END IF;
END
$idempotency_cardinality$;

-- RLS positiva e negativa: claims distintos enxergam somente seu tenant.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000010', true);
DO $rls$
DECLARE n bigint;
BEGIN
  IF auth.uid() <> '10000000-0000-0000-0000-000000000010'
     OR private.current_company_id() <> '10000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'auth.users/profiles nao resolveram a empresa A';
  END IF;
  SELECT count(*) INTO n FROM public.whatsapp_send_attempts;
  IF n <> 2 THEN RAISE EXCEPTION 'RLS positiva falhou: esperado 2, obtido %', n; END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_send_attempts WHERE company_id <> '10000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'RLS negativa falhou: tenant cruzado visivel';
  END IF;
  BEGIN
    INSERT INTO public.whatsapp_send_attempts(company_id, integration_id, conversation_id, lead_id, idempotency_key, request_fingerprint)
      VALUES ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003','direct-auth','direct-auth');
    RAISE EXCEPTION 'authenticated inseriu diretamente';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.claim_whatsapp_send_attempt('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'authenticated executou RPC backend-only';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$rls$;

-- Um claim de outro tenant nao ve linhas, nem consegue usar uma RPC de escrita.
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000010', true);
DO $rls_negative$
BEGIN
  IF auth.uid() <> '20000000-0000-0000-0000-000000000010'
     OR private.current_company_id() <> '20000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'auth.users/profiles nao resolveram a empresa B';
  END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_send_attempts WHERE company_id = '10000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'RLS negativa falhou para segundo tenant';
  END IF;
END
$rls_negative$;

-- Corrida real em duas sessoes. As sessoes herdam bruna_test e mudam para o
-- role existente service_role; nenhuma mensagem/WhatsApp e envolvida.
SET LOCAL ROLE bruna_test;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $race$
DECLARE
  db text := format('user=bruna_test dbname=%I', current_database());
  suffix text := replace(gen_random_uuid()::text, '-', '');
  c text := '30000000-0000-0000-0000-' || substr(suffix, 1, 12);
  i text := '30000000-0000-0000-0000-' || substr(suffix, 1, 12);
  l text := '30000000-0000-0000-0000-' || substr(suffix, 1, 12);
  v text := '30000000-0000-0000-0000-' || substr(suffix, 1, 12);
  conn1 text := 'wa_homolog_1_' || suffix;
  conn2 text := 'wa_homolog_2_' || suffix;
  r1 uuid; r2 uuid; n integer := 0; cleanup text;
  count1 integer := 0; count2 integer := 0;
  busy1 integer; busy2 integer;
  query1_active boolean := false; query2_active boolean := false;
  result_id uuid; result_batch integer;
BEGIN
  PERFORM dblink_connect(conn1, db); PERFORM dblink_connect(conn2, db);
  PERFORM dblink_exec(conn1, $$SET statement_timeout = '30s'; SET lock_timeout = '5s'$$);
  PERFORM dblink_exec(conn2, $$SET statement_timeout = '30s'; SET lock_timeout = '5s'$$);
  -- A transacao principal continua aberta e pode reter locks dos seus
  -- proprios INSERTs/triggers. A fixture da corrida e isolada na conexao
  -- dblink, com cada etapa explicita, e commitada antes das RPCs; assim as
  -- duas sessoes nao dependem de locks da transacao principal nem de uma
  -- transacao de fixture ainda aberta.
  PERFORM dblink_exec(conn1, 'BEGIN');
  PERFORM dblink_exec(conn1, format($sql$INSERT INTO public.companies(id,name) VALUES ('%s','race')$sql$, c));
  PERFORM dblink_exec(conn1, format($sql$INSERT INTO public.integrations(id,company_id,channel,display_name) VALUES ('%s','%s','whatsapp','race')$sql$, i, c));
  PERFORM dblink_exec(conn1, format($sql$INSERT INTO public.leads(id,company_id,name,channel) VALUES ('%s','%s','race','whatsapp')$sql$, l, c));
  PERFORM dblink_exec(conn1, format($sql$INSERT INTO public.conversations(id,company_id,lead_id,channel) VALUES ('%s','%s','%s','whatsapp')$sql$, v, c, l));
  PERFORM dblink_exec(conn1, 'COMMIT');
  PERFORM dblink_exec(conn1, 'SET ROLE service_role'); PERFORM dblink_exec(conn2, 'SET ROLE service_role');
  PERFORM * FROM dblink(conn1, $$SELECT set_config('request.jwt.claim.role','service_role',false)$$) AS x(config text);
  PERFORM * FROM dblink(conn2, $$SELECT set_config('request.jwt.claim.role','service_role',false)$$) AS x(config text);
  PERFORM dblink_send_query(conn1, format($sql$SELECT id::text FROM public.create_whatsapp_send_attempt('%s','%s','%s','%s','race-key','race-fp','{}')$sql$,c,i,v,l));
  query1_active := true;
  PERFORM dblink_send_query(conn2, format($sql$SELECT id::text FROM public.create_whatsapp_send_attempt('%s','%s','%s','%s','race-key','race-fp','{}')$sql$,c,i,v,l));
  query2_active := true;
  -- So coletar resultados quando ambas terminaram evita que a leitura de uma
  -- conexao participe do bloqueio da outra. Erros das RPCs sao propagados.
  LOOP
    busy1 := dblink_is_busy(conn1);
    busy2 := dblink_is_busy(conn2);
    EXIT WHEN (busy1 = 0 AND busy2 = 0) OR n >= 3000;
    PERFORM pg_sleep(0.01);
    n := n + 1;
  END LOOP;
  IF busy1 = 1 OR busy2 = 1 THEN
    RAISE EXCEPTION 'corrida excedeu timeout de sincronizacao';
  END IF;
  -- dblink_get_result precisa ser chamado ate retornar zero linhas; somente
  -- entao a conexao pode ser reutilizada com dblink_exec. O primeiro UUID de
  -- cada RPC e preservado e a cardinalidade inteira e validada.
  LOOP
    result_batch := 0;
    FOR result_id IN SELECT id FROM dblink_get_result(conn1) AS x(id uuid) LOOP
      result_batch := result_batch + 1;
      count1 := count1 + 1;
      IF count1 = 1 THEN r1 := result_id; END IF;
    END LOOP;
    EXIT WHEN dblink_is_busy(conn1) = 0 AND result_batch = 0;
  END LOOP;
  query1_active := false;
  LOOP
    result_batch := 0;
    FOR result_id IN SELECT id FROM dblink_get_result(conn2) AS x(id uuid) LOOP
      result_batch := result_batch + 1;
      count2 := count2 + 1;
      IF count2 = 1 THEN r2 := result_id; END IF;
    END LOOP;
    EXIT WHEN dblink_is_busy(conn2) = 0 AND result_batch = 0;
  END LOOP;
  query2_active := false;
  IF count1 <> 1 OR count2 <> 1 OR r1 IS NULL OR r2 IS NULL OR r1 <> r2 THEN
    RAISE EXCEPTION 'concorrencia retornou cardinalidades/ids invalidos: count1=%, count2=%, id1=%, id2=%', count1, count2, r1, r2;
  END IF;
  IF (SELECT count(*) FROM public.whatsapp_send_attempts WHERE company_id = c::uuid AND idempotency_key = 'race-key') <> 1 THEN RAISE EXCEPTION 'concorrencia criou mais de uma tentativa'; END IF;
  cleanup := format('DELETE FROM public.whatsapp_send_attempts WHERE company_id = ''%s'' AND idempotency_key = ''race-key''; DELETE FROM public.conversations WHERE id = ''%s''; DELETE FROM public.leads WHERE id = ''%s''; DELETE FROM public.integrations WHERE id = ''%s''; DELETE FROM public.companies WHERE id = ''%s'';',c,v,l,i,c);
  PERFORM dblink_exec(conn1, 'SET ROLE bruna_test');
  PERFORM dblink_exec(conn1, cleanup); PERFORM dblink_disconnect(conn1); PERFORM dblink_disconnect(conn2);
EXCEPTION WHEN OTHERS THEN
  -- Primeiro cancela/draina as duas sessoes. So depois desconecta e abre uma
  -- sessao nova para cleanup; nunca limpa usando uma transacao abortada ou
  -- enquanto a outra corrida ainda segura um lock.
  IF query1_active AND conn1 = ANY(coalesce(dblink_get_connections(), ARRAY[]::text[])) THEN
    BEGIN
      IF dblink_is_busy(conn1) = 1 THEN PERFORM dblink_cancel_query(conn1); END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM dblink_get_result(conn1); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF query2_active AND conn2 = ANY(coalesce(dblink_get_connections(), ARRAY[]::text[])) THEN
    BEGIN
      IF dblink_is_busy(conn2) = 1 THEN PERFORM dblink_cancel_query(conn2); END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM dblink_get_result(conn2); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF conn1 = ANY(coalesce(dblink_get_connections(), ARRAY[]::text[])) THEN BEGIN PERFORM dblink_disconnect(conn1); EXCEPTION WHEN OTHERS THEN NULL; END; END IF;
  IF conn2 = ANY(coalesce(dblink_get_connections(), ARRAY[]::text[])) THEN BEGIN PERFORM dblink_disconnect(conn2); EXCEPTION WHEN OTHERS THEN NULL; END; END IF;
  BEGIN
    PERFORM dblink_connect(conn1, db);
    PERFORM dblink_exec(conn1, $$SET statement_timeout = '10s'; SET lock_timeout = '2s'$$);
    PERFORM dblink_exec(conn1, 'SET ROLE bruna_test');
    PERFORM dblink_exec(conn1, format('BEGIN; DELETE FROM public.whatsapp_send_attempts WHERE company_id = ''%s'' AND idempotency_key = ''race-key''; DELETE FROM public.conversations WHERE id = ''%s''; DELETE FROM public.leads WHERE id = ''%s''; DELETE FROM public.integrations WHERE id = ''%s''; DELETE FROM public.companies WHERE id = ''%s''; COMMIT;',c,v,l,i,c));
    PERFORM dblink_disconnect(conn1);
  EXCEPTION WHEN OTHERS THEN
    IF conn1 = ANY(coalesce(dblink_get_connections(), ARRAY[]::text[])) THEN BEGIN PERFORM dblink_disconnect(conn1); EXCEPTION WHEN OTHERS THEN NULL; END; END IF;
  END;
  RAISE;
END
$race$;

ROLLBACK;
\echo 'OK: homologacao whatsapp_attempts_phase1 concluida; fixture revertida.'
