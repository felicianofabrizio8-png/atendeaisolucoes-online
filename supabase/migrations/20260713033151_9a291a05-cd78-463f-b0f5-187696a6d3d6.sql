
-- =====================================================================
-- Fase 4 — Persistência Científica
-- =====================================================================

-- 1) SNAPSHOTS ---------------------------------------------------------
CREATE TABLE public.scientific_knowledge_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period IN ('7d','30d','90d')),
  engine_version text NOT NULL,
  snapshot_date date NOT NULL,
  snapshot_generated_at timestamptz NOT NULL,
  source_fingerprint text NOT NULL,
  observations_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  hypotheses_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  theories_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  validated_knowledge_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  quality_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX scientific_snapshots_unique_idx
  ON public.scientific_knowledge_snapshots
  (company_id, period, engine_version, snapshot_date, source_fingerprint);

CREATE INDEX scientific_snapshots_company_date_idx
  ON public.scientific_knowledge_snapshots (company_id, snapshot_date DESC);

GRANT SELECT ON public.scientific_knowledge_snapshots TO authenticated;
GRANT ALL ON public.scientific_knowledge_snapshots TO service_role;

ALTER TABLE public.scientific_knowledge_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read snapshots of own company"
  ON public.scientific_knowledge_snapshots
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), company_id, 'admin'::app_role)
  );

-- 2) HYPOTHESIS REGISTRY ----------------------------------------------
CREATE TABLE public.scientific_hypothesis_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  hypothesis_key text NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL CHECK (status IN (
    'observed','insufficient_history','strengthening','validated','weakening','discarded'
  )),
  confidence numeric NOT NULL,
  scientific_score numeric NOT NULL DEFAULT 0,
  occurrence_count integer NOT NULL DEFAULT 0,
  distinct_snapshot_days integer NOT NULL DEFAULT 0,
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  last_observed_day date NOT NULL,
  provenance_key text NOT NULL,
  source_fingerprint text NOT NULL,
  contradiction_count integer NOT NULL DEFAULT 0,
  supporting_evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX scientific_hypothesis_registry_unique_idx
  ON public.scientific_hypothesis_registry (company_id, hypothesis_key);

CREATE INDEX scientific_hypothesis_registry_company_status_idx
  ON public.scientific_hypothesis_registry (company_id, status);

GRANT SELECT ON public.scientific_hypothesis_registry TO authenticated;
GRANT ALL ON public.scientific_hypothesis_registry TO service_role;

ALTER TABLE public.scientific_hypothesis_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read hypothesis registry of own company"
  ON public.scientific_hypothesis_registry
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), company_id, 'admin'::app_role)
  );

CREATE TRIGGER trg_scientific_hypothesis_registry_updated_at
  BEFORE UPDATE ON public.scientific_hypothesis_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) KNOWLEDGE REGISTRY -----------------------------------------------
CREATE TABLE public.scientific_knowledge_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  knowledge_key text NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  status text NOT NULL CHECK (status IN ('candidate','validated','historical','deprecated')),
  confidence numeric NOT NULL,
  scientific_score numeric NOT NULL DEFAULT 0,
  validated_since timestamptz,
  last_confirmed_at timestamptz,
  last_confirmed_day date,
  distinct_snapshot_days integer NOT NULL DEFAULT 0,
  contradiction_count integer NOT NULL DEFAULT 0,
  provenance_keys_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX scientific_knowledge_registry_unique_idx
  ON public.scientific_knowledge_registry (company_id, knowledge_key);

CREATE INDEX scientific_knowledge_registry_company_status_idx
  ON public.scientific_knowledge_registry (company_id, status);

GRANT SELECT ON public.scientific_knowledge_registry TO authenticated;
GRANT ALL ON public.scientific_knowledge_registry TO service_role;

ALTER TABLE public.scientific_knowledge_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read knowledge registry of own company"
  ON public.scientific_knowledge_registry
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), company_id, 'admin'::app_role)
  );

CREATE TRIGGER trg_scientific_knowledge_registry_updated_at
  BEFORE UPDATE ON public.scientific_knowledge_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) RETENÇÃO ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_scientific_snapshots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.scientific_knowledge_snapshots
   WHERE created_at < now() - interval '730 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
