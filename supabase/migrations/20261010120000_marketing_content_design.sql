-- Estúdio Criativo: documento único (vídeo, carrossel ou arte) por conteúdo.
-- Aditiva: conteúdos existentes ficam com design NULL e seguem funcionando
-- pelas colunas atuais (overlay_*, video_layout, ai_prompt.image_sequence).
ALTER TABLE public.marketing_contents
  ADD COLUMN IF NOT EXISTS design jsonb;

ALTER TABLE public.marketing_contents
  DROP CONSTRAINT IF EXISTS marketing_contents_design_shape;
ALTER TABLE public.marketing_contents
  ADD CONSTRAINT marketing_contents_design_shape
  CHECK (
    design IS NULL
    OR (
      jsonb_typeof(design) = 'object'
      AND jsonb_typeof(design -> 'version') = 'number'
      AND design ->> 'kind' IN ('video', 'carousel', 'art')
      AND jsonb_typeof(design -> 'pages') = 'array'
      AND jsonb_array_length(design -> 'pages') BETWEEN 1 AND 10
      AND octet_length(design::text) < 262144
    )
  );

COMMENT ON COLUMN public.marketing_contents.design IS
  'Documento versionado do Estúdio Criativo (kind, format, pages). NULL em conteúdos anteriores ao estúdio.';
