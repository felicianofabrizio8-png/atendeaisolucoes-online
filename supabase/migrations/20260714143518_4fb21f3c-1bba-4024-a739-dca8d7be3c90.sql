UPDATE public.company_settings
   SET runtime_autonomy_enabled       = true,
       runtime_scheduler_enabled      = true,
       runtime_business_brain_enabled = true,
       runtime_kill_switch            = false,
       updated_at                     = now()
 WHERE company_id = '3a7e989c-2e1c-425d-8fc6-0feecbeb48fd';

-- Trilha de auditoria da ativação manual (Etapa 17B).
INSERT INTO public.audit_log (company_id, user_id, action, entity, entity_id, before, after)
VALUES (
  '3a7e989c-2e1c-425d-8fc6-0feecbeb48fd',
  NULL,
  'runtime_autonomy_manual_activation',
  'company_settings',
  '3a7e989c-2e1c-425d-8fc6-0feecbeb48fd',
  jsonb_build_object('runtime_business_brain_enabled', false, 'runtime_kill_switch', true),
  jsonb_build_object('runtime_business_brain_enabled', true, 'runtime_kill_switch', false, 'stage', 'etapa_17b_validation')
);