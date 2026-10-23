-- Bruna-only renewable leases with monotonic fencing.
-- This migration is intentionally additive. It does not alter runtime_locks or
-- any existing runtime RPC.

CREATE TABLE IF NOT EXISTS public.bruna_adapter_leases (
  company_id uuid NOT NULL,
  lease_key text NOT NULL,
  owner_id text NOT NULL,
  fence_token bigint NOT NULL DEFAULT 0,
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  PRIMARY KEY (company_id, lease_key)
);

CREATE INDEX IF NOT EXISTS bruna_adapter_leases_expires_idx
  ON public.bruna_adapter_leases (expires_at)
  WHERE released_at IS NULL;

ALTER TABLE public.bruna_adapter_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bruna_adapter_leases FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bruna_lease_acquire_v1(
  _lease_key text,
  _owner_id text,
  _ttl_seconds integer,
  _company_id uuid
) RETURNS TABLE(acquired boolean, fence_token bigint, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_expires timestamptz := v_now + make_interval(secs => GREATEST(1, _ttl_seconds));
BEGIN
  IF _company_id IS NULL
     OR NULLIF(btrim(_lease_key), '') IS NULL
     OR NULLIF(btrim(_owner_id), '') IS NULL THEN
    RETURN QUERY SELECT false, NULL::bigint, NULL::timestamptz;
    RETURN;
  END IF;

  INSERT INTO public.bruna_adapter_leases AS lease
    (lease_key, owner_id, company_id, fence_token, acquired_at, expires_at, released_at)
  VALUES (_lease_key, _owner_id, _company_id, 1, v_now, v_expires, NULL)
  ON CONFLICT (company_id, lease_key) DO UPDATE
    SET owner_id = EXCLUDED.owner_id,
        fence_token = lease.fence_token + 1,
        acquired_at = EXCLUDED.acquired_at,
        expires_at = EXCLUDED.expires_at,
        released_at = NULL
    WHERE lease.released_at IS NOT NULL
       OR lease.expires_at <= v_now
  RETURNING true, lease.fence_token, lease.expires_at
  INTO acquired, fence_token, expires_at;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::bigint, NULL::timestamptz;
  ELSE
    RETURN NEXT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.bruna_lease_renew_v1(
  _lease_key text,
  _owner_id text,
  _fence_token bigint,
  _ttl_seconds integer,
  _company_id uuid
) RETURNS TABLE(renewed boolean, fence_token bigint, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_expires timestamptz := v_now + make_interval(secs => GREATEST(1, _ttl_seconds));
BEGIN
  UPDATE public.bruna_adapter_leases AS lease
     SET expires_at = v_expires
   WHERE lease.lease_key = _lease_key
     AND lease.company_id = _company_id
     AND lease.owner_id = _owner_id
     AND lease.fence_token = _fence_token
     AND lease.released_at IS NULL
     AND lease.expires_at > v_now
  RETURNING true, lease.fence_token, lease.expires_at
  INTO renewed, fence_token, expires_at;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::bigint, NULL::timestamptz;
  ELSE
    RETURN NEXT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.bruna_lease_validate_v1(
  _lease_key text,
  _owner_id text,
  _fence_token bigint,
  _company_id uuid
) RETURNS TABLE(valid boolean, fence_token bigint, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  SELECT true, l.fence_token, l.expires_at
    FROM public.bruna_adapter_leases AS l
   WHERE l.lease_key = _lease_key
     AND l.company_id = _company_id
     AND l.owner_id = _owner_id
     AND l.fence_token = _fence_token
     AND l.released_at IS NULL
     AND l.expires_at > clock_timestamp();

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::bigint, NULL::timestamptz;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.bruna_lease_release_v1(
  _lease_key text,
  _owner_id text,
  _fence_token bigint,
  _company_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.bruna_adapter_leases AS lease
     SET released_at = clock_timestamp()
   WHERE lease.lease_key = _lease_key
     AND lease.company_id = _company_id
     AND lease.owner_id = _owner_id
     AND lease.fence_token = _fence_token
     AND lease.released_at IS NULL;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.bruna_lease_acquire_v1(text, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bruna_lease_acquire_v1(text, text, integer, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.bruna_lease_renew_v1(text, text, bigint, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bruna_lease_renew_v1(text, text, bigint, integer, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.bruna_lease_validate_v1(text, text, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bruna_lease_validate_v1(text, text, bigint, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.bruna_lease_release_v1(text, text, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bruna_lease_release_v1(text, text, bigint, uuid) TO service_role;
