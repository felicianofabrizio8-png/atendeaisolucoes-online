# Agenda com hierarquia, tags e equipe por link — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Funcionário com agenda pessoal, gestor da agenda e admin com agenda da equipe; tags da empresa e pessoais; convite por link com aprovação opcional; tudo administrado em Usuários e Permissões.

**Architecture:** Regras no banco: uma migração aditiva com funções `SECURITY DEFINER`, políticas RLS restritivas, gatilhos e RPCs, testada com PGlite e as migrações reais. Tela e Lume só refletem essas regras. O lado cliente detecta se a migração existe e cai no comportamento atual se não existir.

**Tech Stack:** PostgreSQL/Supabase (RLS, plpgsql), PGlite (testes), React 19 + TanStack Router/Query, Vitest + Testing Library, framer-motion, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-15-agenda-equipe-hierarquia-design.md`

## Global Constraints

- Multiempresa: toda linha nova tem `company_id`, e toda regra confere `company_id = current_company_id()`.
- Migração aditiva e reexecutável (`IF NOT EXISTS`, `DROP ... IF EXISTS` antes de `CREATE`). Depende de `20261007180000_team_permissions_and_assignment.sql` e `20261015120000_agenda_lume_foundation.sql`, que rodam antes pela ordem dos arquivos.
- Nenhuma coluna existente de `visits` é removida ou renomeada. `appointment_type`, `technician` e `salesperson` continuam no banco.
- Follow-up, recuperação, analytics e LGPD leem `visits` com service role: nada do que eles leem pode mudar.
- Permissões válidas = a lista atual mais `agenda.team`. `ai.manage`, `settings.manage` e `campaigns.manage` continuam só para admin.
- Link de convite nunca concede o papel `admin`.
- Textos de tela em português do Brasil. Visual do formulário igual ao orçamento (`quotes.css`); da Agenda, `agenda.css`; das Configurações, `settings-ui`.
- Commits com autoria `Isaque Matarazzo <devmatarazzo@gmail.com>` e o rodapé `Co-Authored-By`/`Claude-Session` desta sessão.

## Review Focus

1. Um compromisso criado pelo **Atendimento** (`scheduleVisit`, sem `owner_id`) precisa continuar funcionando para um funcionário: vira pessoal dele. Teste na Task 1.
2. Um **link com limite de usos** usado por duas pessoas ao mesmo tempo não pode passar do limite. O cadastro trava a linha do link; teste de uso esgotado na Task 2.
3. O **funcionário** não pode transformar o próprio compromisso pessoal em compromisso de equipe, nem passar o dono para outra pessoa, mesmo com uma chamada direta à API. Teste na Task 1.
4. A **tag pessoal** de uma pessoa não pode ser vista nem anexada por outra, inclusive pelo gestor. Teste na Task 1.
5. **Antes da migração** de hierarquia, a Agenda não pode quebrar: sem o seletor de escopo, sem tags e com o formulário como hoje. Teste de detecção na Task 6.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `supabase/migrations/20261016120000_agenda_team_hierarchy.sql` (novo) | Permissão, dono e alcance, regras, tags, links e aprovação |
| `src/lib/__tests__/agenda-hierarchy-database.test.ts` (novo) | Testes SQL reais (PGlite) |
| `src/lib/team/permissions.ts` | `agenda.team`, grupos por módulo, perfis prontos |
| `src/lib/users.functions.ts` | APIs de links, aprovação e renomear equipe |
| `src/components/settings/UsersTab.tsx` | Tela Usuários e Permissões redesenhada |
| `src/components/settings/team/*` (novos) | Gaveta de permissões, links e pendentes |
| `src/routes/convite.tsx`, `src/auth/AuthContext.tsx` | Entrar pelo link |
| `src/components/team/WelcomeTeamDialog.tsx` (novo) | "Crie sua equipe" |
| `src/components/agenda/agenda-model.ts`, `agenda-schema.ts` | Tipos e detecção da hierarquia |
| `src/components/agenda/useAgendaTags.ts`, `useTeamDirectory.ts` (novos) | Dados de tags e membros |
| `src/components/agenda/event-form.ts`, `EventFormModal.tsx` | Alcance, dono, participantes e tags |
| `src/components/agenda/TagPicker.tsx` (novo), `AgendaCustomize.tsx`, `AgendaToolbar.tsx`, `EventDrawer.tsx`, `AgendaViews.tsx`, `src/routes/agenda.tsx` | Tela da Agenda |
| `src/lib/lume/domains/agenda.server.ts` | Lume: alcance, participantes e tags |

---

### Task 1: Migração — permissão `agenda.team`, dono/alcance e tags (SQL + testes)

**Files:**
- Create: `supabase/migrations/20261016120000_agenda_team_hierarchy.sql`
- Create: `src/lib/__tests__/agenda-hierarchy-database.test.ts`

**Interfaces:**
- Produces (SQL): `visits.owner_id uuid`, `visits.scope text ('pessoal'|'equipe')`, `visits.everyone boolean`; funções `agenda_is_manager(uuid)`, `agenda_can_see_event(uuid)`, `agenda_can_edit_event(uuid)`; tabelas `agenda_tags(id, company_id, owner_id, name, hue, created_by, created_at)` e `agenda_event_tags(company_id, event_id, tag_id)`.

- [ ] **Step 1: Escrever o teste (falhando)**

`src/lib/__tests__/agenda-hierarchy-database.test.ts`: reaproveita o preparo de `team-database.test.ts` e aplica as migrações da Agenda.

```ts
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const db = new PGlite();
const admin = "00000000-0000-4000-8000-000000000001";
const empA = "00000000-0000-4000-8000-000000000002";
const empB = "00000000-0000-4000-8000-000000000003";
const outsider = "00000000-0000-4000-8000-000000000004";
const manager = "00000000-0000-4000-8000-000000000005";
let company: string;
let legacyId: string;

async function asUser(id: string) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE authenticated;`);
}
async function asAnon() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); SET ROLE anon;`);
}
async function root() {
  await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
}
async function value<T>(sql: string, params: unknown[] = []) {
  return (await db.query<{ v: T }>(sql, params)).rows[0]?.v;
}
async function fails(sql: string, params: unknown[] = []) {
  try {
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  }
}
const run = (file: string) => db.exec(readFileSync(file, "utf8"));

beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
   CREATE SCHEMA auth; CREATE SCHEMA private;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',email_confirmed_at timestamptz DEFAULT now());
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   GRANT USAGE ON SCHEMA auth,public,private TO authenticated,anon,service_role;
   GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon,service_role;`);
  await run("supabase/migrations/20260426013234_7f419db7-87f8-4034-9c97-5d26c092e9e7.sql");
  await db.exec(`CREATE TYPE public.app_role AS ENUM('admin','atendente','financeiro');
   DO $$ BEGIN CREATE TYPE public.appointment_type AS ENUM('visita_tecnica','loja','retorno_comercial','pos_venda','instalacao','manutencao'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   CREATE FUNCTION private.current_company_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT public.current_company_id(); $$;
   CREATE TABLE user_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,user_id uuid,role app_role,UNIQUE(company_id,user_id,role));
   CREATE TABLE company_invites(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,email text,role app_role,token text UNIQUE DEFAULT gen_random_uuid()::text,invited_by uuid,expires_at timestamptz DEFAULT now()+interval '7 days',accepted_at timestamptz,accepted_by uuid,cancelled_at timestamptz,created_at timestamptz DEFAULT now());
   CREATE TABLE audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,user_id uuid,action text,entity text,entity_id text,before jsonb,after jsonb);
   CREATE TABLE ai_suggestions_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,conversation_id uuid);
   CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);
   ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated;
   GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
   CREATE POLICY legacy_storage_write ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);
   ALTER TABLE profiles ADD last_seen_at timestamptz; ALTER TABLE leads ADD external_id text;
   ALTER TABLE messages ADD source_subtype text, ADD source_metadata jsonb, ADD delivery_status text, ADD status_updated_at timestamptz, ADD edited_at timestamptz, ADD deleted_at timestamptz, ADD deleted_for text;
   ALTER TABLE visits ADD COLUMN IF NOT EXISTS appointment_type public.appointment_type NOT NULL DEFAULT 'visita_tecnica',
     ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS salesperson text, ADD COLUMN IF NOT EXISTS technician text;
   CREATE PUBLICATION supabase_realtime;
   INSERT INTO auth.users(id,email) VALUES('${admin}','fabriziosoul@gmail.com'),('${empA}','a@x.test'),('${empB}','b@x.test'),('${outsider}','o@x.test'),('${manager}','m@x.test');
   UPDATE profiles SET company_id=(SELECT company_id FROM profiles WHERE id='${admin}') WHERE id IN ('${empA}','${empB}','${manager}');
   INSERT INTO user_roles(company_id,user_id,role) SELECT company_id,id,CASE WHEN id='${outsider}' THEN 'admin'::app_role ELSE 'atendente'::app_role END FROM profiles;
   GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;`);
  await run("supabase/migrations/20260607034655_1c280507-1e0f-45d2-86f6-3a5661e5dff7.sql");
  await run("supabase/migrations/20261007180000_team_permissions_and_assignment.sql");
  await run("supabase/migrations/20261015120000_agenda_lume_foundation.sql");
  company = await value<string>(`SELECT company_id AS v FROM profiles WHERE id='${admin}'`);
  // Compromisso antigo, criado antes da hierarquia (sem dono).
  legacyId = await value<string>(
    `INSERT INTO visits(company_id,title,scheduled_at) VALUES('${company}','Antigo',now()) RETURNING id AS v`,
  );
  await run("supabase/migrations/20261016120000_agenda_team_hierarchy.sql");
  await run("supabase/migrations/20261016120000_agenda_team_hierarchy.sql"); // reexecutável
  await db.exec(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
   UPDATE company_member_access SET permissions = permissions || ARRAY['agenda.team'] WHERE user_id='${manager}';`);
}, 60000);
afterAll(() => db.close());

const insertEvent = (title: string, extra = "") =>
  `INSERT INTO visits(company_id,title,scheduled_at${extra ? "," + extra.split("=")[0] : ""}) VALUES('${company}','${title}',now()${extra ? "," + extra.split("=")[1] : ""}) RETURNING id AS v`;

describe.sequential("agenda: hierarquia no banco", () => {
  it("aceita a permissão agenda.team e reconhece o gestor", async () => {
    await asUser(manager);
    expect(await value<boolean>(`SELECT public.agenda_is_manager('${company}') AS v`)).toBe(true);
    await asUser(empA);
    expect(await value<boolean>(`SELECT public.agenda_is_manager('${company}') AS v`)).toBe(false);
  });

  it("compromisso antigo vira de toda a equipe e todos continuam vendo", async () => {
    await asUser(empB);
    expect(await value<number>(`SELECT count(*)::int AS v FROM visits WHERE id='${legacyId}'`)).toBe(1);
    await root();
    expect(await value<string>(`SELECT scope AS v FROM visits WHERE id='${legacyId}'`)).toBe("equipe");
  });

  it("funcionário cria pessoal (dono automático, como o Atendimento) e o colega não vê", async () => {
    await asUser(empA);
    const id = await value<string>(insertEvent("Cliente João"));
    expect(await value<string>(`SELECT owner_id::text AS v FROM visits WHERE id='${id}'`)).toBe(empA);
    await asUser(empB);
    expect(await value<number>(`SELECT count(*)::int AS v FROM visits WHERE id='${id}'`)).toBe(0);
    await asUser(manager);
    expect(await value<number>(`SELECT count(*)::int AS v FROM visits WHERE id='${id}'`)).toBe(1);
  });

  it("funcionário não cria de equipe, não troca dono nem vira o pessoal em equipe", async () => {
    await asUser(empA);
    expect(await fails(insertEvent("Reunião geral", "scope='equipe'"))).toBe(true);
    expect(await fails(insertEvent("Do colega", `owner_id='${empB}'`))).toBe(true);
    const id = await value<string>(insertEvent("Meu"));
    expect(await fails(`UPDATE visits SET scope='equipe' WHERE id='${id}'`)).toBe(true);
    expect(await fails(`UPDATE visits SET owner_id='${empB}' WHERE id='${id}'`)).toBe(true);
    await db.query(`UPDATE visits SET title='Meu (editado)' WHERE id='${id}'`);
    expect(await value<string>(`SELECT title AS v FROM visits WHERE id='${id}'`)).toBe("Meu (editado)");
  });

  it("compromisso de equipe: participante vê, quem não participa não vê, toda a equipe libera", async () => {
    await asUser(manager);
    const team = await value<string>(insertEvent("Treinamento", "scope='equipe'"));
    await db.query(
      `INSERT INTO agenda_event_participants(company_id,event_id,user_id,name) VALUES('${company}','${team}','${empA}','A')`,
    );
    await asUser(empA);
    expect(await value<number>(`SELECT count(*)::int AS v FROM visits WHERE id='${team}'`)).toBe(1);
    expect(await fails(`UPDATE visits SET title='x' WHERE id='${team}'`)).toBe(false);
    expect(await value<string>(`SELECT title AS v FROM visits WHERE id='${team}'`)).toBe("Treinamento");
    await asUser(empB);
    expect(await value<number>(`SELECT count(*)::int AS v FROM visits WHERE id='${team}'`)).toBe(0);
    await asUser(manager);
    await db.query(`UPDATE visits SET everyone=true WHERE id='${team}'`);
    await asUser(empB);
    expect(await value<number>(`SELECT count(*)::int AS v FROM visits WHERE id='${team}'`)).toBe(1);
  });

  it("checklist só em compromisso visível; participantes só quem edita", async () => {
    await asUser(empA);
    const mine = await value<string>(insertEvent("Privado A"));
    await asUser(empB);
    expect(
      await fails(`INSERT INTO agenda_checklist_items(company_id,event_id,label) VALUES('${company}','${mine}','x')`),
    ).toBe(true);
    await asUser(empA);
    expect(
      await fails(`INSERT INTO agenda_checklist_items(company_id,event_id,label) VALUES('${company}','${mine}','ok')`),
    ).toBe(false);
  });

  it("tags: gestor cria da empresa, funcionário só pessoal; pessoal é invisível e não anexável por outros", async () => {
    await asUser(manager);
    const companyTag = await value<string>(
      `INSERT INTO agenda_tags(company_id,name,hue) VALUES('${company}','Comercial',280) RETURNING id AS v`,
    );
    await asUser(empA);
    expect(await fails(`INSERT INTO agenda_tags(company_id,name) VALUES('${company}','Oficial')`)).toBe(true);
    const personal = await value<string>(
      `INSERT INTO agenda_tags(company_id,owner_id,name) VALUES('${company}','${empA}','Foco') RETURNING id AS v`,
    );
    const mine = await value<string>(insertEvent("Com tag"));
    await db.query(
      `INSERT INTO agenda_event_tags(company_id,event_id,tag_id) VALUES('${company}','${mine}','${personal}'),('${company}','${mine}','${companyTag}')`,
    );
    await asUser(empB);
    expect(await value<number>(`SELECT count(*)::int AS v FROM agenda_tags WHERE id='${personal}'`)).toBe(0);
    expect(await value<number>(`SELECT count(*)::int AS v FROM agenda_tags WHERE id='${companyTag}'`)).toBe(1);
    await asUser(manager);
    const team = await value<string>(insertEvent("Equipe tag", "scope='equipe'"));
    expect(
      await fails(`INSERT INTO agenda_event_tags(company_id,event_id,tag_id) VALUES('${company}','${team}','${personal}')`),
    ).toBe(true);
  });

  it("outra empresa não vê nada", async () => {
    await asUser(outsider);
    expect(await value<number>(`SELECT count(*)::int AS v FROM visits`)).toBe(0);
    expect(await value<number>(`SELECT count(*)::int AS v FROM agenda_tags`)).toBe(0);
  });
});

export { asAnon, root };
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/__tests__/agenda-hierarchy-database.test.ts`
Expected: FAIL. O arquivo `20261016120000_agenda_team_hierarchy.sql` ainda não existe (ENOENT).

- [ ] **Step 3: Criar a migração (parte 1)**

`supabase/migrations/20261016120000_agenda_team_hierarchy.sql`:

```sql
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/__tests__/agenda-hierarchy-database.test.ts`
Expected: PASS nos 8 testes.

Se o teste "participante vê" falhar na edição: o participante **não** edita compromisso de equipe. O teste espera `fails(...) === false`, porque um UPDATE bloqueado por RLS não gera erro, só não altera nada; o `SELECT title` confirma que nada mudou.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261016120000_agenda_team_hierarchy.sql src/lib/__tests__/agenda-hierarchy-database.test.ts
git commit -m "feat(agenda): hierarquia pessoal × equipe e tags no banco"
```

---

### Task 2: Migração — convite por link, aprovação e renomear equipe (SQL + testes)

**Files:**
- Modify: `supabase/migrations/20261016120000_agenda_team_hierarchy.sql` (acrescentar ao final)
- Modify: `src/lib/__tests__/agenda-hierarchy-database.test.ts` (novo `describe`)

**Interfaces:**
- Produces (RPC):
  - `team_create_invite_link(_role app_role, _permissions text[], _requires_approval boolean, _expires_in_days int, _max_uses int, _label text) → jsonb`
  - `team_list_invite_links() → jsonb[]`
  - `team_revoke_invite_link(_link uuid) → void`
  - `team_invite_link_info(_token text) → jsonb {valid, company, requiresApproval}` (anon)
  - `team_approve_member(_user uuid)`, `team_reject_member(_user uuid)`, `team_rename_company(_name text)`
  - `team_list_users()` passa a incluir `approvalPending`
- Cadastro: metadado `invite_link` em `auth.users.raw_user_meta_data`.

- [ ] **Step 1: Escrever os testes (falhando)**

Acrescentar ao arquivo de teste da Task 1:

```ts
describe.sequential("equipe: convite por link", () => {
  let token: string;
  let approvalToken: string;

  it("só admin cria link; link de admin é recusado", async () => {
    await asUser(empA);
    expect(await fails(`SELECT team_create_invite_link('atendente', ARRAY['agenda.manage'], false, 7, 2, 'Vendas')`)).toBe(true);
    await asUser(admin);
    expect(await fails(`SELECT team_create_invite_link('admin', ARRAY[]::text[], false, 7, null, null)`)).toBe(true);
    const link = await value<{ token: string }>(
      `SELECT team_create_invite_link('atendente', ARRAY['agenda.manage','conversations.read'], false, 7, 2, 'Vendas') AS v`,
    );
    token = link.token;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    approvalToken = (await value<{ token: string }>(
      `SELECT team_create_invite_link('atendente', ARRAY['agenda.manage'], true, null, null, null) AS v`,
    )).token;
  });

  it("qualquer um consulta só o nome da equipe e a validade", async () => {
    await asAnon();
    const info = await value<Record<string, unknown>>(`SELECT team_invite_link_info('${token}') AS v`);
    expect(info).toMatchObject({ valid: true, requiresApproval: false });
    expect(Object.keys(info).sort()).toEqual(["company", "requiresApproval", "valid"]);
    expect((await value<Record<string, unknown>>(`SELECT team_invite_link_info('nao-existe') AS v`)).valid).toBe(false);
  });

  it("cadastro pelo link entra na equipe com o papel e as permissões do link", async () => {
    await root();
    const novo = "00000000-0000-4000-8000-0000000000a1";
    await db.query(
      `INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'novo@x.test',jsonb_build_object('invite_link',$2::text,'display_name','Novo'))`,
      [novo, token],
    );
    expect(await value<string>(`SELECT company_id::text AS v FROM profiles WHERE id='${novo}'`)).toBe(company);
    expect(await value<string[]>(`SELECT permissions AS v FROM company_member_access WHERE user_id='${novo}'`)).toEqual(["agenda.manage", "conversations.read"]);
    expect(await value<boolean>(`SELECT active AS v FROM company_member_access WHERE user_id='${novo}'`)).toBe(true);
    expect(await value<number>(`SELECT uses AS v FROM company_invite_links WHERE token='${token}'`)).toBe(1);
  });

  it("respeita o limite de usos", async () => {
    await root();
    await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('00000000-0000-4000-8000-0000000000a2','dois@x.test',jsonb_build_object('invite_link',$1::text))`, [token]);
    expect(
      await fails(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('00000000-0000-4000-8000-0000000000a3','tres@x.test',jsonb_build_object('invite_link',$1::text))`, [token]),
    ).toBe(true);
  });

  it("link com aprovação deixa pendente até o admin aprovar", async () => {
    await root();
    const pend = "00000000-0000-4000-8000-0000000000a4";
    await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'pend@x.test',jsonb_build_object('invite_link',$2::text))`, [pend, approvalToken]);
    expect(await value<boolean>(`SELECT active AS v FROM company_member_access WHERE user_id='${pend}'`)).toBe(false);
    expect(await value<boolean>(`SELECT approval_pending AS v FROM company_member_access WHERE user_id='${pend}'`)).toBe(true);
    await asUser(pend);
    expect(await value<string | null>(`SELECT public.current_company_id()::text AS v`)).toBeNull();
    await asUser(empA);
    expect(await fails(`SELECT team_approve_member('${pend}')`)).toBe(true);
    await asUser(admin);
    await db.query(`SELECT team_approve_member('${pend}')`);
    const users = await value<Array<{ id: string; approvalPending: boolean; active: boolean }>>(`SELECT team_list_users() AS v`);
    expect(users.find((u) => u.id === pend)).toMatchObject({ active: true, approvalPending: false });
  });

  it("link revogado ou vencido não funciona", async () => {
    await asUser(admin);
    const links = await value<Array<{ id: string; token: string }>>(`SELECT team_list_invite_links() AS v`);
    const target = links.find((l) => l.token === approvalToken)!;
    await db.query(`SELECT team_revoke_invite_link('${target.id}')`);
    await root();
    expect(
      await fails(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('00000000-0000-4000-8000-0000000000a5','rev@x.test',jsonb_build_object('invite_link',$1::text))`, [approvalToken]),
    ).toBe(true);
    await db.query(`UPDATE company_invite_links SET expires_at=now()-interval '1 day', revoked_at=null, uses=0, max_uses=null WHERE token=$1`, [token]);
    expect(
      await fails(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('00000000-0000-4000-8000-0000000000a6','venc@x.test',jsonb_build_object('invite_link',$1::text))`, [token]),
    ).toBe(true);
  });

  it("cadastro sem convite continua criando a própria equipe como admin; admin renomeia", async () => {
    await root();
    const dono = "00000000-0000-4000-8000-0000000000a7";
    await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'dono@x.test',jsonb_build_object('company_name','Clínica Sol'))`, [dono]);
    const own = await value<string>(`SELECT company_id::text AS v FROM profiles WHERE id='${dono}'`);
    expect(own).not.toBe(company);
    expect(await value<string>(`SELECT role::text AS v FROM user_roles WHERE user_id='${dono}'`)).toBe("admin");
    await asUser(dono);
    await db.query(`SELECT team_rename_company('Clínica Sol Matriz')`);
    await root();
    expect(await value<string>(`SELECT name AS v FROM companies WHERE id='${own}'`)).toBe("Clínica Sol Matriz");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/__tests__/agenda-hierarchy-database.test.ts -t "convite por link"`
Expected: FAIL com "function team_create_invite_link(...) does not exist".

- [ ] **Step 3: Acrescentar à migração (parte 2)**

```sql
-- ---------- 4. Convite por link e aprovação ----------
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

CREATE OR REPLACE FUNCTION public.team_create_invite_link(_role public.app_role, _permissions text[],
  _requires_approval boolean, _expires_in_days integer, _max_uses integer, _label text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid := public.current_company_id(); v_link public.company_invite_links;
BEGIN
  IF NOT public.has_role(auth.uid(), v_company, 'admin') THEN RAISE EXCEPTION 'Apenas administradores criam convites' USING ERRCODE = '42501'; END IF;
  IF _role = 'admin' THEN RAISE EXCEPTION 'Link de convite não concede administrador. Promova depois em Usuários e Permissões.'; END IF;
  INSERT INTO public.company_invite_links (company_id, label, role, permissions, requires_approval, expires_at, max_uses, created_by)
  VALUES (v_company, NULLIF(trim(_label), ''), _role, COALESCE(_permissions, ARRAY[]::text[]), COALESCE(_requires_approval, false),
    CASE WHEN _expires_in_days IS NULL THEN NULL ELSE now() + make_interval(days => _expires_in_days) END,
    _max_uses, auth.uid())
  RETURNING * INTO v_link;
  RETURN to_jsonb(v_link);
END; $$;

CREATE OR REPLACE FUNCTION public.team_list_invite_links()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), public.current_company_id(), 'admin') THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC) FROM public.company_invite_links l
    WHERE l.company_id = public.current_company_id()), '[]'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.team_revoke_invite_link(_link uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), public.current_company_id(), 'admin') THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501'; END IF;
  UPDATE public.company_invite_links SET revoked_at = now()
  WHERE id = _link AND company_id = public.current_company_id() AND revoked_at IS NULL;
END; $$;

-- Pública de propósito: só o nome da equipe e se o link vale (nada de ids ou e-mails).
CREATE OR REPLACE FUNCTION public.team_invite_link_info(_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link public.company_invite_links; v_name text;
BEGIN
  SELECT * INTO v_link FROM public.company_invite_links WHERE token = _token;
  IF NOT FOUND OR v_link.revoked_at IS NOT NULL OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now())
     OR (v_link.max_uses IS NOT NULL AND v_link.uses >= v_link.max_uses) THEN
    RETURN jsonb_build_object('valid', false, 'company', NULL, 'requiresApproval', false);
  END IF;
  SELECT name INTO v_name FROM public.companies WHERE id = v_link.company_id;
  RETURN jsonb_build_object('valid', true, 'company', v_name, 'requiresApproval', v_link.requires_approval);
END; $$;
GRANT EXECUTE ON FUNCTION public.team_invite_link_info(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.team_approve_member(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid := public.current_company_id();
BEGIN
  IF NOT public.has_role(auth.uid(), v_company, 'admin') THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501'; END IF;
  UPDATE public.company_member_access SET active = true, approval_pending = false
  WHERE user_id = _user AND company_id = v_company AND approval_pending;
END; $$;

CREATE OR REPLACE FUNCTION public.team_reject_member(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid := public.current_company_id();
BEGIN
  IF NOT public.has_role(auth.uid(), v_company, 'admin') THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501'; END IF;
  UPDATE public.company_member_access SET active = false, approval_pending = false
  WHERE user_id = _user AND company_id = v_company AND approval_pending;
END; $$;

CREATE OR REPLACE FUNCTION public.team_rename_company(_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid := public.current_company_id();
BEGIN
  IF NOT public.has_role(auth.uid(), v_company, 'admin') THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501'; END IF;
  IF _name IS NULL OR char_length(trim(_name)) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'Nome da equipe deve ter de 2 a 80 caracteres'; END IF;
  UPDATE public.companies SET name = trim(_name) WHERE id = v_company;
END; $$;

GRANT EXECUTE ON FUNCTION public.team_create_invite_link(public.app_role, text[], boolean, integer, integer, text),
  public.team_list_invite_links(), public.team_revoke_invite_link(uuid), public.team_approve_member(uuid),
  public.team_reject_member(uuid), public.team_rename_company(text) TO authenticated;

-- Lista de membros com a pendência de aprovação.
CREATE OR REPLACE FUNCTION public.team_list_users() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), public.current_company_id(), 'admin') THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'displayName', p.display_name, 'email', p.email,
    'createdAt', p.created_at, 'lastSeenAt', p.last_seen_at,
    'role', (SELECT role FROM user_roles WHERE user_id = p.id AND company_id = p.company_id
             ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'financeiro' THEN 1 ELSE 2 END LIMIT 1),
    'active', a.active, 'permissions', a.permissions, 'approvalPending', a.approval_pending) ORDER BY p.created_at)
    FROM profiles p JOIN company_member_access a ON a.user_id = p.id AND a.company_id = p.company_id
    WHERE p.company_id = public.current_company_id()), '[]'::jsonb);
END; $$;

-- Cadastro: convite por e-mail (como antes), por link (novo) ou equipe nova (admin).
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid;
  v_inv company_invites;
  v_link company_invite_links;
  v_token text := NEW.raw_user_meta_data->>'invite_token';
  v_link_token text := NEW.raw_user_meta_data->>'invite_link';
  v_role app_role := 'admin';
  v_active boolean := true;
  v_pending boolean := false;
  v_permissions text[] := ARRAY['conversations.read','conversations.reply','quotes.manage','agenda.manage','products.view'];
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE id = NEW.id) THEN RETURN NEW; END IF;
  IF v_token IS NOT NULL THEN
    SELECT * INTO v_inv FROM company_invites WHERE token = v_token FOR UPDATE;
    IF NOT FOUND OR v_inv.accepted_at IS NOT NULL OR v_inv.cancelled_at IS NOT NULL OR v_inv.expires_at <= now()
       OR lower(v_inv.email) <> lower(NEW.email) THEN
      RAISE EXCEPTION 'Convite inválido, expirado ou de outro e-mail';
    END IF;
    v_company := v_inv.company_id;
    v_role := v_inv.role;
  ELSIF v_link_token IS NOT NULL THEN
    -- FOR UPDATE: dois cadastros simultâneos não passam do limite de usos.
    SELECT * INTO v_link FROM company_invite_links WHERE token = v_link_token FOR UPDATE;
    IF NOT FOUND OR v_link.revoked_at IS NOT NULL OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now())
       OR (v_link.max_uses IS NOT NULL AND v_link.uses >= v_link.max_uses) THEN
      RAISE EXCEPTION 'Link de convite inválido, expirado ou esgotado';
    END IF;
    v_company := v_link.company_id;
    v_role := v_link.role;
    v_permissions := v_link.permissions;
    v_active := NOT v_link.requires_approval;
    v_pending := v_link.requires_approval;
    UPDATE company_invite_links SET uses = uses + 1 WHERE id = v_link.id;
  ELSE
    INSERT INTO companies(name) VALUES (COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'company_name'), ''), 'Minha Empresa'))
      RETURNING id INTO v_company;
    INSERT INTO company_settings(company_id) VALUES (v_company);
    INSERT INTO loss_reasons(company_id, label) VALUES (v_company, 'Preço acima do orçamento'), (v_company, 'Comprou do concorrente'),
      (v_company, 'Sem retorno do cliente'), (v_company, 'Não era o cliente ideal'), (v_company, 'Problema de prazo');
  END IF;
  INSERT INTO profiles(id, company_id, display_name, email)
  VALUES (NEW.id, v_company, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)), NEW.email);
  INSERT INTO user_roles(company_id, user_id, role) VALUES (v_company, NEW.id, v_role);
  INSERT INTO company_member_access(company_id, user_id, active, permissions, approval_pending, joined_via_link)
  VALUES (v_company, NEW.id, v_active, v_permissions, v_pending, v_link.id);
  IF v_token IS NOT NULL THEN
    UPDATE company_invites SET accepted_at = now(), accepted_by = NEW.id WHERE id = v_inv.id;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 4: Rodar a migração inteira com os testes antigos de equipe**

Run: `npx vitest run src/lib/__tests__/agenda-hierarchy-database.test.ts src/lib/__tests__/team-database.test.ts`
Expected: PASS em tudo. O teste antigo de convite por e-mail continua passando: a lógica foi preservada.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261016120000_agenda_team_hierarchy.sql src/lib/__tests__/agenda-hierarchy-database.test.ts
git commit -m "feat(equipe): convite por link com aprovação e renomear equipe"
```

---

### Task 3: Permissões no código (grupos por módulo e perfis prontos)

**Files:**
- Modify: `src/lib/team/permissions.ts`
- Test: `src/lib/__tests__/team-permission-presets.test.ts` (novo)

**Interfaces:**
- Produces:
  - `PERMISSIONS["agenda.team"]`
  - `PERMISSION_GROUPS: Array<{ module: string; items: Array<{ key: Permission; hint: string }> }>`
  - `PROFILE_PRESETS: Record<"funcionario" | "gestor_agenda", Permission[]>`
  - `presetOf(perms: Permission[], role: TeamRole | null): "funcionario" | "gestor_agenda" | "admin" | "personalizado"`
  - `canManageTeamAgenda(access?: TeamAccess): boolean`

- [ ] **Step 1: Teste (falhando)**

```ts
import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  PROFILE_PRESETS,
  canManageTeamAgenda,
  presetOf,
} from "@/lib/team/permissions";

describe("permissões da equipe", () => {
  it("cada permissão aparece em exatamente um grupo", () => {
    const listed = PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => item.key));
    expect([...listed].sort()).toEqual(Object.keys(PERMISSIONS).sort());
    expect(new Set(listed).size).toBe(listed.length);
  });
  it("perfis prontos e reconhecimento do perfil atual", () => {
    expect(PROFILE_PRESETS.gestor_agenda).toContain("agenda.team");
    expect(PROFILE_PRESETS.funcionario).not.toContain("agenda.team");
    expect(presetOf(PROFILE_PRESETS.funcionario, "atendente")).toBe("funcionario");
    expect(presetOf(PROFILE_PRESETS.gestor_agenda, "atendente")).toBe("gestor_agenda");
    expect(presetOf(["dashboard.view"], "atendente")).toBe("personalizado");
    expect(presetOf([], "admin")).toBe("admin");
  });
  it("gestor da agenda: admin ou permissão agenda.team", () => {
    expect(canManageTeamAgenda({ role: "admin", active: true, permissions: [] })).toBe(true);
    expect(canManageTeamAgenda({ role: "atendente", active: true, permissions: ["agenda.team"] })).toBe(true);
    expect(canManageTeamAgenda({ role: "atendente", active: true, permissions: ["agenda.manage"] })).toBe(false);
    expect(canManageTeamAgenda(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/__tests__/team-permission-presets.test.ts`
Expected: FAIL, com "PERMISSION_GROUPS is not exported".

- [ ] **Step 3: Implementar em `permissions.ts`**

No `PERMISSIONS`, trocar o rótulo de `agenda.manage` e acrescentar `agenda.team` logo depois:

```ts
  "agenda.manage": "Usar a agenda (pessoal)",
  "agenda.team": "Gerenciar agenda da equipe",
```

Ao final do arquivo:

```ts
export const PERMISSION_GROUPS: Array<{ module: string; items: Array<{ key: Permission; hint: string }> }> = [
  { module: "Painel", items: [{ key: "dashboard.view", hint: "Vê os números da empresa." }] },
  {
    module: "Atendimento",
    items: [
      { key: "conversations.read", hint: "Vê a fila e os próprios atendimentos." },
      { key: "conversations.reply", hint: "Assume e responde clientes." },
      { key: "conversations.view_all", hint: "Acompanha os atendimentos de todos." },
      { key: "conversations.assign", hint: "Transfere atendimentos entre pessoas." },
    ],
  },
  {
    module: "Agenda",
    items: [
      { key: "agenda.manage", hint: "Tem a própria agenda: clientes, lembretes e tarefas." },
      { key: "agenda.team", hint: "Cria compromissos da equipe e vê a agenda de todos." },
    ],
  },
  { module: "Orçamentos", items: [{ key: "quotes.manage", hint: "Cria e envia orçamentos." }] },
  {
    module: "Catálogo",
    items: [
      { key: "products.view", hint: "Consulta produtos e preços." },
      { key: "products.manage", hint: "Edita produtos e preços." },
    ],
  },
  { module: "Relatórios", items: [{ key: "reports.view", hint: "Vê relatórios." }] },
  { module: "Marketing", items: [{ key: "campaigns.manage", hint: "Só administradores." }] },
  { module: "IA", items: [{ key: "ai.manage", hint: "Só administradores." }] },
  { module: "Configurações", items: [{ key: "settings.manage", hint: "Só administradores." }] },
];

export const PROFILE_PRESETS = {
  funcionario: [...DEFAULT_ATTENDANT],
  gestor_agenda: [...DEFAULT_ATTENDANT, "agenda.team"],
} satisfies Record<string, Permission[]>;

export function presetOf(permissions: Permission[], role: TeamRole | null) {
  if (role === "admin") return "admin" as const;
  const same = (a: Permission[], b: Permission[]) =>
    a.length === b.length && a.every((item) => b.includes(item));
  if (same(permissions, PROFILE_PRESETS.gestor_agenda)) return "gestor_agenda" as const;
  if (same(permissions, PROFILE_PRESETS.funcionario)) return "funcionario" as const;
  return "personalizado" as const;
}

export function canManageTeamAgenda(access: TeamAccess | undefined): boolean {
  return can(access, "agenda.team");
}
```

- [ ] **Step 4: Rodar e ver passar (mais os testes de permissão antigos)**

Run: `npx vitest run src/lib/__tests__/team-permission-presets.test.ts src/lib/__tests__/team-permissions.test.ts src/lib/__tests__/team-api-access.test.ts`
Expected: PASS. Se um teste antigo comparar o rótulo "Gerenciar agenda", atualize-o para "Usar a agenda (pessoal)".

- [ ] **Step 5: Commit**

```bash
git add src/lib/team/permissions.ts src/lib/__tests__/team-permission-presets.test.ts src/lib/__tests__/team-permissions.test.ts
git commit -m "feat(equipe): permissão de gestão da agenda, grupos e perfis prontos"
```

---

### Task 4: Usuários e Permissões — membros, gaveta, pendentes e links

**Files:**
- Modify: `src/lib/users.functions.ts`
- Create: `src/components/settings/team/MemberPermissionsDrawer.tsx`
- Create: `src/components/settings/team/InviteLinksSection.tsx`
- Create: `src/components/settings/team/PendingApprovals.tsx`
- Modify: `src/components/settings/UsersTab.tsx`
- Test: `src/routes/__tests__/users-permissions.test.tsx` (pasta já incluída no Vitest)

**Interfaces:**
- Consumes: `PERMISSION_GROUPS`, `PROFILE_PRESETS`, `presetOf` (Task 3); RPCs da Task 2.
- Produces (`users.functions.ts`):

```ts
export interface TeamUser { /* campos atuais */ approvalPending?: boolean }
export interface InviteLink {
  id: string; token: string; label: string | null; role: TeamRole; permissions: Permission[];
  requires_approval: boolean; expires_at: string | null; max_uses: number | null; uses: number;
  revoked_at: string | null; created_at: string;
}
export function inviteLinkUrl(token: string, origin?: string): string
export async function listInviteLinks(): Promise<InviteLink[]>
export async function createInviteLink(input: { role: TeamRole; permissions: Permission[]; requiresApproval: boolean; expiresInDays: number | null; maxUses: number | null; label: string }): Promise<InviteLink>
export async function revokeInviteLink(id: string): Promise<void>
export async function approveMember(userId: string): Promise<void>
export async function rejectMember(userId: string): Promise<void>
export async function renameTeam(name: string): Promise<void>
```

- [ ] **Step 1: Teste da tela (falhando)**

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  users: [] as unknown[],
  links: [] as unknown[],
  update: vi.fn(),
  createLink: vi.fn(),
  revoke: vi.fn(),
  approve: vi.fn(),
}));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin" }, profile: { company_id: "c1" } }) }));
vi.mock("@/hooks/useTeamAccess", () => ({
  useTeamAccess: () => ({ isAdmin: true, access: { schemaReady: true, role: "admin", active: true, permissions: [] } }),
}));
vi.mock("@/lib/users.functions", () => ({
  listCompanyUsers: async () => ({ users: api.users }),
  listCompanyInvites: async () => ({ invites: [] }),
  listInviteLinks: async () => api.links,
  inviteUser: vi.fn(),
  cancelInvite: vi.fn(),
  updateTeamMember: api.update,
  createInviteLink: api.createLink,
  revokeInviteLink: api.revoke,
  approveMember: api.approve,
  rejectMember: vi.fn(),
  inviteLinkUrl: (token: string) => `https://app.test/convite?link=${token}`,
}));
import { UsersTab } from "@/components/settings/UsersTab";

