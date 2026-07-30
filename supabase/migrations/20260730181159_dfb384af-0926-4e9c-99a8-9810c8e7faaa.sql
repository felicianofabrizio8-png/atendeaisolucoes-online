-- Isolamento de falhas: a avaliação do vendedor é o dado de negócio que NÃO
-- pode se perder. Métricas de aprendizado são derivadas e reconstituíveis.
-- Portanto cada atualização de aprendizado roda em subtransação própria:
-- um erro isolado não derruba a avaliação nem os outros aprendizados.
CREATE OR REPLACE FUNCTION public.submit_coach_suggestion_feedback_v2(
  _suggestion_id uuid,
  _feedback      text,
  _source        text DEFAULT 'coach_panel'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user       uuid := auth.uid();
  v_company    uuid;
  v_sug        public.coach_suggestions;
  v_new        text;
  v_prev       text;
  v_transition text;
  v_affected   int := 0;
  v_metrics    int := 0;
  v_audits     int := 0;
  v_failed     int := 0;
  r            record;
  v_w          numeric;
  v_pw         numeric;
  v_nw         numeric;
  v_pc         int;
  v_nc         int;
  v_sc         int;
  v_sr_before  numeric;
  v_sr_after   numeric;
  v_cf_before  numeric;
  v_cf_after   numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'coach_feedback_unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_new := CASE WHEN _feedback = 'cleared' THEN NULL ELSE _feedback END;
  IF v_new IS NOT NULL AND v_new NOT IN ('positive','negative') THEN
    RAISE EXCEPTION 'coach_feedback_invalid_status' USING ERRCODE = '22023';
  END IF;

  SELECT company_id INTO v_company FROM public.profiles WHERE id = v_user;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'coach_feedback_no_company' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sug FROM public.coach_suggestions
   WHERE id = _suggestion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coach_feedback_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_sug.company_id <> v_company THEN
    RAISE EXCEPTION 'coach_feedback_cross_tenant' USING ERRCODE = '42501';
  END IF;

  v_prev := v_sug.feedback_status;

  IF v_prev IS NOT DISTINCT FROM v_new THEN
    RETURN jsonb_build_object(
      'ok', true, 'suggestionId', _suggestion_id,
      'previousFeedback', v_prev, 'currentFeedback', v_new,
      'changed', false, 'affectedLearnings', 0,
      'metricsUpdated', 0, 'metricsFailed', 0, 'auditEventsCreated', 0
    );
  END IF;

  v_transition := COALESCE(v_prev,'none') || '->' || COALESCE(v_new,'none');

  -- Avaliação persistida PRIMEIRO e fora de qualquer bloco que possa abortar.
  UPDATE public.coach_suggestions
     SET feedback_status     = v_new,
         feedback_user_id    = CASE WHEN v_new IS NULL THEN NULL ELSE v_user END,
         feedback_created_at = CASE WHEN v_new IS NULL THEN NULL ELSE now() END
   WHERE id = _suggestion_id;

  BEGIN
    FOR r IN
      SELECT l.id, l.confidence,
             l.positive_feedback_count, l.negative_feedback_count,
             l.positive_feedback_weight, l.negative_feedback_weight,
             l.success_rate,
             ret.rank, ret.final_score
        FROM public.coach_learnings l
        LEFT JOIN public.coach_learning_retrievals ret
               ON ret.learning_id = l.id
              AND ret.generation_ref = _suggestion_id::text
       WHERE l.company_id = v_company
         AND l.status <> 'archived'
         AND (
           EXISTS (SELECT 1 FROM public.coach_learning_retrievals r2
                    WHERE r2.learning_id = l.id
                      AND r2.generation_ref = _suggestion_id::text
                      AND r2.company_id = v_company)
           OR l.id = ANY(v_sug.learning_ids_used)
         )
    LOOP
      v_affected := v_affected + 1;

      -- Subtransação por aprendizado.
      BEGIN
        v_w := public.coach_feedback_event_weight(r.rank, r.final_score);

        v_pc := r.positive_feedback_count;
        v_nc := r.negative_feedback_count;
        v_pw := r.positive_feedback_weight;
        v_nw := r.negative_feedback_weight;

        IF v_prev = 'positive' THEN
          v_pc := GREATEST(0, v_pc - 1); v_pw := GREATEST(0, v_pw - v_w);
        ELSIF v_prev = 'negative' THEN
          v_nc := GREATEST(0, v_nc - 1); v_nw := GREATEST(0, v_nw - v_w);
        END IF;
        IF v_new = 'positive' THEN
          v_pc := v_pc + 1; v_pw := v_pw + v_w;
        ELSIF v_new = 'negative' THEN
          v_nc := v_nc + 1; v_nw := v_nw + v_w;
        END IF;

        v_sc        := v_pc + v_nc;
        v_sr_before := r.success_rate;
        v_cf_before := r.confidence;
        v_sr_after  := public.coach_feedback_success_rate(v_pw, v_nw);
        v_cf_after  := public.coach_feedback_confidence(v_sr_after, v_sc);

        UPDATE public.coach_learnings
           SET positive_feedback_count   = v_pc,
               negative_feedback_count   = v_nc,
               feedback_sample_count     = v_sc,
               positive_feedback_weight  = v_pw,
               negative_feedback_weight  = v_nw,
               success_rate              = v_sr_after,
               confidence                = v_cf_after,
               last_feedback_at          = now(),
               last_positive_feedback_at = CASE WHEN v_new = 'positive'
                                                THEN now() ELSE last_positive_feedback_at END,
               last_negative_feedback_at = CASE WHEN v_new = 'negative'
                                                THEN now() ELSE last_negative_feedback_at END
         WHERE id = r.id;
        v_metrics := v_metrics + 1;

        INSERT INTO public.coach_learning_feedback_events (
          company_id, learning_id, suggestion_id, actor_user_id,
          previous_feedback, new_feedback, transition, event_weight,
          rank, final_score,
          confidence_before, confidence_after,
          success_rate_before, success_rate_after, source
        ) VALUES (
          v_company, r.id, _suggestion_id, v_user,
          v_prev, v_new, v_transition, v_w,
          r.rank, r.final_score,
          v_cf_before, v_cf_after,
          v_sr_before, v_sr_after, COALESCE(_source, 'coach_panel')
        );
        v_audits := v_audits + 1;
      EXCEPTION WHEN OTHERS THEN
        -- Sem PII no log: apenas identificadores e SQLSTATE.
        v_failed := v_failed + 1;
        RAISE WARNING 'coach_feedback_metric_failed learning=% sqlstate=%',
          r.id, SQLSTATE;
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'coach_feedback_attribution_failed suggestion=% sqlstate=%',
      _suggestion_id, SQLSTATE;
  END;

  RETURN jsonb_build_object(
    'ok', true, 'suggestionId', _suggestion_id,
    'previousFeedback', v_prev, 'currentFeedback', v_new,
    'changed', true, 'affectedLearnings', v_affected,
    'metricsUpdated', v_metrics, 'metricsFailed', v_failed,
    'auditEventsCreated', v_audits
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_coach_suggestion_feedback_v2(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_coach_suggestion_feedback_v2(uuid, text, text) TO authenticated;