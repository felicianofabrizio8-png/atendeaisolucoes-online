BEGIN;

-- Opt-in independente do shadow: empresas atuais permanecem com o pipeline original.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS consultative_sales_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.company_settings.consultative_sales_enabled IS
  'Opt-in por empresa para usar memória comercial consultiva na orientação da resposta; não habilita ações nem envio.';

COMMIT;

-- Rollback manual, somente depois de remover qualquer leitura da aplicação:
-- BEGIN;
-- ALTER TABLE public.company_settings
--   DROP COLUMN IF EXISTS consultative_sales_enabled;
-- COMMIT;
