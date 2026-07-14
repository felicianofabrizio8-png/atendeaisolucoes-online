
UPDATE public.company_settings
   SET runtime_autonomy_enabled = false,
       runtime_scheduler_enabled = false,
       runtime_business_brain_enabled = false,
       runtime_kill_switch = true,
       runtime_updated_at = now()
 WHERE company_id = '3a7e989c-2e1c-425d-8fc6-0feecbeb48fd';
