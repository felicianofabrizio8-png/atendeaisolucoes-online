UPDATE public.company_settings
   SET runtime_autonomy_enabled       = false,
       runtime_scheduler_enabled      = false,
       runtime_business_brain_enabled = false,
       runtime_kill_switch            = true,
       updated_at                     = now()
 WHERE company_id = '3a7e989c-2e1c-425d-8fc6-0feecbeb48fd';

INSERT INTO public.audit_log (company_id, user_id, action, entity, entity_id, before, after)
VALUES (
  '3a7e989c-2e1c-425d-8fc6-0feecbeb48fd',
  NULL,
  'runtime_autonomy_manual_deactivation',
  'company_settings',
  '3a7e989c-2e1c-425d-8fc6-0feecbeb48fd',
  jsonb_build_object('runtime_business_brain_enabled', true, 'runtime_kill_switch', false),
  jsonb_build_object('runtime_business_brain_enabled', false, 'runtime_kill_switch', true, 'stage', 'etapa_17b_completed', 'proof_job_id', '496576c3-8938-4aef-9055-416beac6c222')
);