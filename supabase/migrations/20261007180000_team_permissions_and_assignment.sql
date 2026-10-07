-- Lume team access. Existing owners remain admins; invitations join the same tenant.
BEGIN;

CREATE TABLE public.company_member_access (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  permissions text[] NOT NULL DEFAULT ARRAY['conversations.read','conversations.reply','quotes.manage','agenda.manage','products.view'],
  PRIMARY KEY (company_id, user_id),
  CHECK (permissions <@ ARRAY['dashboard.view','conversations.read','conversations.reply','conversations.view_all','conversations.assign','quotes.manage','agenda.manage','products.view','products.manage','reports.view','campaigns.manage','ai.manage','settings.manage']::text[])
);
ALTER TABLE public.company_member_access ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.company_member_access TO authenticated;
GRANT ALL ON public.company_member_access TO service_role;

INSERT INTO public.company_member_access(company_id,user_id,active)
SELECT p.company_id,p.id, EXISTS(SELECT 1 FROM public.user_roles r WHERE r.company_id=p.company_id AND r.user_id=p.id)
FROM public.profiles p;

-- Explicitly requested administrator. No fallback promotes other users.
INSERT INTO public.user_roles(company_id,user_id,role)
SELECT p.company_id,p.id,'admin' FROM public.profiles p JOIN auth.users u ON u.id=p.id
WHERE lower(u.email)='fabriziosoul@gmail.com' ON CONFLICT DO NOTHING;
UPDATE public.company_member_access a SET active=true FROM auth.users u
WHERE a.user_id=u.id AND lower(u.email)='fabriziosoul@gmail.com';

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _company_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM user_roles r JOIN profiles p ON p.id=r.user_id AND p.company_id=r.company_id
    JOIN company_member_access a ON a.user_id=r.user_id AND a.company_id=r.company_id
    WHERE r.user_id=_user_id AND r.company_id=_company_id AND r.role=_role AND a.active);
$$;

CREATE OR REPLACE FUNCTION public.current_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT p.company_id FROM profiles p JOIN company_member_access a ON a.user_id=p.id AND a.company_id=p.company_id
 WHERE p.id=auth.uid() AND a.active AND EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=p.id AND r.company_id=p.company_id);
$$;
CREATE OR REPLACE FUNCTION private.current_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT public.current_company_id(); $$;

