-- Hardening: índices faltantes do inbox + remoção do has_role legado.
-- Nenhuma policy ativa usa public.has_role(uuid, app_role) — confirmado por
-- consulta a pg_policy. Mantemos apenas has_role(uuid, uuid, app_role).

CREATE INDEX IF NOT EXISTS idx_messages_company_at_desc
  ON public.messages (company_id, at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conv_at_desc
  ON public.messages (conversation_id, at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_company_last_message_at_desc
  ON public.conversations (company_id, last_message_at DESC);

DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);