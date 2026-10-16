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

-- ---------- 4. Convite por link e aprovação ----------
-- Quem não tem conta cria a conta normalmente (com as verificações) e depois
-- abre o link: o popup confirma e a conta passa para a equipe do convite.
ALTER TABLE public.company_member_access
  ADD COLUMN IF NOT EXISTS approval_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS joined_via_link uuid;

CREATE TABLE IF NOT EXISTS public.company_invite_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- 64 hex (2 × UUID v4 = 244 bits aleatórios), sem depender de pgcrypto.
  token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  label text CHECK (label IS NULL OR char_length(label) <= 60),
  role public.app_role NOT NULL DEFAULT 'atendente' CHECK (role <> 'admin'),
  permissions text[] NOT NULL DEFAULT ARRAY['conversations.read','conversations.reply','quotes.manage','agenda.manage','products.view'],
  requires_approval boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  uses integer NOT NULL DEFAULT 0,
  created_by uuid,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (permissions <@ ARRAY['dashboard.view','conversations.read','conversations.reply','conversations.view_all',
    'conversations.assign','quotes.manage','agenda.manage','agenda.team','products.view','products.manage','reports.view']::text[])
);
ALTER TABLE public.company_invite_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_invite_links FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.team_link_usable(_link public.company_invite_links)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT _link.id IS NOT NULL AND _link.revoked_at IS NULL
    AND (_link.expires_at IS NULL OR _link.expires_at > now())
    AND (_link.max_uses IS NULL OR _link.uses < _link.max_uses);
$$;

CREATE OR REPLACE FUNCTION public.team_create_invite_link(_role public.app_role, _permissions text[],
  _requires_approval boolean, _expires_in_days integer, _max_uses integer, _label text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid := public.current_company_id(); v_link public.company_invite_links;
BEGIN
  IF NOT public.has_role(auth.uid(), v_company, 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores criam convites' USING ERRCODE = '42501';
  END IF;
  IF _role = 'admin' THEN
    RAISE EXCEPTION 'Link de convite não concede administrador. Promova depois em Usuários e Permissões.';
  END IF;
  INSERT INTO public.company_invite_links (company_id, label, role, permissions, requires_approval, expires_at, max_uses, created_by)
  VALUES (v_company, NULLIF(trim(_label), ''), _role, COALESCE(_permissions, ARRAY[]::text[]),
    COALESCE(_requires_approval, false),
    CASE WHEN _expires_in_days IS NULL THEN NULL ELSE now() + make_interval(days => _expires_in_days) END,
    _max_uses, auth.uid())
  RETURNING * INTO v_link;
  RETURN to_jsonb(v_link);
END; $$;

CREATE OR REPLACE FUNCTION public.team_list_invite_links()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), public.current_company_id(), 'admin') THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC) FROM public.company_invite_links l
    WHERE l.company_id = public.current_company_id()), '[]'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.team_revoke_invite_link(_link uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), public.current_company_id(), 'admin') THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  UPDATE public.company_invite_links SET revoked_at = now()
  WHERE id = _link AND company_id = public.current_company_id() AND revoked_at IS NULL;
END; $$;

-- Pública de propósito: sem login, só o nome da equipe e se o link vale.
-- Logado: também a equipe atual, se já é membro e se pode trocar.
CREATE OR REPLACE FUNCTION public.team_invite_link_info(_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link public.company_invite_links; v_name text; v_me public.profiles; v_has_data boolean;
BEGIN
  SELECT * INTO v_link FROM public.company_invite_links WHERE token = _token;
  IF NOT public.team_link_usable(v_link) THEN
    RETURN jsonb_build_object('valid', false, 'company', NULL, 'requiresApproval', false);
  END IF;
  SELECT name INTO v_name FROM public.companies WHERE id = v_link.company_id;
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('valid', true, 'company', v_name, 'requiresApproval', v_link.requires_approval);
  END IF;
  SELECT * INTO v_me FROM public.profiles WHERE id = auth.uid();
  -- Equipe com dados: leads/conversas, compromissos, orçamentos ou um canal conectado.
  v_has_data := EXISTS (SELECT 1 FROM public.leads WHERE company_id = v_me.company_id)
    OR EXISTS (SELECT 1 FROM public.visits WHERE company_id = v_me.company_id)
    OR EXISTS (SELECT 1 FROM public.quotes WHERE company_id = v_me.company_id);
  IF NOT v_has_data AND to_regclass('public.integrations') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.integrations WHERE company_id = $1)'
      INTO v_has_data USING v_me.company_id;
  END IF;
  RETURN jsonb_build_object(
    'valid', true,
    'company', v_name,
    'requiresApproval', v_link.requires_approval,
    'currentTeam', (SELECT name FROM public.companies WHERE id = v_me.company_id),
    'alreadyMember', v_me.company_id = v_link.company_id,
    'canSwitch', NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.company_id = v_me.company_id AND p.id <> v_me.id),
    'currentTeamHasData', COALESCE(v_has_data, false)
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.team_invite_link_info(text) TO anon, authenticated;

