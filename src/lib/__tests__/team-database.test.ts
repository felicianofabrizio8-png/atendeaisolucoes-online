import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
const db = new PGlite();
const admin = "00000000-0000-4000-8000-000000000001";
const agent = "00000000-0000-4000-8000-000000000002";
const second = "00000000-0000-4000-8000-000000000003";
const outsider = "00000000-0000-4000-8000-000000000004";
const lead = "10000000-0000-4000-8000-000000000001";
const conv = "20000000-0000-4000-8000-000000000001";
let company: string;
async function asUser(id: string) {
  await db.exec(
    `RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE authenticated;`,
  );
}
async function root() {
  await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
}
async function value<T>(sql: string, params: unknown[] = []) {
  return (await db.query<{ v: T }>(sql, params)).rows[0]?.v;
}
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE SCHEMA private;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',email_confirmed_at timestamptz DEFAULT now());
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth,public,private TO authenticated,anon,service_role; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon,service_role;`);
  await db.exec(
    readFileSync(
      "supabase/migrations/20260426013234_7f419db7-87f8-4034-9c97-5d26c092e9e7.sql",
      "utf8",
    ),
  );
  await db.exec(`CREATE TYPE public.app_role AS ENUM('admin','atendente','financeiro');
 CREATE FUNCTION private.current_company_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT public.current_company_id(); $$;
 CREATE TABLE user_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,user_id uuid,role app_role,UNIQUE(company_id,user_id,role));
 CREATE TABLE company_invites(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,email text,role app_role,token text UNIQUE DEFAULT gen_random_uuid()::text,invited_by uuid,expires_at timestamptz DEFAULT now()+interval '7 days',accepted_at timestamptz,accepted_by uuid,cancelled_at timestamptz,created_at timestamptz DEFAULT now());
 CREATE TABLE audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,user_id uuid,action text,entity text,entity_id text,before jsonb,after jsonb);
 CREATE TABLE ai_suggestions_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,conversation_id uuid);
 CREATE SCHEMA storage;
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT USAGE ON SCHEMA storage TO authenticated;
 GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
 CREATE POLICY legacy_storage_write ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);
 ALTER TABLE profiles ADD last_seen_at timestamptz; ALTER TABLE leads ADD external_id text;
 ALTER TABLE messages ADD source_subtype text, ADD source_metadata jsonb, ADD delivery_status text, ADD status_updated_at timestamptz, ADD edited_at timestamptz, ADD deleted_at timestamptz, ADD deleted_for text;
 INSERT INTO auth.users(id,email) VALUES('${admin}','fabriziosoul@gmail.com'),('${agent}','agent@example.test'),('${second}','second@example.test'),('${outsider}','outside@example.test');
 UPDATE profiles SET company_id=(SELECT company_id FROM profiles WHERE id='${admin}') WHERE id IN ('${agent}','${second}');
 INSERT INTO user_roles(company_id,user_id,role) SELECT company_id,id,CASE WHEN id='${outsider}' THEN 'admin'::app_role ELSE 'atendente'::app_role END FROM profiles;
 GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
 `);
  await db.exec(
    readFileSync(
      "supabase/migrations/20260607034655_1c280507-1e0f-45d2-86f6-3a5661e5dff7.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync("supabase/migrations/20261007180000_team_permissions_and_assignment.sql", "utf8"),
  );
  company = await value<string>(`SELECT company_id AS v FROM profiles WHERE id='${admin}'`);
  await db.exec(
    `INSERT INTO leads(id,company_id,name,channel) VALUES('${lead}','${company}','Cliente','whatsapp'); INSERT INTO conversations(id,company_id,lead_id,channel) VALUES('${conv}','${company}','${lead}','whatsapp');`,
  );
}, 30000);
afterAll(() => db.close());
describe.sequential("tenant permissions and ownership in PostgreSQL", () => {
  it("preserves the requested administrator without promoting attendants", async () => {
    await asUser(admin);
    expect(await value<boolean>("SELECT team_has_permission('ai.manage') AS v")).toBe(true);
    await asUser(agent);
    expect(await value<boolean>("SELECT team_has_permission('ai.manage') AS v")).toBe(false);
    expect(await value<boolean>("SELECT team_has_permission('conversations.reply') AS v")).toBe(
      true,
    );
  });
  it("denies another tenant and self-escalation", async () => {
    await asUser(outsider);
    expect(await value<number>(`SELECT count(*)::int AS v FROM leads WHERE id='${lead}'`)).toBe(0);
    await expect(db.query("SELECT team_assign_lead($1,$2)", [lead, outsider])).rejects.toThrow();
    await asUser(agent);
    await expect(
      db.query("SELECT team_update_member($1,'admin',true,'{}')", [agent]),
    ).rejects.toThrow();
    await expect(
      db.exec(`UPDATE user_roles SET role='admin' WHERE user_id='${agent}'`),
    ).rejects.toThrow();
  });
  it("allows only one owner and rejects another claimant or direct takeover", async () => {
    await asUser(agent);
    await db.query("SELECT team_assign_lead($1,$2)", [lead, agent]);
    await asUser(second);
    await expect(db.query("SELECT team_assign_lead($1,$2)", [lead, second])).rejects.toThrow();
    expect(
      await value<boolean>("SELECT team_authorize_interaction($1,true) AS v", [
        { conversationId: conv },
      ]),
    ).toBe(false);
    await expect(
      db.exec(
        `INSERT INTO messages(company_id,conversation_id,role,text) VALUES('${company}','${conv}','agent','intrusão')`,
      ),
    ).rejects.toThrow();
  });
  it("allows the owner to reply and isolates message preview RPCs", async () => {
    await asUser(agent);
    await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('product-images',$1)", [
      `${company}/inbox/${conv}/photo.jpg`,
    ]);
    await expect(
      db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('product-images',$1)", [
        `${company}/catalog/photo.jpg`,
      ]),
    ).rejects.toThrow();
    expect(
      await value<boolean>("SELECT team_storage_write('product-images',$1) AS v", [
        `${company}/inbox/${conv}/photo.jpg`,
      ]),
    ).toBe(true);
    expect(
      await value<boolean>("SELECT team_storage_write('product-images',$1) AS v", [
        `${company}/catalog/photo.jpg`,
      ]),
    ).toBe(false);
    await db.exec(
      `INSERT INTO messages(company_id,conversation_id,role,text) VALUES('${company}','${conv}','agent','Olá')`,
    );
    expect(
      await value<number>("SELECT count(*)::int AS v FROM latest_messages_per_conversation($1)", [
        company,
      ]),
    ).toBe(1);
    await asUser(second);
    await expect(
      db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('product-images',$1)", [
        `${company}/inbox/${conv}/another.jpg`,
      ]),
    ).rejects.toThrow();
    expect(
      await value<boolean>("SELECT team_storage_write('product-images',$1) AS v", [
        `${company}/inbox/${conv}/photo.jpg`,
      ]),
    ).toBe(false);
    expect(
      await value<number>("SELECT count(*)::int AS v FROM latest_messages_per_conversation($1)", [
        company,
      ]),
    ).toBe(0);
  });
  it("supports explicit transfer, rejects cross-tenant assignees and audits it", async () => {
    await asUser(admin);
    await expect(db.query("SELECT team_assign_lead($1,$2)", [lead, outsider])).rejects.toThrow();
    await db.query("SELECT team_assign_lead($1,$2)", [lead, second]);
    await asUser(agent);
    expect(await value<boolean>("SELECT team_can_reply_lead($1) AS v", [lead])).toBe(false);
    await asUser(second);
    expect(await value<boolean>("SELECT team_can_reply_lead($1) AS v", [lead])).toBe(true);
    expect(
      await value<boolean>("SELECT team_authorize_interaction($1,false) AS v", [
        { conversation_ids: conv },
      ]),
    ).toBe(true);
    await asUser(agent);
    expect(
      await value<boolean>("SELECT team_authorize_interaction($1,false) AS v", [
        { conversation_ids: conv },
      ]),
    ).toBe(false);
  });
  it("protects the last active administrator", async () => {
    await asUser(admin);
    await expect(
      db.query("SELECT team_update_member($1,'atendente',true,'{}')", [admin]),
    ).rejects.toThrow(/administrador/);
  });
  it("lets admins supervise but requires a transfer before replying", async () => {
    await asUser(admin);
    expect(await value<boolean>("SELECT team_can_read_lead($1) AS v", [lead])).toBe(true);
    expect(
      await value<boolean>("SELECT team_authorize_interaction($1,true) AS v", [
        { conversationId: conv },
      ]),
    ).toBe(false);
  });
  it("blocks cross-tenant foreign keys even on an otherwise permitted insert", async () => {
    await asUser(outsider);
    const otherCompany = await value<string>("SELECT current_company_id() AS v");
    await expect(
      db.query(
        "INSERT INTO messages(company_id,conversation_id,role,text) VALUES($1,$2,'agent','intrusão')",
        [otherCompany, conv],
      ),
    ).rejects.toThrow();
  });
  it("revokes membership immediately and releases owned work", async () => {
    await asUser(admin);
    await db.query(
      "SELECT team_update_member($1,'atendente',false,ARRAY['conversations.read','conversations.reply'])",
      [second],
    );
    await asUser(second);
    expect(await value<string | null>("SELECT current_company_id() AS v")).toBeNull();
    expect(await value<number>("SELECT count(*)::int AS v FROM leads")).toBe(0);
    await asUser(admin);
    expect(
      await value<string | null>("SELECT assigned_to AS v FROM leads WHERE id=$1", [lead]),
    ).toBeNull();
  });
  it("rejects profile tenant switching", async () => {
    await asUser(agent);
    await expect(
      db.query("UPDATE profiles SET company_id=gen_random_uuid() WHERE id=$1", [agent]),
    ).rejects.toThrow();
  });
  it("rejects expired and cancelled invitations", async () => {
    await asUser(admin);
    const expired = await value<{ id: string; token: string }>(
      "SELECT team_create_invite('expired@example.test','atendente') AS v",
    );
    const cancelled = await value<{ id: string; token: string }>(
      "SELECT team_create_invite('cancelled@example.test','atendente') AS v",
    );
    await db.query("SELECT team_cancel_invite($1)", [cancelled.id]);
    await root();
    await db.query("UPDATE company_invites SET expires_at=now()-interval '1 day' WHERE id=$1", [
      expired.id,
    ]);
    for (const [email, token] of [
      ["expired@example.test", expired.token],
      ["cancelled@example.test", cancelled.token],
    ]) {
      await expect(
        db.query(
          "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(gen_random_uuid(),$1,$2)",
          [email, { invite_token: token }],
        ),
      ).rejects.toThrow(/Convite/);
    }
  });
  it("enforces explicit product permissions and immediately revokes reply access", async () => {
    await asUser(admin);
    await db.query(
      "SELECT team_update_member($1,'atendente',true,ARRAY['conversations.read','conversations.reply','products.view','products.manage'])",
      [agent],
    );
    await asUser(agent);
    await db.query("SELECT team_assign_lead($1,$2)", [lead, agent]);
    expect(
      await value<boolean>("SELECT team_table_access('products',true,$1) AS v", [company]),
    ).toBe(true);
    await asUser(admin);
    await db.query(
      "SELECT team_update_member($1,'atendente',true,ARRAY['conversations.read','products.view'])",
      [agent],
    );
    await asUser(agent);
    expect(
      await value<boolean>("SELECT team_table_access('products',true,$1) AS v", [company]),
    ).toBe(false);
    expect(
      await value<boolean>("SELECT team_authorize_interaction($1,true) AS v", [
        { conversationId: conv },
      ]),
    ).toBe(false);
    expect(
      await value<string | null>("SELECT assigned_to AS v FROM leads WHERE id=$1", [lead]),
    ).toBeNull();
  });
  it("joins invited users to the same company with the stored role, ignoring forged metadata", async () => {
    await asUser(admin);
    const invitation = await value<{ token: string }>(
      "SELECT team_create_invite('new@example.test','atendente') AS v",
    );
    await root();
    const newId = "00000000-0000-4000-8000-000000000005";
    await expect(
      db.query(
        "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(gen_random_uuid(),$1,$2)",
        ["wrong@example.test", { invite_token: invitation.token }],
      ),
    ).rejects.toThrow();
    await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)", [
      newId,
      "new@example.test",
      { invite_token: invitation.token, role: "admin", company_id: "attacker" },
    ]);
    expect(await value<string>("SELECT company_id AS v FROM profiles WHERE id=$1", [newId])).toBe(
      company,
    );
    await asUser(newId);
    expect(await value<boolean>("SELECT team_has_permission('ai.manage') AS v")).toBe(false);
    await root();
    await expect(
      db.query(
        "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(gen_random_uuid(),$1,$2)",
        ["new@example.test", { invite_token: invitation.token }],
      ),
    ).rejects.toThrow();
  });
});
