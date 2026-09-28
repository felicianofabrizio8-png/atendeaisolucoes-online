-- Follow-up grava em ai_flow_events desde a Fase A, mas o CHECK da coluna
-- nunca incluiu esses tipos: os inserts falhavam em silêncio e a trilha
-- operacional do follow-up ficava vazia. Mantém a lista atual e acrescenta
-- somente os eventos que o código emite:
--   src/lib/followup/dispatch.ts   followup_sent, followup_simulated,
--                                  followup_failed, template_missing
--   src/lib/followup/reconcile.ts  followup_responded, lead_recovered
--   cancel_pending_followups_on_reply (trigger em messages)
--                                  followup_auto_cancelled
-- Nenhuma linha existente viola a nova lista: ela só amplia a anterior.
BEGIN;

ALTER TABLE public.ai_flow_events
  DROP CONSTRAINT IF EXISTS ai_flow_events_event_type_check;

ALTER TABLE public.ai_flow_events
  ADD CONSTRAINT ai_flow_events_event_type_check
  CHECK (
    event_type = ANY (
      ARRAY[
        'auto_reply_sent',
        'handoff_human',
        'detected_city',
        'detected_pool_size',
        'detected_intent',
        'ai_flow_step',
        'safety_block',
        'skipped_business_hours',
        'skipped_human_active',
        'skipped_disabled',
        'skipped_rate_limit',
        'agent_error',
        'trigger_enqueued',
        'followup_sent',
        'followup_simulated',
        'followup_failed',
        'template_missing',
        'followup_responded',
        'lead_recovered',
        'followup_auto_cancelled'
      ]::text[]
    )
  );

COMMIT;
