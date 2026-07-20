-- Fase M1 — Marketing IA: separar texto visual da legenda.
-- Aditivo, 100% retrocompatível. Nenhuma coluna existente é alterada.
-- Não conectamos ao Render Engine nesta etapa.

ALTER TABLE public.marketing_contents
  ADD COLUMN IF NOT EXISTS overlay_headline    TEXT,
  ADD COLUMN IF NOT EXISTS overlay_subheadline TEXT,
  ADD COLUMN IF NOT EXISTS overlay_cta         TEXT;

-- Guardas leves de tamanho (limites da spec Fase M1) — evitam poluição do banco.
-- Aceitam NULL (retrocompatibilidade) e não bloqueiam linhas antigas.
ALTER TABLE public.marketing_contents
  DROP CONSTRAINT IF EXISTS marketing_contents_overlay_headline_len;
ALTER TABLE public.marketing_contents
  ADD CONSTRAINT marketing_contents_overlay_headline_len
  CHECK (overlay_headline IS NULL OR char_length(overlay_headline) <= 40);

ALTER TABLE public.marketing_contents
  DROP CONSTRAINT IF EXISTS marketing_contents_overlay_subheadline_len;
ALTER TABLE public.marketing_contents
  ADD CONSTRAINT marketing_contents_overlay_subheadline_len
  CHECK (overlay_subheadline IS NULL OR char_length(overlay_subheadline) <= 60);

ALTER TABLE public.marketing_contents
  DROP CONSTRAINT IF EXISTS marketing_contents_overlay_cta_len;
ALTER TABLE public.marketing_contents
  ADD CONSTRAINT marketing_contents_overlay_cta_len
  CHECK (overlay_cta IS NULL OR char_length(overlay_cta) <= 40);

-- Índice parcial para consulta de repetição por empresa nas últimas campanhas.
CREATE INDEX IF NOT EXISTS marketing_contents_company_overlay_recent_idx
  ON public.marketing_contents (company_id, created_at DESC)
  WHERE overlay_headline IS NOT NULL;

COMMENT ON COLUMN public.marketing_contents.overlay_headline    IS 'Fase M1 — texto visual curto para overlay do vídeo/imagem. Independente do title/body (legenda).';
COMMENT ON COLUMN public.marketing_contents.overlay_subheadline IS 'Fase M1 — subtítulo curto complementar ao overlay_headline.';
COMMENT ON COLUMN public.marketing_contents.overlay_cta         IS 'Fase M1 — CTA visual curto (botão overlay). Independente do cta_text da legenda.';