-- Estado comercial da Vendedora 2.0 por conversa (estágio do cliente, sinais de compra,
-- assuntos já perguntados, fechamentos já usados). É memória da conversa, nunca fonte de fato.
ALTER TABLE public.conversation_sales_states
  ADD COLUMN IF NOT EXISTS seller_state jsonb;

COMMENT ON COLUMN public.conversation_sales_states.seller_state IS
  'Estado devolvido pela Vendedora 2.0 no último turno; reenviado a ela no turno seguinte.';
