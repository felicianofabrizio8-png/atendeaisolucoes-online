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
  // Valor acrescentado ao enum por uma migração posterior (orçamento visualizado).
  await db.exec("ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'visualizado' AFTER 'enviado'");
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

describe.sequential("metas: indicadores e progresso", () => {
  const at = (day: string) => `'${day}T15:00:00-03:00'`;
  let leadA: string;
  let leadB: string;

  beforeAll(async () => {
    await root();
    // "Hoje" fixo para o cálculo: fim de outubro de 2026 (vale para a sessão, mesmo após SET ROLE).
    await db.exec("SELECT set_config('lume.goals_now','2026-10-31T12:00:00-03:00',false)");
    leadA = await value<string>(`INSERT INTO leads(company_id,channel,name,phone,assigned_to,status,closed_value,closed_at,created_at)
      VALUES('${company}','whatsapp','Cliente A','1','${empA}','fechado',1000,${at("2026-10-05")},${at("2026-10-02")}) RETURNING id AS v`);
    leadB = await value<string>(`INSERT INTO leads(company_id,channel,name,phone,assigned_to,status,closed_value,closed_at,created_at)
      VALUES('${company}','whatsapp','Cliente B','2','${empB}','fechado',500,${at("2026-10-06")},${at("2026-10-03")}) RETURNING id AS v`);
    await db.exec(`INSERT INTO leads(company_id,channel,name,phone,status,created_at) VALUES('${company}','whatsapp','Sem dono','3','novo',${at("2026-10-07")});
      INSERT INTO leads(company_id,channel,name,phone,assigned_to,status,closed_value,closed_at,created_at) VALUES('${company}','whatsapp','Fora','4','${empA}','fechado',9999,${at("2026-09-20")},${at("2026-09-18")});
      INSERT INTO quotes(company_id,lead_id,status,created_at) VALUES('${company}','${leadA}','rascunho',${at("2026-10-05")});
      INSERT INTO quotes(company_id,lead_id,status,created_at,sent_at) VALUES('${company}','${leadA}','aceito',${at("2026-09-30")},${at("2026-10-02")});
      INSERT INTO quotes(company_id,lead_id,status,created_at) VALUES('${company}','${leadB}','visualizado',${at("2026-10-08")});`);
    const conv = await value<string>(`INSERT INTO conversations(company_id,lead_id,channel) VALUES('${company}','${leadA}','whatsapp') RETURNING id AS v`);
    await db.exec(`INSERT INTO messages(company_id,conversation_id,role,text,at) VALUES
      ('${company}','${conv}','lead','Oi',${at("2026-10-05")}),
      ('${company}','${conv}','agent','Olá!','2026-10-05T15:12:00-03:00');`);
  });

  const progress = async (id: string) =>
    (await db.query<{ value: string | null; weeks: unknown; contributions: unknown }>(
      `SELECT value, weeks, contributions FROM public.goals_progress(ARRAY['${id}']::uuid[])`,
    )).rows[0];

  it("receita e vendas da empresa somam todos, só no período", async () => {
    await asUser(admin);
    const receita = await value<string>(goal({ name: "'Receita'", metric: "'receita_fechada'", target: "5000" }));
    const vendas = await value<string>(goal({ name: "'Vendas'" }));
    expect(Number((await progress(receita)).value)).toBe(1500);
    expect(Number((await progress(vendas)).value)).toBe(2);
  });

  it("meta de pessoa conta só o que é dela, e a de grupo soma o grupo", async () => {
    await asUser(admin);
    const solo = await value<string>(goal({ name: "'Ana'", scope: "'pessoa'", metric: "'receita_fechada'", target: "5000" }));
    await db.query(`INSERT INTO goal_members VALUES('${solo}','${empA}')`);
    const team = await value<string>(goal({ name: "'Dupla'", scope: "'grupo'", metric: "'receita_fechada'", target: "5000" }));
    await db.query(`INSERT INTO goal_members VALUES('${team}','${empA}'),('${team}','${empB}')`);
    expect(Number((await progress(solo)).value)).toBe(1000);
    expect(Number((await progress(team)).value)).toBe(1500);
  });

  it("orçamentos criados e enviados (enviado = saiu do rascunho, pela data de envio)", async () => {
    await asUser(admin);
    const criados = await value<string>(goal({ name: "'Criados'", metric: "'orcamentos_criados'" }));
    const enviados = await value<string>(goal({ name: "'Enviados'", metric: "'orcamentos_enviados'" }));
    expect(Number((await progress(criados)).value)).toBe(2);
    expect(Number((await progress(enviados)).value)).toBe(2);
  });

  it("leads novos, conversão, conversas respondidas e tempo de 1ª resposta", async () => {
    await asUser(admin);
    const novos = await value<string>(goal({ name: "'Novos'", metric: "'leads_novos'" }));
    const conv = await value<string>(goal({ name: "'Conv'", metric: "'taxa_conversao'", target: "50" }));
    const resp = await value<string>(goal({ name: "'Resp'", metric: "'conversas_respondidas'" }));
    const tempo = await value<string>(goal({ name: "'Tempo'", metric: "'tempo_primeira_resposta'", lower_is_better: "true" }));
    expect(Number((await progress(novos)).value)).toBe(3);
    expect(Number((await progress(conv)).value)).toBeCloseTo(66.7, 1);
    expect(Number((await progress(resp)).value)).toBe(1);
    expect(Number((await progress(tempo)).value)).toBe(12);
  });

  it("semanas e contribuições vêm no formato esperado", async () => {
    await asUser(admin);
    const receita = await value<string>(goal({ name: "'Receita 2'", metric: "'receita_fechada'", target: "5000" }));
    const row = await progress(receita);
    const weeks = row.weeks as Array<{ startsOn: string; endsOn: string; actual: number | null }>;
    expect(weeks[0]).toMatchObject({ startsOn: "2026-10-01", endsOn: "2026-10-04" });
    expect(weeks[1]).toMatchObject({ startsOn: "2026-10-05", endsOn: "2026-10-11", actual: 1500 });
    expect(row.contributions).toEqual([
      { userId: empA, value: 1000 },
      { userId: empB, value: 500 },
    ]);
  });

  it("funcionário vê o progresso da meta da empresa, mas não chama o cálculo bruto", async () => {
    await asUser(admin);
    const receita = await value<string>(goal({ name: "'Receita 3'", metric: "'receita_fechada'", target: "5000" }));
    await asUser(empB);
    expect(Number((await progress(receita)).value)).toBe(1500);
    expect(
      await fails(`SELECT public.goals_metric_raw('${outsiderCompany}','receita_fechada',now()-interval '1 year',now(),NULL)`),
    ).toBe(true);
    expect(await fails(`SELECT public.goals_progress_for('${company}',false,NULL)`)).toBe(true);
  });

  it("meta manual soma os lançamentos; participante lança, colega de fora não", async () => {
    await asUser(admin);
    const manual = await value<string>(goal({ name: "'Posts'", measure: "'manual'", metric: "NULL", unit: "'posts'", scope: "'pessoa'", target: "8" }));
    await db.query(`INSERT INTO goal_members VALUES('${manual}','${empA}')`);
    const period = await value<string>(`SELECT id AS v FROM goal_periods WHERE goal_id='${manual}'`);
    await asUser(empA);
    await db.query(`INSERT INTO goal_entries(company_id,goal_id,period_id,amount,created_at) VALUES('${company}','${manual}','${period}',3,${at("2026-10-06")})`);
    await asUser(empB);
    expect(await fails(`INSERT INTO goal_entries(company_id,goal_id,period_id,amount) VALUES('${company}','${manual}','${period}',5)`)).toBe(true);
    await asUser(empA);
    expect(Number((await progress(manual)).value)).toBe(3);
  });

  it("participante que saiu da equipe continua contando", async () => {
    await asUser(admin);
    const team = await value<string>(goal({ name: "'Dupla 2'", scope: "'grupo'", metric: "'receita_fechada'", target: "5000" }));
    await db.query(`INSERT INTO goal_members VALUES('${team}','${empA}'),('${team}','${empB}')`);
    await root();
    await db.query(`UPDATE company_member_access SET active=false WHERE user_id='${empB}'`);
    await asUser(admin);
    expect(Number((await progress(team)).value)).toBe(1500);
    await root();
    await db.query(`UPDATE company_member_access SET active=true WHERE user_id='${empB}'`);
  });
});

