-- Escopo global do Atendimento 2.0 por empresa.
-- A migration é aditiva; ai_auto_reply_enabled é mantido por compatibilidade.
-- A autorização individual por conversa é a coluna já existente
-- conversations.sales_agent_auto_reply (20261004120000): um único controle por conversa.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS ai_auto_reply_scope text;

ALTER TABLE public.company_settings
  DROP CONSTRAINT IF EXISTS company_settings_ai_auto_reply_scope_check;

ALTER TABLE public.company_settings
  ADD CONSTRAINT company_settings_ai_auto_reply_scope_check
  CHECK (ai_auto_reply_scope IN ('desligado', 'teste', 'geral'));

-- Preserva o comportamento atual: quem respondia automaticamente continua em "geral".
UPDATE public.company_settings
SET ai_auto_reply_scope = CASE WHEN ai_auto_reply_enabled THEN 'geral' ELSE 'desligado' END
WHERE ai_auto_reply_scope IS NULL;

ALTER TABLE public.company_settings
  ALTER COLUMN ai_auto_reply_scope SET DEFAULT 'desligado',
  ALTER COLUMN ai_auto_reply_scope SET NOT NULL;

COMMENT ON COLUMN public.company_settings.ai_auto_reply_scope IS
  'Modo global do Atendimento 2.0 sem a Vendedora V2: desligado, teste (só conversas com sales_agent_auto_reply) ou geral.';
