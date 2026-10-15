-- ============================================================================
-- Agenda Lume — base de dados (aditiva).
--
-- `visits` continua sendo a fonte dos compromissos: follow-up, recuperação,
-- atendimento e relatórios seguem lendo as mesmas colunas. Aqui só se ACRESCENTA:
--   * colunas opcionais em `visits` (autoria, fim, tipo da empresa, recorrência,
--     campos personalizados, origem e referência externa para o Google);
--   * tipos de evento por empresa, participantes, checklist, lembretes e o
--     histórico de alterações (quem mudou o quê, pela tela ou pela Lume);
--   * registro das ações da IA Lume (confirmação e desfazer), automações e
--     notificações dentro do Lume.
-- Acesso: mesma regra de `visits` (empresa + permissão "Gerenciar agenda").
-- ============================================================================

-- ---------- Colunas novas em visits ----------
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS all_day boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS event_type_id uuid,
  ADD COLUMN IF NOT EXISTS recurrence_rule text,
  ADD COLUMN IF NOT EXISTS recurrence_parent_id uuid,
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'tela',
  ADD COLUMN IF NOT EXISTS external_ref jsonb;

DO $$ BEGIN
  ALTER TABLE public.visits
    ADD CONSTRAINT visits_source_check
    CHECK (source IN ('tela', 'lume', 'atendimento', 'google', 'sistema'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.visits
    ADD CONSTRAINT visits_ends_after_start CHECK (ends_at IS NULL OR ends_at >= scheduled_at);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_visits_company_created_by ON public.visits (company_id, created_by);
CREATE INDEX IF NOT EXISTS idx_visits_recurrence_parent ON public.visits (recurrence_parent_id)
  WHERE recurrence_parent_id IS NOT NULL;

-- Função de acesso única para as tabelas da Agenda (mesma regra de visits): com o
-- módulo de equipe instalado, exige "Gerenciar agenda"; sem ele, basta ser da empresa.
CREATE OR REPLACE FUNCTION public.agenda_can_access(_company uuid, _write boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_allowed boolean;
BEGIN
  IF _company IS NULL OR _company IS DISTINCT FROM public.current_company_id() THEN
    RETURN false;
  END IF;
  IF to_regprocedure('public.team_table_access(text,boolean,uuid)') IS NULL THEN
    RETURN true;
  END IF;
  EXECUTE 'SELECT public.team_table_access($1, $2, $3)' INTO v_allowed USING 'visits', _write, _company;
  RETURN COALESCE(v_allowed, false);
END; $$;
GRANT EXECUTE ON FUNCTION public.agenda_can_access(uuid, boolean) TO authenticated;

-- ---------- Tipos de evento por empresa ----------
CREATE TABLE IF NOT EXISTS public.agenda_event_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  -- Matiz OKLCH (0–360) da luz do tipo na Agenda.
  hue integer NOT NULL DEFAULT 300 CHECK (hue BETWEEN 0 AND 360),
  icon text NOT NULL DEFAULT 'calendar',
  kind text NOT NULL DEFAULT 'compromisso'
    CHECK (kind IN ('compromisso', 'visita', 'reuniao', 'tarefa', 'lembrete', 'bloqueio')),
  default_duration_min integer NOT NULL DEFAULT 60 CHECK (default_duration_min BETWEEN 5 AND 1440),
  requires_customer boolean NOT NULL DEFAULT false,
  requires_address boolean NOT NULL DEFAULT false,
  -- Itens padrão do checklist: ["Medir área", "Tirar fotos"].
  checklist_template jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Campos personalizados: [{ "key": "placa", "label": "Placa", "type": "text" }].
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Ligação com o tipo legado de visits, quando houver.
  legacy_type public.appointment_type,
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_agenda_event_types_company ON public.agenda_event_types (company_id, position);

DO $$ BEGIN
  ALTER TABLE public.visits
    ADD CONSTRAINT visits_event_type_fk FOREIGN KEY (event_type_id)
    REFERENCES public.agenda_event_types(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Participantes ----------
CREATE TABLE IF NOT EXISTS public.agenda_event_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  -- Membro da equipe (quando tem conta) ou só um nome.
  user_id uuid,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  role text NOT NULL DEFAULT 'participante'
    CHECK (role IN ('responsavel', 'participante', 'tecnico', 'vendedor')),
  response text NOT NULL DEFAULT 'pendente' CHECK (response IN ('pendente', 'aceito', 'recusado')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agenda_participants_event ON public.agenda_event_participants (event_id);
CREATE INDEX IF NOT EXISTS idx_agenda_participants_user ON public.agenda_event_participants (company_id, user_id);

-- ---------- Checklist ----------
CREATE TABLE IF NOT EXISTS public.agenda_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  done boolean NOT NULL DEFAULT false,
  done_by uuid,
  done_at timestamptz,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agenda_checklist_event ON public.agenda_checklist_items (event_id, position);

-- ---------- Registro de campo (chegada, saída, relatório, anexos) ----------
CREATE TABLE IF NOT EXISTS public.agenda_field_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('chegada', 'saida', 'relatorio', 'anexo', 'confirmacao_cliente')),
  author_id uuid,
  author_name text,
  note text,
  -- Caminho no storage para anexos; coordenadas opcionais na chegada/saída.
  storage_path text,
  latitude double precision,
  longitude double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agenda_field_logs_event ON public.agenda_field_logs (event_id, created_at);

-- ---------- Lembretes ----------
CREATE TABLE IF NOT EXISTS public.agenda_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  -- Minutos antes do início.
  offset_min integer NOT NULL DEFAULT 30 CHECK (offset_min BETWEEN 0 AND 43200),
  channel text NOT NULL DEFAULT 'app' CHECK (channel IN ('app', 'email')),
  -- Quem recebe; nulo = participantes do evento.
  user_id uuid,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviado', 'falhou', 'cancelado')),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agenda_reminders_pending ON public.agenda_reminders (status, company_id)
  WHERE status = 'pendente';

-- ---------- Histórico de alterações ----------
CREATE TABLE IF NOT EXISTS public.agenda_event_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Sem FK: o histórico de um evento excluído continua consultável.
  event_id uuid NOT NULL,
  actor_id uuid,
  actor_name text,
  source text NOT NULL DEFAULT 'tela',
  action text NOT NULL CHECK (action IN ('criado', 'alterado', 'excluido')),
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agenda_history_event ON public.agenda_event_history (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agenda_history_company ON public.agenda_event_history (company_id, created_at DESC);

-- Autoria: preenchida pelo banco, nunca confiada ao cliente.
CREATE OR REPLACE FUNCTION public.agenda_stamp_author()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
    NEW.updated_by := NEW.created_by;
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS agenda_stamp_author ON public.visits;
CREATE TRIGGER agenda_stamp_author BEFORE INSERT OR UPDATE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.agenda_stamp_author();

-- Histórico: guarda só os campos que mudaram (antes → depois).
CREATE OR REPLACE FUNCTION public.agenda_log_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_old jsonb := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_actor uuid := auth.uid();
  v_name text;
  v_headers jsonb;
  v_source text;
BEGIN
  -- Quem pediu: a Lume manda o cabeçalho x-lume-source em cada requisição.
  BEGIN
    v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN v_headers := NULL;
  END;
  v_source := COALESCE(
    NULLIF(v_headers->>'x-lume-source', ''),
    NULLIF(current_setting('lume.source', true), ''),
    CASE WHEN TG_OP = 'INSERT' THEN v_row->>'source' END,
    'tela'
  );
  IF v_source NOT IN ('tela', 'lume', 'atendimento', 'google', 'sistema') THEN
    v_source := 'tela';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_row) LOOP
      CONTINUE WHEN v_key IN ('updated_at', 'updated_by', 'created_by', 'created_at');
      IF v_row->v_key IS DISTINCT FROM v_old->v_key THEN
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('de', v_old->v_key, 'para', v_row->v_key));
      END IF;
    END LOOP;
    IF v_changes = '{}'::jsonb THEN RETURN NULL; END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_changes := jsonb_build_object('titulo', v_row->'title', 'inicio', v_row->'scheduled_at');
  ELSE
    v_changes := jsonb_build_object('titulo', v_row->'title', 'inicio', v_row->'scheduled_at');
  END IF;
  IF v_actor IS NOT NULL THEN
    SELECT display_name INTO v_name FROM public.profiles WHERE id = v_actor;
  END IF;
  INSERT INTO public.agenda_event_history (company_id, event_id, actor_id, actor_name, source, action, changes)
  VALUES (
    (v_row->>'company_id')::uuid,
    (v_row->>'id')::uuid,
    v_actor,
    v_name,
    v_source,
    CASE TG_OP WHEN 'INSERT' THEN 'criado' WHEN 'UPDATE' THEN 'alterado' ELSE 'excluido' END,
    v_changes
  );
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS agenda_log_history ON public.visits;
CREATE TRIGGER agenda_log_history AFTER INSERT OR UPDATE OR DELETE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.agenda_log_history();

-- ---------- IA Lume: ações, automações e notificações ----------
-- Cada pedido feito à Lume que muda dados vira uma linha: executada, aguardando
-- confirmação, confirmada, cancelada, desfeita ou com falha. `undo` guarda como voltar.
CREATE TABLE IF NOT EXISTS public.lume_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  domain text NOT NULL DEFAULT 'agenda',
  tool text NOT NULL,
  summary text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'executada', 'confirmada', 'cancelada', 'desfeita', 'falhou')),
  result jsonb,
  undo jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_lume_actions_company ON public.lume_actions (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lume_actions_user ON public.lume_actions (user_id, created_at DESC);

-- Regras "quando X, faça Y" criadas pela tela ou pedidas à Lume.
CREATE TABLE IF NOT EXISTS public.lume_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  domain text NOT NULL DEFAULT 'agenda',
  -- Ex.: { "event": "agenda.event_created", "where": { "type": "Instalação" } }
  trigger jsonb NOT NULL,
  -- Ex.: [{ "type": "reminder", "offset_min": 60, "channel": "app" }]
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lume_automations_company ON public.lume_automations (company_id, domain)
  WHERE enabled;

CREATE TABLE IF NOT EXISTS public.lume_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  domain text NOT NULL DEFAULT 'agenda',
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lume_notifications_user ON public.lume_notifications (user_id, created_at DESC);

-- ---------- Acesso (RLS) ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agenda_event_types', 'agenda_event_participants', 'agenda_checklist_items',
    'agenda_field_logs', 'agenda_reminders'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS agenda_read ON public.%I', t);
    EXECUTE format('CREATE POLICY agenda_read ON public.%I FOR SELECT TO authenticated USING (public.agenda_can_access(company_id, false))', t);
    EXECUTE format('DROP POLICY IF EXISTS agenda_insert ON public.%I', t);
    EXECUTE format('CREATE POLICY agenda_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.agenda_can_access(company_id, true))', t);
    EXECUTE format('DROP POLICY IF EXISTS agenda_update ON public.%I', t);
    EXECUTE format('CREATE POLICY agenda_update ON public.%I FOR UPDATE TO authenticated USING (public.agenda_can_access(company_id, true)) WITH CHECK (public.agenda_can_access(company_id, true))', t);
    EXECUTE format('DROP POLICY IF EXISTS agenda_delete ON public.%I', t);
    EXECUTE format('CREATE POLICY agenda_delete ON public.%I FOR DELETE TO authenticated USING (public.agenda_can_access(company_id, true))', t);
  END LOOP;
END $$;

-- Histórico: leitura para quem acessa a agenda; escrita só pelo gatilho.
ALTER TABLE public.agenda_event_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agenda_history_read ON public.agenda_event_history;
CREATE POLICY agenda_history_read ON public.agenda_event_history FOR SELECT TO authenticated
  USING (public.agenda_can_access(company_id, false));

-- Ações da Lume: cada pessoa vê e decide as próprias; o servidor grava.
ALTER TABLE public.lume_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lume_actions_own ON public.lume_actions;
CREATE POLICY lume_actions_own ON public.lume_actions FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND company_id = public.current_company_id());

ALTER TABLE public.lume_automations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lume_automations_read ON public.lume_automations;
CREATE POLICY lume_automations_read ON public.lume_automations FOR SELECT TO authenticated
  USING (public.agenda_can_access(company_id, false));
DROP POLICY IF EXISTS lume_automations_write ON public.lume_automations;
CREATE POLICY lume_automations_write ON public.lume_automations FOR ALL TO authenticated
  USING (public.agenda_can_access(company_id, true))
  WITH CHECK (public.agenda_can_access(company_id, true));

ALTER TABLE public.lume_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lume_notifications_own ON public.lume_notifications;
CREATE POLICY lume_notifications_own ON public.lume_notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND company_id = public.current_company_id());
-- Avisar colegas: quem gerencia a agenda pode notificar pessoas da própria empresa.
DROP POLICY IF EXISTS lume_notifications_send ON public.lume_notifications;
CREATE POLICY lume_notifications_send ON public.lume_notifications FOR INSERT TO authenticated
  WITH CHECK (
    public.agenda_can_access(company_id, true)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = lume_notifications.user_id AND p.company_id = lume_notifications.company_id
    )
  );
DROP POLICY IF EXISTS lume_notifications_mark_read ON public.lume_notifications;
CREATE POLICY lume_notifications_mark_read ON public.lume_notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND company_id = public.current_company_id())
  WITH CHECK (user_id = auth.uid() AND company_id = public.current_company_id());

-- Tempo real para a tela atualizar quando a Lume ou outra pessoa mexe.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['visits', 'agenda_checklist_items', 'agenda_event_history', 'lume_notifications'] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

-- updated_at dos tipos e automações.
DROP TRIGGER IF EXISTS trg_agenda_event_types_updated ON public.agenda_event_types;
CREATE TRIGGER trg_agenda_event_types_updated BEFORE UPDATE ON public.agenda_event_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_lume_automations_updated ON public.lume_automations;
CREATE TRIGGER trg_lume_automations_updated BEFORE UPDATE ON public.lume_automations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
