
-- ============================================================================
-- 1) Colunas novas — todas opcionais, com defaults seguros.
-- ============================================================================

ALTER TABLE public.audio_library
  ADD COLUMN IF NOT EXISTS marketing_objectives text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS brand_styles         text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS seasons              text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS target_audiences     text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS best_video_durations integer[]   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS preferred_start_second integer,
  ADD COLUMN IF NOT EXISTS preferred_end_second   integer;

-- ============================================================================
-- 2) CHECK constraints — validam whitelist de valores e regras de negócio.
--    Todas usam expressões IMMUTABLE (subset via <@ com literal, comparação
--    entre colunas da mesma linha e IS NULL / valores literais).
-- ============================================================================

ALTER TABLE public.audio_library
  DROP CONSTRAINT IF EXISTS audio_library_marketing_objectives_check;
ALTER TABLE public.audio_library
  ADD CONSTRAINT audio_library_marketing_objectives_check
  CHECK (
    marketing_objectives <@ ARRAY[
      'venda','institucional','promocao','lancamento',
      'relacionamento','branding','engajamento'
    ]::text[]
  );

ALTER TABLE public.audio_library
  DROP CONSTRAINT IF EXISTS audio_library_brand_styles_check;
ALTER TABLE public.audio_library
  ADD CONSTRAINT audio_library_brand_styles_check
  CHECK (
    brand_styles <@ ARRAY[
      'premium','moderno','elegante','sofisticado',
      'divertido','popular','minimalista','tropical'
    ]::text[]
  );

ALTER TABLE public.audio_library
  DROP CONSTRAINT IF EXISTS audio_library_seasons_check;
ALTER TABLE public.audio_library
  ADD CONSTRAINT audio_library_seasons_check
  CHECK (
    seasons <@ ARRAY['verao','inverno','primavera','outono','todas']::text[]
    AND (
      NOT ('todas' = ANY(seasons))
      OR cardinality(seasons) = 1
    )
  );

ALTER TABLE public.audio_library
  DROP CONSTRAINT IF EXISTS audio_library_target_audiences_check;
ALTER TABLE public.audio_library
  ADD CONSTRAINT audio_library_target_audiences_check
  CHECK (
    target_audiences <@ ARRAY[
      'familia','casal','criancas','luxo',
      'residencial','comercial','jovens'
    ]::text[]
  );

ALTER TABLE public.audio_library
  DROP CONSTRAINT IF EXISTS audio_library_best_video_durations_check;
ALTER TABLE public.audio_library
  ADD CONSTRAINT audio_library_best_video_durations_check
  CHECK (
    best_video_durations <@ ARRAY[8,10,15,30,60]::integer[]
  );

-- Trecho preferido: ambos nulos OU ambos preenchidos, com start>=0 e end>start.
ALTER TABLE public.audio_library
  DROP CONSTRAINT IF EXISTS audio_library_preferred_range_check;
ALTER TABLE public.audio_library
  ADD CONSTRAINT audio_library_preferred_range_check
  CHECK (
    (preferred_start_second IS NULL AND preferred_end_second IS NULL)
    OR (
      preferred_start_second IS NOT NULL
      AND preferred_end_second   IS NOT NULL
      AND preferred_start_second >= 0
      AND preferred_end_second   >  preferred_start_second
    )
  );

-- Se duration_seconds estiver definido, o intervalo não pode ultrapassá-lo.
ALTER TABLE public.audio_library
  DROP CONSTRAINT IF EXISTS audio_library_preferred_within_duration_check;
ALTER TABLE public.audio_library
  ADD CONSTRAINT audio_library_preferred_within_duration_check
  CHECK (
    duration_seconds IS NULL
    OR (
      (preferred_start_second IS NULL OR preferred_start_second <= duration_seconds)
      AND
      (preferred_end_second   IS NULL OR preferred_end_second   <= duration_seconds)
    )
  );

-- ============================================================================
-- 3) Trigger para deduplicar arrays em INSERT/UPDATE (defesa em profundidade
--    contra clientes que enviem duplicatas). Preserva ordem de primeira
--    aparição usando WITH ORDINALITY.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.audio_library_dedupe_arrays()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.marketing_objectives IS NOT NULL THEN
    NEW.marketing_objectives := ARRAY(
      SELECT val FROM (
        SELECT DISTINCT ON (val) val, ord
        FROM unnest(NEW.marketing_objectives) WITH ORDINALITY AS t(val, ord)
        ORDER BY val, ord
      ) s ORDER BY ord
    );
  END IF;
  IF NEW.brand_styles IS NOT NULL THEN
    NEW.brand_styles := ARRAY(
      SELECT val FROM (
        SELECT DISTINCT ON (val) val, ord
        FROM unnest(NEW.brand_styles) WITH ORDINALITY AS t(val, ord)
        ORDER BY val, ord
      ) s ORDER BY ord
    );
  END IF;
  IF NEW.seasons IS NOT NULL THEN
    NEW.seasons := ARRAY(
      SELECT val FROM (
        SELECT DISTINCT ON (val) val, ord
        FROM unnest(NEW.seasons) WITH ORDINALITY AS t(val, ord)
        ORDER BY val, ord
      ) s ORDER BY ord
    );
  END IF;
  IF NEW.target_audiences IS NOT NULL THEN
    NEW.target_audiences := ARRAY(
      SELECT val FROM (
        SELECT DISTINCT ON (val) val, ord
        FROM unnest(NEW.target_audiences) WITH ORDINALITY AS t(val, ord)
        ORDER BY val, ord
      ) s ORDER BY ord
    );
  END IF;
  IF NEW.best_video_durations IS NOT NULL THEN
    NEW.best_video_durations := ARRAY(
      SELECT val FROM (
        SELECT DISTINCT ON (val) val, ord
        FROM unnest(NEW.best_video_durations) WITH ORDINALITY AS t(val, ord)
        ORDER BY val, ord
      ) s ORDER BY ord
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audio_library_dedupe_arrays ON public.audio_library;
CREATE TRIGGER trg_audio_library_dedupe_arrays
  BEFORE INSERT OR UPDATE OF
    marketing_objectives, brand_styles, seasons,
    target_audiences, best_video_durations
  ON public.audio_library
  FOR EACH ROW
  EXECUTE FUNCTION public.audio_library_dedupe_arrays();

-- ============================================================================
-- 4) Índices GIN — apenas nos arrays usados como filtro na UI.
-- ============================================================================

CREATE INDEX IF NOT EXISTS audio_library_marketing_objectives_gin_idx
  ON public.audio_library USING GIN (marketing_objectives);

CREATE INDEX IF NOT EXISTS audio_library_brand_styles_gin_idx
  ON public.audio_library USING GIN (brand_styles);

CREATE INDEX IF NOT EXISTS audio_library_seasons_gin_idx
  ON public.audio_library USING GIN (seasons);

CREATE INDEX IF NOT EXISTS audio_library_target_audiences_gin_idx
  ON public.audio_library USING GIN (target_audiences);

CREATE INDEX IF NOT EXISTS audio_library_best_video_durations_gin_idx
  ON public.audio_library USING GIN (best_video_durations);
