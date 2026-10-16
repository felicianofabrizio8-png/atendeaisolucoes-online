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

-- ---------- 5. Indicadores e progresso ----------
-- "Agora" das metas: o relógio do banco, ou uma data fixa em testes
-- (SELECT set_config('lume.goals_now', '2026-10-31T12:00:00-03:00', false)).
CREATE OR REPLACE FUNCTION public.goals_now()
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('lume.goals_now', true), '')::timestamptz, now());
$$;

-- Cálculo bruto: lê leads/orçamentos/mensagens/agenda ignorando RLS, então
-- NÃO pode ser chamado pela API. Só as RPCs abaixo (que conferem acesso) usam.
-- _users NULL = toda a empresa (inclui registros sem responsável).
CREATE OR REPLACE FUNCTION public.goals_metric_raw(_company uuid, _metric text, _from timestamptz, _to timestamptz, _users uuid[])
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v numeric; n numeric; d numeric;
BEGIN
  IF _metric = 'receita_fechada' THEN
    SELECT sum(l.closed_value) INTO v FROM leads l
    WHERE l.company_id = _company AND l.status = 'fechado' AND l.closed_at >= _from AND l.closed_at < _to
      AND (_users IS NULL OR l.assigned_to = ANY (_users));
  ELSIF _metric = 'vendas_fechadas' THEN
    SELECT count(*) INTO v FROM leads l
    WHERE l.company_id = _company AND l.status = 'fechado' AND l.closed_at >= _from AND l.closed_at < _to
      AND (_users IS NULL OR l.assigned_to = ANY (_users));
  ELSIF _metric = 'leads_novos' THEN
    SELECT count(*) INTO v FROM leads l
    WHERE l.company_id = _company AND l.created_at >= _from AND l.created_at < _to
      AND (_users IS NULL OR l.assigned_to = ANY (_users));
  ELSIF _metric = 'taxa_conversao' THEN
    n := public.goals_metric_raw(_company, 'vendas_fechadas', _from, _to, _users);
    d := public.goals_metric_raw(_company, 'leads_novos', _from, _to, _users);
    v := CASE WHEN d > 0 THEN round(n * 100.0 / d, 1) END;
  ELSIF _metric = 'orcamentos_criados' THEN
    SELECT count(*) INTO v FROM quotes q LEFT JOIN leads l ON l.id = q.lead_id
    WHERE q.company_id = _company AND q.created_at >= _from AND q.created_at < _to
      AND (_users IS NULL OR l.assigned_to = ANY (_users));
  ELSIF _metric = 'orcamentos_enviados' THEN
    SELECT count(*) INTO v FROM quotes q LEFT JOIN leads l ON l.id = q.lead_id
    WHERE q.company_id = _company AND q.status <> 'rascunho'
      AND coalesce(q.sent_at, q.created_at) >= _from AND coalesce(q.sent_at, q.created_at) < _to
      AND (_users IS NULL OR l.assigned_to = ANY (_users));
  ELSIF _metric = 'conversas_respondidas' THEN
    SELECT count(DISTINCT c.id) INTO v FROM conversations c JOIN leads l ON l.id = c.lead_id
    WHERE c.company_id = _company AND (_users IS NULL OR l.assigned_to = ANY (_users))
      AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'agent' AND m.at >= _from AND m.at < _to);
  ELSIF _metric = 'tempo_primeira_resposta' THEN
    SELECT round(avg(extract(epoch FROM (fa.at - fl.at)) / 60)::numeric, 1) INTO v
    FROM conversations c JOIN leads l ON l.id = c.lead_id
    CROSS JOIN LATERAL (SELECT min(m.at) AS at FROM messages m WHERE m.conversation_id = c.id AND m.role = 'lead') fl
    CROSS JOIN LATERAL (SELECT min(m.at) AS at FROM messages m WHERE m.conversation_id = c.id AND m.role = 'agent' AND m.at >= fl.at) fa
    WHERE c.company_id = _company AND fl.at >= _from AND fl.at < _to AND fa.at IS NOT NULL
      AND (_users IS NULL OR l.assigned_to = ANY (_users));
  ELSIF _metric = 'compromissos_concluidos' THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'visits' AND column_name = 'owner_id') THEN
      EXECUTE 'SELECT count(*) FROM public.visits WHERE company_id = $1 AND status = ''concluida''
               AND scheduled_at >= $2 AND scheduled_at < $3 AND ($4 IS NULL OR owner_id = ANY ($4))'
        INTO v USING _company, _from, _to, _users;
    END IF;
  END IF;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.goals_value(_goal uuid, _from timestamptz, _to timestamptz, _users uuid[])
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE g public.goals; v numeric;
BEGIN
  SELECT * INTO g FROM public.goals WHERE id = _goal;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF g.measure = 'manual' THEN
    SELECT sum(e.amount) INTO v FROM public.goal_entries e
    WHERE e.goal_id = g.id AND e.created_at >= _from AND e.created_at < _to
      AND (_users IS NULL OR e.user_id = ANY (_users));
    RETURN v;
  END IF;
  RETURN public.goals_metric_raw(g.company_id, g.metric, _from, _to, _users);
END; $$;