CREATE FUNCTION public.team_has_permission(_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE((SELECT public.has_role(auth.uid(),p.company_id,'admin') OR (_permission NOT IN ('ai.manage','settings.manage','campaigns.manage') AND _permission=ANY(a.permissions))
 FROM profiles p JOIN company_member_access a ON a.company_id=p.company_id AND a.user_id=p.id
 WHERE p.id=auth.uid() AND a.active AND p.company_id=public.current_company_id()),false);
$$;

CREATE FUNCTION public.team_my_access() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('active',public.current_company_id() IS NOT NULL,
   'role',(SELECT role FROM user_roles WHERE user_id=auth.uid() AND company_id=public.current_company_id() ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'financeiro' THEN 1 ELSE 2 END LIMIT 1),
   'permissions',COALESCE((SELECT to_jsonb(permissions) FROM company_member_access WHERE user_id=auth.uid() AND company_id=public.current_company_id()),'[]'::jsonb));
$$;

CREATE POLICY team_access_read ON public.company_member_access FOR SELECT TO authenticated
USING(company_id=public.current_company_id() AND (user_id=auth.uid() OR public.has_role(auth.uid(),company_id,'admin')));

CREATE FUNCTION public.team_can_read_lead(_lead uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM leads l WHERE l.id=_lead AND l.company_id=public.current_company_id()
 AND public.team_has_permission('conversations.read')
 AND (l.assigned_to IS NULL OR l.assigned_to=auth.uid() OR public.team_has_permission('conversations.view_all')));
$$;
CREATE FUNCTION public.team_can_reply_lead(_lead uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM leads l WHERE l.id=_lead AND l.company_id=public.current_company_id()
 AND l.assigned_to=auth.uid() AND public.team_has_permission('conversations.reply'));
$$;
CREATE FUNCTION public.team_can_access_conversation(_conversation uuid, _write boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM conversations c WHERE c.id=_conversation AND c.company_id=public.current_company_id()
 AND CASE WHEN _write THEN public.team_can_reply_lead(c.lead_id) ELSE public.team_can_read_lead(c.lead_id) END);
$$;

CREATE FUNCTION public.team_assign_lead(_lead uuid, _user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_lead leads; v_company uuid:=public.current_company_id();
BEGIN
 IF v_company IS NULL OR NOT public.team_has_permission('conversations.read') THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_lead FROM leads WHERE id=_lead AND company_id=v_company FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contato não encontrado' USING ERRCODE='42501'; END IF;
 IF NOT public.team_has_permission('conversations.assign') AND NOT
   ((v_lead.assigned_to IS NULL AND _user=auth.uid() AND public.team_has_permission('conversations.reply')) OR (v_lead.assigned_to=auth.uid() AND (_user IS NULL OR _user=auth.uid())))
 THEN RAISE EXCEPTION 'Este atendimento pertence a outro usuário. Solicite uma transferência.' USING ERRCODE='42501'; END IF;
 IF _user IS NOT NULL AND NOT EXISTS(SELECT 1 FROM profiles p JOIN company_member_access a ON a.user_id=p.id AND a.company_id=p.company_id
   WHERE p.id=_user AND p.company_id=v_company AND a.active AND
   (public.has_role(p.id,v_company,'admin') OR ('conversations.reply'=ANY(a.permissions) AND EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=p.id AND r.company_id=v_company))))
 THEN RAISE EXCEPTION 'Atendente inválido para esta empresa' USING ERRCODE='42501'; END IF;
 UPDATE leads SET assigned_to=_user WHERE id=_lead;
 INSERT INTO audit_log(company_id,user_id,action,entity,entity_id,before,after) VALUES
 (v_company,auth.uid(),'assign_conversation','lead',_lead,jsonb_build_object('assigned_to',v_lead.assigned_to),jsonb_build_object('assigned_to',_user));
END; $$;

-- Direct REST updates must obey the same ownership rules as the assignment RPC.
CREATE FUNCTION public.team_guard_lead() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN NEW; END IF;
 IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'Não é permitido trocar a empresa' USING ERRCODE='42501'; END IF;
 IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
   IF NOT public.team_has_permission('conversations.assign') AND NOT
    ((OLD.assigned_to IS NULL AND NEW.assigned_to=auth.uid() AND public.team_has_permission('conversations.reply')) OR (OLD.assigned_to=auth.uid() AND NEW.assigned_to IS NULL))
   THEN RAISE EXCEPTION 'Transferência não autorizada' USING ERRCODE='42501'; END IF;
   IF NEW.assigned_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM company_member_access a JOIN profiles p ON p.id=a.user_id AND p.company_id=a.company_id
      WHERE a.user_id=NEW.assigned_to AND a.company_id=NEW.company_id AND a.active AND (public.has_role(a.user_id,a.company_id,'admin') OR 'conversations.reply'=ANY(a.permissions)))
   THEN RAISE EXCEPTION 'Atendente inválido' USING ERRCODE='42501'; END IF;
 END IF;
 IF NOT public.has_role(auth.uid(),OLD.company_id,'admin') AND OLD.assigned_to IS DISTINCT FROM auth.uid()
   AND (to_jsonb(NEW)-'assigned_to'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'assigned_to'-'updated_at')
 THEN RAISE EXCEPTION 'Assuma o atendimento antes de alterar o contato' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER team_guard_lead BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.team_guard_lead();

