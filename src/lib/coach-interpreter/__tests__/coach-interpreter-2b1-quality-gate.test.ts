// Coach Interpreter · Fase 2.b.1 — Quality gate das correções obrigatórias.
//
// Escopo (READ-ONLY em runtime, exceto pela função pura de decisão):
//   1) Contratos de migration (RPC de reserva atômica, evento coach_rule_events,
//      remoção do CHECK duplicado).
//   2) Isolamento server-side: `supabaseAdmin` NÃO em module-scope, e nenhum
//      arquivo de server function carrega o client.server no topo.
//   3) Repository consome a RPC atômica (`coach_reserve_user_message`) e NÃO
//      usa `insertUserCoachMessage` como caminho principal.
//   4) Regra determinística de ambiguidade (M4) — função pura exportada.
//   5) Allow-list de isolamento (Fase 1) contempla os 3 arquivos legítimos
//      do módulo Interpreter (M2).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  decideCoachInterpreterOutcome,
  type CoachInterpreterDecision,
} from "@/lib/coach-interpreter/coach-interpreter.service";
import type { CoachInterpreterOutput } from "@/lib/coach-interpreter/schema";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");

function findMigration(needle: RegExp): string {
  const file = readdirSync(MIG_DIR).find((f) => {
    if (!f.endsWith(".sql")) return false;
    return needle.test(readFileSync(join(MIG_DIR, f), "utf8"));
  });
  if (!file) throw new Error(`Migration não encontrada para ${needle}`);
  return readFileSync(join(MIG_DIR, file), "utf8");
}

// ============================================================
// 1) Migration da Fase 2.b.1
// ============================================================
describe("Fase 2.b.1 · Migration — hardening", () => {
  const sql = findMigration(/coach_reserve_user_message/);

  it("cria RPC coach_reserve_user_message SECURITY DEFINER", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.coach_reserve_user_message\s*\(/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/ON CONFLICT[\s\S]{0,200}DO NOTHING/i);
  });

  it("RPC valida tenant, autor e é revogada de anon", () => {
    expect(sql).toMatch(/current_company_id\(\)/);
    expect(sql).toMatch(/coach_cross_tenant/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.coach_reserve_user_message[\s\S]*FROM anon/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.coach_reserve_user_message[\s\S]*TO authenticated/,
    );
  });

  it("confirm_coach_rule_proposal emite version_created em coach_rule_events com linkage completo", () => {
    // O bloco de INSERT precisa vir DEPOIS do UPDATE do proposal e ANTES do RETURN QUERY final.
    expect(sql).toMatch(
      /INSERT INTO public\.coach_rule_events[\s\S]*'version_created'[\s\S]*'source'[\s\S]*'coach_interpreter'[\s\S]*'proposal_id'[\s\S]*'conversation_id'[\s\S]*'source_message_id'[\s\S]*'critical_confirmed'/,
    );
  });

  it("confirmação idempotente retorna cedo (sem re-inserir evento)", () => {
    // O early return de was_already_confirmed=true ocorre antes de qualquer INSERT.
    expect(sql).toMatch(
      /IF v_row\.status = 'confirmed' THEN[\s\S]{0,200}RETURN QUERY SELECT v_row\.created_rule_id, v_row\.created_version_id, true;/,
    );
  });

  it("remove CHECK redundante coach_rule_proposals_normalized_output_check", () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS coach_rule_proposals_normalized_output_check/);
    // Pré-condição de segurança: só faz DROP se o constraint consolidado existir e estiver validado.
    expect(sql).toMatch(/coach_prop_normalized_output_size/);
    expect(sql).toMatch(/convalidated = true/);
  });
});

