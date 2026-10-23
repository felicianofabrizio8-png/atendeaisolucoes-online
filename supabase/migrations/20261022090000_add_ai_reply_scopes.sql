-- Escopo global do Atendimento 2.0 e autorização explícita por conversa.
-- A migration é aditiva; ai_auto_reply_enabled é mantido por compatibilidade.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS ai_auto_reply_scope text;

ALTER TABLE public.company_settings
  DROP CONSTRAINT IF EXISTS company_settings_ai_auto_reply_scope_check;

ALTER TABLE public.company_settings
  ADD CONSTRAINT company_settings_ai_auto_reply_scope_check
  CHECK (ai_auto_reply_scope IN ('desligado', 'teste', 'geral'));

UPDATE public.company_settings
SET ai_auto_reply_scope = CASE WHEN ai_auto_reply_enabled THEN 'geral' ELSE 'desligado' END
WHERE ai_auto_reply_scope IS NULL;

ALTER TABLE public.company_settings
  ALTER COLUMN ai_auto_reply_scope SET DEFAULT 'desligado',
  ALTER COLUMN ai_auto_reply_scope SET NOT NULL;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_reply_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.company_settings.ai_auto_reply_scope IS
  'Modo global do Atendimento 2.0: desligado, teste (por conversa) ou geral.';
COMMENT ON COLUMN public.conversations.ai_reply_enabled IS
  'Autorização individual para a Vendedora 2.0 quando o modo global é teste.';