describe.sequential("metas: integridade dos lançamentos manuais", () => {
  let manual: string;
  let period: string;
  let otherPeriod: string;
  beforeAll(async () => {
    await db.exec("SELECT set_config('lume.goals_now','2026-10-20T12:00:00-03:00',false)");
    await asUser(admin);
    manual = await value<string>(goal({ name: "'Visitas'", measure: "'manual'", metric: "NULL", unit: "'visitas'", scope: "'pessoa'", target: "8" }));
    await db.query(`INSERT INTO goal_members VALUES('${manual}','${empA}')`);
    const other = await value<string>(goal({ name: "'Outra'", measure: "'manual'", metric: "NULL", unit: "'x'", scope: "'pessoa'", target: "8" }));
    await db.query(`INSERT INTO goal_members VALUES('${other}','${empA}')`);
    await root();
    period = await value<string>(`SELECT id AS v FROM goal_periods WHERE goal_id='${manual}'`);
    otherPeriod = await value<string>(`SELECT id AS v FROM goal_periods WHERE goal_id='${other}'`);
  });

  it("participante não escolhe a data nem o autor do lançamento", async () => {
    await asUser(empA);
    const id = await value<string>(`INSERT INTO goal_entries(company_id,goal_id,period_id,amount,created_at,user_id)
      VALUES('${company}','${manual}','${period}',2,'2026-09-01T10:00:00-03:00','${empA}') RETURNING id AS v`);
    await root();
    expect(await value<string>(`SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS v FROM goal_entries WHERE id='${id}'`)).toBe("2026-10-20");
    await asUser(empA);
    expect(await fails(`INSERT INTO goal_entries(company_id,goal_id,period_id,amount,user_id) VALUES('${company}','${manual}','${period}',1,'${empB}')`)).toBe(true);
  });

  it("período precisa ser da mesma meta e estar aberto", async () => {
    await asUser(empA);
    expect(await fails(`INSERT INTO goal_entries(company_id,goal_id,period_id,amount) VALUES('${company}','${manual}','${otherPeriod}',1)`)).toBe(true);
    await root();
    await db.query(`UPDATE goal_periods SET closed_at=now() WHERE id='${period}'`);
    await asUser(empA);
    expect(await fails(`INSERT INTO goal_entries(company_id,goal_id,period_id,amount) VALUES('${company}','${manual}','${period}',1)`)).toBe(true);
  });

  it("participante não apaga lançamento de período fechado", async () => {
    await asUser(empA);
    await db.query(`DELETE FROM goal_entries WHERE goal_id='${manual}'`);
    await root();
    expect(await value<number>(`SELECT count(*)::int AS v FROM goal_entries WHERE goal_id='${manual}'`)).toBe(1);
    await db.query(`UPDATE goal_periods SET closed_at=NULL WHERE id='${period}'`);
  });
});