// ============================================================
// 2) Isolamento server-side (A2) — nenhum module-scope de supabaseAdmin
// ============================================================
describe("Fase 2.b.1 · Isolamento server-only (A2)", () => {
  const paths = [
    "src/lib/coach-interpreter/coach-interpreter.service.ts",
    "src/lib/coach-interpreter/coach-interpreter.repository.ts",
    "src/lib/coach-interpreter/coach-interpreter.functions.ts",
  ];

  for (const p of paths) {
    it(`${p} não importa supabaseAdmin no module-scope`, () => {
      const src = readFileSync(join(ROOT, p), "utf8");
      // ES import estático de client.server é proibido nestes arquivos.
      expect(src).not.toMatch(/^\s*import[^\n]*integrations\/supabase\/client\.server/m);
    });
  }

  it("service.ts carrega supabaseAdmin via dynamic import dentro do handler", () => {
    const src = readFileSync(
      join(ROOT, "src/lib/coach-interpreter/coach-interpreter.service.ts"),
      "utf8",
    );
    expect(src).toMatch(/await import\(\s*["']@\/integrations\/supabase\/client\.server["']\s*\)/);
  });

  it("nenhuma server function retorna o admin client", () => {
    const src = readFileSync(
      join(ROOT, "src/lib/coach-interpreter/coach-interpreter.functions.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/supabaseAdmin/);
  });
});

// ============================================================
// 3) Idempotência atômica no repository (A1/M3)
// ============================================================
describe("Fase 2.b.1 · Repository consome RPC atômica", () => {
  const src = readFileSync(
    join(ROOT, "src/lib/coach-interpreter/coach-interpreter.repository.ts"),
    "utf8",
  );

  it("expõe reserveUserCoachMessage e chama coach_reserve_user_message", () => {
    expect(src).toMatch(/export async function reserveUserCoachMessage/);
    expect(src).toMatch(/\.rpc\(\s*["']coach_reserve_user_message["']/);
  });

  it("não expõe mais insertUserCoachMessage como caminho principal", () => {
    expect(src).not.toMatch(/export async function insertUserCoachMessage/);
  });
});

describe("Fase 2.b.1 · Functions usam reserva atômica", () => {
  const src = readFileSync(
    join(ROOT, "src/lib/coach-interpreter/coach-interpreter.functions.ts"),
    "utf8",
  );

  it("sendCoachMessageFn chama reserveUserCoachMessage e ramifica em created/!created", () => {
    expect(src).toMatch(/reserveUserCoachMessage/);
    expect(src).toMatch(/reserved\.created/);
    expect(src).toMatch(/if\s*\(\s*!reserved\.created\s*\)/);
  });

  it("expõe códigos estáveis de status (M3) sem vazar erro bruto do Postgres", () => {
    expect(src).toMatch(/COACH_INTERPRETER_SEND_STATUS/);
    expect(src).toMatch(/duplicate_in_progress/);
    expect(src).toMatch(/duplicate_completed/);
    expect(src).toMatch(/duplicate_failed/);
    expect(src).toMatch(/created/);
    expect(src).not.toMatch(/duplicate key value/);
  });
});

// ============================================================
// 4) Ambiguidade determinística (M4) — função pura
// ============================================================
describe("Fase 2.b.1 · decideCoachInterpreterOutcome (M4)", () => {
  function baseProposal(overrides: Record<string, unknown> = {}) {
    return {
      title: "Regra teste",
      category: "sales",
      rule_type: "instruction",
      scope_kind: "company",
      scope_ref: {},
      priority: 50,
      condition: "",
      instruction: "Aja assim",
      rationale: "",
      examples: [],
      confidence: 0.95,
      risk_level: "low",
      ambiguities: [],
      missing_information: [],
      ...overrides,
    };
  }
  function baseOut(overrides: Record<string, unknown> = {}): CoachInterpreterOutput {
    return {
      intent: "rule",
      has_rule: true,
      proposals: [baseProposal()],
      clarification_questions: [],
      confidence: 0.95,
      reasoning_summary: "resumo",
      warnings: [],
      ...overrides,
    } as unknown as CoachInterpreterOutput;
  }

  it("confidence 0.95 sem ambiguidade → proposals", () => {
    const d: CoachInterpreterDecision = decideCoachInterpreterOutcome(baseOut());
    expect(d.kind).toBe("proposals");
    expect(d.materialAmbiguity).toBe(false);
  });

  it("confidence 0.95 + ambiguities não-vazio → clarification quando há perguntas", () => {
    const out = baseOut({
      clarification_questions: ["Qual o desconto?"],
      proposals: [baseProposal({ ambiguities: ["desconto não informado"] })],
    });
    const d = decideCoachInterpreterOutcome(out);
    expect(d.kind).toBe("clarification");
    expect(d.materialAmbiguity).toBe(true);
  });

  it("confidence 0.95 + missing_information não-vazio SEM perguntas → classified (não persiste)", () => {
    const out = baseOut({
      proposals: [baseProposal({ missing_information: ["prazo"] })],
    });
    const d = decideCoachInterpreterOutcome(out);
    expect(d.kind).toBe("classified");
    expect(d.materialAmbiguity).toBe(true);
  });

  it("confidence < 0.70 força clarification mesmo sem ambiguities", () => {
    const out = baseOut({
      confidence: 0.5,
      clarification_questions: ["Reformule"],
    });
    const d = decideCoachInterpreterOutcome(out);
    expect(d.kind).toBe("clarification");
  });

  it("sem proposals e sem ambiguidade → classified", () => {
    const out = baseOut({
      intent: "knowledge",
      has_rule: false,
      proposals: [],
    });
    const d = decideCoachInterpreterOutcome(out);
    expect(d.kind).toBe("classified");
    expect(d.materialAmbiguity).toBe(false);
  });
});

// ============================================================
// 5) Allow-list de isolamento (M2) — Fase 1 quality gate estendido
// ============================================================
describe("Fase 2.b.1 · Allow-list de isolamento estendida (M2)", () => {
  const src = readFileSync(
    join(ROOT, "src/lib/coach-rules/__tests__/coach-v2-phase-1-quality-gate.test.ts"),
    "utf8",
  );

  it("inclui os 3 arquivos do Coach Interpreter", () => {
    expect(src).toMatch(/"src\/lib\/coach-interpreter\/coach-interpreter\.repository\.ts"/);
    expect(src).toMatch(/"src\/lib\/coach-interpreter\/coach-interpreter\.service\.ts"/);
    expect(src).toMatch(/"src\/lib\/coach-interpreter\/coach-interpreter\.functions\.ts"/);
  });

  it("mantém os 2 consumidores originais da Fase 1", () => {
    expect(src).toMatch(/"src\/lib\/coach-rules\/coach-rules\.repository\.ts"/);
    expect(src).toMatch(/"src\/routes\/configuracoes_\.regras-coach\.tsx"/);
  });
});
