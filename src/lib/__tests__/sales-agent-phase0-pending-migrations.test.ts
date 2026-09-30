// Vendedora IA · Fase 0 — migrations preparadas, mas fora do caminho aplicado.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PENDING = "supabase/pending-migrations";
const TRIGGER = `${PENDING}/20260930120000_sales_agent_trigger_secret.sql`;
const COACH = `${PENDING}/20260930121000_coach_learning_admin_activation.sql`;

function sql(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("migrations pendentes da Fase 0", () => {
  it("não estão em supabase/migrations (não são aplicadas automaticamente)", () => {
    const applied = readdirSync("supabase/migrations");
    expect(applied.some((file) => file.startsWith("20260930120000"))).toBe(false);
    expect(applied.some((file) => file.startsWith("20260930121000"))).toBe(false);
    expect(existsSync(TRIGGER)).toBe(true);
    expect(existsSync(COACH)).toBe(true);
  });

  it("trigger do agente envia o segredo exigido pela rota e não descarta mensagens rápidas", () => {
    const body = sql(TRIGGER);
    expect(body).toContain("'x-agent-trigger-secret', v_secret");
    expect(body).toContain("get_hook_secret('agent_trigger_url')");
    expect(body).not.toMatch(/interval '30 seconds'/);
    expect(body).not.toMatch(/eyJ[A-Za-z0-9_-]+\./); // nenhum JWT embutido
    expect(body).not.toMatch(/lovable\.app/); // nenhuma URL de ambiente embutida
    expect(body).toMatch(/'assumido_humano',\s*'aguardando_humano'/);
  });

  it("get_hook_secret cobre todos os segredos lidos pelo código e é só service_role", () => {
    const body = sql(TRIGGER);
    for (const name of ["agent_trigger_secret", "followup_tick_secret", "runtime_tick_secret"]) {
      expect(body).toContain(`'${name}'`);
    }
    expect(body).toContain(
      "GRANT EXECUTE ON FUNCTION public.get_hook_secret(text) TO service_role",
    );
    expect(body).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_hook_secret\(text\) FROM PUBLIC, anon, authenticated/,
    );
  });

  it("guard do Coach exige admin da empresa para ativar ou editar regra ativa", () => {
    const body = sql(COACH);
    expect(body).toContain("public.has_role(v_uid, NEW.company_id, 'admin')");
    expect(body).toContain("NEW.status := 'paused'");
    expect(body).toContain("coach_learning_activation_requires_admin");
    expect(body).toContain("coach_learning_active_edit_requires_admin");
    expect(body).toMatch(/BEFORE INSERT OR UPDATE ON public\.coach_learnings/);
  });
});
