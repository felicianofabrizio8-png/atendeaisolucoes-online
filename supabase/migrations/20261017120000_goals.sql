-- supabase/migrations/20261017120000_goals.sql
-- ============================================================================
-- Metas: da empresa, de pessoas ou de grupos; automáticas (indicadores do
-- sistema) ou manuais; prazo único ou recorrente; fotos diárias e análises da
-- Lume. Aditiva e reexecutável. Depende de 20261007180000 (equipe). O
-- indicador "compromissos concluídos" usa visits.owner_id (20261016120000)
-- quando a coluna existe.
-- ============================================================================

-- ---------- 1. Permissões ----------
ALTER TABLE public.company_member_access DROP CONSTRAINT IF EXISTS company_member_access_permissions_check;
ALTER TABLE public.company_member_access ADD CONSTRAINT company_member_access_permissions_check
  CHECK (permissions <@ ARRAY['dashboard.view','conversations.read','conversations.reply','conversations.view_all',
    'conversations.assign','quotes.manage','agenda.manage','agenda.team','products.view','products.manage',
    'reports.view','campaigns.manage','ai.manage','settings.manage','goals.view','goals.manage']::text[]);
ALTER TABLE public.company_member_access ALTER COLUMN permissions
  SET DEFAULT ARRAY['conversations.read','conversations.reply','quotes.manage','agenda.manage','products.view','goals.view'];
UPDATE public.company_member_access SET permissions = array_append(permissions, 'goals.view')
  WHERE NOT ('goals.view' = ANY (permissions));

DO $$ BEGIN
  IF to_regclass('public.company_invite_links') IS NOT NULL THEN
    ALTER TABLE public.company_invite_links DROP CONSTRAINT IF EXISTS company_invite_links_permissions_check;
    ALTER TABLE public.company_invite_links ADD CONSTRAINT company_invite_links_permissions_check
      CHECK (permissions <@ ARRAY['dashboard.view','conversations.read','conversations.reply','conversations.view_all',
        'conversations.assign','quotes.manage','agenda.manage','agenda.team','products.view','products.manage',
        'reports.view','campaigns.manage','ai.manage','settings.manage','goals.view','goals.manage']::text[]);
    ALTER TABLE public.company_invite_links ALTER COLUMN permissions
      SET DEFAULT ARRAY['conversations.read','conversations.reply','quotes.manage','agenda.manage','products.view','goals.view'];
  END IF;
END $$;

-- ---------- 2. Tabelas ----------
CREATE TABLE IF NOT EXISTS public.goal_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  hue integer NOT NULL DEFAULT 275 CHECK (hue BETWEEN 0 AND 360),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_goal_stages_company ON public.goal_stages (company_id, position);

