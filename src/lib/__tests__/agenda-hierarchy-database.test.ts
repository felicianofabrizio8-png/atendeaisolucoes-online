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
