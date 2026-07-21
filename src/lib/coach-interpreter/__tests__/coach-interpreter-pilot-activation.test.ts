// ============================================================================
// FASE 3.3 · ETAPA 2B — Testes do mecanismo de ativação piloto.
//
// Cobertura (22 cenários):
//  1) dry_run enable válido           2) dry_run disable válido
//  3) enable real (mock)              4) disable real (mock)
//  5) company_id malformado           6) company não é a piloto
//  7) empresa inexistente             8) settings inexistente
//  9) environment != production      10) nome divergente
// 11) actor inexistente              12) actor não-admin
// 13) motivo vazio                   14) segundo tenant já enabled
// 15) row count zero (concorrência)  16) row count > 1
// 17) enable idempotente             18) disable idempotente
// 19) audit falha → rollback         20) update falha
// 21) logs/resultado não expõem secrets ou UUID completo
// 22) tabelas coach_* nunca são acessadas
//
// Não acessa produção. Sem network. Puros mocks.
// ============================================================================
import { describe, expect, it, vi } from "vitest";
import {
  maskUuid,
  PILOT_COMPANY_NAME_EXPECTED,
  runPilotActivation,
  type PilotActivationDeps,
  type PilotActivationInput,
} from "@/lib/coach-interpreter/pilot-activation.server";

// UUID que casa com os invariantes do piloto (prefixo 3a7e989c / sufixo cbeb48fd).
const PILOT_ID = "3a7e989c-1111-4222-8333-444444cbeb48fd";
const NON_PILOT_ID = "11111111-2222-4333-8444-555555555555";
const ACTOR_ID = "99999999-8888-4777-8666-555555555555";

function baseInput(over: Partial<PilotActivationInput> = {}): PilotActivationInput {
  return {
    companyId: PILOT_ID,
    action: "enable",
    actorUserId: ACTOR_ID,
    reason: "Ativação piloto autorizada por Rafael (fase 3.3 etapa 2B).",
    dryRun: true,
    environment: "production",
    ...over,
  };
}

interface MockOpts {
  companyName?: string | null;
  companyMissing?: boolean;
  settingsMissing?: boolean;
  currentFlag?: boolean;
  actorMissing?: boolean;
  actorAdmin?: boolean;
  otherEnabledCount?: number;
  updateResult?: { rowsAffected: number; error?: string } | "throw";
  auditResult?: { error?: string };
  tableSpy?: (t: string) => void;
}

function makeDeps(opts: MockOpts = {}) {
  const {
    companyName = PILOT_COMPANY_NAME_EXPECTED,
    companyMissing = false,
    settingsMissing = false,
    currentFlag = false,
    actorMissing = false,
    actorAdmin = true,
    otherEnabledCount = 0,
    updateResult = { rowsAffected: 1 },
    auditResult = {},
    tableSpy,
  } = opts;

  const updateCalls: Array<{ companyId: string; expectedBefore: boolean; desired: boolean }> = [];
  const auditCalls: Array<Parameters<PilotActivationDeps["insertAudit"]>[0]> = [];

  const deps: PilotActivationDeps = {
    fetchCompany: vi.fn(async (id) => {
      tableSpy?.("companies");
      if (companyMissing) return null;
      return { id, name: companyName ?? "" };
    }),
    fetchSettings: vi.fn(async () => {
      tableSpy?.("company_settings");
      if (settingsMissing) return null;
      return { coach_interpreter_enabled: currentFlag };
    }),
    fetchActor: vi.fn(async (id) => {
      tableSpy?.("profiles");
      if (actorMissing) return null;
      return { id };
    }),
    actorIsAdmin: vi.fn(async () => {
      tableSpy?.("user_roles");
      return actorAdmin;
    }),
    countOtherEnabled: vi.fn(async () => {
      tableSpy?.("company_settings");
      return otherEnabledCount;
    }),
    updateFlag: vi.fn(async (companyId, expectedBefore, desired) => {
      tableSpy?.("company_settings");
      updateCalls.push({ companyId, expectedBefore, desired });
      if (updateResult === "throw") throw new Error("boom");
      // Rollback chamadas (desired=currentFlag após update inicial) devem sempre "voltar" 1 linha.
      if (updateCalls.length > 1) return { rowsAffected: 1 };
      return updateResult;
    }),
    insertAudit: vi.fn(async (row) => {
      tableSpy?.("audit_log");
      auditCalls.push(row);
      return auditResult;
    }),
  };

  return { deps, updateCalls, auditCalls };
}