const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UsersTab />
    </QueryClientProvider>,
  );

beforeEach(() => {
  api.users = [
    { id: "admin", displayName: "Ana", email: "ana@x", role: "admin", active: true, permissions: [], createdAt: "", lastSeenAt: null },
    { id: "u2", displayName: "Bruno", email: "b@x", role: "atendente", active: true, permissions: ["conversations.read","conversations.reply","quotes.manage","agenda.manage","products.view"], createdAt: "", lastSeenAt: null },
    { id: "u3", displayName: "Carla", email: "c@x", role: "atendente", active: false, approvalPending: true, permissions: ["agenda.manage"], createdAt: "", lastSeenAt: null },
  ];
  api.links = [];
  Object.values(api).forEach((item) => typeof item === "function" && "mockReset" in item && item.mockReset());
});
afterEach(cleanup);

describe("Usuários e Permissões", () => {
  it("lista membros com perfil e mostra aprovação pendente", async () => {
    wrap();
    expect(await screen.findByText("Bruno")).toBeInTheDocument();
    expect(screen.getByText("Funcionário")).toBeInTheDocument();
    const pending = screen.getByRole("region", { name: /aguardando aprovação/i });
    expect(within(pending).getByText("Carla")).toBeInTheDocument();
    await userEvent.click(within(pending).getByRole("button", { name: /aprovar/i }));
    await waitFor(() => expect(api.approve).toHaveBeenCalledWith("u3"));
  });

  it("perfil Gestor da agenda liga a permissão de equipe e salva", async () => {
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: /editar bruno/i }));
    await userEvent.click(screen.getByRole("radio", { name: /gestor da agenda/i }));
    expect(screen.getByRole("switch", { name: /gerenciar agenda da equipe/i })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: /salvar/i }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ id: "u2", permissions: expect.arrayContaining(["agenda.team"]) })),
    );
  });

  it("cria link de convite com aprovação e mostra o endereço para copiar", async () => {
    api.createLink.mockResolvedValue({ id: "l1", token: "abc", label: "Vendas", role: "atendente", permissions: [], requires_approval: true, expires_at: null, max_uses: null, uses: 0, revoked_at: null, created_at: "" });
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: /gerar link/i }));
    await userEvent.click(screen.getByRole("switch", { name: /exigir minha aprovação/i }));
    await userEvent.click(screen.getByRole("button", { name: /criar link/i }));
    await waitFor(() => expect(api.createLink).toHaveBeenCalledWith(expect.objectContaining({ requiresApproval: true })));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/routes/__tests__/users-permissions.test.tsx`
Expected: FAIL. Ainda não existe a região "Aguardando aprovação" nem o botão "Gerar link".

- [ ] **Step 3: Funções de API em `users.functions.ts`**

Acrescentar `approvalPending?: boolean` em `TeamUser` e, ao final:

```ts
export interface InviteLink {
  id: string;
  token: string;
  label: string | null;
  role: TeamRole;
  permissions: Permission[];
  requires_approval: boolean;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  revoked_at: string | null;
  created_at: string;
}
export function inviteLinkUrl(token: string, origin = typeof window === "undefined" ? "" : window.location.origin) {
  return `${origin}/convite?link=${encodeURIComponent(token)}`;
}
export async function listInviteLinks() {
  return teamRpc<InviteLink[]>("team_list_invite_links");
}
export async function createInviteLink(input: {
  role: TeamRole;
  permissions: Permission[];
  requiresApproval: boolean;
  expiresInDays: number | null;
  maxUses: number | null;
  label: string;
}) {
  return teamRpc<InviteLink>("team_create_invite_link", {
    _role: input.role,
    _permissions: input.permissions,
    _requires_approval: input.requiresApproval,
    _expires_in_days: input.expiresInDays,
    _max_uses: input.maxUses,
    _label: input.label,
  });
}
export async function revokeInviteLink(id: string) {
  await teamRpc("team_revoke_invite_link", { _link: id });
}
export async function approveMember(userId: string) {
  await teamRpc("team_approve_member", { _user: userId });
}
export async function rejectMember(userId: string) {
  await teamRpc("team_reject_member", { _user: userId });
}
export async function renameTeam(name: string) {
  await teamRpc("team_rename_company", { _name: name });
}
```

- [ ] **Step 4: Gaveta de permissões `MemberPermissionsDrawer.tsx`**

Gaveta (`Sheet`) com:
- cabeçalho com nome e e-mail;
- perfil em `role="radiogroup"` com Funcionário, Gestor da agenda, Administrador e Personalizado. Personalizado só aparece selecionado, não é clicável;
- para cada `PERMISSION_GROUPS`, o título do módulo e um interruptor `role="switch"` por permissão, com rótulo `PERMISSIONS[key]` e a dica embaixo. Permissões de `ADMIN_ONLY_PERMISSIONS` ficam desabilitadas fora do papel admin;
- Ativo/Desativado e o botão Salvar, que chama `onSave({ id, role, active, permissions })`.

```tsx
import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  ADMIN_ONLY_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_GROUPS,
  PROFILE_PRESETS,
  presetOf,
  type Permission,
  type TeamRole,
} from "@/lib/team/permissions";
import type { TeamUser } from "@/lib/users.functions";

