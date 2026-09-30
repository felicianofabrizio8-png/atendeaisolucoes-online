-- =============================================================================
-- PENDENTE (não aplicada automaticamente) — Vendedora IA · Fase 1
--
-- Mensagem de transição enviada ao cliente quando a Vendedora encaminha a
-- conversa para humano, configurável por empresa.
--
-- Semântica lida pelo código (src/lib/ai-agent.server.ts, resolveHandoffMessage):
--   NULL (padrão)  → texto neutro da plataforma (DEFAULT_HANDOFF_MESSAGE);
--   ''             → aviso desativado para a empresa;
--   texto          → texto da empresa (até 1000 caracteres).
--
-- Enquanto a coluna não existir, todas as empresas usam o texto padrão neutro
-- (o código lê company_settings com select("*") e trata ausência como NULL).
-- Aditiva e sem efeito em linhas existentes.
-- =============================================================================

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS ai_handoff_message text;

ALTER TABLE public.company_settings
  DROP CONSTRAINT IF EXISTS company_settings_ai_handoff_message_len;
ALTER TABLE public.company_settings
  ADD CONSTRAINT company_settings_ai_handoff_message_len
  CHECK (ai_handoff_message IS NULL OR char_length(ai_handoff_message) <= 1000);
