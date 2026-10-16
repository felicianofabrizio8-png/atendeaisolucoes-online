// src/lib/__tests__/goals-database.test.ts
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const db = new PGlite();
const admin = "00000000-0000-4000-8000-000000000001";
const empA = "00000000-0000-4000-8000-000000000002";
const empB = "00000000-0000-4000-8000-000000000003";
const outsider = "00000000-0000-4000-8000-000000000004";
const lead = "00000000-0000-4000-8000-000000000005"; // gestor de metas
let company: string;
let outsiderCompany: string;

async function asUser(id: string) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE authenticated;`);
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
const goal = (extra: Record<string, string> = {}) => {
  const cols = {
    company_id: `'${company}'`, name: "'Meta'", measure: "'automatica'", metric: "'vendas_fechadas'",
    target: "10", scope: "'empresa'", starts_on: "'2026-10-01'", ends_on: "'2026-10-31'", ...extra,
  };
  return `INSERT INTO goals(${Object.keys(cols).join(",")}) VALUES(${Object.values(cols).join(",")}) RETURNING id AS v`;
};

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
   ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sent_at timestamptz;
   ALTER TABLE visits ADD COLUMN IF NOT EXISTS appointment_type public.appointment_type NOT NULL DEFAULT 'visita_tecnica',
     ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS salesperson text, ADD COLUMN IF NOT EXISTS technician text;
   CREATE PUBLICATION supabase_realtime;
   INSERT INTO auth.users(id,email) VALUES('${admin}','fabriziosoul@gmail.com'),('${empA}','a@x.test'),('${empB}','b@x.test'),('${outsider}','o@x.test'),('${lead}','l@x.test');
   UPDATE profiles SET company_id=(SELECT company_id FROM profiles WHERE id='${admin}') WHERE id IN ('${empA}','${empB}','${lead}');
   INSERT INTO user_roles(company_id,user_id,role) SELECT company_id,id,CASE WHEN id IN ('${admin}','${outsider}') THEN 'admin'::app_role ELSE 'atendente'::app_role END FROM profiles;
   GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;`);
  await run("supabase/migrations/20260607034655_1c280507-1e0f-45d2-86f6-3a5661e5dff7.sql");
  await run("supabase/migrations/20261007180000_team_permissions_and_assignment.sql");
  await run("supabase/migrations/20261015120000_agenda_lume_foundation.sql");
  await run("supabase/migrations/20261016120000_agenda_team_hierarchy.sql");
  await run("supabase/migrations/20261017120000_goals.sql");
  await run("supabase/migrations/20261017120000_goals.sql"); // reexecutável
  await run("supabase/migrations/20261016120000_agenda_team_hierarchy.sql"); // continua reexecutável depois
  await db.exec(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
   UPDATE company_member_access SET permissions = permissions || ARRAY['goals.manage'] WHERE user_id='${lead}';`);
  company = await value<string>(`SELECT company_id AS v FROM profiles WHERE id='${admin}'`);
  outsiderCompany = await value<string>(`SELECT company_id AS v FROM profiles WHERE id='${outsider}'`);
}, 60000);
afterAll(() => db.close());

describe.sequential("metas: acesso no banco", () => {
  it("todo membro recebeu 'Ver metas' e o gestor é reconhecido", async () => {
    await root();
    expect(await value<boolean>(`SELECT bool_and('goals.view'=ANY(permissions)) AS v FROM company_member_access`)).toBe(true);
    await asUser(lead);
    expect(await value<boolean>(`SELECT public.goals_can_manage('${company}') AS v`)).toBe(true);
    await asUser(empA);
    expect(await value<boolean>(`SELECT public.goals_can_manage('${company}') AS v`)).toBe(false);
  });

  it("funcionário não cria meta nem etapa; admin e gestor criam", async () => {
    await asUser(empA);
    expect(await fails(goal())).toBe(true);
    expect(await fails(`INSERT INTO goal_stages(company_id,name) VALUES('${company}','Planejada')`)).toBe(true);
    await asUser(admin);
    expect(await value<string>(goal({ name: "'Da empresa'" }))).toBeTruthy();
    await asUser(lead);
    expect(await value<string>(`INSERT INTO goal_stages(company_id,name) VALUES('${company}','Planejada') RETURNING id AS v`)).toBeTruthy();
  });

  it("primeiro período nasce com a meta (prazo único e recorrente)", async () => {
    await asUser(admin);
    const unique = await value<string>(goal({ name: "'Única'" }));
    const monthly = await value<string>(goal({ name: "'Mensal'", ends_on: "NULL", recurrence: "'mensal'", starts_on: "'2026-10-16'" }));
    await root();
    expect(await value<string>(`SELECT starts_on||'..'||ends_on AS v FROM goal_periods WHERE goal_id='${unique}'`)).toBe("2026-10-01..2026-10-31");
    expect(await value<string>(`SELECT starts_on||'..'||ends_on AS v FROM goal_periods WHERE goal_id='${monthly}'`)).toBe("2026-10-16..2026-10-31");
  });

  it("funcionário vê metas da empresa e as dele; não vê a individual do colega", async () => {
    await asUser(admin);
    const mine = await value<string>(goal({ name: "'Da Ana'", scope: "'pessoa'" }));
    await db.query(`INSERT INTO goal_members(goal_id,user_id) VALUES('${mine}','${empA}')`);
    await asUser(empA);
    expect(await value<number>(`SELECT count(*)::int AS v FROM goals WHERE id='${mine}'`)).toBe(1);
    expect(await value<number>(`SELECT count(*)::int AS v FROM goals WHERE scope='empresa'`)).toBeGreaterThan(0);
    await asUser(empB);
    expect(await value<number>(`SELECT count(*)::int AS v FROM goals WHERE id='${mine}'`)).toBe(0);
    expect(await value<number>(`SELECT count(*)::int AS v FROM goal_periods WHERE goal_id='${mine}'`)).toBe(0);
  });

  it("outra empresa não vê nada", async () => {
    await asUser(outsider);
    expect(await value<number>(`SELECT count(*)::int AS v FROM goals`)).toBe(0);
    expect(await fails(goal({ company_id: `'${company}'` }))).toBe(true);
  });

  it("funcionário não edita nem exclui; gestor edita", async () => {
    await asUser(admin);
    const id = await value<string>(goal({ name: "'Editável'" }));
    await asUser(empA);
    await db.query(`UPDATE goals SET target=99 WHERE id='${id}'`);
    await db.query(`DELETE FROM goals WHERE id='${id}'`);
    await root();
    expect(await value<number>(`SELECT target::int AS v FROM goals WHERE id='${id}'`)).toBe(10);
    await asUser(lead);
    await db.query(`UPDATE goals SET target=20 WHERE id='${id}'`);
    await root();
    expect(await value<number>(`SELECT target::int AS v FROM goals WHERE id='${id}'`)).toBe(20);
  });

  it("valida o formato da meta no banco", async () => {
    await asUser(admin);
    expect(await fails(goal({ target: "0" }))).toBe(true);
    expect(await fails(goal({ metric: "NULL" }))).toBe(true); // automática sem indicador
    expect(await fails(goal({ ends_on: "'2026-09-01'" }))).toBe(true);
    expect(await fails(goal({ ends_on: "NULL" }))).toBe(true); // prazo único sem fim
    expect(await fails(goal({ metric: "'inventado'" }))).toBe(true);
  });
});
