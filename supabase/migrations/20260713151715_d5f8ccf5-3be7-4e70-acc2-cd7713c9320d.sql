
-- ============================================================================
-- Enterprise Hardening Phase 1 — Infrastructure tables
-- All tables are company-isolated, admin-read + service-role-write only.
-- No operational consumer changes.
-- ============================================================================

-- ---------- agent_jobs ----------
CREATE TABLE public.agent_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority INT NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed','cancelled','dead_letter')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  last_error TEXT,
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.agent_jobs TO authenticated;
GRANT ALL ON public.agent_jobs TO service_role;

ALTER TABLE public.agent_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_jobs admin read"
  ON public.agent_jobs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), company_id, 'admin'::app_role));

CREATE INDEX idx_agent_jobs_company_status
  ON public.agent_jobs (company_id, status);
CREATE INDEX idx_agent_jobs_status_available
  ON public.agent_jobs (status, available_at)
  WHERE status = 'pending';
CREATE INDEX idx_agent_jobs_priority_available
  ON public.agent_jobs (priority, available_at)
  WHERE status = 'pending';
CREATE UNIQUE INDEX uniq_agent_jobs_dedupe_active
  ON public.agent_jobs (company_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('pending','processing');

CREATE TRIGGER agent_jobs_set_updated_at
  BEFORE UPDATE ON public.agent_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Dequeue: atomic pick + lock (single worker gets a given row).
CREATE OR REPLACE FUNCTION public.dequeue_agent_job(
  _worker_id TEXT,
  _job_types TEXT[],
  _lock_seconds INT DEFAULT 300
)
RETURNS SETOF public.agent_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT j.id
      FROM public.agent_jobs j
     WHERE j.status = 'pending'
       AND j.available_at <= now()
       AND (_job_types IS NULL OR array_length(_job_types,1) IS NULL OR j.job_type = ANY(_job_types))
     ORDER BY j.priority ASC, j.available_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.agent_jobs u
     SET status      = 'processing',
         attempts    = u.attempts + 1,
         locked_at   = now(),
         locked_by   = _worker_id,
         started_at  = COALESCE(u.started_at, now()),
         available_at = now() + make_interval(secs => _lock_seconds)
    FROM picked
   WHERE u.id = picked.id
  RETURNING u.*;
END;
$$;

REVOKE ALL ON FUNCTION public.dequeue_agent_job(TEXT, TEXT[], INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dequeue_agent_job(TEXT, TEXT[], INT) TO service_role;

-- Complete/fail with retry+backoff decision inside DB (single source of truth).
CREATE OR REPLACE FUNCTION public.complete_agent_job(
  _job_id UUID,
  _worker_id TEXT,
  _success BOOLEAN,
  _error TEXT DEFAULT NULL,
  _backoff_seconds INT DEFAULT NULL
)
RETURNS public.agent_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.agent_jobs;
BEGIN
  SELECT * INTO v_row FROM public.agent_jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job % not found', _job_id;
  END IF;
  IF v_row.locked_by IS DISTINCT FROM _worker_id THEN
    RAISE EXCEPTION 'job % not owned by worker %', _job_id, _worker_id;
  END IF;

  IF _success THEN
    UPDATE public.agent_jobs
       SET status = 'completed',
           finished_at = now(),
           last_error = NULL,
           locked_at = NULL,
           locked_by = NULL
     WHERE id = _job_id
     RETURNING * INTO v_row;
  ELSE
    IF v_row.attempts >= v_row.max_attempts THEN
      UPDATE public.agent_jobs
         SET status = 'dead_letter',
             finished_at = now(),
             last_error = _error,
             locked_at = NULL,
             locked_by = NULL
       WHERE id = _job_id
       RETURNING * INTO v_row;
    ELSE
      UPDATE public.agent_jobs
         SET status = 'pending',
             last_error = _error,
             locked_at = NULL,
             locked_by = NULL,
             available_at = now() + make_interval(secs => COALESCE(_backoff_seconds, LEAST(3600, 15 * (2 ^ v_row.attempts)::int)))
       WHERE id = _job_id
       RETURNING * INTO v_row;
    END IF;
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_agent_job(UUID, TEXT, BOOLEAN, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_agent_job(UUID, TEXT, BOOLEAN, TEXT, INT) TO service_role;

-- ---------- rate_limit_counters ----------
CREATE TABLE public.rate_limit_counters (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_seconds INT NOT NULL,
  count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.rate_limit_counters TO authenticated;
GRANT ALL ON public.rate_limit_counters TO service_role;

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rate_limit admin read"
  ON public.rate_limit_counters FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), company_id, 'admin'::app_role));

CREATE UNIQUE INDEX uniq_rate_limit_window
  ON public.rate_limit_counters (company_id, bucket, window_seconds, window_start);
CREATE INDEX idx_rate_limit_lookup
  ON public.rate_limit_counters (company_id, bucket, window_start DESC);

CREATE TRIGGER rate_limit_set_updated_at
  BEFORE UPDATE ON public.rate_limit_counters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Atomic increment helper (upsert + return new count).
CREATE OR REPLACE FUNCTION public.rate_limit_increment(
  _company_id UUID,
  _bucket TEXT,
  _window_start TIMESTAMPTZ,
  _window_seconds INT,
  _increment BIGINT DEFAULT 1
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  INSERT INTO public.rate_limit_counters (company_id, bucket, window_start, window_seconds, count)
  VALUES (_company_id, _bucket, _window_start, _window_seconds, _increment)
  ON CONFLICT (company_id, bucket, window_seconds, window_start)
  DO UPDATE SET count = public.rate_limit_counters.count + EXCLUDED.count,
                updated_at = now()
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_increment(UUID, TEXT, TIMESTAMPTZ, INT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_increment(UUID, TEXT, TIMESTAMPTZ, INT, BIGINT) TO service_role;

-- ---------- billing_usage_events ----------
CREATE TABLE public.billing_usage_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  value BIGINT NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'count',
  provider TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_day DATE GENERATED ALWAYS AS ((occurred_at AT TIME ZONE 'UTC')::date) STORED,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.billing_usage_events TO authenticated;
GRANT ALL ON public.billing_usage_events TO service_role;

ALTER TABLE public.billing_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing admin read"
  ON public.billing_usage_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), company_id, 'admin'::app_role));

