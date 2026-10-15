-- ============================================================================
-- Agenda com hierarquia (pessoal × equipe), tags da empresa/pessoais e
-- convite por link. Aditiva e reexecutável. Depende de 20261007180000 (equipe)
-- e 20261015120000 (Agenda/Lume), que rodam antes pela ordem dos arquivos.
-- ============================================================================

-- ---------- 1. Permissão agenda.team ----------
ALTER TABLE public.company_member_access DROP CONSTRAINT IF EXISTS company_member_access_permissions_check;
ALTER TABLE public.company_member_access ADD CONSTRAINT company_member_access_permissions_check
  CHECK (permissions <@ ARRAY['dashboard.view','conversations.read','conversations.reply','conversations.view_all',
    'conversations.assign','quotes.manage','agenda.manage','agenda.team','products.view','products.manage',
    'reports.view','campaigns.manage','ai.manage','settings.manage']::text[]);

-- ---------- 2. Dono, alcance e toda a equipe ----------
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'pessoal',
  ADD COLUMN IF NOT EXISTS everyone boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE public.visits ADD CONSTRAINT visits_scope_check CHECK (scope IN ('pessoal', 'equipe'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.visits ADD CONSTRAINT visits_everyone_team_only CHECK (scope = 'equipe' OR NOT everyone);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_visits_company_owner ON public.visits (company_id, owner_id);

-- Compromissos anteriores à hierarquia (sem dono): de toda a equipe, como sempre foram.
UPDATE public.visits SET scope = 'equipe', everyone = true WHERE owner_id IS NULL AND scope = 'pessoal';

CREATE OR REPLACE FUNCTION public.agenda_is_manager(_company uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN _company IS NOT NULL AND _company = public.current_company_id()
    AND (public.has_role(auth.uid(), _company, 'admin') OR public.team_has_permission('agenda.team'));
END; $$;

CREATE OR REPLACE FUNCTION public.agenda_can_see_row(_company uuid, _id uuid, _owner uuid, _scope text, _everyone boolean)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _company IS DISTINCT FROM public.current_company_id() THEN RETURN false; END IF;
  RETURN public.agenda_is_manager(_company)
    OR _owner = auth.uid()
    OR (_scope = 'equipe' AND (_everyone OR EXISTS (
      SELECT 1 FROM public.agenda_event_participants p WHERE p.event_id = _id AND p.user_id = auth.uid())));
END; $$;

CREATE OR REPLACE FUNCTION public.agenda_can_edit_row(_company uuid, _owner uuid, _scope text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _company IS DISTINCT FROM public.current_company_id() THEN RETURN false; END IF;
  RETURN public.agenda_is_manager(_company) OR (_scope = 'pessoal' AND _owner = auth.uid());
END; $$;

CREATE OR REPLACE FUNCTION public.agenda_can_see_event(_event uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.visits;
BEGIN
  SELECT * INTO v FROM public.visits WHERE id = _event;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN public.agenda_can_see_row(v.company_id, v.id, v.owner_id, v.scope, v.everyone);
END; $$;

CREATE OR REPLACE FUNCTION public.agenda_can_edit_event(_event uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.visits;
BEGIN
  SELECT * INTO v FROM public.visits WHERE id = _event;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN public.agenda_can_edit_row(v.company_id, v.owner_id, v.scope);
END; $$;

GRANT EXECUTE ON FUNCTION public.agenda_is_manager(uuid), public.agenda_can_see_event(uuid),
  public.agenda_can_edit_event(uuid) TO authenticated;

-- Dono automático e trava: funcionário só cria/edita pessoal dele e não muda alcance/dono.
CREATE OR REPLACE FUNCTION public.agenda_scope_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.owner_id IS NULL THEN NEW.owner_id := auth.uid(); END IF;
  IF auth.uid() IS NULL OR public.agenda_is_manager(NEW.company_id) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.scope <> 'pessoal' OR NEW.everyone OR NEW.owner_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Só a gestão da agenda cria compromissos da equipe' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.scope IS DISTINCT FROM OLD.scope OR NEW.everyone IS DISTINCT FROM OLD.everyone
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'Só a gestão da agenda muda alcance ou dono' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS agenda_scope_guard ON public.visits;
CREATE TRIGGER agenda_scope_guard BEFORE INSERT OR UPDATE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.agenda_scope_guard();

DROP POLICY IF EXISTS agenda_scope_read ON public.visits;
CREATE POLICY agenda_scope_read ON public.visits AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.agenda_can_see_row(company_id, id, owner_id, scope, everyone));
DROP POLICY IF EXISTS agenda_scope_insert ON public.visits;
CREATE POLICY agenda_scope_insert ON public.visits AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.agenda_can_edit_row(company_id, owner_id, scope));
DROP POLICY IF EXISTS agenda_scope_update ON public.visits;
CREATE POLICY agenda_scope_update ON public.visits AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.agenda_can_edit_row(company_id, owner_id, scope))
  WITH CHECK (public.agenda_can_edit_row(company_id, owner_id, scope));
DROP POLICY IF EXISTS agenda_scope_delete ON public.visits;
CREATE POLICY agenda_scope_delete ON public.visits AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.agenda_can_edit_row(company_id, owner_id, scope));

-- Itens do compromisso: ler/usar exige ver; participantes exigem editar.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agenda_checklist_items', 'agenda_field_logs', 'agenda_reminders'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS agenda_event_visible ON public.%I', t);
    EXECUTE format('CREATE POLICY agenda_event_visible ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.agenda_can_see_event(event_id)) WITH CHECK (public.agenda_can_see_event(event_id))', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS agenda_participants_read ON public.agenda_event_participants;
CREATE POLICY agenda_participants_read ON public.agenda_event_participants AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.agenda_can_see_event(event_id));
DROP POLICY IF EXISTS agenda_participants_write ON public.agenda_event_participants;
CREATE POLICY agenda_participants_write ON public.agenda_event_participants AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.agenda_can_edit_event(event_id));
DROP POLICY IF EXISTS agenda_participants_change ON public.agenda_event_participants;
CREATE POLICY agenda_participants_change ON public.agenda_event_participants AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.agenda_can_edit_event(event_id)) WITH CHECK (public.agenda_can_edit_event(event_id));
DROP POLICY IF EXISTS agenda_participants_remove ON public.agenda_event_participants;
CREATE POLICY agenda_participants_remove ON public.agenda_event_participants AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.agenda_can_edit_event(event_id));

