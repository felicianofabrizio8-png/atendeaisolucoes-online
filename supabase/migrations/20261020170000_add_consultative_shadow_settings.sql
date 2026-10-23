BEGIN;

-- Opt-in estrito: empresas existentes permanecem desligadas.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS consultative_shadow_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consultative_capability_profile jsonb;

COMMENT ON COLUMN public.company_settings.consultative_shadow_enabled IS
  'Opt-in por empresa para observacao consultiva shadow; false preserva o comportamento atual.';
COMMENT ON COLUMN public.company_settings.consultative_capability_profile IS
  'Perfil JSON de capacidades consultivas autorizado para esta empresa; null usa o perfil shadow seguro padrao.';

COMMIT;

-- Reversao manual, somente apos confirmar que nenhuma aplicacao depende das colunas:
-- ALTER TABLE public.company_settings
--   DROP COLUMN IF EXISTS consultative_capability_profile,
--   DROP COLUMN IF EXISTS consultative_shadow_enabled;