CREATE INDEX idx_billing_company_day
  ON public.billing_usage_events (company_id, period_day DESC);
CREATE INDEX idx_billing_company_metric_day
  ON public.billing_usage_events (company_id, metric, period_day DESC);

-- ---------- system_health_samples ----------
CREATE TABLE public.system_health_samples (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_health_samples TO authenticated;
GRANT ALL ON public.system_health_samples TO service_role;

ALTER TABLE public.system_health_samples ENABLE ROW LEVEL SECURITY;

-- Global samples (company_id NULL) readable by any admin; company samples by admin of that company.
CREATE POLICY "system_health admin read"
  ON public.system_health_samples FOR SELECT
  TO authenticated
  USING (
    company_id IS NULL
    OR public.has_role(auth.uid(), company_id, 'admin'::app_role)
  );

CREATE INDEX idx_health_metric_time
  ON public.system_health_samples (metric, collected_at DESC);
CREATE INDEX idx_health_company_time
  ON public.system_health_samples (company_id, collected_at DESC);

-- ---------- upload_hashes ----------
CREATE TABLE public.upload_hashes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL,
  object_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  mime TEXT,
  magic_family TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.upload_hashes TO authenticated;
GRANT ALL ON public.upload_hashes TO service_role;

ALTER TABLE public.upload_hashes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "upload_hashes admin read"
  ON public.upload_hashes FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), company_id, 'admin'::app_role));

CREATE UNIQUE INDEX uniq_upload_hash_per_company
  ON public.upload_hashes (company_id, sha256);
CREATE INDEX idx_upload_hash_bucket_path
  ON public.upload_hashes (bucket, object_path);

-- ---------- http_audit_log ----------
CREATE TABLE public.http_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INT,
  duration_ms INT,
  outcome TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.http_audit_log TO authenticated;
GRANT ALL ON public.http_audit_log TO service_role;

ALTER TABLE public.http_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "http_audit admin read"
  ON public.http_audit_log FOR SELECT
  TO authenticated
  USING (
    company_id IS NOT NULL
    AND public.has_role(auth.uid(), company_id, 'admin'::app_role)
  );

CREATE INDEX idx_http_audit_company_time
  ON public.http_audit_log (company_id, created_at DESC);
CREATE INDEX idx_http_audit_path_time
  ON public.http_audit_log (path, created_at DESC);