-- Troca de empresa do perfil: liberada só pelas RPCs de convite (marca da transação).
CREATE OR REPLACE FUNCTION public.team_guard_profile() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (
       (NEW.company_id IS DISTINCT FROM OLD.company_id AND COALESCE(current_setting('lume.team_move', true), '') <> 'on')
    OR NEW.id IS DISTINCT FROM OLD.id
    OR (OLD.id <> auth.uid() AND NOT public.has_role(auth.uid(), OLD.company_id, 'admin'))) THEN
    RAISE EXCEPTION 'Alteração de perfil não autorizada' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.team_guard_profile() FROM PUBLIC, anon, authenticated;

-- Entrar pelo link: a conta (sozinha na equipe atual) passa para a equipe do convite.
CREATE OR REPLACE FUNCTION public.team_join_via_link(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_me public.profiles; v_link public.company_invite_links;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Entre na sua conta' USING ERRCODE = '42501'; END IF;
  -- FOR UPDATE: duas pessoas ao mesmo tempo não passam do limite de usos.
  SELECT * INTO v_link FROM public.company_invite_links WHERE token = _token FOR UPDATE;
  IF NOT public.team_link_usable(v_link) THEN
    RAISE EXCEPTION 'Link de convite inválido, expirado ou esgotado';
  END IF;
  SELECT * INTO v_me FROM public.profiles WHERE id = v_uid;
  IF v_me.company_id = v_link.company_id THEN RETURN jsonb_build_object('status', 'already_member'); END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.company_id = v_me.company_id AND p.id <> v_uid) THEN
    RAISE EXCEPTION 'Sua conta faz parte de uma equipe com outras pessoas. Use outro e-mail para entrar nesta equipe.';
  END IF;
  PERFORM set_config('lume.team_move', 'on', true);
  -- A equipe antiga fica sem ninguém: fecha os convites dela para ninguém entrar sem admin.
  UPDATE public.company_invite_links SET revoked_at = now()
  WHERE company_id = v_me.company_id AND revoked_at IS NULL;
  UPDATE public.company_invites SET cancelled_at = now()
  WHERE company_id = v_me.company_id AND accepted_at IS NULL AND cancelled_at IS NULL;
  DELETE FROM public.user_roles WHERE user_id = v_uid AND company_id = v_me.company_id;
  DELETE FROM public.company_member_access WHERE user_id = v_uid AND company_id = v_me.company_id;
  UPDATE public.profiles SET company_id = v_link.company_id WHERE id = v_uid;
  INSERT INTO public.user_roles(company_id, user_id, role) VALUES (v_link.company_id, v_uid, v_link.role);
  INSERT INTO public.company_member_access(company_id, user_id, active, permissions, approval_pending, joined_via_link)
  VALUES (v_link.company_id, v_uid, NOT v_link.requires_approval, v_link.permissions, v_link.requires_approval, v_link.id);
  UPDATE public.company_invite_links SET uses = uses + 1 WHERE id = v_link.id;
  PERFORM set_config('lume.team_move', 'off', true);
  RETURN jsonb_build_object('status', CASE WHEN v_link.requires_approval THEN 'pending_approval' ELSE 'joined' END);
END; $$;

-- Aguardando aprovação? (funciona sem acesso ativo: usa auth.uid() direto).
CREATE OR REPLACE FUNCTION public.team_my_pending_join()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_access public.company_member_access; v_name text;
BEGIN
  SELECT a.* INTO v_access FROM public.company_member_access a
    JOIN public.profiles p ON p.id = a.user_id AND p.company_id = a.company_id
  WHERE a.user_id = auth.uid();
  IF NOT FOUND OR NOT v_access.approval_pending THEN RETURN NULL; END IF;
  SELECT name INTO v_name FROM public.companies WHERE id = v_access.company_id;
  RETURN jsonb_build_object('state', 'waiting', 'company', v_name);
END; $$;

