
-- Audio Library — Fase de melhorias: dedupe (sha256) + plano da empresa (quota).

-- 1) Coluna sha256 na audio_library (hex SHA-256 do arquivo)
ALTER TABLE public.audio_library
  ADD COLUMN IF NOT EXISTS sha256 text;

-- Unicidade por empresa: dois áudios idênticos da mesma empresa são bloqueados.
-- Nulos são permitidos (registros antigos não têm hash) e não colidem.
CREATE UNIQUE INDEX IF NOT EXISTS audio_library_company_sha256_unique
  ON public.audio_library (company_id, sha256)
  WHERE sha256 IS NOT NULL;

-- 2) Plano da empresa (starter / pro / enterprise). Sem cobrança nesta fase,
--    apenas arquitetura de quota.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'starter';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_schema='public'
       AND constraint_name='companies_plan_tier_check'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_plan_tier_check
      CHECK (plan_tier IN ('starter','pro','enterprise'));
  END IF;
END $$;
