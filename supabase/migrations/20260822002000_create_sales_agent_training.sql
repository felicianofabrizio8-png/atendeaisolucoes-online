BEGIN;

CREATE TABLE public.ai_training_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Treinamento da Vendedora IA',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_training_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.ai_training_sessions(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('lead', 'agent')),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 8000),
  decision jsonb,
  generation_status text NOT NULL DEFAULT 'completed'
    CHECK (generation_status IN ('pending', 'completed', 'failed')),
  generation_error text CHECK (generation_error IS NULL OR generation_error IN ('generation_failed')),
  review_status text CHECK (review_status IN ('approved', 'rejected', 'corrected')),
  correction_text text CHECK (correction_text IS NULL OR length(btrim(correction_text)) BETWEEN 1 AND 8000),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_training_sessions_company_created_idx
  ON public.ai_training_sessions (company_id, created_at DESC);
CREATE INDEX ai_training_messages_session_created_idx
  ON public.ai_training_messages (session_id, created_at ASC);

ALTER TABLE public.ai_training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_training_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_training_sessions_company_access
  ON public.ai_training_sessions
  FOR ALL TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), company_id, 'admin'::public.app_role)
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND created_by = auth.uid()
    AND public.has_role(auth.uid(), company_id, 'admin'::public.app_role)
  );

CREATE POLICY ai_training_messages_company_access
  ON public.ai_training_messages
  FOR ALL TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), company_id, 'admin'::public.app_role)
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), company_id, 'admin'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.ai_training_sessions s
      WHERE s.id = session_id
        AND s.company_id = public.current_company_id()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_training_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_training_messages TO authenticated;
GRANT ALL ON public.ai_training_sessions, public.ai_training_messages TO service_role;

COMMIT;