describe.sequential("metas: sugestões e recorrência", () => {
  it("gestor aplica ajuste de alvo; funcionário não aplica", async () => {
    await asUser(admin);
    const id = await value<string>(goal({ name: "'Ajustável'" }));
    await root();
    const insight = await value<string>(`INSERT INTO goal_insights(company_id,kind,goal_id,body,action)
      VALUES('${company}','sugestao','${id}','Reduzir alvo','{"type":"ajustar_alvo","goalId":"${id}","target":8}') RETURNING id AS v`);
    await asUser(empA);
    expect(await fails(`SELECT public.goals_apply_insight('${insight}')`)).toBe(true);
    await asUser(lead);
    await db.query(`SELECT public.goals_apply_insight('${insight}')`);
    await root();
    expect(await value<number>(`SELECT target::int AS v FROM goals WHERE id='${id}'`)).toBe(8);
    expect(await value<string>(`SELECT state AS v FROM goal_insights WHERE id='${insight}'`)).toBe("aplicada");
    await asUser(lead);
    expect(await fails(`SELECT public.goals_apply_insight('${insight}')`)).toBe(true); // já decidida
  });

  it("recusa ação inválida e dispensa sem alterar a meta", async () => {
    await asUser(admin);
    const id = await value<string>(goal({ name: "'Prazo'" }));
    await root();
    const bad = await value<string>(`INSERT INTO goal_insights(company_id,kind,goal_id,body,action)
      VALUES('${company}','sugestao','${id}','x','{"type":"apagar_tudo","goalId":"${id}"}') RETURNING id AS v`);
    const ok = await value<string>(`INSERT INTO goal_insights(company_id,kind,goal_id,body,action)
      VALUES('${company}','sugestao','${id}','y','{"type":"ajustar_prazo","goalId":"${id}","endsOn":"2026-11-15"}') RETURNING id AS v`);
    await asUser(admin);
    expect(await fails(`SELECT public.goals_apply_insight('${bad}')`)).toBe(true);
    await db.query(`SELECT public.goals_dismiss_insight('${ok}')`);
    await root();
    expect(await value<string>(`SELECT ends_on::text AS v FROM goals WHERE id='${id}'`)).toBe("2026-10-31");
    expect(await value<string>(`SELECT state AS v FROM goal_insights WHERE id='${ok}'`)).toBe("dispensada");
  });

  it("fecha o período vencido e abre o próximo da recorrente, sem duplicar", async () => {
    await asUser(admin);
    const weekly = await value<string>(goal({ name: "'Semanal'", ends_on: "NULL", recurrence: "'semanal'", starts_on: "'2026-10-05'" }));
    await root();
    expect(await fails(`SET ROLE authenticated; SELECT public.goals_roll_periods('2026-10-13')`)).toBe(true);
    await root();
    await db.query(`SELECT public.goals_roll_periods('2026-10-13')`);
    await db.query(`SELECT public.goals_roll_periods('2026-10-13')`); // de novo no mesmo dia
    const rows = (await db.query<{ starts_on: string; closed: boolean; final_status: string | null }>(
      `SELECT starts_on::text, closed_at IS NOT NULL AS closed, final_status FROM goal_periods WHERE goal_id='${weekly}' ORDER BY starts_on`,
    )).rows;
    // As duas vendas do describe anterior caem em 05–11/10; alvo 10 → não bateu.
    expect(rows).toEqual([
      { starts_on: "2026-10-05", closed: true, final_status: "encerrada" },
      { starts_on: "2026-10-12", closed: false, final_status: null },
    ]);
  });
});

