-- Amplitude 0.600 -> 0.900.
-- Antes: assíntota [0.40, 0.95] — 50 negativos paravam em 0.447, gentil demais
--        para um aprendizado comprovadamente ruim.
-- Agora: assíntota [0.25, 0.95] — 1 negativo ainda move só 0.015 (gradual),
--        mas evidência acumulada consegue efetivamente rebaixar a regra.
-- Continua função PURA dos contadores: reprocessar reproduz o mesmo valor.
CREATE OR REPLACE FUNCTION public.coach_feedback_confidence(
  _success_rate numeric, _sample_count integer
) RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT round(
    GREATEST(0.150, LEAST(0.950,
      0.700 + (COALESCE(_success_rate, 0.5) - 0.5) * 0.900
              * (GREATEST(0, COALESCE(_sample_count,0))::numeric
                 / (GREATEST(0, COALESCE(_sample_count,0)) + 5.0))
    )), 3)::numeric;
$$;

REVOKE ALL ON FUNCTION public.coach_feedback_confidence(numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_feedback_confidence(numeric, integer) TO authenticated, service_role;