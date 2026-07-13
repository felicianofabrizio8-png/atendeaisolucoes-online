-- 1) TABELA
CREATE TABLE public.scientific_memory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  period TEXT NOT NULL CHECK (period IN ('7d','30d','90d')),
  knowledge_score NUMERIC(6,3) NOT NULL DEFAULT 0,
  scientific_score NUMERIC(6,3) NOT NULL DEFAULT 0,
  validated_theories JSONB NOT NULL DEFAULT '[]'::jsonb,
  strengthening_hypotheses JSONB NOT NULL DEFAULT '[]'::jsonb,
  observed_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  business_conclusions JSONB NOT NULL DEFAULT '[]'::jsonb,
  correlations JSONB NOT NULL DEFAULT '[]'::jsonb,
  limitations JSONB NOT NULL DEFAULT '[]'::jsonb,
  quality JSONB NOT NULL DEFAULT '{}'::jsonb,
  version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) GRANTS
GRANT SELECT, INSERT ON public.scientific_memory TO authenticated;
GRANT ALL ON public.scientific_memory TO service_role;

-- 3) RLS
ALTER TABLE public.scientific_memory ENABLE ROW LEVEL SECURITY;

-- 4) POLICIES (admin-only, mesma empresa)
CREATE POLICY "admins read scientific_memory of own company"
  ON public.scientific_memory
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), company_id, 'admin'::app_role)
  );

CREATE POLICY "admins insert scientific_memory of own company"
  ON public.scientific_memory
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), company_id, 'admin'::app_role)
  );

-- 5) INDEXES
CREATE INDEX scientific_memory_company_generated_idx
  ON public.scientific_memory (company_id, generated_at DESC);

CREATE INDEX scientific_memory_company_period_idx
  ON public.scientific_memory (company_id, period, generated_at DESC);

-- 6) Retenção (365 dias)
CREATE OR REPLACE FUNCTION public.cleanup_scientific_memory()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.scientific_memory
   WHERE created_at < now() - interval '365 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;