CREATE OR REPLACE FUNCTION public.goals_progress_for(_company uuid, _check boolean, _goal_ids uuid[])
RETURNS TABLE (goal_id uuid, period_id uuid, period_start date, period_end date, value numeric, weeks jsonb, contributions jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g public.goals; p public.goal_periods; users uuid[]; w date; ws date; we date;
  today date := (public.goals_now() AT TIME ZONE 'America/Sao_Paulo')::date;
  manager boolean := CASE WHEN _check THEN public.goals_can_manage(_company) ELSE true END;
BEGIN
  FOR g IN SELECT * FROM public.goals x WHERE x.company_id = _company AND x.archived_at IS NULL
                AND (_goal_ids IS NULL OR x.id = ANY (_goal_ids)) ORDER BY x.created_at LOOP
    CONTINUE WHEN _check AND NOT public.goals_can_see(g.id);
    SELECT * INTO p FROM public.goal_periods gp WHERE gp.goal_id = g.id AND gp.closed_at IS NULL ORDER BY gp.starts_on DESC LIMIT 1;
    CONTINUE WHEN NOT FOUND;
    users := CASE WHEN g.scope = 'empresa' THEN NULL ELSE (SELECT array_agg(m.user_id) FROM public.goal_members m WHERE m.goal_id = g.id) END;
    goal_id := g.id; period_id := p.id; period_start := p.starts_on; period_end := p.ends_on;
    value := public.goals_value(g.id, public.goals_day_start(p.starts_on), public.goals_day_start(least(p.ends_on, today) + 1), users);
    weeks := '[]'::jsonb;
    w := date_trunc('week', p.starts_on)::date;
    WHILE w <= p.ends_on LOOP
      ws := greatest(w, p.starts_on); we := least(w + 6, p.ends_on);
      weeks := weeks || jsonb_build_object('startsOn', ws, 'endsOn', we, 'actual',
        CASE WHEN ws > today THEN NULL
             ELSE coalesce(public.goals_value(g.id, public.goals_day_start(ws), public.goals_day_start(least(we, today) + 1), users), 0) END);
      w := w + 7;
    END LOOP;
    IF manager OR g.scope = 'empresa' THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('userId', s.user_id, 'value', s.v) ORDER BY s.v DESC), '[]'::jsonb) INTO contributions
      FROM (
        SELECT u.user_id, public.goals_value(g.id, public.goals_day_start(p.starts_on), public.goals_day_start(least(p.ends_on, today) + 1), ARRAY[u.user_id]) AS v
        FROM (SELECT m.user_id FROM public.goal_members m WHERE m.goal_id = g.id AND g.scope <> 'empresa'
              UNION SELECT a.user_id FROM public.company_member_access a WHERE a.company_id = g.company_id AND g.scope = 'empresa') u
      ) s WHERE s.v IS NOT NULL AND s.v <> 0;
    ELSE
      contributions := '[]'::jsonb;
    END IF;
    RETURN NEXT;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.goals_progress(_goal_ids uuid[] DEFAULT NULL)
RETURNS TABLE (goal_id uuid, period_id uuid, period_start date, period_end date, value numeric, weeks jsonb, contributions jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.goals_progress_for(public.current_company_id(), true, _goal_ids);
$$;

REVOKE ALL ON FUNCTION public.goals_metric_raw(uuid, text, timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.goals_value(uuid, timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.goals_progress_for(uuid, boolean, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.goals_metric_raw(uuid, text, timestamptz, timestamptz, uuid[]),
  public.goals_value(uuid, timestamptz, timestamptz, uuid[]),
  public.goals_progress_for(uuid, boolean, uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.goals_progress(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.goals_progress(uuid[]) TO authenticated;

-- ---------- 5b. Integridade dos lançamentos manuais ----------
-- O lançamento vale para "agora" e para quem lança: nada de retroagir a data
-- para cair em outro período, nem lançar em nome de outra pessoa (o gestor
-- também lança como ele mesmo). Período precisa ser da mesma meta e aberto.
CREATE OR REPLACE FUNCTION public.goals_entry_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN -- pedido de uma pessoa (a rotina usa a chave de serviço, sem usuário)
    NEW.created_at := public.goals_now();
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'O lançamento é sempre de quem lança.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.goal_periods p
    WHERE p.id = NEW.period_id AND p.goal_id = NEW.goal_id AND p.closed_at IS NULL
      AND (NEW.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p.starts_on AND p.ends_on) THEN
    RAISE EXCEPTION 'Período inválido ou fechado para este lançamento.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS goals_entry_guard ON public.goal_entries;
CREATE TRIGGER goals_entry_guard BEFORE INSERT ON public.goal_entries
  FOR EACH ROW EXECUTE FUNCTION public.goals_entry_guard();

-- Lançamento não é editado: corrige-se apagando (período aberto) e lançando de novo.
REVOKE UPDATE ON public.goal_entries FROM authenticated;
DROP POLICY IF EXISTS goal_entries_delete ON public.goal_entries;
CREATE POLICY goal_entries_delete ON public.goal_entries FOR DELETE TO authenticated USING (
  public.goals_can_manage(company_id)
  OR (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.goal_periods p WHERE p.id = period_id AND p.closed_at IS NULL)));
