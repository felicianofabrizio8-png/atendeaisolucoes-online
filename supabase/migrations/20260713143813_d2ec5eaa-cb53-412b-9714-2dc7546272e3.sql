-- 1) Remove policy de INSERT direto do frontend. Gravação passa a ser exclusiva do server-side (service_role).
DROP POLICY IF EXISTS "admins insert scientific_memory of own company" ON public.scientific_memory;
REVOKE INSERT ON public.scientific_memory FROM authenticated;

-- 2) Idempotência: chave determinística por dia/período/versão/fingerprint.
ALTER TABLE public.scientific_memory
  ADD COLUMN IF NOT EXISTS memory_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  ADD COLUMN IF NOT EXISTS source_fingerprint TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS scientific_memory_dedupe_key
  ON public.scientific_memory (company_id, period, version, memory_date, source_fingerprint);