const PRESET_LABEL = {
  funcionario: "Funcionário",
  gestor_agenda: "Gestor da agenda",
  admin: "Administrador",
  personalizado: "Personalizado",
} as const;

export function MemberPermissionsDrawer({
  member,
  self,
  onClose,
  onSave,
}: {
  member: TeamUser | null;
  self: boolean;
  onClose: () => void;
  onSave: (data: Pick<TeamUser, "id" | "role" | "active" | "permissions">) => Promise<void>;
}) {
  const [role, setRole] = useState<TeamRole | null>(member?.role ?? "atendente");
  const [permissions, setPermissions] = useState<Permission[]>(member?.permissions ?? []);
  const [active, setActive] = useState(member?.active ?? true);
  const [saving, setSaving] = useState(false);
  if (!member) return null;
  const preset = presetOf(permissions, role);
  const choose = (next: "funcionario" | "gestor_agenda" | "admin") => {
    if (next === "admin") return setRole("admin");
    setRole("atendente");
    setPermissions([...PROFILE_PRESETS[next]]);
  };
  const toggle = (key: Permission) =>
    setPermissions((list) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]));
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-[94vw] max-w-[480px] overflow-y-auto">
        <SheetTitle>{member.displayName ?? member.email}</SheetTitle>
        <SheetDescription>{member.email}</SheetDescription>
        <div role="radiogroup" aria-label="Perfil" className="mt-5 grid grid-cols-2 gap-2">
          {(["funcionario", "gestor_agenda", "admin"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={preset === key}
              disabled={self && key !== "admin"}
              onClick={() => choose(key)}
              className="rounded-2xl border border-border px-3 py-2.5 text-left text-sm aria-checked:border-foreground aria-checked:bg-secondary"
            >
              {PRESET_LABEL[key]}
            </button>
          ))}
          {preset === "personalizado" && (
            <span role="radio" aria-checked className="rounded-2xl border border-foreground px-3 py-2.5 text-sm">
              Personalizado
            </span>
          )}
        </div>
        {role !== "admin" &&
          PERMISSION_GROUPS.map((group) => (
            <section key={group.module} className="mt-6">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.module}</h4>
              <ul className="mt-2 space-y-2">
                {group.items.map((item) => {
                  const locked = ADMIN_ONLY_PERMISSIONS.includes(item.key);
                  return (
                    <li key={item.key} className="flex items-start justify-between gap-3">
                      <span className="text-sm">
                        {PERMISSIONS[item.key]}
                        <span className="block text-xs text-muted-foreground">{item.hint}</span>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-label={PERMISSIONS[item.key]}
                        aria-checked={permissions.includes(item.key)}
                        disabled={locked}
                        onClick={() => toggle(item.key)}
                        className="relative h-6 w-10 shrink-0 rounded-full bg-secondary transition-colors aria-checked:bg-violet-600 disabled:opacity-40"
                      >
                        <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform [[aria-checked=true]>&]:translate-x-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        <label className="mt-6 flex items-center justify-between text-sm">
          Acesso ativo
          <input type="checkbox" checked={active} disabled={self} onChange={(e) => setActive(e.target.checked)} />
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave({ id: member.id, role, active, permissions });
              onClose();
            } finally {
              setSaving(false);
            }
          }}
          className="mt-6 w-full rounded-full bg-foreground px-4 py-2.5 text-sm font-semibold text-background"
        >
          Salvar
        </button>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 5: `PendingApprovals.tsx` e `InviteLinksSection.tsx`**

`PendingApprovals`: `<section aria-label="Aguardando aprovação">` com a lista dos membros com `approvalPending && !active` e os botões "Aprovar" e "Recusar" (`approveMember` / `rejectMember`, depois `onChanged()`). Não renderiza nada se a lista estiver vazia.

```tsx
import type { TeamUser } from "@/lib/users.functions";
export function PendingApprovals({
  members,
  onApprove,
  onReject,
}: {
  members: TeamUser[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const pending = members.filter((member) => member.approvalPending && !member.active);
  if (!pending.length) return null;
  return (
    <section aria-label="Aguardando aprovação" className="rounded-2xl border border-violet-500/40 p-4">
      <h3 className="text-sm font-semibold">Aguardando aprovação</h3>
      <ul className="mt-3 space-y-2">
        {pending.map((member) => (
          <li key={member.id} className="flex items-center justify-between gap-3 text-sm">
            <span>
              <b>{member.displayName ?? member.email}</b>
              <span className="block text-xs text-muted-foreground">{member.email}</span>
            </span>
            <span className="flex gap-2">
              <button type="button" className="rounded-full border border-border px-3 py-1.5" onClick={() => onReject(member.id)}>
                Recusar
              </button>
              <button type="button" className="rounded-full bg-foreground px-3 py-1.5 text-background" onClick={() => onApprove(member.id)}>
                Aprovar
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`InviteLinksSection`: botão "Gerar link" que abre um formulário com:
- nome do link;
- perfil (Funcionário ou Gestor da agenda), que define `permissions` por `PROFILE_PRESETS`;
- interruptor "Exigir minha aprovação" (`role="switch"`);
- validade (1, 7 ou 30 dias, ou sem prazo);
- limite de usos (vazio = sem limite);
- botão "Criar link", que chama `createInviteLink` e mostra o endereço `inviteLinkUrl(token)` com "Copiar".

Abaixo, a lista dos links: nome, usos/limite, validade, status (ativo, revogado, vencido, esgotado), "Copiar" e "Revogar".

```tsx
import { useState } from "react";
import { Copy, Link2 } from "lucide-react";
import { toast } from "sonner";
import { PROFILE_PRESETS } from "@/lib/team/permissions";
import { createInviteLink, inviteLinkUrl, revokeInviteLink, type InviteLink } from "@/lib/users.functions";

function linkStatus(link: InviteLink) {
  if (link.revoked_at) return "Revogado";
  if (link.expires_at && new Date(link.expires_at) <= new Date()) return "Vencido";
  if (link.max_uses != null && link.uses >= link.max_uses) return "Esgotado";
  return "Ativo";
}

export function InviteLinksSection({ links, onChanged }: { links: InviteLink[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [profile, setProfile] = useState<"funcionario" | "gestor_agenda">("funcionario");
  const [approval, setApproval] = useState(false);
  const [days, setDays] = useState<number | null>(7);
  const [maxUses, setMaxUses] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const copy = async (token: string) => {
    await navigator.clipboard.writeText(inviteLinkUrl(token));
    toast.success("Link copiado");
  };
  return (
    <section aria-label="Links de convite" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Links de convite</h3>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm">
          <Link2 className="h-4 w-4" /> Gerar link
        </button>
      </div>
      {open && (
        <form
          className="space-y-3 rounded-2xl border border-border p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const link = await createInviteLink({
              role: "atendente",
              permissions: [...PROFILE_PRESETS[profile]],
              requiresApproval: approval,
              expiresInDays: days,
              maxUses: maxUses ? Number(maxUses) : null,
              label,
            });
            setCreated(link.token);
            onChanged();
          }}
        >
          <input className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm" placeholder="Nome do link (ex.: Equipe de vendas)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <div role="radiogroup" aria-label="Perfil de quem entra" className="flex gap-2">
            {(["funcionario", "gestor_agenda"] as const).map((key) => (
              <button key={key} type="button" role="radio" aria-checked={profile === key} onClick={() => setProfile(key)} className="rounded-full border border-border px-3 py-1.5 text-sm aria-checked:bg-secondary">
                {key === "funcionario" ? "Funcionário" : "Gestor da agenda"}
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between text-sm">
            Exigir minha aprovação
            <button type="button" role="switch" aria-label="Exigir minha aprovação" aria-checked={approval} onClick={() => setApproval(!approval)} className="h-6 w-10 rounded-full bg-secondary aria-checked:bg-violet-600" />
          </label>
          <div className="flex flex-wrap gap-2 text-sm">
            {[1, 7, 30, null].map((value) => (
              <button key={String(value)} type="button" aria-pressed={days === value} onClick={() => setDays(value)} className="rounded-full border border-border px-3 py-1.5 aria-pressed:bg-secondary">
                {value ? `${value} dia${value > 1 ? "s" : ""}` : "Sem prazo"}
              </button>
            ))}
            <input type="number" min={1} placeholder="Limite de usos" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} className="w-36 rounded-xl border border-border bg-input px-3 py-1.5" />
          </div>
          <button type="submit" className="rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background">Criar link</button>
          {created && (
            <p className="flex items-center gap-2 break-all text-xs">
              {inviteLinkUrl(created)}
              <button type="button" aria-label="Copiar link" onClick={() => void copy(created)}><Copy className="h-3.5 w-3.5" /></button>
            </p>
          )}
        </form>
      )}
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3 text-sm">
            <span>
              <b>{link.label ?? "Link de convite"}</b>
              <span className="block text-xs text-muted-foreground">
                {linkStatus(link)} · {link.uses}{link.max_uses ? `/${link.max_uses}` : ""} usos
                {link.requires_approval ? " · com aprovação" : ""}
                {link.expires_at ? ` · até ${new Date(link.expires_at).toLocaleDateString("pt-BR")}` : ""}
              </span>
            </span>
            <span className="flex gap-2">
              {linkStatus(link) === "Ativo" && (
                <>
                  <button type="button" className="rounded-full border border-border px-3 py-1.5" onClick={() => void copy(link.token)}>Copiar</button>
                  <button type="button" className="rounded-full border border-border px-3 py-1.5" onClick={async () => { await revokeInviteLink(link.id); onChanged(); }}>Revogar</button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 6: Montar em `UsersTab.tsx`**

- A consulta (`query`) passa a buscar também `listInviteLinks()`, só para admin.
- A ordem da tela fica: `PendingApprovals`, a lista de membros e depois `InviteLinksSection`, seguida da seção atual de convites por e-mail.
- Membros: cada linha mostra nome, e-mail, o perfil (`PRESET_LABEL[presetOf(...)]`) e o status (Ativo, Pendente, Desativado), mais um botão com `aria-label={"Editar " + nome}` que abre `MemberPermissionsDrawer`. O botão salva com `perform(() => updateTeamMember(data))`.
- Aprovar ou recusar chama `perform(() => approveMember(id))` ou `perform(() => rejectMember(id))`.
- Remover o editor de permissões antigo que hoje está no `Dialog` deste arquivo; a gaveta o substitui.

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run src/routes/__tests__/users-permissions.test.tsx && npx tsc --noEmit -p .`
Expected: PASS e tipagem limpa.

- [ ] **Step 8: Commit**

```bash
git add src/lib/users.functions.ts src/components/settings src/routes/__tests__/users-permissions.test.tsx
git commit -m "feat(equipe): Usuários e Permissões com perfis, aprovação e links de convite"
```

---

### Task 5: Entrar pelo link e boas-vindas "Crie sua equipe"

**Files:**
- Modify: `src/routes/convite.tsx`
- Modify: `src/auth/AuthContext.tsx` (função de cadastro aceita `inviteLink`)
- Create: `src/components/team/WelcomeTeamDialog.tsx`
- Modify: `src/components/AppShell.tsx` (montar o diálogo)
- Test: `src/routes/__tests__/invite-link-page.test.tsx`

**Interfaces:**
- Consumes: RPC `team_invite_link_info`, `renameTeam` (Task 4).
- Produces: `signUp(email, password, name, companyName?, options?: { inviteLink?: string })`. Ler a assinatura atual em `AuthContext.tsx:~130` e acrescentar só o parâmetro opcional, que vai para `options.data.invite_link`.

- [ ] **Step 1: Teste (falhando)**

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => ({ ...(opts as object), useSearch: () => ({ link: "tok" }) }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ user: null, signUp: vi.fn() }) }));
import { InviteLinkJoin } from "@/routes/convite";

describe("entrar pelo link", () => {
  it("mostra o nome da equipe e pede cadastro", async () => {
    rpc.mockResolvedValue({ data: { valid: true, company: "Clínica Sol", requiresApproval: true }, error: null });
    render(<InviteLinkJoin token="tok" />);
    expect(await screen.findByText(/Clínica Sol/)).toBeInTheDocument();
    expect(screen.getByText(/aprovação do administrador/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /criar conta e entrar/i })).toBeInTheDocument();
  });
  it("link inválido explica e não mostra formulário", async () => {
    rpc.mockResolvedValue({ data: { valid: false, company: null, requiresApproval: false }, error: null });
    render(<InviteLinkJoin token="tok" />);
    expect(await screen.findByText(/link expirou, foi revogado ou atingiu o limite/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /criar conta/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/routes/__tests__/invite-link-page.test.tsx`
Expected: FAIL, porque `InviteLinkJoin` não está exportado.

- [ ] **Step 3: Implementar `InviteLinkJoin` em `convite.tsx`**

Exportar o componente `InviteLinkJoin({ token })`:
- busca `supabase.rpc("team_invite_link_info", { _token: token })`;
- se `valid` for falso, mostra "Este link expirou, foi revogado ou atingiu o limite. Peça um novo ao administrador.";
- se valer, mostra "Você foi convidado para **{company}**", o aviso "Seu acesso começa após a aprovação do administrador." quando `requiresApproval`, e o formulário (nome, e-mail, senha) com o botão "Criar conta e entrar", que chama `signUp(email, password, name, undefined, { inviteLink: token })`;
- se `user` já estiver logado, mostra "Você já está conectado. Para entrar nesta equipe, saia e crie a conta com outro e-mail." (uma empresa por conta).

Na rota, ler `?link=`; com ele, renderizar `InviteLinkJoin`, e sem ele manter o fluxo atual de `?token=`.

- [ ] **Step 4: `WelcomeTeamDialog.tsx`**

Diálogo que abre uma vez (marca em `localStorage` `lume.welcomeTeam.{companyId}`, com try/catch) quando `isAdmin` e o nome da empresa é "Minha Empresa":
- título "Crie sua equipe" e o campo "Nome da equipe";
- "Continuar" chama `renameTeam(name)` e depois mostra "Convide sua equipe", com o botão "Gerar link de convite" que abre as Configurações na aba usuários (`SettingsRedirect tab="usuarios"`) e "Agora não".

Montar no `AppShell` ao lado dos outros elementos globais.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/routes/__tests__/invite-link-page.test.tsx && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/convite.tsx src/auth/AuthContext.tsx src/components/team/WelcomeTeamDialog.tsx src/components/AppShell.tsx src/routes/__tests__/invite-link-page.test.tsx
git commit -m "feat(equipe): entrar pelo link e boas-vindas para criar a equipe"
```

---

### Task 6: Agenda — modelo, detecção e dados de tags e membros

**Files:**
- Modify: `src/components/agenda/agenda-model.ts`, `src/components/agenda/agenda-schema.ts`, `src/components/agenda/useAgendaEvents.ts`
- Create: `src/components/agenda/useAgendaTags.ts`, `src/components/agenda/useTeamDirectory.ts`
- Test: `src/components/agenda/__tests__/agenda-hierarchy.test.ts`

**Interfaces:**
- Produces:

```ts
// agenda-model.ts
export type EventScope = "pessoal" | "equipe";
// AgendaEvent ganha: owner_id?: string | null; scope?: EventScope; everyone?: boolean;
//   tag_ids?: string[]; participant_ids?: string[]
export interface AgendaTag { id: string; name: string; hue: number; owner_id: string | null }
export const AGENDA_SELECT_HIERARCHY: string // EXTENDED + ",owner_id,scope,everyone,agenda_event_tags(tag_id),agenda_event_participants(user_id)"
export type ScopeFilter = { kind: "minha" } | { kind: "equipe" } | { kind: "pessoa"; userId: string };
export function matchesScope(event: AgendaEvent, filter: ScopeFilter, me: string): boolean
export function canEditEvent(event: AgendaEvent, me: string, manager: boolean): boolean
// agenda-schema.ts
export interface AgendaSchema { extended: boolean; hierarchy: boolean }
// useAgendaTags.ts
export function useAgendaTags(companyId: string | null | undefined, enabled: boolean): {
  tags: AgendaTag[]; companyTags: AgendaTag[]; myTags: AgendaTag[];
  create(input: { name: string; hue: number; personal: boolean }): Promise<AgendaTag | null>;
  update(id: string, changes: { name?: string; hue?: number }): Promise<void>;
  remove(id: string): Promise<void>;
}
// useTeamDirectory.ts
export interface TeamMember { id: string; name: string }
export function useTeamDirectory(enabled: boolean): TeamMember[] // RPC team_directory
```

- [ ] **Step 1: Teste (falhando)**

```ts
import { describe, expect, it } from "vitest";
import { canEditEvent, matchesScope, type AgendaEvent } from "../agenda-model";

const base = {
  id: "e", title: "t", address: null, scheduled_at: "2026-10-16T12:00:00Z", status: "agendada",
  notes: null, customer_name: null, customer_phone: null, product: null, lead_id: null, quote_id: null,
  appointment_type: "retorno_comercial", city: null, salesperson: null, technician: null,
} as AgendaEvent;

describe("hierarquia na tela", () => {
  const mine = { ...base, owner_id: "me", scope: "pessoal" } as AgendaEvent;
  const team = { ...base, owner_id: "boss", scope: "equipe", participant_ids: ["me"] } as AgendaEvent;
  const other = { ...base, owner_id: "x", scope: "pessoal" } as AgendaEvent;

  it("Minha agenda: os meus e os de equipe em que participo", () => {
    expect(matchesScope(mine, { kind: "minha" }, "me")).toBe(true);
    expect(matchesScope(team, { kind: "minha" }, "me")).toBe(true);
    expect(matchesScope(other, { kind: "minha" }, "me")).toBe(false);
  });
  it("Pessoa: os dela como dona ou participante", () => {
    expect(matchesScope(other, { kind: "pessoa", userId: "x" }, "me")).toBe(true);
    expect(matchesScope(team, { kind: "pessoa", userId: "me" }, "boss")).toBe(true);
  });
  it("edição: gestor tudo; funcionário só o pessoal dele; sem hierarquia, como hoje", () => {
    expect(canEditEvent(team, "me", false)).toBe(false);
    expect(canEditEvent(mine, "me", false)).toBe(true);
    expect(canEditEvent(other, "me", true)).toBe(true);
    expect(canEditEvent(base, "me", false)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/components/agenda/__tests__/agenda-hierarchy.test.ts`
Expected: FAIL, porque `matchesScope` não existe.

- [ ] **Step 3: Implementar**

Em `agenda-model.ts`:

```ts
export type EventScope = "pessoal" | "equipe";
export interface AgendaTag { id: string; name: string; hue: number; owner_id: string | null }
export const AGENDA_SELECT_HIERARCHY = `${AGENDA_SELECT_EXTENDED},owner_id,scope,everyone,agenda_event_tags(tag_id),agenda_event_participants(user_id)`;
export type ScopeFilter = { kind: "minha" } | { kind: "equipe" } | { kind: "pessoa"; userId: string };

export function matchesScope(event: AgendaEvent, filter: ScopeFilter, me: string): boolean {
  const involves = (user: string) => event.owner_id === user || (event.participant_ids ?? []).includes(user);
  if (filter.kind === "equipe") return true;
  if (filter.kind === "pessoa") return involves(filter.userId);
  return involves(me) || (event.scope === "equipe" && !!event.everyone);
}

/** Sem a migração de hierarquia (scope ausente), todos editam, como antes. */
export function canEditEvent(event: AgendaEvent, me: string, manager: boolean): boolean {
  if (!event.scope) return true;
  return manager || (event.scope === "pessoal" && event.owner_id === me);
}
```

Acrescentar os campos opcionais em `AgendaEvent`:

```ts
  owner_id?: string | null;
  scope?: EventScope;
  everyone?: boolean;
  tag_ids?: string[];
  participant_ids?: string[];
```

`agenda-schema.ts`: a detecção passa a testar também `agenda_tags`:

```ts
export interface AgendaSchema { extended: boolean; hierarchy: boolean }
// dentro de detectAgendaSchema():
const [types, tags] = await Promise.all([
  supabase.from("agenda_event_types" as never).select("id").limit(1),
  supabase.from("agenda_tags" as never).select("id").limit(1),
]);
return { extended: !types.error, hierarchy: !tags.error };
```

`useAgendaEvents.ts`:
- usar `AGENDA_SELECT_HIERARCHY` quando `hierarchy`;
- ao carregar, achatar `agenda_event_tags` em `tag_ids` e `agenda_event_participants` em `participant_ids`;
- expor `hierarchy` no retorno.

```ts
const rows = (data ?? []) as unknown as Array<AgendaEvent & {
  agenda_event_tags?: Array<{ tag_id: string }>;
  agenda_event_participants?: Array<{ user_id: string | null }>;
}>;
setEvents(rows.map(({ agenda_event_tags, agenda_event_participants, ...event }) => ({
  ...event,
  tag_ids: agenda_event_tags?.map((row) => row.tag_id) ?? [],
  participant_ids: agenda_event_participants?.map((row) => row.user_id).filter((id): id is string => !!id) ?? [],
})));
```

`useAgendaTags.ts`:
- `select("id,name,hue,owner_id").eq("company_id", companyId).order("name")`;
- `create` insere `{ company_id, name: name.trim(), hue, owner_id: personal ? userId : null }`, com `userId` vindo de `useAuth().user?.id`; erro `23505` vira "Já existe uma tag com esse nome.";
- `companyTags` são as de `owner_id === null`, e `myTags` as de `owner_id === userId`.

`useTeamDirectory.ts`: chama `teamRpc<Array<{ id: string; name: string }>>("team_directory")` quando `enabled`, com try/catch que devolve `[]`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/components/agenda && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/agenda
git commit -m "feat(agenda): modelo de hierarquia, tags e membros na tela"
```

---

### Task 7: Agenda — tela (escopo, formulário, tags, painel, Personalizar, Equipe)

**Files:**
- Create: `src/components/agenda/TagPicker.tsx`
- Modify: `src/components/agenda/event-form.ts`, `EventFormModal.tsx`, `AgendaToolbar.tsx`, `EventDrawer.tsx`, `AgendaCustomize.tsx`, `AgendaViews.tsx`, `src/routes/agenda.tsx`
- Test: `src/components/agenda/__tests__/event-form.test.ts` (estender), `src/components/agenda/__tests__/agenda-scope-ui.test.tsx` (novo)

**Interfaces:**
- Consumes: Task 6 inteira.
- Produces (`event-form.ts`):
  - `EventForm` ganha `scope: EventScope; everyone: boolean; ownerId: string | null; participantIds: string[]; tagIds: string[]`;
  - `buildEventRow(form, { companyId, extended, hierarchy, source })` grava `scope`, `everyone` e `owner_id` quando `hierarchy`;
  - `saveEventRelations(eventId, form, companyId): Promise<void>` substitui `agenda_event_tags` e `agenda_event_participants` do compromisso.

- [ ] **Step 1: Testes (falhando)**

Em `event-form.test.ts`:

```ts
it("com hierarquia grava alcance, toda a equipe e dono", () => {
  const form = { ...emptyForm(new Date(2026, 9, 15, 9, 0)), title: "Treino", scope: "equipe" as const, everyone: true, ownerId: "boss" };
  const row = buildEventRow(form, { companyId: "c1", extended: true, hierarchy: true });
  expect(row).toMatchObject({ scope: "equipe", everyone: true, owner_id: "boss" });
  const legacy = buildEventRow(form, { companyId: "c1", extended: true, hierarchy: false });
  expect(legacy).not.toHaveProperty("scope");
});
it("pessoal nunca grava toda a equipe", () => {
  const form = { ...emptyForm(), title: "x", scope: "pessoal" as const, everyone: true };
  expect(buildEventRow(form, { companyId: "c1", extended: true, hierarchy: true }).everyone).toBe(false);
});
```

`agenda-scope-ui.test.tsx`: renderiza `EventFormModal` com `manager={false}` e confere que **não existe** o grupo "Alcance". Com `manager={true}`, confere que existe e que "Equipe" mostra "Participantes" e "Toda a equipe". O setup segue o padrão de mocks de `lume-dock.test.tsx`: mockar `@/integrations/supabase/client`, `@/data/leadRepo` (`getLeads: () => []`, `subscribeRepo: () => () => {}`), `@/data/quotes` e `./useTeamDirectory`.

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
vi.mock("@/data/leadRepo", () => ({ getLeads: () => [], subscribeRepo: () => () => {} }));
vi.mock("@/data/quotes", () => ({ listQuotes: () => [], subscribeQuotes: () => () => {} }));
import { EventFormModal } from "../EventFormModal";
afterEach(cleanup);
const props = {
  companyId: "c1", event: null, initialAt: new Date(2026, 9, 16, 9), types: [], extended: true,
  hierarchy: true, tags: [], members: [{ id: "u2", name: "Bruno" }], me: "u1",
  onClose: () => {}, onSaved: () => {}, onCreateTag: async () => null,
};
async function toPeopleStep() {
  await userEvent.type(screen.getByPlaceholderText(/reunião de alinhamento/i), "Treino");
  await userEvent.click(screen.getByRole("button", { name: /avançar/i }));
}
describe("formulário com hierarquia", () => {
  it("funcionário não escolhe alcance", async () => {
    render(<EventFormModal {...props} manager={false} />);
    await toPeopleStep();
    expect(screen.queryByRole("radiogroup", { name: /alcance/i })).toBeNull();
  });
  it("gestor escolhe Equipe e vê participantes e toda a equipe", async () => {
    render(<EventFormModal {...props} manager />);
    await toPeopleStep();
    await userEvent.click(screen.getByRole("radio", { name: /^equipe$/i }));
    expect(screen.getByRole("group", { name: /participantes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /toda a equipe/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/components/agenda`
Expected: FAIL nos testes novos.

- [ ] **Step 3: `event-form.ts`**

Acrescentar ao `EventForm`, com padrão em `emptyForm`: `scope: "pessoal", everyone: false, ownerId: null, participantIds: [], tagIds: []`. Em `formFromEvent`, ler de `event.scope ?? "pessoal"`, `event.everyone ?? false`, `event.owner_id ?? null`, `event.participant_ids ?? []` e `event.tag_ids ?? []`. Em `buildEventRow`:

```ts
if (options.hierarchy) {
  Object.assign(row, {
    scope: form.scope,
    everyone: form.scope === "equipe" && form.everyone,
    ...(form.ownerId ? { owner_id: form.ownerId } : {}),
  });
}
```

E a função de relações:

```ts
export async function saveEventRelations(eventId: string, form: EventForm, companyId: string) {
  const { supabase } = await import("@/integrations/supabase/client");
  const tags = supabase.from("agenda_event_tags" as never);
  await tags.delete().eq("event_id", eventId);
  if (form.tagIds.length)
    await tags.insert(form.tagIds.map((tag_id) => ({ company_id: companyId, event_id: eventId, tag_id })) as never);
  const people = supabase.from("agenda_event_participants" as never);
  await people.delete().eq("event_id", eventId);
  if (form.scope === "equipe" && form.participantIds.length)
    await people.insert(
      form.participantIds.map((user_id) => ({ company_id: companyId, event_id: eventId, user_id, name: user_id, role: "participante" })) as never,
    );
}
```

Ao inserir participantes, gravar `name` com o nome do membro: a chamada recebe `members` e passa `members.find(...)?.name ?? "Membro"`. Ajustar a assinatura para `saveEventRelations(eventId, form, companyId, members: TeamMember[])`.

- [ ] **Step 4: `TagPicker.tsx`**

Chips multisseleção (`role="group" aria-label="Tags"`), cada um `aria-pressed`, com um ponto `oklch(0.7 0.08 hue)`. Ao final, "+ Nova tag" abre um campo inline (nome e matiz) e, para gestor, a escolha "Da empresa / Só minha". Chama `onCreate({ name, hue, personal })` e marca a tag nova. Seções: "Da empresa" e "Minhas".

- [ ] **Step 5: `EventFormModal.tsx`**

- Novas props: `hierarchy: boolean; manager: boolean; me: string; members: TeamMember[]; tags: AgendaTag[]; onCreateTag(input): Promise<AgendaTag | null>`.
- Etapa "Quando": trocar a seção "Tipo" por `TagPicker` (só com `hierarchy`; sem hierarquia, continuam os tipos de hoje).
- Etapa "Pessoas":
  - remover "Responsável" e "Executor / técnico" quando `hierarchy`;
  - se `manager`: `role="radiogroup" aria-label="Alcance"` com "Pessoal" e "Equipe"; com Equipe, `role="group" aria-label="Participantes"` (chips dos `members`) e o botão "Toda a equipe" (`aria-pressed`); "Dono" num `select` de membros, com padrão `me`.
- Ao salvar: `buildEventRow(..., { hierarchy })` e, se `hierarchy`, `await saveEventRelations(id, form, companyId, members)`.
- Resumo final: "Alcance" e "Tags" no lugar de "Equipe".

- [ ] **Step 6: Barra, painel, Personalizar e Equipe**

- `AgendaToolbar`: com `hierarchy && manager`, um seletor `role="tablist" aria-label="De quem"` com "Minha agenda", "Equipe" e um `select` "Pessoa…" (membros), emitindo `ScopeFilter`. Os chips de tipo passam a ser chips de tags (`filters.typeIds` passa a guardar ids de tag; o filtro em `applyFilters` usa `event.tag_ids`).
- `EventDrawer`:
  - mostra "Dono" (nome via `members`), "Alcance", "Participantes" e as tags (chips);
  - os botões Editar e Excluir e o seletor de status só aparecem se `canEditEvent(event, me, manager)`;
  - "Técnico (registro antigo)" e "Vendedor (registro antigo)" aparecem só quando houver valor.
- `AgendaCustomize`: a seção "Tipos de evento da empresa" vira "Tags": "Da empresa" (criar, editar ou excluir só se `manager`) e "Minhas tags". Sem "Criar tipos sugeridos".
- `AgendaViews.TeamView`: agrupa por `owner_id` e `participant_ids`, com o nome vindo de `members`. Sem dono = "Equipe toda". Só aparece para gestor.
- `src/routes/agenda.tsx`:
  - carregar `useAgendaTags`, `useTeamDirectory`, `useTeamAccess` (`manager = canManageTeamAgenda(access)`) e `me = user.id`;
  - aplicar `matchesScope` antes de `applyFilters`, com padrão `{ kind: "minha" }`; para gestor, guardar a escolha em `writePreference("scope", ...)`;
  - esconder a visão "Equipe" para quem não é gestor.

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run src/components/agenda && npx tsc --noEmit -p . && npx eslint src/components/agenda --fix`
Expected: PASS e lint limpo.

- [ ] **Step 8: Commit**

```bash
git add src/components/agenda src/routes/agenda.tsx
git commit -m "feat(agenda): agenda pessoal × equipe, tags e participantes na tela"
```

---

### Task 8: Lume — alcance, participantes e tags

**Files:**
- Modify: `src/lib/lume/domains/agenda.server.ts`
- Test: `src/lib/__tests__/lume-agenda.test.ts` (estender)

**Interfaces:**
- Consumes: tabelas da Task 1, RPC `team_directory`.
- Produces: `EVENT_FIELDS` ganha `alcance: "pessoal" | "equipe"`, `participantes: string[]` (nomes) e `tags: string[]` (nomes). `agenda_criar` e `agenda_alterar` gravam `scope` e `everyone` (se `participantes` contém "todos") e as tabelas de relação.

- [ ] **Step 1: Teste (falhando)**

```ts
it("cria de equipe com participantes e tags pelo nome", async () => {
  const client = fakeClient({
    agenda_tags: [{ id: "t1", name: "Comercial", owner_id: null }],
    profiles: [{ id: "u2", display_name: "Bruno" }],
  });
  await tool("agenda_criar").execute(
    { titulo: "Treino", inicio: "2026-10-16T09:00", alcance: "equipe", participantes: ["bruno"], tags: ["comercial"] } as never,
    context(client),
  );
  const visit = client.writes.find((w) => w.table === "visits")!.payload as Record<string, unknown>;
  expect(visit).toMatchObject({ scope: "equipe", everyone: false });
  expect(client.writes.some((w) => w.table === "agenda_event_participants")).toBe(true);
  expect(client.writes.some((w) => w.table === "agenda_event_tags")).toBe(true);
});
it("explica quando o banco recusa compromisso de equipe", async () => {
  const client = fakeClient();
  client.failInsert = "Só a gestão da agenda cria compromissos da equipe";
  const result = await tool("agenda_criar").execute(
    { titulo: "Geral", inicio: "2026-10-16T09:00", alcance: "equipe" } as never,
    context(client),
  );
  expect((result.output as { erro: string }).erro).toMatch(/gestão da agenda/);
});
```

No `fakeClient` do teste, aceitar `failInsert?: string`. Quando estiver definido, o `insert` em `visits` faz `single()` devolver `{ data: null, error: { message: failInsert } }`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/__tests__/lume-agenda.test.ts`
Expected: FAIL nos dois testes novos.

- [ ] **Step 3: Implementar em `agenda.server.ts`**

- `EVENT_FIELDS`, acrescentar:
  - `alcance: { type: "string", enum: ["pessoal", "equipe"] }`
  - `participantes: { type: "array", items: { type: "string" }, description: "Nomes de membros, ou 'todos'." }`
  - `tags: { type: "array", items: { type: "string" } }`
- `toColumns`: com `ctx.extended`, `args.alcance` vai para `columns.scope`, e `participantes` contendo "todos" vai para `columns.everyone = true`.
- Em `createEvent.execute`, depois do insert, resolver os nomes:
  - participantes via `teamNames(ctx)`, comparando com `norm`;
  - tags via `ctx.client.from("agenda_tags").select("id,name,owner_id").eq("company_id", ctx.companyId)`;
  - inserir em `agenda_event_participants` e `agenda_event_tags`;
  - nomes não encontrados vão em `output.nao_encontrados`.
- Se o insert falhar com mensagem do banco, devolver `{ erro: error.message }` quando ela contém "gestão da agenda"; senão, a mensagem genérica atual.
- Instruções do domínio: "Por padrão crie compromissos pessoais. Só use alcance 'equipe' se a pessoa pedir algo para a equipe; se o banco recusar, explique que é preciso a permissão 'Gerenciar agenda da equipe'."

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/__tests__/lume-agenda.test.ts src/lib/__tests__/lume-core.test.ts src/lib/__tests__/lume-action-integrity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lume src/lib/__tests__/lume-agenda.test.ts
git commit -m "feat(lume): compromissos de equipe, participantes e tags pela Lume"
```

---

### Task 9: Documentação, verificação completa e PR

**Files:**
- Modify: `docs/team-access.md` (seção "Convite por link e agenda da equipe")
- Modify: `docs/lume-ia-agenda.md` (alcance, participantes e tags)

- [ ] **Step 1: Documentar a ativação**

Em `docs/team-access.md`, acrescentar:
- a ordem das migrações (20261007 → 20261015 → 20261016);
- incluir `/convite` (com `?link=`) nos redirects do Supabase Auth;
- um roteiro de conferência:
  - admin gera um link com aprovação;
  - uma pessoa nova se cadastra e fica pendente;
  - o admin aprova;
  - a pessoa vê só a própria agenda;
  - o admin dá "Gestor da agenda" e ela passa a criar compromisso de equipe.

- [ ] **Step 2: Verificação completa**

Run:
```bash
npx tsc --noEmit -p .
npx vitest run src/lib/__tests__/agenda-hierarchy-database.test.ts src/lib/__tests__/team-database.test.ts src/lib/__tests__/team-permissions.test.ts src/lib/__tests__/team-permission-presets.test.ts src/routes/__tests__/users-permissions.test.tsx src/routes/__tests__/invite-link-page.test.tsx src/components/agenda lume sales-agent vendedora coach atendimento followup whatsapp
npx vite build
```
Expected: tipagem limpa, testes passando (falhas só se forem os casos de tempo esgotado já conhecidos, que passam isolados) e build ok.

- [ ] **Step 3: Commit, push e PR**

```bash
git add docs
git commit -m "docs: ativação da agenda com hierarquia e convite por link"
git push origin isaque3
gh pr view --json number,state   # se o #44 ainda estiver aberto, os commits entram nele; senão, abrir PR novo
```

Se for abrir um PR novo: `gh pr create --base main --head isaque3`, com o resumo das Tasks 1–8, a verificação e o roteiro de ativação.
