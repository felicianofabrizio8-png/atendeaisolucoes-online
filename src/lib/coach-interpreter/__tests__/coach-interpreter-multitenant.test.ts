// Fase 3.3 · Etapa 2A — Testes multi-tenant do gate de ativação do
// Coach Interpreter. Cobre exclusivamente:
//   T1) coexistência de flags por tenant (A=true, B=false);
//   T2) ausência de cache cross-tenant entre chamadas alternadas;
//   T3) precedência do kill switch global sobre a flag por empresa.
//
// Não altera código, banco, RLS, migrations, prompts, agente ou runtime.
// Consome apenas exports puros do repository + tabela de erros do módulo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  checkCoachInterpreterEnabled,
  isKillSwitchActive,
} from "@/lib/coach-interpreter/coach-interpreter.repository";
import { COACH_INTERPRETER_ERROR_CODES } from "@/lib/coach-interpreter/errors";

// ------------------------------------------------------------------
// Fake Supabase client — reproduz o encadeamento
//   sb.from("company_settings").select(...).eq("company_id", id).maybeSingle()
// e registra QUANTAS vezes cada tenant foi consultado, garantindo que o
// resultado nunca é reutilizado entre empresas.
// ------------------------------------------------------------------
type Flags = Record<string, boolean | undefined>;

function makeFakeClient(flags: Flags) {
  const calls: { table: string; companyId: string | null }[] = [];
  const fromSpy = vi.fn((table: string) => {
    let currentCompany: string | null = null;
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn((col: string, val: string) => {
      if (col === "company_id") currentCompany = val;
      return builder;
    });
    builder.maybeSingle = vi.fn(async () => {
      calls.push({ table, companyId: currentCompany });
      const enabled = currentCompany ? flags[currentCompany] : undefined;
      return {
        data: enabled === undefined ? null : { coach_interpreter_enabled: enabled },
        error: null as null,
      };
    });
    return builder;
  });
  const sb = { from: fromSpy } as unknown as SupabaseClient<Database>;
  return { sb, calls, fromSpy };
}

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const ORIGINAL_KILLSWITCH = process.env.COACH_INTERPRETER_KILLSWITCH;

beforeEach(() => {
  delete process.env.COACH_INTERPRETER_KILLSWITCH;
});

afterEach(() => {
  if (ORIGINAL_KILLSWITCH === undefined) {
    delete process.env.COACH_INTERPRETER_KILLSWITCH;
  } else {
    process.env.COACH_INTERPRETER_KILLSWITCH = ORIGINAL_KILLSWITCH;
  }
});

// ============================================================
// TESTE 1 — Coexistência de flags por tenant
// ============================================================
describe("Fase 3.3 · Etapa 2A · T1 — coexistência de flags por tenant", () => {
  it("Empresa A (flag=true) recebe true; Empresa B (flag=false) recebe false", async () => {
    const { sb, calls } = makeFakeClient({
      [COMPANY_A]: true,
      [COMPANY_B]: false,
    });

    const enabledA = await checkCoachInterpreterEnabled(sb, COMPANY_A);
    const enabledB = await checkCoachInterpreterEnabled(sb, COMPANY_B);

    expect(enabledA).toBe(true);
    expect(enabledB).toBe(false);

    // Cada consulta foi feita exclusivamente com o company_id correto.
    expect(calls).toEqual([
      { table: "company_settings", companyId: COMPANY_A },
      { table: "company_settings", companyId: COMPANY_B },
    ]);
  });

  it("mapeamento de erros expõe COACH_INTERPRETER_DISABLED para tenants desligados", () => {
    // ensureFlagOrThrow (server function) traduz enabled=false neste código.
    expect(COACH_INTERPRETER_ERROR_CODES.includes("COACH_INTERPRETER_DISABLED")).toBeTruthy();
  });
});

// ============================================================
// TESTE 2 — Ausência de cache cross-tenant
// ============================================================
describe("Fase 3.3 · Etapa 2A · T2 — sem cache cross-tenant", () => {
  it("chamadas alternadas A→B→A→B disparam exatamente 4 consultas ao banco", async () => {
    const { sb, calls, fromSpy } = makeFakeClient({
      [COMPANY_A]: true,
      [COMPANY_B]: false,
    });

    const r1 = await checkCoachInterpreterEnabled(sb, COMPANY_A);
    const r2 = await checkCoachInterpreterEnabled(sb, COMPANY_B);
    const r3 = await checkCoachInterpreterEnabled(sb, COMPANY_A);
    const r4 = await checkCoachInterpreterEnabled(sb, COMPANY_B);

    expect([r1, r2, r3, r4]).toEqual([true, false, true, false]);
    expect(fromSpy).toHaveBeenCalledTimes(4);
    expect(calls.map((c) => c.companyId)).toEqual([COMPANY_A, COMPANY_B, COMPANY_A, COMPANY_B]);
  });

  it("flag flip em runtime é refletida imediatamente (sem memoização)", async () => {
    const flags: Flags = { [COMPANY_A]: true };
    const { sb } = makeFakeClient(flags);

    expect(await checkCoachInterpreterEnabled(sb, COMPANY_A)).toBe(true);
    flags[COMPANY_A] = false;
    expect(await checkCoachInterpreterEnabled(sb, COMPANY_A)).toBe(false);
  });
});

// ============================================================
// TESTE 3 — Precedência do kill switch global
// ============================================================
describe("Fase 3.3 · Etapa 2A · T3 — kill switch global tem precedência", () => {
  it("com kill switch ativo, A(true) e B(false) retornam false sem consultar o banco", async () => {
    process.env.COACH_INTERPRETER_KILLSWITCH = "true";
    const { sb, fromSpy } = makeFakeClient({
      [COMPANY_A]: true,
      [COMPANY_B]: false,
    });

    expect(isKillSwitchActive()).toBe(true);
    expect(await checkCoachInterpreterEnabled(sb, COMPANY_A)).toBe(false);
    expect(await checkCoachInterpreterEnabled(sb, COMPANY_B)).toBe(false);

    // Curto-circuito: o kill switch impede qualquer query ao banco.
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("kill switch aceita apenas literal 'true' (case-insensitive)", () => {
    process.env.COACH_INTERPRETER_KILLSWITCH = "TRUE";
    expect(isKillSwitchActive()).toBe(true);
    process.env.COACH_INTERPRETER_KILLSWITCH = "false";
    expect(isKillSwitchActive()).toBe(false);
    process.env.COACH_INTERPRETER_KILLSWITCH = "1";
    expect(isKillSwitchActive()).toBe(false);
    delete process.env.COACH_INTERPRETER_KILLSWITCH;
    expect(isKillSwitchActive()).toBe(false);
  });

  it("mapeamento de erros expõe COACH_INTERPRETER_KILLED quando o kill switch está ativo", () => {
    expect(COACH_INTERPRETER_ERROR_CODES.includes("COACH_INTERPRETER_KILLED")).toBeTruthy();
  });
});
