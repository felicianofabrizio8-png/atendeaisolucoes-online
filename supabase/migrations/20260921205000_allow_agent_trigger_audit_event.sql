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
        'trigger_enqueued'
      ]::text[]
    )
  );

COMMIT;
