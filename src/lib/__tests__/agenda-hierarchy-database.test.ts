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

// Revisão 2: quem não tem conta cria a conta normalmente e depois entra pelo link.
describe.sequential("equipe: convite por link", () => {
  const solo = "00000000-0000-4000-8000-0000000000b1";
  const solo2 = "00000000-0000-4000-8000-0000000000b2";
  const waiting = "00000000-0000-4000-8000-0000000000b3";
  let token: string;
  let single: string;
  let approvalToken: string;
  let linkId: string;

  it("só admin cria link; link de admin é recusado", async () => {
    await asUser(empA);
    expect(
      await fails(`SELECT team_create_invite_link('atendente', ARRAY['agenda.manage'], false, 7, null, 'Vendas')`),
    ).toBe(true);
    await asUser(admin);
    expect(
      await fails(`SELECT team_create_invite_link('admin', ARRAY[]::text[], false, 7, null, null)`),
    ).toBe(true);
    const link = await value<{ token: string; id: string }>(
      `SELECT team_create_invite_link('atendente', ARRAY['agenda.manage','conversations.read'], false, 7, null, 'Vendas') AS v`,
    );
    token = link.token;
    linkId = link.id;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    single = (
      await value<{ token: string }>(
        `SELECT team_create_invite_link('atendente', ARRAY['agenda.manage'], false, null, 1, 'Um uso') AS v`,
      )
    ).token;
    approvalToken = (
      await value<{ token: string }>(
        `SELECT team_create_invite_link('atendente', ARRAY['agenda.manage'], true, null, null, null) AS v`,
      )
    ).token;
  });

  it("sem login, o link informa só o nome da equipe e se vale", async () => {
    await asAnon();
    const info = await value<Record<string, unknown>>(`SELECT team_invite_link_info('${token}') AS v`);
    expect(info).toMatchObject({ valid: true, requiresApproval: false });
    expect(Object.keys(info).sort()).toEqual(["company", "requiresApproval", "valid"]);
    expect(
      (await value<Record<string, unknown>>(`SELECT team_invite_link_info('nao-existe') AS v`)).valid,
    ).toBe(false);
  });

  it("conta nova (cadastro normal) entra pelo link e leva as permissões do link", async () => {
    await root();
    await db.query(
      `INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'solo@x.test','{"display_name":"Solo"}')`,
      [solo],
    );
    const own = await value<string>(`SELECT company_id::text AS v FROM profiles WHERE id='${solo}'`);
    expect(own).not.toBe(company);
    await asUser(solo);
    const info = await value<Record<string, unknown>>(`SELECT team_invite_link_info('${token}') AS v`);
    expect(info).toMatchObject({ valid: true, canSwitch: true, alreadyMember: false, currentTeamHasData: false });
    expect(await value<Record<string, unknown>>(`SELECT team_join_via_link('${token}') AS v`)).toMatchObject({
      status: "joined",
    });
    await root();
    expect(await value<string>(`SELECT company_id::text AS v FROM profiles WHERE id='${solo}'`)).toBe(company);
    expect(await value<string>(`SELECT role::text AS v FROM user_roles WHERE user_id='${solo}'`)).toBe("atendente");
    expect(
      await value<string[]>(`SELECT permissions AS v FROM company_member_access WHERE user_id='${solo}'`),
    ).toEqual(["agenda.manage", "conversations.read"]);
    expect(await value<number>(`SELECT uses AS v FROM company_invite_links WHERE id='${linkId}'`)).toBe(1);
    await asUser(solo);
    expect(await value<string>(`SELECT public.current_company_id()::text AS v`)).toBe(company);
    expect(
      (await value<Record<string, unknown>>(`SELECT team_join_via_link('${token}') AS v`)).status,
    ).toBe("already_member");
  });

  it("respeita o limite de usos", async () => {
    await root();
    await db.query(`INSERT INTO auth.users(id,email) VALUES($1,'s2@x.test')`, [solo2]);
    await db.query(`INSERT INTO auth.users(id,email) VALUES($1,'s3@x.test')`, [waiting]);
    await asUser(solo2);
    await db.query(`SELECT team_join_via_link('${single}')`);
    await asUser(waiting);
    expect(await fails(`SELECT team_join_via_link('${single}')`)).toBe(true);
  });

  it("link com aprovação deixa aguardando até o admin aprovar", async () => {
    await asUser(waiting);
    expect(
      (await value<Record<string, unknown>>(`SELECT team_join_via_link('${approvalToken}') AS v`)).status,
    ).toBe("pending_approval");
    expect(await value<Record<string, unknown>>(`SELECT team_my_pending_join() AS v`)).toMatchObject({
      state: "waiting",
    });
    expect(await value<string | null>(`SELECT public.current_company_id()::text AS v`)).toBeNull();
    await asUser(empA);
    expect(await fails(`SELECT team_approve_member('${waiting}')`)).toBe(true);
    await asUser(admin);
    await db.query(`SELECT team_approve_member('${waiting}')`);
    const users = await value<Array<{ id: string; approvalPending: boolean; active: boolean }>>(
      `SELECT team_list_users() AS v`,
    );
    expect(users.find((u) => u.id === waiting)).toMatchObject({ active: true, approvalPending: false });
    await asUser(waiting);
    expect(await value<unknown>(`SELECT team_my_pending_join() AS v`)).toBeNull();
  });

  it("conta com colegas na equipe atual não troca; equipe com dados é sinalizada", async () => {
    await root();
    const theirs = await value<string>(`SELECT company_id::text AS v FROM profiles WHERE id='${outsider}'`);
    const mate = "00000000-0000-4000-8000-0000000000b4";
    await db.query(`INSERT INTO auth.users(id,email) VALUES($1,'mate@x.test')`, [mate]);
    await db.query(`UPDATE company_member_access SET company_id=$1 WHERE user_id=$2`, [theirs, mate]);
    await db.query(`UPDATE profiles SET company_id=$1 WHERE id=$2`, [theirs, mate]);
    await db.query(
      `INSERT INTO leads(company_id,name,channel) VALUES($1,'Cliente B','whatsapp')`,
      [theirs],
    );
    await asUser(outsider);
    const info = await value<Record<string, unknown>>(`SELECT team_invite_link_info('${token}') AS v`);
    expect(info).toMatchObject({ canSwitch: false, currentTeamHasData: true });
    expect(await fails(`SELECT team_join_via_link('${token}')`)).toBe(true);
  });

  it("o perfil continua sem poder trocar de empresa direto", async () => {
    await asUser(empA);
    await db
      .query(`UPDATE profiles SET company_id=(SELECT company_id FROM profiles WHERE id='${outsider}') WHERE id='${empA}'`)
      .catch(() => undefined);
    await root();
    expect(await value<string>(`SELECT company_id::text AS v FROM profiles WHERE id='${empA}'`)).toBe(company);
  });

  it("link revogado ou vencido não funciona; admin renomeia a equipe", async () => {
    await asUser(admin);
    await db.query(`SELECT team_revoke_invite_link('${linkId}')`);
    const fresh = "00000000-0000-4000-8000-0000000000b5";
    await root();
    await db.query(`INSERT INTO auth.users(id,email) VALUES($1,'fresh@x.test')`, [fresh]);
    await asUser(fresh);
    expect(await fails(`SELECT team_join_via_link('${token}')`)).toBe(true);
    await root();
    await db.query(`UPDATE company_invite_links SET expires_at=now()-interval '1 day' WHERE token=$1`, [approvalToken]);
    await asUser(fresh);
    expect(await fails(`SELECT team_join_via_link('${approvalToken}')`)).toBe(true);
    await db.query(`SELECT team_rename_company('Equipe Fresh')`);
    await root();
    expect(
      await value<string>(
        `SELECT c.name AS v FROM companies c JOIN profiles p ON p.company_id=c.id WHERE p.id='${fresh}'`,
      ),
    ).toBe("Equipe Fresh");
  });
});

