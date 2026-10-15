-- Publicação de carrossel: a fila de publicações passa a aceitar o formato.
-- Aditiva: só amplia o CHECK; linhas existentes (feed/reel/story) seguem válidas.
-- A publicação em si continua desligada até MARKETING_CAROUSEL_PUBLISH=enabled.
--
-- O CHECK original foi criado sem nome (inline na criação da tabela). Remove
-- qualquer CHECK que restrinja só a coluna `format`, seja qual for o nome.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.marketing_publications'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%format%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%status%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%channel%'
  LOOP
    EXECUTE format('ALTER TABLE public.marketing_publications DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.marketing_publications
  ADD CONSTRAINT marketing_publications_format_check
  CHECK (format IN ('feed', 'reel', 'story', 'carousel'));