CREATE FUNCTION public.team_table_access(_table text,_write boolean,_company uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF _company IS DISTINCT FROM public.current_company_id() OR _company IS NULL THEN RETURN false; END IF;
 IF public.has_role(auth.uid(),_company,'admin') THEN RETURN true; END IF;
 IF _table IN ('profiles','user_roles','company_member_access') THEN RETURN NOT _write; END IF;
 IF _table IN ('leads','conversations','messages','conversation_sales_states','lead_tasks','lead_notes','conversation_notes') THEN
   RETURN public.team_has_permission(CASE WHEN _write THEN 'conversations.reply' ELSE 'conversations.read' END);
 END IF;
 IF _table IN ('products','product_images','product_variants','product_categories') THEN RETURN public.team_has_permission(CASE WHEN _write THEN 'products.manage' ELSE 'products.view' END); END IF;
 IF _table IN ('quotes','quote_items') THEN RETURN public.team_has_permission('quotes.manage'); END IF;
 IF _table IN ('visits','appointments') THEN RETURN public.team_has_permission('agenda.manage'); END IF;
 IF _table IN ('quick_replies','loss_reasons') AND NOT _write THEN RETURN public.team_has_permission('conversations.read'); END IF;
 -- Secrets/integrations are reserved for administrators even if a module is delegated.
 IF _table IN ('company_integrations','company_invites','audit_log') THEN RETURN false; END IF;
 IF _table='company_settings' THEN RETURN public.team_has_permission('settings.manage') OR (NOT _write AND public.team_has_permission('conversations.read')); END IF;
 IF _table ~ '^(ai_|coach_|agent_|scientific_|business_|sales_|runtime_)' THEN RETURN public.team_has_permission('ai.manage'); END IF;
 IF _table ~ '^(campaign|marketing|brand_|creative|audio_|render_|relationship_)' THEN RETURN public.team_has_permission('campaigns.manage'); END IF;
 RETURN false;
END; $$;

-- Restrictive policies compose with existing tenant policies; no permissive policy can bypass them.
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables catalog_table USING(table_schema,table_name)
 WHERE c.table_schema='public' AND c.column_name='company_id' AND catalog_table.table_type='BASE TABLE'
 AND c.table_name NOT IN ('company_member_access','profiles','user_roles','company_invites') LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t.table_name);
   EXECUTE format('CREATE POLICY team_read ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.team_table_access(%L,false,company_id))',t.table_name,t.table_name);
   EXECUTE format('CREATE POLICY team_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.team_table_access(%L,true,company_id))',t.table_name,t.table_name);
   EXECUTE format('CREATE POLICY team_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.team_table_access(%L,true,company_id)) WITH CHECK (public.team_table_access(%L,true,company_id))',t.table_name,t.table_name,t.table_name);
   EXECUTE format('CREATE POLICY team_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.team_table_access(%L,true,company_id))',t.table_name,t.table_name);
 END LOOP;
END; $$;
CREATE POLICY team_lead_scope ON public.leads AS RESTRICTIVE FOR SELECT TO authenticated USING(public.team_can_read_lead(id));
CREATE POLICY team_conversation_scope ON public.conversations AS RESTRICTIVE FOR SELECT TO authenticated USING(public.team_can_read_lead(lead_id));
CREATE POLICY team_conversation_write ON public.conversations AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.team_can_reply_lead(lead_id)) WITH CHECK(public.team_can_reply_lead(lead_id));
CREATE POLICY team_message_scope ON public.messages AS RESTRICTIVE FOR SELECT TO authenticated USING(public.team_can_access_conversation(conversation_id));
CREATE POLICY team_message_insert ON public.messages AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.team_can_access_conversation(conversation_id,true));
CREATE POLICY team_message_update ON public.messages AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.team_can_access_conversation(conversation_id,true)) WITH CHECK(public.team_can_access_conversation(conversation_id,true));
CREATE POLICY team_message_delete ON public.messages AS RESTRICTIVE FOR DELETE TO authenticated USING(public.team_can_access_conversation(conversation_id,true));
CREATE POLICY team_lead_delete ON public.leads AS RESTRICTIVE FOR DELETE TO authenticated USING(public.team_can_reply_lead(id));
CREATE POLICY team_conversation_delete ON public.conversations AS RESTRICTIVE FOR DELETE TO authenticated USING(public.team_can_reply_lead(lead_id));
CREATE POLICY team_conversation_insert ON public.conversations AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.team_can_reply_lead(lead_id));
CREATE POLICY team_company_update ON public.companies AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.team_has_permission('settings.manage')) WITH CHECK(public.team_has_permission('settings.manage'));
CREATE POLICY team_product_delete_grant ON public.products FOR DELETE TO authenticated USING(company_id=public.current_company_id() AND public.team_has_permission('products.manage'));

