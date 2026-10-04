-- Automático por conversa: em empresa no modo `assisted`, o atendente escolhe as conversas
-- em que a Vendedora responde o cliente sozinha. Padrão desligado: nada muda até ligarem.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS sales_agent_auto_reply boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.conversations.sales_agent_auto_reply IS
  'Vendedora 2.0 responde o cliente sem aprovação nesta conversa (empresa em modo assisted).';
