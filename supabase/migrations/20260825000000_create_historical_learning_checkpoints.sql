-- Checkpoint resumível do aprendizado histórico. O metadata contém somente
-- regras comportamentais estruturadas e IDs de evidência; nunca transcrições.
CREATE TABLE IF NOT EXISTS public.coach_historical_learning_checkpoints (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  prompt_version text NOT NULL,
  next_offset integer NOT NULL DEFAULT 0 CHECK (next_offset >= 0),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, prompt_version)
);

ALTER TABLE public.coach_historical_learning_checkpoints ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.coach_historical_learning_checkpoints TO authenticated;
GRANT ALL ON public.coach_historical_learning_checkpoints TO service_role;

DROP POLICY IF EXISTS coach_historical_checkpoints_select_own_company
  ON public.coach_historical_learning_checkpoints;
CREATE POLICY coach_historical_checkpoints_select_own_company
  ON public.coach_historical_learning_checkpoints
  FOR SELECT TO authenticated
  USING (company_id = private.current_company_id());

COMMENT ON TABLE public.coach_historical_learning_checkpoints IS
  'Checkpoint interno do extrator histórico; metadata não pode conter transcrições ou PII.';