CREATE TABLE IF NOT EXISTS public.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 600),
  hue integer NOT NULL DEFAULT 275 CHECK (hue BETWEEN 0 AND 360),
  measure text NOT NULL CHECK (measure IN ('automatica', 'manual')),
  metric text CHECK (metric IS NULL OR metric IN ('receita_fechada','vendas_fechadas','leads_novos','taxa_conversao',
    'orcamentos_criados','orcamentos_enviados','conversas_respondidas','tempo_primeira_resposta','compromissos_concluidos')),
  target numeric NOT NULL CHECK (target > 0),
  unit text CHECK (unit IS NULL OR char_length(unit) <= 24),
  lower_is_better boolean NOT NULL DEFAULT false,
  scope text NOT NULL CHECK (scope IN ('empresa', 'pessoa', 'grupo')),
  starts_on date NOT NULL,
  ends_on date,
  recurrence text CHECK (recurrence IS NULL OR recurrence IN ('semanal', 'mensal')),
  stage_id uuid REFERENCES public.goal_stages(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goals_measure_metric CHECK ((measure = 'automatica') = (metric IS NOT NULL)),
  CONSTRAINT goals_deadline CHECK ((recurrence IS NULL) = (ends_on IS NOT NULL)),
  CONSTRAINT goals_dates CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS idx_goals_company ON public.goals (company_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.goal_members (
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (goal_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.goal_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  final_value numeric,
  final_status text,
  closed_at timestamptz,
  UNIQUE (goal_id, starts_on)
);

CREATE TABLE IF NOT EXISTS public.goal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES public.goal_periods(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  amount numeric NOT NULL CHECK (amount <> 0),
  note text CHECK (note IS NULL OR char_length(note) <= 280),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_goal_entries_goal ON public.goal_entries (goal_id, created_at);

CREATE TABLE IF NOT EXISTS public.goal_snapshots (
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES public.goal_periods(id) ON DELETE CASCADE,
  day date NOT NULL,
  value numeric,
  expected numeric NOT NULL,
  status text NOT NULL,
  PRIMARY KEY (goal_id, period_id, day)
);

CREATE TABLE IF NOT EXISTS public.goal_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('resumo', 'atencao', 'sugestao', 'dica')),
  goal_id uuid REFERENCES public.goals(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) <= 600),
  action jsonb,
  state text NOT NULL DEFAULT 'pendente' CHECK (state IN ('pendente', 'aplicada', 'dispensada')),
  generated_on date NOT NULL DEFAULT current_date,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_goal_insights_company_day ON public.goal_insights (company_id, generated_on DESC);

-- ---------- 3. Funções de acesso e datas ----------
CREATE OR REPLACE FUNCTION public.goals_can_manage(_company uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN _company IS NOT NULL AND _company = public.current_company_id()
    AND (public.has_role(auth.uid(), _company, 'admin') OR public.team_has_permission('goals.manage'));
END; $$;

CREATE OR REPLACE FUNCTION public.goals_can_see(_goal uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE g public.goals;
BEGIN
  SELECT * INTO g FROM public.goals WHERE id = _goal;
  IF NOT FOUND OR g.company_id IS DISTINCT FROM public.current_company_id() THEN RETURN false; END IF;
  IF public.goals_can_manage(g.company_id) THEN RETURN true; END IF;
  RETURN public.team_has_permission('goals.view') AND (g.scope = 'empresa' OR EXISTS (
    SELECT 1 FROM public.goal_members m WHERE m.goal_id = g.id AND m.user_id = auth.uid()));
END; $$;

CREATE OR REPLACE FUNCTION public.goals_day_start(_day date)
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT (_day::timestamp AT TIME ZONE 'America/Sao_Paulo');
$$;

CREATE OR REPLACE FUNCTION public.goals_period_bounds(_recurrence text, _starts date, _ends date, _day date)
RETURNS TABLE (starts_on date, ends_on date) LANGUAGE sql IMMUTABLE AS $$
  SELECT
    CASE _recurrence
      WHEN 'semanal' THEN greatest(_starts, date_trunc('week', _day)::date)
      WHEN 'mensal' THEN greatest(_starts, date_trunc('month', _day)::date)
      ELSE _starts END,
    CASE _recurrence
      WHEN 'semanal' THEN (date_trunc('week', _day) + interval '6 days')::date
      WHEN 'mensal' THEN (date_trunc('month', _day) + interval '1 month' - interval '1 day')::date
      ELSE _ends END;
$$;

CREATE OR REPLACE FUNCTION public.goals_open_first_period()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.goal_periods (goal_id, starts_on, ends_on)
  SELECT NEW.id, b.starts_on, b.ends_on FROM public.goals_period_bounds(NEW.recurrence, NEW.starts_on, NEW.ends_on, NEW.starts_on) b
  ON CONFLICT (goal_id, starts_on) DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS goals_open_first_period ON public.goals;
CREATE TRIGGER goals_open_first_period AFTER INSERT ON public.goals
  FOR EACH ROW EXECUTE FUNCTION public.goals_open_first_period();

CREATE OR REPLACE FUNCTION public.goals_touch()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS goals_touch ON public.goals;
CREATE TRIGGER goals_touch BEFORE UPDATE ON public.goals FOR EACH ROW EXECUTE FUNCTION public.goals_touch();

-- ---------- 4. Regras de acesso (RLS) ----------
ALTER TABLE public.goal_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS goal_stages_read ON public.goal_stages;
CREATE POLICY goal_stages_read ON public.goal_stages FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND (public.goals_can_manage(company_id) OR public.team_has_permission('goals.view')));
DROP POLICY IF EXISTS goal_stages_write ON public.goal_stages;
CREATE POLICY goal_stages_write ON public.goal_stages FOR ALL TO authenticated
  USING (public.goals_can_manage(company_id)) WITH CHECK (public.goals_can_manage(company_id));

DROP POLICY IF EXISTS goals_read ON public.goals;
CREATE POLICY goals_read ON public.goals FOR SELECT TO authenticated USING (public.goals_can_see(id));
DROP POLICY IF EXISTS goals_write ON public.goals;
CREATE POLICY goals_write ON public.goals FOR ALL TO authenticated
  USING (public.goals_can_manage(company_id)) WITH CHECK (public.goals_can_manage(company_id));

DROP POLICY IF EXISTS goal_members_read ON public.goal_members;
CREATE POLICY goal_members_read ON public.goal_members FOR SELECT TO authenticated USING (public.goals_can_see(goal_id));
DROP POLICY IF EXISTS goal_members_write ON public.goal_members;
CREATE POLICY goal_members_write ON public.goal_members FOR ALL TO authenticated
  USING (public.goals_can_manage((SELECT company_id FROM public.goals g WHERE g.id = goal_id)))
  WITH CHECK (public.goals_can_manage((SELECT company_id FROM public.goals g WHERE g.id = goal_id)));

DROP POLICY IF EXISTS goal_periods_read ON public.goal_periods;
CREATE POLICY goal_periods_read ON public.goal_periods FOR SELECT TO authenticated USING (public.goals_can_see(goal_id));

DROP POLICY IF EXISTS goal_entries_read ON public.goal_entries;
CREATE POLICY goal_entries_read ON public.goal_entries FOR SELECT TO authenticated USING (public.goals_can_see(goal_id));
DROP POLICY IF EXISTS goal_entries_insert ON public.goal_entries;
CREATE POLICY goal_entries_insert ON public.goal_entries FOR INSERT TO authenticated WITH CHECK (
  company_id = public.current_company_id() AND user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.goals g WHERE g.id = goal_id AND g.measure = 'manual' AND g.company_id = company_id)
  AND (public.goals_can_manage(company_id)
       OR EXISTS (SELECT 1 FROM public.goal_members m WHERE m.goal_id = goal_entries.goal_id AND m.user_id = auth.uid())));
DROP POLICY IF EXISTS goal_entries_delete ON public.goal_entries;
CREATE POLICY goal_entries_delete ON public.goal_entries FOR DELETE TO authenticated
  USING (public.goals_can_manage(company_id) OR user_id = auth.uid());

DROP POLICY IF EXISTS goal_snapshots_read ON public.goal_snapshots;
CREATE POLICY goal_snapshots_read ON public.goal_snapshots FOR SELECT TO authenticated USING (public.goals_can_see(goal_id));

DROP POLICY IF EXISTS goal_insights_read ON public.goal_insights;
CREATE POLICY goal_insights_read ON public.goal_insights FOR SELECT TO authenticated USING (
  company_id = public.current_company_id() AND (
    (kind = 'dica' AND user_id = auth.uid())
    OR (kind <> 'dica' AND (goal_id IS NULL AND public.goals_can_manage(company_id) OR goal_id IS NOT NULL AND public.goals_can_see(goal_id)))));
-- Decidir sugestão é só pela RPC goals_apply_insight / goals_dismiss_insight.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.goal_stages, public.goals, public.goal_members, public.goal_entries TO authenticated;
GRANT SELECT ON public.goal_periods, public.goal_snapshots, public.goal_insights TO authenticated;
GRANT ALL ON public.goal_stages, public.goals, public.goal_members, public.goal_periods, public.goal_entries,
  public.goal_snapshots, public.goal_insights TO service_role;
GRANT EXECUTE ON FUNCTION public.goals_can_manage(uuid), public.goals_can_see(uuid) TO authenticated;