-- ---------- 3. Tags da empresa e pessoais ----------
CREATE TABLE IF NOT EXISTS public.agenda_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Vazio = tag da empresa; preenchido = tag pessoal (só a dona vê).
  owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 40),
  hue integer NOT NULL DEFAULT 280 CHECK (hue BETWEEN 0 AND 360),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agenda_tags_unique_name ON public.agenda_tags
  (company_id, COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(trim(name)));

CREATE TABLE IF NOT EXISTS public.agenda_event_tags (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.agenda_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_agenda_event_tags_tag ON public.agenda_event_tags (tag_id);

CREATE OR REPLACE FUNCTION public.agenda_event_tag_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tag public.agenda_tags;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.id = NEW.event_id AND v.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Compromisso de outra empresa' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_tag FROM public.agenda_tags WHERE id = NEW.tag_id;
  IF NOT FOUND OR v_tag.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'Tag de outra empresa' USING ERRCODE = '42501';
  END IF;
  IF v_tag.owner_id IS NOT NULL AND auth.uid() IS NOT NULL AND v_tag.owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Tag pessoal de outra pessoa' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS agenda_event_tag_guard ON public.agenda_event_tags;
CREATE TRIGGER agenda_event_tag_guard BEFORE INSERT OR UPDATE ON public.agenda_event_tags
  FOR EACH ROW EXECUTE FUNCTION public.agenda_event_tag_guard();

ALTER TABLE public.agenda_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agenda_tags_read ON public.agenda_tags;
CREATE POLICY agenda_tags_read ON public.agenda_tags FOR SELECT TO authenticated
  USING (public.agenda_can_access(company_id, false) AND (owner_id IS NULL OR owner_id = auth.uid()));
DROP POLICY IF EXISTS agenda_tags_write ON public.agenda_tags;
CREATE POLICY agenda_tags_write ON public.agenda_tags FOR ALL TO authenticated
  USING (public.agenda_can_access(company_id, true)
    AND ((owner_id IS NULL AND public.agenda_is_manager(company_id)) OR owner_id = auth.uid()))
  WITH CHECK (public.agenda_can_access(company_id, true)
    AND ((owner_id IS NULL AND public.agenda_is_manager(company_id)) OR owner_id = auth.uid()));

ALTER TABLE public.agenda_event_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agenda_event_tags_read ON public.agenda_event_tags;
CREATE POLICY agenda_event_tags_read ON public.agenda_event_tags FOR SELECT TO authenticated
  USING (public.agenda_can_access(company_id, false) AND public.agenda_can_see_event(event_id));
DROP POLICY IF EXISTS agenda_event_tags_write ON public.agenda_event_tags;
CREATE POLICY agenda_event_tags_write ON public.agenda_event_tags FOR ALL TO authenticated
  USING (public.agenda_can_access(company_id, true) AND public.agenda_can_edit_event(event_id))
  WITH CHECK (public.agenda_can_access(company_id, true) AND public.agenda_can_edit_event(event_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_tags, public.agenda_event_tags TO authenticated;
