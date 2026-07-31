// Fase 4.2 — Quality gate: a v2 é o contrato oficial.
//
// Falha se código de aplicação (fora de tipos gerados e testes de auditoria da
// própria RPC legada) voltar a chamar submit_coach_suggestion_feedback v1.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

/** Arquivos autorizados a mencionar a v1 (tipos gerados e testes legados). */
const ALLOWLIST = new Set([
  "integrations/supabase/types.ts",
  "lib/coach-learnings/__tests__/coach-evolutivo-flow.test.ts",
  "lib/coach-learnings/__tests__/feedback-grants.test.ts",
  "lib/coach-learnings/__tests__/feedback-v1-quality-gate.test.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

/** Detecta a v1 ignorando ocorrências da v2 (que contém o mesmo prefixo). */
function callsV1(source: string): boolean {
  return /submit_coach_suggestion_feedback(?!_v2)/.test(source);
}

describe("quality gate — contrato oficial de feedback", () => {
  const files = walk(SRC);

  it("nenhum código de aplicação chama a RPC v1", () => {
    const offenders = files
      .map((f) => relative(SRC, f).split("\\").join("/"))
      .filter((rel) => !ALLOWLIST.has(rel))
      .filter((rel) => callsV1(readFileSync(join(SRC, rel), "utf8")));
    expect(offenders, `Use submit_coach_suggestion_feedback_v2. Ofensores: ${offenders.join(", ")}`).toEqual([]);
  });

  it("a server function de feedback usa exclusivamente a v2", () => {
    const src = readFileSync(
      join(SRC, "lib/coach-learnings/coach-learnings.functions.ts"),
      "utf8",
    );
    expect(src).toContain("submit_coach_suggestion_feedback_v2");
    expect(callsV1(src)).toBe(false);
  });
});
