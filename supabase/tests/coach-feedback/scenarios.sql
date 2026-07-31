\set ON_ERROR_STOP on
\pset pager off

-- Fixtures: duas empresas reais e isoladas, dois usuários autenticados.
INSERT INTO public.profiles (id, company_id) VALUES
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),  -- user A / company A
  ('22222222-2222-2222-2222-222222222222','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');  -- user B / company B

INSERT INTO public.coach_learnings (id, company_id) VALUES
  ('b0000000-0000-0000-0000-000000000001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('b0000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

INSERT INTO public.coach_suggestions (id, company_id, learning_ids_used) VALUES
  ('5b000000-0000-0000-0000-0000000000b1','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   ARRAY['b0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002']::uuid[]);

INSERT INTO public.coach_learning_retrievals (company_id, learning_id, generation_ref, rank, final_score) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','b0000000-0000-0000-0000-000000000001','5b000000-0000-0000-0000-0000000000b1',1,90),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','b0000000-0000-0000-0000-000000000002','5b000000-0000-0000-0000-0000000000b1',2,70);

\echo '=== C. CROSS-TENANT: usuário da empresa A avalia sugestão da empresa B ==='
SET test.uid = '11111111-1111-1111-1111-111111111111';
DO $$
DECLARE v_msg text; v_state text;
BEGIN
  PERFORM public.submit_coach_suggestion_feedback_v2(
    '5b000000-0000-0000-0000-0000000000b1'::uuid, 'positive', 'coach_panel');
  RAISE EXCEPTION 'FALHA: cross-tenant NAO foi bloqueado';
EXCEPTION WHEN SQLSTATE '42501' THEN
  GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  RAISE NOTICE 'OK bloqueado (42501): %', v_msg;
END $$;

SELECT 'cross_tenant_no_write' AS check,
       (SELECT feedback_status IS NULL AND feedback_user_id IS NULL
          FROM public.coach_suggestions WHERE id='5b000000-0000-0000-0000-0000000000b1') AS suggestion_untouched,
       (SELECT count(*) FROM public.coach_learnings
         WHERE feedback_sample_count <> 0 OR confidence <> 0.700 OR success_rate <> 0.5000) AS learnings_changed,
       (SELECT count(*) FROM public.coach_learning_feedback_events) AS audit_rows;

\echo '=== D. FALHA PARCIAL DE MÉTRICA (metricsFailed) ==='
-- Constraint temporária: qualquer UPDATE no learning 2 falha.
CREATE FUNCTION public.tmp_fail_learning2() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id = 'b0000000-0000-0000-0000-000000000002' THEN
    RAISE EXCEPTION 'tmp_injected_metric_failure' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tmp_fail_l2 BEFORE UPDATE ON public.coach_learnings
  FOR EACH ROW EXECUTE FUNCTION public.tmp_fail_learning2();

SET test.uid = '22222222-2222-2222-2222-222222222222';
SELECT public.submit_coach_suggestion_feedback_v2(
  '5b000000-0000-0000-0000-0000000000b1'::uuid, 'positive', 'coach_panel') AS partial_failure_result;

SELECT 'partial_failure_state' AS check,
       (SELECT feedback_status FROM public.coach_suggestions WHERE id='5b000000-0000-0000-0000-0000000000b1') AS feedback_saved,
       (SELECT feedback_sample_count FROM public.coach_learnings WHERE id='b0000000-0000-0000-0000-000000000001') AS l1_samples,
       (SELECT feedback_sample_count FROM public.coach_learnings WHERE id='b0000000-0000-0000-0000-000000000002') AS l2_samples_should_be_0,
       (SELECT count(*) FROM public.coach_learning_feedback_events) AS audit_rows;

DROP TRIGGER tmp_fail_l2 ON public.coach_learnings;
DROP FUNCTION public.tmp_fail_learning2();

\echo '=== D2. Após remover a falha injetada, o restante volta a processar ==='
SELECT public.submit_coach_suggestion_feedback_v2(
  '5b000000-0000-0000-0000-0000000000b1'::uuid, 'negative', 'coach_panel') AS recovery_result;

SELECT 'recovery_state' AS check,
       (SELECT feedback_sample_count FROM public.coach_learnings WHERE id='b0000000-0000-0000-0000-000000000002') AS l2_samples_now,
       (SELECT count(*) FROM public.coach_learning_feedback_events) AS audit_rows;

\echo '=== B. Chamada sem autenticação (anon) ==='
SET test.uid = '';
DO $$
BEGIN
  PERFORM public.submit_coach_suggestion_feedback_v2(
    '5b000000-0000-0000-0000-0000000000b1'::uuid, 'positive', 'coach_panel');
  RAISE EXCEPTION 'FALHA: chamada sem auth.uid() NAO foi bloqueada';
EXCEPTION WHEN SQLSTATE '42501' THEN
  RAISE NOTICE 'OK bloqueado sem sessão (42501)';
END $$;
