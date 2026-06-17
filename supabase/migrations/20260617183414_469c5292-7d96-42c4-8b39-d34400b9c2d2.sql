
-- Coach V1: tabelas, RLS, GRANTs, índices. Sem pg_cron/pg_net.

CREATE TABLE IF NOT EXISTS public.coach_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  alert_type text NOT NULL CHECK (alert_type IN (
    'no_response','followup_overdue','quote_no_reply','window_closing',
    'hot_lead_unattended','awaiting_quote','discount_requested',
    'will_research','spouse_decision'
  )),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  urgency_minutes int,
  risk_score int DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_alerts TO authenticated;
GRANT ALL ON public.coach_alerts TO service_role;

ALTER TABLE public.coach_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coach_alerts_select_company" ON public.coach_alerts
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "coach_alerts_insert_company" ON public.coach_alerts
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "coach_alerts_update_company" ON public.coach_alerts
  FOR UPDATE TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "coach_alerts_delete_company" ON public.coach_alerts
  FOR DELETE TO authenticated
  USING (company_id = public.current_company_id());

CREATE INDEX idx_coach_alerts_company_status ON public.coach_alerts(company_id, status, severity);
CREATE INDEX idx_coach_alerts_conversation ON public.coach_alerts(conversation_id, status);
CREATE UNIQUE INDEX uq_coach_alerts_open_type ON public.coach_alerts(conversation_id, alert_type) WHERE status = 'open';

CREATE TRIGGER trg_coach_alerts_updated_at
  BEFORE UPDATE ON public.coach_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


CREATE TABLE IF NOT EXISTS public.coach_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  situation text,
  next_action text,
  suggestion_text text NOT NULL,
  reasoning text,
  objection_type text CHECK (objection_type IN (
    'price','timing','spouse','researching','discount','other'
  ) OR objection_type IS NULL),
  urgency text CHECK (urgency IN ('low','medium','high','critical') OR urgency IS NULL),
  risk_score int DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','copied','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_suggestions TO authenticated;
GRANT ALL ON public.coach_suggestions TO service_role;

ALTER TABLE public.coach_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coach_suggestions_select_company" ON public.coach_suggestions
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "coach_suggestions_insert_company" ON public.coach_suggestions
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "coach_suggestions_update_company" ON public.coach_suggestions
  FOR UPDATE TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "coach_suggestions_delete_company" ON public.coach_suggestions
  FOR DELETE TO authenticated
  USING (company_id = public.current_company_id());

CREATE INDEX idx_coach_suggestions_conversation ON public.coach_suggestions(conversation_id, created_at DESC);
CREATE INDEX idx_coach_suggestions_company ON public.coach_suggestions(company_id, created_at DESC);
