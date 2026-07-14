DELETE FROM public.runtime_dedupe
 WHERE operation IN ('probe-diagnose','probe-supabase-js','probe-unbound')
    OR (operation = 'runtime-tick:business-brain'
        AND resource_key = '3a7e989c-2e1c-425d-8fc6-0feecbeb48fd');