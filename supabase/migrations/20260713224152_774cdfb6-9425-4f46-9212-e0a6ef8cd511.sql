
-- ============================================================================
-- 1. company_settings: colunas de runtime
-- ============================================================================
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS runtime_autonomy_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS runtime_system_health_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS runtime_kill_switch boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS runtime_scheduler_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS runtime_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS runtime_updated_by uuid;

-- ============================================================================
-- 2. runtime_dedupe: impede execuções duplicadas entre isolates
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.runtime_dedupe (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid,
  operation text NOT NULL,
  resource_key text NOT NULL,
  bucket bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS runtime_dedupe_key_uidx
  ON public.runtime_dedupe (operation, resource_key, bucket, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS runtime_dedupe_expires_idx
  ON public.runtime_dedupe (expires_at);

GRANT SELECT ON public.runtime_dedupe TO authenticated;
GRANT ALL ON public.runtime_dedupe TO service_role;

ALTER TABLE public.runtime_dedupe ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read own tenant dedupe"
  ON public.runtime_dedupe
  FOR SELECT
  TO authenticated
  USING (
    company_id IS NOT NULL
    AND public.has_role(auth.uid(), company_id, 'admin'::app_role)
  );

-- ============================================================================
-- 3. runtime_locks: locks distribuídos com TTL
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.runtime_locks (
  lock_key text NOT NULL PRIMARY KEY,
  owner_id text NOT NULL,
  company_id uuid,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz
);

CREATE INDEX IF NOT EXISTS runtime_locks_expires_idx
  ON public.runtime_locks (expires_at)
  WHERE released_at IS NULL;

GRANT SELECT ON public.runtime_locks TO authenticated;
GRANT ALL ON public.runtime_locks TO service_role;

ALTER TABLE public.runtime_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read own tenant locks"
  ON public.runtime_locks
  FOR SELECT
  TO authenticated
  USING (
    company_id IS NOT NULL
    AND public.has_role(auth.uid(), company_id, 'admin'::app_role)
  );

-- ============================================================================
-- 4. runtime_audit: auditoria técnica
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.runtime_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid,
  actor_id uuid,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runtime_audit_company_idx
  ON public.runtime_audit (company_id, created_at DESC);

GRANT SELECT ON public.runtime_audit TO authenticated;
GRANT ALL ON public.runtime_audit TO service_role;

ALTER TABLE public.runtime_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read own tenant runtime audit"
  ON public.runtime_audit
  FOR SELECT
  TO authenticated
  USING (
    company_id IS NOT NULL
    AND public.has_role(auth.uid(), company_id, 'admin'::app_role)
  );

-- ============================================================================
-- 5. RPCs internas (service_role apenas)
-- ============================================================================

-- Acquire lock atomicamente. Retorna true se adquiriu; recupera locks expirados.
CREATE OR REPLACE FUNCTION public.runtime_try_acquire_lock(
  _lock_key text,
  _owner_id text,
  _ttl_seconds integer,
  _company_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_expires timestamptz := v_now + make_interval(secs => GREATEST(1, _ttl_seconds));
BEGIN
  INSERT INTO public.runtime_locks (lock_key, owner_id, company_id, acquired_at, expires_at, released_at)
  VALUES (_lock_key, _owner_id, _company_id, v_now, v_expires, NULL)
  ON CONFLICT (lock_key) DO UPDATE
    SET owner_id    = EXCLUDED.owner_id,
        company_id  = COALESCE(EXCLUDED.company_id, public.runtime_locks.company_id),
        acquired_at = EXCLUDED.acquired_at,
        expires_at  = EXCLUDED.expires_at,
        released_at = NULL
    WHERE public.runtime_locks.released_at IS NOT NULL
       OR public.runtime_locks.expires_at <= v_now;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.runtime_release_lock(
  _lock_key text,
  _owner_id text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.runtime_locks
     SET released_at = now()
   WHERE lock_key = _lock_key
     AND owner_id = _owner_id
     AND released_at IS NULL;
  RETURN FOUND;
END;
$$;

-- Dedupe: insere chave; retorna true na PRIMEIRA vez, false se já existir.
CREATE OR REPLACE FUNCTION public.runtime_try_dedupe(
  _operation text,
  _resource_key text,
  _bucket bigint,
  _ttl_seconds integer,
  _company_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires timestamptz := now() + make_interval(secs => GREATEST(1, _ttl_seconds));
BEGIN
  INSERT INTO public.runtime_dedupe (company_id, operation, resource_key, bucket, expires_at)
  VALUES (_company_id, _operation, _resource_key, _bucket, v_expires)
  ON CONFLICT DO NOTHING;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.runtime_cleanup_expired()
RETURNS TABLE(deleted_dedupe integer, deleted_locks integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dd integer;
  v_lk integer;
BEGIN
  DELETE FROM public.runtime_dedupe WHERE expires_at < now();
  GET DIAGNOSTICS v_dd = ROW_COUNT;
  DELETE FROM public.runtime_locks WHERE expires_at < now() - interval '1 hour';
  GET DIAGNOSTICS v_lk = ROW_COUNT;
  RETURN QUERY SELECT v_dd, v_lk;
END;
$$;

-- Restringe execução a service_role
REVOKE ALL ON FUNCTION public.runtime_try_acquire_lock(text, text, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.runtime_try_acquire_lock(text, text, integer, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_try_acquire_lock(text, text, integer, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.runtime_release_lock(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.runtime_release_lock(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_release_lock(text, text) TO service_role;

REVOKE ALL ON FUNCTION public.runtime_try_dedupe(text, text, bigint, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.runtime_try_dedupe(text, text, bigint, integer, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_try_dedupe(text, text, bigint, integer, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.runtime_cleanup_expired() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.runtime_cleanup_expired() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_cleanup_expired() TO service_role;