// ---------------------------------------------------------------------------
// 1 & 2 — dry_run
// ---------------------------------------------------------------------------
describe("2B · dry_run", () => {
  it("T01 dry_run enable retorna preview sem escrever", async () => {
    const { deps, updateCalls, auditCalls } = makeDeps({ currentFlag: false });
    const r = await runPilotActivation(baseInput({ action: "enable", dryRun: true }), deps);
    expect(r.ok).toBe(true);
    expect(r.code).toBe("dry_run_ok");
    expect(r.wouldChangeTo).toBe(true);
    expect(r.auditPreview?.after.coach_interpreter_enabled).toBe(true);
    expect(updateCalls).toHaveLength(0);
    expect(auditCalls).toHaveLength(0);
  });

  it("T02 dry_run disable retorna preview sem escrever", async () => {
    const { deps, updateCalls, auditCalls } = makeDeps({ currentFlag: true });
    const r = await runPilotActivation(baseInput({ action: "disable", dryRun: true }), deps);
    expect(r.ok).toBe(true);
    expect(r.code).toBe("dry_run_ok");
    expect(r.wouldChangeTo).toBe(false);
    expect(updateCalls).toHaveLength(0);
    expect(auditCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3 & 4 — execução real
// ---------------------------------------------------------------------------
describe("2B · execução real", () => {
  it("T03 enable real: flag false→true, audit_log gravado", async () => {
    const { deps, updateCalls, auditCalls } = makeDeps({ currentFlag: false });
    const r = await runPilotActivation(baseInput({ action: "enable", dryRun: false }), deps);
    expect(r.ok).toBe(true);
    expect(r.code).toBe("activated");
    expect(updateCalls).toEqual([{ companyId: PILOT_ID, expectedBefore: false, desired: true }]);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].before).toEqual({ coach_interpreter_enabled: false });
    expect(auditCalls[0].after.coach_interpreter_enabled).toBe(true);
    expect(auditCalls[0].after.reason).toContain("Ativação piloto");
  });

  it("T04 disable real: flag true→false, audit_log gravado", async () => {
    const { deps, updateCalls, auditCalls } = makeDeps({ currentFlag: true });
    const r = await runPilotActivation(baseInput({ action: "disable", dryRun: false }), deps);
    expect(r.ok).toBe(true);
    expect(r.code).toBe("deactivated");
    expect(updateCalls[0]).toEqual({ companyId: PILOT_ID, expectedBefore: true, desired: false });
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].after.coach_interpreter_enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5–14 — validações
// ---------------------------------------------------------------------------
describe("2B · validações", () => {
  it("T05 company_id malformado", async () => {
    const { deps } = makeDeps();
    const r = await runPilotActivation(baseInput({ companyId: "nope" }), deps);
    expect(r.code).toBe("company_id_invalid");
    expect(deps.fetchCompany).not.toHaveBeenCalled();
  });

  it("T06 UUID válido mas não é o tenant piloto", async () => {
    const { deps } = makeDeps();
    const r = await runPilotActivation(baseInput({ companyId: NON_PILOT_ID }), deps);
    expect(r.code).toBe("company_not_pilot");
    expect(deps.fetchCompany).not.toHaveBeenCalled();
  });

  it("T07 empresa inexistente no banco", async () => {
    const { deps } = makeDeps({ companyMissing: true });
    const r = await runPilotActivation(baseInput(), deps);
    expect(r.code).toBe("company_not_found");
  });

  it("T08 company_settings inexistente", async () => {
    const { deps } = makeDeps({ settingsMissing: true });
    const r = await runPilotActivation(baseInput(), deps);
    expect(r.code).toBe("settings_not_found");
  });

  it("T09 environment != production", async () => {
    const { deps } = makeDeps();
    const r = await runPilotActivation(baseInput({ environment: "staging" }), deps);
    expect(r.code).toBe("environment_not_production");
    expect(deps.fetchCompany).not.toHaveBeenCalled();
  });

  it("T10 nome divergente", async () => {
    const { deps } = makeDeps({ companyName: "Outra Empresa" });
    const r = await runPilotActivation(baseInput(), deps);
    expect(r.code).toBe("company_name_mismatch");
  });

  it("T11 actor inexistente", async () => {
    const { deps } = makeDeps({ actorMissing: true });
    const r = await runPilotActivation(baseInput(), deps);
    expect(r.code).toBe("actor_not_found");
  });

  it("T12 actor não-admin", async () => {
    const { deps } = makeDeps({ actorAdmin: false });
    const r = await runPilotActivation(baseInput(), deps);
    expect(r.code).toBe("actor_not_admin");
  });

  it("T13 motivo vazio ou muito curto", async () => {
    const { deps } = makeDeps();
    const r = await runPilotActivation(baseInput({ reason: "  " }), deps);
    expect(r.code).toBe("reason_missing");
    expect(deps.fetchCompany).not.toHaveBeenCalled();
  });

  it("T14 outro tenant já habilitado bloqueia enable", async () => {
    const { deps, updateCalls } = makeDeps({ otherEnabledCount: 2 });
    const r = await runPilotActivation(baseInput({ action: "enable", dryRun: false }), deps);
    expect(r.code).toBe("other_tenant_enabled");
    expect(updateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 15, 16, 19, 20 — execução: row count e falhas
// ---------------------------------------------------------------------------
describe("2B · execução: falhas de UPDATE/audit", () => {
  it("T15 row count zero (concorrência) → update_no_row, sem audit", async () => {
    const { deps, auditCalls } = makeDeps({
      currentFlag: false,
      updateResult: { rowsAffected: 0 },
    });
    const r = await runPilotActivation(baseInput({ dryRun: false }), deps);
    expect(r.code).toBe("update_no_row");
    expect(auditCalls).toHaveLength(0);
  });

  it("T16 row count > 1 → rollback, retorna update_multiple_rows", async () => {
    const { deps, updateCalls, auditCalls } = makeDeps({
      currentFlag: false,
      updateResult: { rowsAffected: 5 },
    });
    const r = await runPilotActivation(baseInput({ dryRun: false }), deps);
    expect(r.code).toBe("update_multiple_rows");
    // 1 update inicial + 1 rollback
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[1]).toEqual({ companyId: PILOT_ID, expectedBefore: true, desired: false });
    expect(auditCalls).toHaveLength(0);
  });

  it("T19 audit_log falha → flag revertida (audit_failed_rolled_back)", async () => {
    const { deps, updateCalls } = makeDeps({
      currentFlag: false,
      auditResult: { error: "PGRST-XX" },
    });
    const r = await runPilotActivation(baseInput({ dryRun: false }), deps);
    expect(r.code).toBe("audit_failed_rolled_back");
    // update inicial + rollback
    expect(updateCalls).toEqual([
      { companyId: PILOT_ID, expectedBefore: false, desired: true },
      { companyId: PILOT_ID, expectedBefore: true, desired: false },
    ]);
  });

  it("T20 UPDATE falha → update_failed, sem audit", async () => {
    const { deps, auditCalls } = makeDeps({
      currentFlag: false,
      updateResult: { rowsAffected: 0, error: "connection_reset" },
    });
    const r = await runPilotActivation(baseInput({ dryRun: false }), deps);
    expect(r.code).toBe("update_failed");
    expect(auditCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 17 & 18 — idempotência
// ---------------------------------------------------------------------------
describe("2B · idempotência", () => {
  it("T17 enable quando já enabled → already_enabled, sem audit", async () => {
    const { deps, updateCalls, auditCalls } = makeDeps({ currentFlag: true });
    const r = await runPilotActivation(baseInput({ action: "enable", dryRun: false }), deps);
    expect(r.code).toBe("already_enabled");
    expect(updateCalls).toHaveLength(0);
    expect(auditCalls).toHaveLength(0);
  });

  it("T18 disable quando já disabled → already_disabled, sem audit", async () => {
    const { deps, updateCalls, auditCalls } = makeDeps({ currentFlag: false });
    const r = await runPilotActivation(baseInput({ action: "disable", dryRun: false }), deps);
    expect(r.code).toBe("already_disabled");
    expect(updateCalls).toHaveLength(0);
    expect(auditCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 21 & 22 — segurança de exposição e isolamento coach_*
// ---------------------------------------------------------------------------
describe("2B · segurança e isolamento", () => {
  it("T21 resultado usa máscara e nunca contém UUID completo, chaves ou secrets", async () => {
    const { deps } = makeDeps({ currentFlag: false });
    const r = await runPilotActivation(baseInput({ dryRun: false }), deps);
    const dump = JSON.stringify(r);
    expect(dump).not.toContain(PILOT_ID);
    expect(dump).not.toContain(ACTOR_ID);
    expect(dump).not.toMatch(/service_role|SUPABASE_SERVICE_ROLE|sb_secret_/i);
    expect(r.companyLabel).toBe(maskUuid(PILOT_ID));
    expect(r.auditPreview?.company_id_masked).toBe(maskUuid(PILOT_ID));
    expect(r.auditPreview?.actor_user_id_masked).toBe(maskUuid(ACTOR_ID));
  });

  it("T22 nenhuma tabela coach_* é lida ou escrita pelo mecanismo", async () => {
    const touched: string[] = [];
    const { deps } = makeDeps({
      currentFlag: false,
      tableSpy: (t) => touched.push(t),
    });
    await runPilotActivation(baseInput({ dryRun: false }), deps);
    expect(touched.length).toBeGreaterThan(0);
    for (const t of touched) {
      expect(t.startsWith("coach_")).toBe(false);
    }
    // Whitelist explícita das tabelas permitidas.
    const allowed = new Set(["companies", "company_settings", "profiles", "user_roles", "audit_log"]);
    for (const t of touched) expect(allowed.has(t)).toBe(true);
  });
});