// Correções da revisão final.
describe.sequential("revisão final: vazamentos e contas presas", () => {
  it("histórico de compromisso pessoal não aparece para colega; gestor vê", async () => {
    await asUser(empA);
    const secret = await value<string>(insertEvent("Consulta médica"));
    await db.query(`UPDATE visits SET title='Consulta médica 2' WHERE id='${secret}'`);
    await asUser(empB);
    expect(
      await value<number>(`SELECT count(*)::int AS v FROM agenda_event_history WHERE event_id='${secret}'`),
    ).toBe(0);
    await asUser(manager);
    expect(
      await value<number>(`SELECT count(*)::int AS v FROM agenda_event_history WHERE event_id='${secret}'`),
    ).toBeGreaterThan(0);
  });

  it("recuperação enxerga a visita de um colega para o mesmo lead", async () => {
    await root();
    // A atendia o lead e agendou a visita; depois o lead passou para B.
    const lead = await value<string>(
      `INSERT INTO leads(company_id,name,channel,assigned_to) VALUES('${company}','Lead visita','whatsapp','${empA}') RETURNING id AS v`,
    );
    await asUser(empA);
    await db.query(
      `INSERT INTO visits(company_id,title,scheduled_at,lead_id) VALUES('${company}','Visita lead',now(),'${lead}')`,
    );
    await root();
    await db.query(`UPDATE leads SET assigned_to='${empB}' WHERE id='${lead}'`);
    await asUser(empB);
    expect(await value<number>(`SELECT count(*)::int AS v FROM visits WHERE lead_id='${lead}'`)).toBe(0);
    const rows = await value<Array<{ lead_id: string; status: string }>>(
      `SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]'::jsonb) AS v FROM public.agenda_lead_visits(ARRAY['${lead}']::uuid[]) r`,
    );
    expect(rows.map((row) => row.lead_id)).toEqual([lead]);
    await asUser(outsider);
    const other = await value<unknown[]>(
      `SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]'::jsonb) AS v FROM public.agenda_lead_visits(ARRAY['${lead}']::uuid[]) r`,
    );
    expect(other).toEqual([]);
  });

  it("recusado na aprovação volta para uma equipe própria, com acesso", async () => {
    await asUser(admin);
    const link = await value<{ token: string }>(
      `SELECT team_create_invite_link('atendente', ARRAY['agenda.manage'], true, null, null, 'Aprovação') AS v`,
    );
    const person = "00000000-0000-4000-8000-0000000000c1";
    await root();
    await db.query(`INSERT INTO auth.users(id,email) VALUES($1,'rec@x.test')`, [person]);
    await asUser(person);
    await db.query(`SELECT team_join_via_link('${link.token}')`);
    await asUser(admin);
    await db.query(`SELECT team_reject_member('${person}')`);
    await root();
    const own = await value<string>(`SELECT company_id::text AS v FROM profiles WHERE id='${person}'`);
    expect(own).not.toBe(company);
    expect(await value<string>(`SELECT role::text AS v FROM user_roles WHERE user_id='${person}'`)).toBe("admin");
    await asUser(person);
    expect(await value<string>(`SELECT public.current_company_id()::text AS v`)).toBe(own);
  });

  it("quem aguarda aprovação pode cancelar o pedido e volta para equipe própria", async () => {
    await asUser(admin);
    const link = await value<{ token: string }>(
      `SELECT team_create_invite_link('atendente', ARRAY['agenda.manage'], true, null, null, 'Cancelar') AS v`,
    );
    const person = "00000000-0000-4000-8000-0000000000c2";
    await root();
    await db.query(`INSERT INTO auth.users(id,email) VALUES($1,'cancel@x.test')`, [person]);
    await asUser(person);
    await db.query(`SELECT team_join_via_link('${link.token}')`);
    await db.query(`SELECT team_cancel_join_request()`);
    expect(await value<unknown>(`SELECT team_my_pending_join() AS v`)).toBeNull();
    const own = await value<string>(`SELECT public.current_company_id()::text AS v`);
    expect(own).not.toBe(company);
    expect(own).toBeTruthy();
  });

  it("ao trocar de equipe, links e convites da equipe antiga são revogados", async () => {
    const owner = "00000000-0000-4000-8000-0000000000c3";
    await root();
    await db.query(`INSERT INTO auth.users(id,email) VALUES($1,'dono2@x.test')`, [owner]);
    await asUser(owner);
    const oldLink = await value<{ token: string }>(
      `SELECT team_create_invite_link('atendente', ARRAY['agenda.manage'], false, null, null, 'Antigo') AS v`,
    );
    await db.query(`SELECT team_create_invite('alguem@x.test','atendente')`);
    await asUser(admin);
    const link = await value<{ token: string }>(
      `SELECT team_create_invite_link('atendente', ARRAY['agenda.manage'], false, null, null, 'Novo') AS v`,
    );
    await asUser(owner);
    await db.query(`SELECT team_join_via_link('${link.token}')`);
    await root();
    expect(
      await value<string | null>(
        `SELECT revoked_at::text AS v FROM company_invite_links WHERE token='${oldLink.token}'`,
      ),
    ).not.toBeNull();
    expect(
      await value<number>(
        `SELECT count(*)::int AS v FROM company_invites WHERE email='alguem@x.test' AND cancelled_at IS NULL`,
      ),
    ).toBe(0);
  });

  it("equipe atual com canal conectado (integração) conta como equipe com dados", async () => {
    const person = "00000000-0000-4000-8000-0000000000c4";
    await root();
    await db.query(`INSERT INTO auth.users(id,email) VALUES($1,'conv@x.test')`, [person]);
    const own = await value<string>(`SELECT company_id::text AS v FROM profiles WHERE id='${person}'`);
    await db.exec(
      `CREATE TABLE IF NOT EXISTS public.integrations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid)`,
    );
    await asUser(admin);
    const link = await value<{ token: string }>(
      `SELECT team_create_invite_link('atendente', ARRAY['agenda.manage'], false, null, null, 'Dados') AS v`,
    );
    await asUser(person);
    expect(
      (await value<Record<string, unknown>>(`SELECT team_invite_link_info('${link.token}') AS v`))
        .currentTeamHasData,
    ).toBe(false);
    await root();
    await db.query(`INSERT INTO public.integrations(company_id) VALUES($1)`, [own]);
    await asUser(person);
    expect(
      (await value<Record<string, unknown>>(`SELECT team_invite_link_info('${link.token}') AS v`))
        .currentTeamHasData,
    ).toBe(true);
  });
});

export { asAnon, root };
