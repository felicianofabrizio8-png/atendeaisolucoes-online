-- Publicação de carrossel: a fila de publicações passa a aceitar o formato.
-- Aditiva: só amplia o CHECK; linhas existentes (feed/reel/story) seguem válidas.
-- A publicação em si continua desligada até MARKETING_CAROUSEL_PUBLISH=enabled.
ALTER TABLE public.marketing_publications
  DROP CONSTRAINT IF EXISTS marketing_publications_format_check;
ALTER TABLE public.marketing_publications
  ADD CONSTRAINT marketing_publications_format_check
  CHECK (format IN ('feed', 'reel', 'story', 'carousel'));