describe.sequential("metas: isolamento entre empresas e contribuições", () => {
  it("gestor de outra empresa não lança na meta manual desta empresa", async () => {
    await db.exec("SELECT set_config('lume.goals_now','2026-10-20T12:00:00-03:00',false)");
    await asUser(admin);
    const manual = await value<string>(goal({ name: "'Treinos'", measure: "'manual'", metric: "NULL", unit: "'treinos'", target: "5" }));
    await root();
    const period = await value<string>(`SELECT id AS v FROM goal_periods WHERE goal_id='${manual}'`);
    await asUser(outsider);
    expect(await fails(`INSERT INTO goal_entries(company_id,goal_id,period_id,amount) VALUES('${outsiderCompany}','${manual}','${period}',50)`)).toBe(true);
    await root();
    expect(await value<number>(`SELECT count(*)::int AS v FROM goal_entries WHERE goal_id='${manual}'`)).toBe(0);
  });

  it("funcionário recebe só a própria contribuição; gestor recebe o ranking", async () => {
    await db.exec("SELECT set_config('lume.goals_now','2026-10-31T12:00:00-03:00',false)");
    await asUser(admin);
    const receita = await value<string>(goal({ name: "'Receita ranking'", metric: "'receita_fechada'", target: "5000" }));
    const contributions = async () =>
      (await db.query<{ contributions: Array<{ userId: string; value: number }> }>(
        `SELECT contributions FROM public.goals_progress(ARRAY['${receita}']::uuid[])`,
      )).rows[0].contributions;
    await asUser(empB);
    expect(await contributions()).toEqual([{ userId: empB, value: 500 }]);
    await asUser(lead);
    expect((await contributions()).map((c) => c.userId)).toEqual([empA, empB]);
  });
});