CREATE OR REPLACE FUNCTION public.team_approve_member(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid := public.current_company_id();
BEGIN
  IF NOT public.has_role(auth.uid(), v_company, 'admin') THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501'; END IF;
  UPDATE public.company_member_access SET active = true, approval_pending = false
  WHERE user_id = _user AND company_id = v_company AND approval_pending;
END; $$;

-- Devolve uma conta (que aguardava aprovação) para uma equipe própria, como admin.
-- Uso interno: recusa do admin ou desistência da própria pessoa. Ninguém fica preso.
CREATE OR REPLACE FUNCTION public.team_send_home(_user uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old uuid; v_company uuid;
BEGIN
  SELECT company_id INTO v_old FROM public.profiles WHERE id = _user;
  INSERT INTO public.companies(name) VALUES ('Minha Empresa') RETURNING id INTO v_company;
  INSERT INTO public.company_settings(company_id) VALUES (v_company);
  PERFORM set_config('lume.team_move', 'on', true);
  DELETE FROM public.user_roles WHERE user_id = _user AND company_id = v_old;
  DELETE FROM public.company_member_access WHERE user_id = _user AND company_id = v_old;
  UPDATE public.profiles SET company_id = v_company WHERE id = _user;
  INSERT INTO public.user_roles(company_id, user_id, role) VALUES (v_company, _user, 'admin');
  INSERT INTO public.company_member_access(company_id, user_id) VALUES (v_company, _user);
  PERFORM set_config('lume.team_move', 'off', true);
  RETURN v_company;
END; $$;
REVOKE ALL ON FUNCTION public.team_send_home(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.team_reject_member(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid := public.current_company_id();
BEGIN
  IF NOT public.has_role(auth.uid(), v_company, 'admin') THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.company_member_access
             WHERE user_id = _user AND company_id = v_company AND approval_pending) THEN
    PERFORM public.team_send_home(_user);
  END IF;
END; $$;

-- Quem aguarda aprovação pode desistir e voltar para uma equipe própria.
CREATE OR REPLACE FUNCTION public.team_cancel_join_request()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre na sua conta' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.company_member_access a JOIN public.profiles p
                   ON p.id = a.user_id AND p.company_id = a.company_id
                 WHERE a.user_id = auth.uid() AND a.approval_pending) THEN
    RAISE EXCEPTION 'Não há pedido aguardando aprovação';
  END IF;
  PERFORM public.team_send_home(auth.uid());
END; $$;

CREATE OR REPLACE FUNCTION public.team_rename_company(_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid := public.current_company_id();
BEGIN
  IF NOT public.has_role(auth.uid(), v_company, 'admin') THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501'; END IF;
  IF _name IS NULL OR char_length(trim(_name)) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Nome da equipe deve ter de 2 a 80 caracteres';
  END IF;
  UPDATE public.companies SET name = trim(_name) WHERE id = v_company;
END; $$;

-- Lista de membros com a pendência de aprovação.
CREATE OR REPLACE FUNCTION public.team_list_users() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), public.current_company_id(), 'admin') THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'displayName', p.display_name, 'email', p.email,
    'createdAt', p.created_at, 'lastSeenAt', p.last_seen_at,
    'role', (SELECT role FROM user_roles WHERE user_id = p.id AND company_id = p.company_id
             ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'financeiro' THEN 1 ELSE 2 END LIMIT 1),
    'active', a.active, 'permissions', a.permissions, 'approvalPending', a.approval_pending) ORDER BY p.created_at)
    FROM profiles p JOIN company_member_access a ON a.user_id = p.id AND a.company_id = p.company_id
    WHERE p.company_id = public.current_company_id()), '[]'::jsonb);
END; $$;

GRANT EXECUTE ON FUNCTION
  public.team_create_invite_link(public.app_role, text[], boolean, integer, integer, text),
  public.team_list_invite_links(), public.team_revoke_invite_link(uuid), public.team_join_via_link(text),
  public.team_my_pending_join(), public.team_approve_member(uuid), public.team_reject_member(uuid),
  public.team_cancel_join_request(), public.team_rename_company(text) TO authenticated;

-- ---------- 5. Histórico e recuperação respeitam a agenda pessoal ----------
-- O histórico só aparece para quem vê o compromisso; de compromisso excluído, só a gestão.
DROP POLICY IF EXISTS agenda_history_scope ON public.agenda_event_history;
CREATE POLICY agenda_history_scope ON public.agenda_event_history AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.agenda_can_see_event(event_id) OR public.agenda_is_manager(company_id));

-- Recuperação de leads: precisa saber se o lead já tem visita, mesmo agendada por um
-- colega (a agenda pessoal dele é invisível para os outros). Devolve só lead, data e status.
CREATE OR REPLACE FUNCTION public.agenda_lead_visits(_leads uuid[])
RETURNS TABLE (lead_id uuid, scheduled_at timestamptz, status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid := public.current_company_id();
BEGIN
  IF v_company IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT v.lead_id, v.scheduled_at, v.status::text
    FROM public.visits v
    WHERE v.company_id = v_company AND v.lead_id = ANY (_leads)
      AND public.team_can_read_lead(v.lead_id);
END; $$;
REVOKE ALL ON FUNCTION public.agenda_lead_visits(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_lead_visits(uuid[]) TO authenticated;
