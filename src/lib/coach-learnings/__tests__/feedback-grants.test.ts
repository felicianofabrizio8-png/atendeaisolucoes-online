// Fase 4.2 — Quality gate de grants e de contrato das RPCs de feedback.
//
// Estes testes leem as migrations versionadas (fonte da verdade aplicada em
// produção) e o código-fonte da aplicação. O objetivo é impedir regressões
// silenciosas: reintrodução de acesso anônimo, uso da RPC legada v1 em código
// novo ou perda das proteções da v2.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const V1 = "submit_coach_suggestion_feedback(uuid, text, uuid)";
const V2 = "submit_coach_suggestion_feedback_v2(uuid, text, text)";

/** Concatena todas as migrations em ordem cronológica (nome = timestamp). */
function migrationsInOrder(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));
}

const ALL_SQL = migrationsInOrder();
const FULL_SQL = ALL_SQL.map((m) => m.sql).join("\n");

/**
 * Estado efetivo de grant após aplicar as migrations em ordem.
 * Um REVOKE posterior vence um GRANT anterior — por isso a ordem importa.
 */
function effectiveGrant(signature: string, role: string): boolean {
  let granted = false;
  for (const { sql } of ALL_SQL) {
    for (const rawLine of sql.split("\n")) {
      const line = rawLine.trim();
      if (!line.includes(signature)) continue;
      const isRevoke = /^REVOKE\b/i.test(line);
      const isGrant = /^GRANT\b/i.test(line);
      if (!isRevoke && !isGrant) continue;
      const roles = line.split(/\bFROM\b|\bTO\b/i)[1] ?? "";
      const mentionsRole =
        new RegExp(`\\b${role}\\b`, "i").test(roles) ||
        (isRevoke && /\bPUBLIC\b/i.test(roles) && role !== "authenticated" && role !== "service_role");
      if (!mentionsRole) continue;
      granted = isGrant;
    }
  }
  return granted;
}

describe("grants das RPCs de feedback do Coach", () => {
  it("v1 legada não concede execute a anon", () => {
    expect(effectiveGrant(V1, "anon")).toBe(false);
  });

  it("v2 não concede execute a anon", () => {
    expect(effectiveGrant(V2, "anon")).toBe(false);
  });

  it("PUBLIC é revogado explicitamente nas duas versões", () => {
    expect(FULL_SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.submit_coach_suggestion_feedback\(uuid, text, uuid\) FROM PUBLIC/i,
    );
    expect(FULL_SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.submit_coach_suggestion_feedback_v2\(uuid, text, text\) FROM PUBLIC/i,
    );
  });

  it("authenticated mantém execute nas duas versões", () => {
    expect(effectiveGrant(V1, "authenticated")).toBe(true);
    expect(effectiveGrant(V2, "authenticated")).toBe(true);
  });

  it("service_role só é concedido à v2 (contrato oficial)", () => {
    expect(effectiveGrant(V2, "service_role")).toBe(true);
  });

  it("a migration de hardening é não destrutiva e idempotente", () => {
    const hardening = ALL_SQL.find((m) => m.sql.includes("Fase 4.2"));
    expect(hardening, "migration de hardening da Fase 4.2 não encontrada").toBeDefined();
    const sql = hardening!.sql;
    // REVOKE/GRANT/COMMENT são idempotentes por natureza.
    expect(sql).not.toMatch(/\bDROP\s+(FUNCTION|TABLE)\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+public\./i);
    expect(sql).toMatch(/COMMENT ON FUNCTION public\.submit_coach_suggestion_feedback\(/i);
    expect(sql).toMatch(/DEPRECATED/i);
  });
});

describe("segurança estrutural das RPCs", () => {
  const v2Def = FULL_SQL.slice(
    FULL_SQL.lastIndexOf("CREATE OR REPLACE FUNCTION public.submit_coach_suggestion_feedback_v2"),
  );

  it("v2 é SECURITY DEFINER com search_path fixo", () => {
    expect(v2Def).toMatch(/SECURITY DEFINER/);
    expect(v2Def).toMatch(/SET search_path = public/);
  });

  it("v2 valida auth.uid() e nunca confia em company_id do payload", () => {
    expect(v2Def).toMatch(/v_user\s+uuid\s*:=\s*auth\.uid\(\)/);
    expect(v2Def).toMatch(/coach_feedback_unauthenticated/);
    expect(v2Def).toMatch(/SELECT company_id INTO v_company FROM public\.profiles WHERE id = v_user/);
    expect(v2Def).toMatch(/coach_feedback_no_company/);
    // A assinatura pública não aceita company_id.
    expect(v2Def).not.toMatch(/_company_id\s+uuid/);
  });

  it("v2 valida ownership da sugestão e os valores de feedback", () => {
    expect(v2Def).toMatch(/coach_feedback_not_found/);
    expect(v2Def).toMatch(/coach_feedback_cross_tenant/);
    expect(v2Def).toMatch(/coach_feedback_invalid_status/);
  });

  it("v2 restringe os aprendizados afetados à empresa do usuário", () => {
    expect(v2Def).toMatch(/l\.company_id = v_company/);
    expect(v2Def).toMatch(/r2\.company_id = v_company/);
  });

  it("v2 não monta SQL dinâmico (sem superfície de injeção)", () => {
    expect(v2Def).not.toMatch(/\bEXECUTE\s+(format\(|'|")/i);
  });
});