CREATE FUNCTION public.team_new_lead_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NOT NULL THEN
   IF NEW.company_id IS DISTINCT FROM public.current_company_id() OR NOT public.team_has_permission('conversations.reply') THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
   IF NEW.assigned_to IS NULL THEN NEW.assigned_to:=auth.uid(); END IF;
   IF NEW.assigned_to<>auth.uid() AND NOT public.team_has_permission('conversations.assign') THEN RAISE EXCEPTION 'Atribuição não autorizada' USING ERRCODE='42501'; END IF;
   IF NOT EXISTS(SELECT 1 FROM company_member_access a WHERE a.company_id=NEW.company_id AND a.user_id=NEW.assigned_to AND a.active) THEN RAISE EXCEPTION 'Responsável de outra empresa' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER team_new_lead_owner BEFORE INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.team_new_lead_owner();

-- Protect related records, including requests crafted with mismatched foreign keys.
CREATE FUNCTION public.team_guard_links() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j jsonb:=to_jsonb(NEW); v_lead uuid; v_conversation uuid; v_company uuid;
BEGIN
 v_company:=(j->>'company_id')::uuid;
 IF TG_OP='UPDATE' AND v_company IS DISTINCT FROM (to_jsonb(OLD)->>'company_id')::uuid THEN RAISE EXCEPTION 'Empresa imutável' USING ERRCODE='42501'; END IF;
 v_lead:=(j->>'lead_id')::uuid; v_conversation:=(j->>'conversation_id')::uuid;
 IF v_conversation IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM conversations WHERE id=v_conversation AND company_id=v_company) THEN RAISE EXCEPTION 'Conversa de outra empresa' USING ERRCODE='42501'; END IF;
   SELECT lead_id INTO v_lead FROM conversations WHERE id=v_conversation;
 END IF;
 IF v_lead IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM leads WHERE id=v_lead AND company_id=v_company) THEN RAISE EXCEPTION 'Contato de outra empresa' USING ERRCODE='42501'; END IF;
   IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),v_company,'admin') AND NOT public.team_can_reply_lead(v_lead) THEN RAISE EXCEPTION 'Atendimento de outro usuário' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END; $$;
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('lead_id','conversation_id')
 AND table_name IN ('conversations','messages','quotes','visits','lead_notes','lead_tasks','conversation_notes','conversation_sales_states') LOOP
   EXECUTE format('CREATE TRIGGER team_guard_links BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.team_guard_links()',t.table_name);
 END LOOP;
 FOR t IN SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='lead_id' AND table_name IN ('quotes','visits','lead_notes','lead_tasks') LOOP
   EXECUTE format('CREATE POLICY team_related_read ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (lead_id IS NULL OR public.team_can_read_lead(lead_id))',t.table_name);
   EXECUTE format('CREATE POLICY team_related_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (lead_id IS NULL OR public.team_can_reply_lead(lead_id))',t.table_name);
 END LOOP;
 FOR t IN SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='conversation_id' AND table_name IN ('conversation_notes','conversation_sales_states') LOOP
   EXECUTE format('CREATE POLICY team_related_read ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.team_can_access_conversation(conversation_id))',t.table_name);
   EXECUTE format('CREATE POLICY team_related_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.team_can_access_conversation(conversation_id,true))',t.table_name);
 END LOOP;
END; $$;

-- Roles and membership changes happen only in transactional admin RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.user_roles,public.company_invites,public.company_member_access FROM authenticated;
CREATE FUNCTION public.team_update_member(_user uuid,_role public.app_role,_active boolean,_permissions text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company uuid:=public.current_company_id(); v_before jsonb;
BEGIN
 IF NOT public.has_role(auth.uid(),v_company,'admin') THEN RAISE EXCEPTION 'Apenas administradores gerenciam a equipe' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM companies WHERE id=v_company FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=_user AND company_id=v_company) THEN RAISE EXCEPTION 'Usuário de outra empresa' USING ERRCODE='42501'; END IF;
 IF _user=auth.uid() AND NOT _active THEN RAISE EXCEPTION 'Você não pode desativar sua própria conta'; END IF;
 IF public.has_role(_user,v_company,'admin') AND (_role<>'admin' OR NOT _active) AND NOT EXISTS(
   SELECT 1 FROM user_roles r JOIN company_member_access a ON a.user_id=r.user_id AND a.company_id=r.company_id
   WHERE r.company_id=v_company AND r.user_id<>_user AND r.role='admin' AND a.active)
 THEN RAISE EXCEPTION 'Mantenha pelo menos um administrador ativo'; END IF;
 SELECT to_jsonb(a) INTO v_before FROM company_member_access a WHERE a.user_id=_user AND a.company_id=v_company;
 DELETE FROM user_roles WHERE user_id=_user AND company_id=v_company;
 INSERT INTO user_roles(company_id,user_id,role) VALUES(v_company,_user,_role);
 INSERT INTO company_member_access(company_id,user_id,active,permissions) VALUES(v_company,_user,_active,_permissions)
 ON CONFLICT(company_id,user_id) DO UPDATE SET active=excluded.active,permissions=excluded.permissions;
 IF NOT _active OR (_role<>'admin' AND NOT 'conversations.reply'=ANY(_permissions)) THEN UPDATE leads SET assigned_to=NULL WHERE company_id=v_company AND assigned_to=_user; END IF;
 INSERT INTO audit_log(company_id,user_id,action,entity,entity_id,before,after) VALUES(v_company,auth.uid(),'team_member_updated','profile',_user,v_before,jsonb_build_object('role',_role,'active',_active,'permissions',_permissions));
