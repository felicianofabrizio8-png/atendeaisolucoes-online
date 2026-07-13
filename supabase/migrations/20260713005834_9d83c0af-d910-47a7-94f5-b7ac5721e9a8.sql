-- Executive Knowledge: histórico de snapshots executivos agregados (sem PII).
-- Base do futuro Executive Brain. 100% READ-ONLY do ponto de vista da aplicação:
-- somente snapshots já produzidos pelo Executive Intelligence entram aqui.

CREATE TABLE public.executive_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  snapshot_generated_at timestamptz NOT NULL,
  period text NOT NULL CHECK (period IN ('7d','30d','90d')),
  knowledge_version integer NOT NULL DEFAULT 1,
  facts_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  highlights_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executive_knowledge_unique_snapshot
    UNIQUE (company_id, period, snapshot_generated_at)
);

CREATE INDEX executive_knowledge_company_period_time_idx
  ON public.executive_knowledge (company_id, period, snapshot_generated_at DESC);

-- GRANTs obrigatórios (Data API não concede nada por padrão).
GRANT SELECT, INSERT, DELETE ON public.executive_knowledge TO authenticated;
GRANT ALL ON public.executive_knowledge TO service_role;
-- Sem GRANT para anon: dados internos por empresa.

ALTER TABLE public.executive_knowledge ENABLE ROW LEVEL SECURITY;

-- Apenas admins da empresa podem ler o histórico da própria empresa.
CREATE POLICY "admins select own company knowledge"
  ON public.executive_knowledge
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), company_id, 'admin'::app_role)
  );

-- Apenas admins da empresa podem gravar novos registros para a própria empresa.
CREATE POLICY "admins insert own company knowledge"
  ON public.executive_knowledge
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), company_id, 'admin'::app_role)
  );

-- Apenas admins da empresa podem apagar registros da própria empresa
-- (usado pela rotina de retenção quando executada com privilégios).
CREATE POLICY "admins delete own company knowledge"
  ON public.executive_knowledge
  FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), company_id, 'admin'::app_role)
  );

-- Rotina de retenção: mantém apenas 365 dias por empresa.
-- SECURITY DEFINER para poder ser chamada por rotinas agendadas (pg_cron)
-- sem depender de service_role no runtime da aplicação.
CREATE OR REPLACE FUNCTION public.cleanup_executive_knowledge()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.executive_knowledge
   WHERE snapshot_generated_at < now() - interval '365 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_executive_knowledge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_executive_knowledge() TO service_role;