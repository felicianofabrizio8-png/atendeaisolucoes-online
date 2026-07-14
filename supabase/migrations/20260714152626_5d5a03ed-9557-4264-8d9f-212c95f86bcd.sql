
UPDATE public.company_settings
   SET runtime_autonomy_enabled = true,
       runtime_scheduler_enabled = true,
       runtime_business_brain_enabled = true,
       runtime_kill_switch = false,
       runtime_updated_at = now()
 WHERE company_id = '3a7e989c-2e1c-425d-8fc6-0feecbeb48fd';