END; $$;

CREATE FUNCTION public.team_create_invite(_email text,_role public.app_role DEFAULT 'atendente') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company uuid:=public.current_company_id(); v_inv company_invites;
BEGIN
 IF NOT public.has_role(auth.uid(),v_company,'admin') THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF _email IS NULL OR length(_email)>255 OR _email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'E-mail inválido'; END IF;
 PERFORM 1 FROM companies WHERE id=v_company FOR UPDATE;
 IF EXISTS(SELECT 1 FROM company_invites WHERE company_id=v_company AND lower(email)=lower(trim(_email)) AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'Já existe um convite pendente'; END IF;
 INSERT INTO company_invites(company_id,email,role,invited_by) VALUES(v_company,lower(trim(_email)),_role,auth.uid()) RETURNING * INTO v_inv;
 RETURN to_jsonb(v_inv);
END; $$;
CREATE FUNCTION public.team_cancel_invite(_invite uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),public.current_company_id(),'admin') THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 UPDATE company_invites SET cancelled_at=now() WHERE id=_invite AND company_id=public.current_company_id() AND accepted_at IS NULL;
END; $$;

CREATE FUNCTION public.team_list_users() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),public.current_company_id(),'admin') THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'displayName',p.display_name,'email',p.email,'createdAt',p.created_at,'lastSeenAt',p.last_seen_at,
   'role',(SELECT role FROM user_roles WHERE user_id=p.id AND company_id=p.company_id ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'financeiro' THEN 1 ELSE 2 END LIMIT 1),
   'active',a.active,'permissions',a.permissions) ORDER BY p.created_at)
 FROM profiles p JOIN company_member_access a ON a.user_id=p.id AND a.company_id=p.company_id WHERE p.company_id=public.current_company_id()),'[]'::jsonb);
END; $$;
CREATE FUNCTION public.team_list_invites() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),public.current_company_id(),'admin') THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY created_at DESC) FROM company_invites i WHERE company_id=public.current_company_id()),'[]'::jsonb);
END; $$;
CREATE FUNCTION public.team_directory() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'name',COALESCE(p.display_name,'Atendente'),'canReply',public.has_role(p.id,p.company_id,'admin') OR 'conversations.reply'=ANY(a.permissions)) ORDER BY p.display_name),'[]'::jsonb)
 FROM profiles p JOIN company_member_access a ON a.user_id=p.id AND a.company_id=p.company_id
 WHERE p.company_id=public.current_company_id() AND a.active AND EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=p.id AND r.company_id=p.company_id);
$$;

