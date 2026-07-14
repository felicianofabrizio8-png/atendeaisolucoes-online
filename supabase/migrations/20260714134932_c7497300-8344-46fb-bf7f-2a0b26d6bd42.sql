UPDATE public.agent_jobs
   SET status = 'cancelled',
       finished_at = now(),
       last_error = 'orphan_legacy_job_type_prefix_runtime_no_consumer',
       locked_at = NULL,
       locked_by = NULL,
       updated_at = now()
 WHERE status = 'pending'
   AND attempts = 0
   AND job_type LIKE 'runtime:%'
   AND created_at < '2026-07-13 22:00:00+00';