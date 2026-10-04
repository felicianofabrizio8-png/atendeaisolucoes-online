-- Validade opcional da resposta rápida: informação com prazo (data de entrega, promoção)
-- deixa de ser usada pela IA depois da data. Sem data, a resposta não vence.
ALTER TABLE public.quick_replies
  ADD COLUMN IF NOT EXISTS valid_until date;

COMMENT ON COLUMN public.quick_replies.valid_until IS
  'Último dia em que a informação vale. Depois dele a IA não usa esta resposta rápida.';
