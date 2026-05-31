
-- Enums
DO $$ BEGIN
  CREATE TYPE public.ai_tone AS ENUM ('comercial','amigavel','premium','tecnico','informal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ai_proposal_type AS ENUM ('faq','objection','recurring_reply','sales_pattern');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ai_proposal_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ai_profiles (1:1 com company)
CREATE TABLE IF NOT EXISTS public.ai_profiles (
  company_id uuid PRIMARY KEY,
  company_name text,
  description text,
  products text,
  payment_methods text,
  avg_lead_time text,
  faq jsonb NOT NULL DEFAULT '[]'::jsonb,
  business_hours text,
  region text,
  differentials text,
  tone public.ai_tone NOT NULL DEFAULT 'comercial',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_profiles TO authenticated;
GRANT ALL ON public.ai_profiles TO service_role;
ALTER TABLE public.ai_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select ai_profiles" ON public.ai_profiles FOR SELECT TO authenticated
  USING (company_id = private.current_company_id());
CREATE POLICY "company insert ai_profiles" ON public.ai_profiles FOR INSERT TO authenticated
  WITH CHECK (company_id = private.current_company_id());
CREATE POLICY "company update ai_profiles" ON public.ai_profiles FOR UPDATE TO authenticated
  USING (company_id = private.current_company_id());

CREATE TRIGGER tg_ai_profiles_updated BEFORE UPDATE ON public.ai_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ai_suggestions_log
CREATE TABLE IF NOT EXISTS public.ai_suggestions_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid,
  conversation_id uuid,
  lead_id uuid,
  model text,
  generated_text text NOT NULL,
  classification text,
  low_confidence boolean NOT NULL DEFAULT false,
  was_sent boolean NOT NULL DEFAULT false,
  was_edited boolean NOT NULL DEFAULT false,
  sent_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_suggestions_log_company_created_idx
  ON public.ai_suggestions_log (company_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_suggestions_log TO authenticated;
GRANT ALL ON public.ai_suggestions_log TO service_role;
ALTER TABLE public.ai_suggestions_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select ai_log" ON public.ai_suggestions_log FOR SELECT TO authenticated
  USING (company_id = private.current_company_id());
CREATE POLICY "company insert ai_log" ON public.ai_suggestions_log FOR INSERT TO authenticated
  WITH CHECK (company_id = private.current_company_id());
CREATE POLICY "company update ai_log" ON public.ai_suggestions_log FOR UPDATE TO authenticated
  USING (company_id = private.current_company_id());

-- ai_usage_counters
CREATE TABLE IF NOT EXISTS public.ai_usage_counters (
  company_id uuid NOT NULL,
  month date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  monthly_limit integer NOT NULL DEFAULT 1000,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, month)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_usage_counters TO authenticated;
GRANT ALL ON public.ai_usage_counters TO service_role;
ALTER TABLE public.ai_usage_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select ai_usage" ON public.ai_usage_counters FOR SELECT TO authenticated
  USING (company_id = private.current_company_id());
CREATE POLICY "company insert ai_usage" ON public.ai_usage_counters FOR INSERT TO authenticated
  WITH CHECK (company_id = private.current_company_id());
CREATE POLICY "company update ai_usage" ON public.ai_usage_counters FOR UPDATE TO authenticated
  USING (company_id = private.current_company_id());

-- ai_knowledge_proposals
CREATE TABLE IF NOT EXISTS public.ai_knowledge_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  type public.ai_proposal_type NOT NULL DEFAULT 'faq',
  question text NOT NULL,
  answer text NOT NULL,
  status public.ai_proposal_status NOT NULL DEFAULT 'pending',
  source_conversation_id uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_kn_proposals_company_status_idx
  ON public.ai_knowledge_proposals (company_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_knowledge_proposals TO authenticated;
GRANT ALL ON public.ai_knowledge_proposals TO service_role;
ALTER TABLE public.ai_knowledge_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select ai_proposals" ON public.ai_knowledge_proposals FOR SELECT TO authenticated
  USING (company_id = private.current_company_id());
CREATE POLICY "company insert ai_proposals" ON public.ai_knowledge_proposals FOR INSERT TO authenticated
  WITH CHECK (company_id = private.current_company_id());
CREATE POLICY "company update ai_proposals" ON public.ai_knowledge_proposals FOR UPDATE TO authenticated
  USING (company_id = private.current_company_id());
CREATE POLICY "company delete ai_proposals" ON public.ai_knowledge_proposals FOR DELETE TO authenticated
  USING (company_id = private.current_company_id());

CREATE TRIGGER tg_ai_proposals_updated BEFORE UPDATE ON public.ai_knowledge_proposals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