-- Prevent users from moving their profile to another tenant or changing another profile.
CREATE FUNCTION public.team_guard_profile() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NOT NULL AND (NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.id IS DISTINCT FROM OLD.id OR
  (OLD.id<>auth.uid() AND NOT public.has_role(auth.uid(),OLD.company_id,'admin'))) THEN
  RAISE EXCEPTION 'Alteração de perfil não autorizada' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER team_guard_profile BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.team_guard_profile();

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company uuid; v_inv company_invites; v_token text:=NEW.raw_user_meta_data->>'invite_token';
BEGIN
 IF EXISTS(SELECT 1 FROM profiles WHERE id=NEW.id) THEN RETURN NEW; END IF;
 IF v_token IS NOT NULL THEN
   SELECT * INTO v_inv FROM company_invites WHERE token=v_token FOR UPDATE;
   IF NOT FOUND OR v_inv.accepted_at IS NOT NULL OR v_inv.cancelled_at IS NOT NULL OR v_inv.expires_at<=now() OR lower(v_inv.email)<>lower(NEW.email)
   THEN RAISE EXCEPTION 'Convite inválido, expirado ou de outro e-mail'; END IF;
   v_company:=v_inv.company_id;
 ELSE
   INSERT INTO companies(name) VALUES(COALESCE(NEW.raw_user_meta_data->>'company_name','Minha Empresa')) RETURNING id INTO v_company;
   INSERT INTO company_settings(company_id) VALUES(v_company);
   INSERT INTO loss_reasons(company_id,label) VALUES(v_company,'Preço acima do orçamento'),(v_company,'Comprou do concorrente'),(v_company,'Sem retorno do cliente'),(v_company,'Não era o cliente ideal'),(v_company,'Problema de prazo');
 END IF;
 INSERT INTO profiles(id,company_id,display_name,email) VALUES(NEW.id,v_company,COALESCE(NEW.raw_user_meta_data->>'display_name',split_part(NEW.email,'@',1)),NEW.email);
 INSERT INTO user_roles(company_id,user_id,role) VALUES(v_company,NEW.id,CASE WHEN v_token IS NULL THEN 'admin'::app_role ELSE v_inv.role END);
 INSERT INTO company_member_access(company_id,user_id) VALUES(v_company,NEW.id);
 IF v_token IS NOT NULL THEN UPDATE company_invites SET accepted_at=now(),accepted_by=NEW.id WHERE id=v_inv.id; END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION public.team_accept_invite(_token text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_inv company_invites; v_user auth.users; v_company uuid;
BEGIN
 SELECT * INTO v_user FROM auth.users WHERE id=auth.uid();
 IF v_user.id IS NULL OR v_user.email_confirmed_at IS NULL THEN RAISE EXCEPTION 'Entre com seu e-mail confirmado'; END IF;
 SELECT * INTO v_inv FROM company_invites WHERE token=_token FOR UPDATE;
 IF NOT FOUND OR lower(v_inv.email)<>lower(v_user.email) OR v_inv.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Convite inválido'; END IF;
 IF v_inv.accepted_by=auth.uid() THEN RETURN; END IF;
 IF v_inv.accepted_at IS NOT NULL OR v_inv.expires_at<=now() THEN RAISE EXCEPTION 'Convite já utilizado ou expirado'; END IF;
 SELECT company_id INTO v_company FROM profiles WHERE id=auth.uid();
 IF v_company IS DISTINCT FROM v_inv.company_id THEN RAISE EXCEPTION 'Esta conta já pertence a outra empresa. Use um novo e-mail para entrar nesta equipe.'; END IF;
 DELETE FROM user_roles WHERE user_id=auth.uid() AND company_id=v_company AND role<>'admin';
 INSERT INTO user_roles(company_id,user_id,role) VALUES(v_company,auth.uid(),v_inv.role) ON CONFLICT DO NOTHING;
 UPDATE company_member_access SET active=true WHERE company_id=v_company AND user_id=auth.uid();
 UPDATE company_invites SET accepted_at=now(),accepted_by=auth.uid() WHERE id=v_inv.id;
END; $$;

CREATE FUNCTION public.team_authorize_interaction(_payload jsonb,_write boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_conversation uuid; v_lead uuid; v_row leads; v_company uuid:=public.current_company_id(); v_source uuid; v_id text; v_count integer:=0;
BEGIN
 IF v_company IS NULL OR NOT public.team_has_permission(CASE WHEN _write THEN 'conversations.reply' ELSE 'conversations.read' END) THEN RETURN false; END IF;
 IF NOT _write AND _payload ? 'conversation_ids' THEN
   FOREACH v_id IN ARRAY string_to_array(_payload->>'conversation_ids',',') LOOP
     v_count:=v_count+1;
     IF v_count>500 OR NOT public.team_can_access_conversation(trim(v_id)::uuid) THEN RETURN false; END IF;
   END LOOP;
   RETURN v_count>0;
 END IF;
 v_conversation:=NULLIF(_payload->>'conversationId','')::uuid;
 v_lead:=COALESCE(NULLIF(_payload->>'targetLeadId',''),NULLIF(_payload->>'leadId',''))::uuid;
 IF _payload ? 'suggestionId' OR _payload ? 'logId' THEN
   SELECT conversation_id INTO v_conversation FROM ai_suggestions_log WHERE id=COALESCE(_payload->>'suggestionId',_payload->>'logId')::uuid AND company_id=v_company;
   IF NOT FOUND THEN RETURN false; END IF;
 END IF;
 IF _payload ? 'sourceMessageId' THEN
   SELECT conversation_id INTO v_source FROM messages WHERE id=(_payload->>'sourceMessageId')::uuid AND company_id=v_company;
   IF NOT FOUND OR NOT public.team_can_access_conversation(v_source) THEN RETURN false; END IF;
 END IF;
 IF v_conversation IS NOT NULL THEN
   SELECT lead_id INTO v_source FROM conversations WHERE id=v_conversation AND company_id=v_company;
   IF NOT FOUND OR (v_lead IS NOT NULL AND v_lead<>v_source) THEN RETURN false; END IF;
   v_lead:=v_source;
 END IF;
 IF v_lead IS NULL AND _payload ? 'phone' THEN
   SELECT id INTO v_lead FROM leads WHERE company_id=v_company AND channel='whatsapp' AND
     (regexp_replace(phone,'\D','','g')=regexp_replace(_payload->>'phone','\D','','g') OR external_id='phone:'||regexp_replace(_payload->>'phone','\D','','g')) LIMIT 1;
   -- A genuinely new contact is allowed; the sending route claims it after creation.
   IF v_lead IS NULL THEN RETURN _write; END IF;
 END IF;
 IF v_lead IS NULL THEN RETURN public.has_role(auth.uid(),v_company,'admin'); END IF;
 IF NOT _write THEN RETURN public.team_can_read_lead(v_lead); END IF;
 SELECT * INTO v_row FROM leads WHERE id=v_lead AND company_id=v_company FOR UPDATE;
 IF NOT FOUND OR (v_row.assigned_to IS NOT NULL AND v_row.assigned_to<>auth.uid()) THEN RETURN false; END IF;
 IF v_row.assigned_to IS NULL THEN PERFORM public.team_assign_lead(v_lead,auth.uid()); END IF;
 RETURN public.team_can_reply_lead(v_lead);
END; $$;

-- This existing preview RPC must respect the new per-attendant RLS scope.
ALTER FUNCTION public.latest_messages_per_conversation(uuid) SECURITY INVOKER;

-- Upload permissions must not allow a catalog viewer to overwrite product images.
-- New inbox uploads carry their conversation ID; old files remain readable.
CREATE FUNCTION public.team_storage_write(_bucket text, _name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company uuid:=public.current_company_id(); v_conversation text;
BEGIN
 IF v_company IS NULL OR split_part(_name,'/',1)<>v_company::text THEN RETURN false; END IF;
 IF public.has_role(auth.uid(),v_company,'admin') THEN RETURN true; END IF;
 IF _bucket='product-images' AND split_part(_name,'/',2)='inbox' THEN
   v_conversation:=split_part(_name,'/',3);
   IF v_conversation !~ '^[0-9a-fA-F-]{36}$' THEN RETURN false; END IF;
   RETURN public.team_can_access_conversation(v_conversation::uuid,true);
 END IF;
 IF _bucket='product-images' THEN RETURN public.team_has_permission('products.manage'); END IF;
 RETURN false;
END; $$;
DO $$ BEGIN
 IF to_regclass('storage.objects') IS NOT NULL THEN
   CREATE POLICY team_storage_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.team_storage_write(bucket_id,name));
   CREATE POLICY team_storage_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.team_storage_write(bucket_id,name)) WITH CHECK(public.team_storage_write(bucket_id,name));
   CREATE POLICY team_storage_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(public.team_storage_write(bucket_id,name));
 END IF;
END; $$;

-- Helpers are callable by authenticated sessions, never anonymously. Trigger functions are private.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'team_%' LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',f.signature);
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',f.signature);
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.team_guard_profile(), public.team_guard_lead() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.team_new_lead_owner(), public.team_guard_links() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
   ALTER PUBLICATION supabase_realtime ADD TABLE public.company_member_access;
 END IF;
END; $$;
COMMIT;
