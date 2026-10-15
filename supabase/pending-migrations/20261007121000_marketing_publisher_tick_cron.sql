-- Agendamento da rotina de publicação do Marketing IA (publisher-tick).
--
-- A rota POST /api/public/hooks/publisher-tick processa agendamentos vencidos
-- e publica o que estiver aprovado. Ela só roda quando alguém a chama, e esse
-- agendamento não está versionado em nenhuma migration.
--
-- ANTES DE APLICAR, confira se já existe um job em produção:
--
--   SELECT jobid, jobname, schedule, active, command
--     FROM cron.job
--    WHERE command ILIKE '%publisher%tick%' OR jobname ILIKE '%publisher%';
--
--   SELECT status, return_message, start_time
--     FROM cron.job_run_details
--    WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname ILIKE '%publisher%')
--    ORDER BY start_time DESC LIMIT 10;
--
-- Se já houver um job ativo e rodando, NÃO aplique este arquivo.
--
-- Pré-requisitos (Vault):
--   PUBLISHER_TICK_SECRET  já usado pela rota (obrigatório).
--   PUBLISHER_TICK_URL     opcional; padrão: URL de produção abaixo.
--
-- Reversão:
--   SELECT cron.unschedule('marketing-publisher-tick');
--   DROP FUNCTION IF EXISTS public.invoke_publisher_tick();

CREATE OR REPLACE FUNCTION public.invoke_publisher_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_secret text;
  v_url text;
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'PUBLISHER_TICK_SECRET'
   LIMIT 1;
  IF v_secret IS NULL OR length(trim(v_secret)) = 0 THEN
    RAISE WARNING 'invoke_publisher_tick: PUBLISHER_TICK_SECRET ausente no Vault';
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
   WHERE name = 'PUBLISHER_TICK_URL'
   LIMIT 1;
  v_url := COALESCE(
    NULLIF(trim(v_url), ''),
    'https://app.atendeaisolucoes.online/api/public/hooks/publisher-tick'
  );

  RETURN net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-publisher-tick-secret', trim(v_secret)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_publisher_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_publisher_tick() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketing-publisher-tick') THEN
    PERFORM cron.unschedule('marketing-publisher-tick');
  END IF;
  -- A cada minuto. A rota tem trava própria: chamadas sobrepostas respondem 409.
  PERFORM cron.schedule(
    'marketing-publisher-tick',
    '* * * * *',
    $cron$ SELECT public.invoke_publisher_tick(); $cron$
  );
END $$;
