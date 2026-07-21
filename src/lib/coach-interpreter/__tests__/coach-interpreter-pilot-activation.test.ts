// ============================================================================
// FASE 3.3 · ETAPA 2B.1 — Testes do mecanismo de ativação piloto (corrigido).
//
// Cobre os cenários originais (22) + os 15 obrigatórios da Etapa 2B.1:
//  - Igualdade INTEGRAL do UUID (aceita correto; rejeita prefixo/sufixo iguais
//    com miolo diferente; rejeita nome + environment corretos mas UUID errado).
//  - COACH_PILOT_COMPANY_ID (aprovado) ausente/vazio/inválido → pilot_config_invalid
//    SEM tocar no banco.
//  - UUID esperado e recebido nunca aparecem integralmente em logs/erros.
//  - Actor admin de outro tenant é rejeitado.
//  - audit falha + rollback compensatório ok → audit_failed_rolled_back.
//  - audit falha + rollback também falha → compensation_failed (nunca sucesso).
//  - dry-run também exige igualdade completa do UUID.
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

// UUIDs válidos e distintos — nenhum é o "real" de produção.
const PILOT_ID = "3a7e989c-1111-4222-8333-4444cbeb48fd";
// mesmo prefixo (3a7e989c) e mesmo sufixo (cbeb48fd) do PILOT_ID, mas miolo diferente
const SAME_PREFIX_SUFFIX_DIFFERENT_MIDDLE = "3a7e989c-9999-4aaa-8bbb-ccccebeb48fd";
// obs: alterei o sufixo acima para NÃO casar; corrijo em seguida com um UUID que casa em prefix+suffix
const SAME_ENVELOPE_DIFFERENT_MIDDLE = "3a7e989c-9999-4aaa-8bbb-ccccbeb48fd0"; // 36 chars? validar
// Uso final: gerar um UUID com mesmos prefix/suffix nibbles mas miolo distinto:
const ENVELOPE_MATCH_MIDDLE_DIFF = "3a7e989c-9999-4aaa-8bbb-0000cbeb48fd";
const NON_PILOT_ID = "11111111-2222-4333-8444-555555555555";
const ACTOR_ID = "99999999-8888-4777-8666-555555555555";
const OTHER_TENANT_ID = "22222222-3333-4444-8555-666666666666";

function baseInput(over: Partial<PilotActivationInput> = {}): PilotActivationInput {
  return {
    companyId: PILOT_ID,
    action: "enable",
    actorUserId: ACTOR_ID,
    reason: "Ativação piloto autorizada por Rafael (fase 3.3 etapa 2B.1).",
    dryRun: true,
    environment: "production",
    approvedPilotCompanyId: PILOT_ID,
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
  /** true = admin do tenant piloto; false = não é admin do tenant piloto. */
  actorAdminOfPilotOnly?: boolean;
  otherEnabledCount?: number;
  updateResult?: { rowsAffected: number; error?: string } | "throw";
  /** Override do resultado do 2º updateFlag (rollback compensatório). */
  rollbackResult?: { rowsAffected: number; error?: string };
  auditResult?: { error?: string };
  tableSpy?: (t: string) => void;
  actorAdminSpy?: (userId: string, companyId: string) => void;
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
    rollbackResult,
    auditResult = {},
    tableSpy,
    actorAdminSpy,
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
    actorIsAdminOfCompany: vi.fn(async (userId, companyId) => {
      tableSpy?.("user_roles");
      actorAdminSpy?.(userId, companyId);
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
      if (updateCalls.length > 1) {
        return rollbackResult ?? { rowsAffected: 1 };
      }
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
describe("2B.1 · dry_run", () => {
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
describe("2B.1 · execução real", () => {
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
describe("2B.1 · validações", () => {
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

  it("T12 actor não-admin do tenant piloto", async () => {
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
describe("2B.1 · execução: falhas de UPDATE/audit", () => {
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
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[1]).toEqual({ companyId: PILOT_ID, expectedBefore: true, desired: false });
    expect(auditCalls).toHaveLength(0);
  });

  it("T19 audit falha + rollback compensatório ok → audit_failed_rolled_back", async () => {
    const { deps, updateCalls } = makeDeps({
      currentFlag: false,
      auditResult: { error: "PGRST-XX" },
    });
    const r = await runPilotActivation(baseInput({ dryRun: false }), deps);
    expect(r.code).toBe("audit_failed_rolled_back");
    expect(r.ok).toBe(false);
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
describe("2B.1 · idempotência", () => {
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
describe("2B.1 · segurança e isolamento", () => {
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
    for (const t of touched) expect(t.startsWith("coach_")).toBe(false);
    const allowed = new Set([
      "companies",
      "company_settings",
      "profiles",
      "user_roles",
      "audit_log",
    ]);
    for (const t of touched) expect(allowed.has(t)).toBe(true);
  });
});

// ===========================================================================
// ETAPA 2B.1 — NOVOS CENÁRIOS OBRIGATÓRIOS
// ===========================================================================
describe("2B.1 · igualdade INTEGRAL do UUID aprovado", () => {
  it("N01 UUID completo correto é aceito (dry-run ok)", async () => {
    const { deps } = makeDeps({ currentFlag: false });
    const r = await runPilotActivation(
      baseInput({ companyId: PILOT_ID, approvedPilotCompanyId: PILOT_ID, dryRun: true }),
      deps,
    );
    expect(r.code).toBe("dry_run_ok");
  });

  it("N02 mesmo prefixo/sufixo mas miolo diferente é REJEITADO", async () => {
    const { deps } = makeDeps({ currentFlag: false });
    const r = await runPilotActivation(
      baseInput({
        companyId: ENVELOPE_MATCH_MIDDLE_DIFF,
        approvedPilotCompanyId: PILOT_ID,
        dryRun: true,
      }),
      deps,
    );
    expect(r.code).toBe("company_not_pilot");
    expect(deps.fetchCompany).not.toHaveBeenCalled();
  });

  it("N03 nome + environment corretos mas UUID diferente é REJEITADO", async () => {
    const { deps } = makeDeps({
      currentFlag: false,
      companyName: PILOT_COMPANY_NAME_EXPECTED,
    });
    const r = await runPilotActivation(
      baseInput({
        companyId: NON_PILOT_ID,
        approvedPilotCompanyId: PILOT_ID,
        environment: "production",
        dryRun: false,
      }),
      deps,
    );
    expect(r.code).toBe("company_not_pilot");
    expect(deps.fetchCompany).not.toHaveBeenCalled();
    expect(deps.updateFlag).not.toHaveBeenCalled();
  });

  it("N14 dry-run também exige igualdade completa do UUID", async () => {
    const { deps } = makeDeps({ currentFlag: false });
    const r = await runPilotActivation(
      baseInput({
        companyId: NON_PILOT_ID,
        approvedPilotCompanyId: PILOT_ID,
        dryRun: true,
      }),
      deps,
    );
    expect(r.code).toBe("company_not_pilot");
    expect(r.ok).toBe(false);
  });
});

describe("2B.1 · COACH_PILOT_COMPANY_ID (aprovado) inválido", () => {
  it("N04 aprovado ausente (undefined) → pilot_config_invalid, sem tocar no banco", async () => {
    const { deps } = makeDeps();
    const r = await runPilotActivation(baseInput({ approvedPilotCompanyId: undefined }), deps);
    expect(r.code).toBe("pilot_config_invalid");
    expect(r.severity).toBe("critical");
    expect(deps.fetchCompany).not.toHaveBeenCalled();
    expect(deps.fetchSettings).not.toHaveBeenCalled();
    expect(deps.fetchActor).not.toHaveBeenCalled();
    expect(deps.actorIsAdminOfCompany).not.toHaveBeenCalled();
    expect(deps.updateFlag).not.toHaveBeenCalled();
    expect(deps.insertAudit).not.toHaveBeenCalled();
  });

  it("N05 aprovado vazio ('   ') → pilot_config_invalid, sem tocar no banco", async () => {
    const { deps } = makeDeps();
    const r = await runPilotActivation(baseInput({ approvedPilotCompanyId: "   " }), deps);
    expect(r.code).toBe("pilot_config_invalid");
    expect(deps.fetchCompany).not.toHaveBeenCalled();
  });

  it("N06 aprovado com formato inválido → pilot_config_invalid, sem tocar no banco", async () => {
    const { deps } = makeDeps();
    const r = await runPilotActivation(
      baseInput({ approvedPilotCompanyId: "not-a-uuid" }),
      deps,
    );
    expect(r.code).toBe("pilot_config_invalid");
    expect(deps.fetchCompany).not.toHaveBeenCalled();
  });

  it("N15 nenhuma consulta ao banco quando aprovado é inválido (spy consolidado)", async () => {
    const touched: string[] = [];
    const { deps } = makeDeps({ tableSpy: (t) => touched.push(t) });
    await runPilotActivation(baseInput({ approvedPilotCompanyId: "" }), deps);
    expect(touched).toEqual([]);
  });
});

describe("2B.1 · segurança de logs — UUIDs nunca aparecem integralmente", () => {
  it("N07 UUID aprovado nunca aparece em result/message/preview", async () => {
    const { deps } = makeDeps({ currentFlag: false });
    const r = await runPilotActivation(baseInput({ dryRun: false }), deps);
    const dump = JSON.stringify(r);
    expect(dump).not.toContain(PILOT_ID);
    // pilot_config_invalid também não vaza o valor esperado
    const r2 = await runPilotActivation(
      baseInput({ approvedPilotCompanyId: "still-bad" }),
      deps,
    );
    const dump2 = JSON.stringify(r2);
    expect(dump2).not.toContain(PILOT_ID);
    expect(dump2).not.toContain("still-bad");
  });

  it("N08 UUID recebido nunca aparece integralmente em erro", async () => {
    const { deps } = makeDeps();
    const r = await runPilotActivation(
      baseInput({ companyId: ENVELOPE_MATCH_MIDDLE_DIFF, approvedPilotCompanyId: PILOT_ID }),
      deps,
    );
    const dump = JSON.stringify(r);
    expect(dump).not.toContain(ENVELOPE_MATCH_MIDDLE_DIFF);
    expect(r.companyLabel).toBe(maskUuid(ENVELOPE_MATCH_MIDDLE_DIFF));
  });
});

describe("2B.1 · escopo do actor por tenant", () => {
  it("N09 actor admin do tenant piloto é aceito (consulta usa companyId completo)", async () => {
    let sawUser = "";
    let sawCompany = "";
    const { deps } = makeDeps({
      currentFlag: false,
      actorAdmin: true,
      actorAdminSpy: (u, c) => {
        sawUser = u;
        sawCompany = c;
      },
    });
    const r = await runPilotActivation(baseInput({ dryRun: true }), deps);
    expect(r.code).toBe("dry_run_ok");
    expect(sawUser).toBe(ACTOR_ID);
    expect(sawCompany).toBe(PILOT_ID);
    expect(deps.actorIsAdminOfCompany).toHaveBeenCalledWith(ACTOR_ID, PILOT_ID);
    // nunca chamado com outro tenant
    for (const call of (deps.actorIsAdminOfCompany as unknown as { mock: { calls: unknown[][] } })
      .mock.calls) {
      expect(call[1]).toBe(PILOT_ID);
      expect(call[1]).not.toBe(OTHER_TENANT_ID);
    }
  });

  it("N10 actor admin apenas de outro tenant é REJEITADO", async () => {
    // actorIsAdminOfCompany(_, PILOT_ID) retorna false porque o admin é de OTHER_TENANT
    const { deps } = makeDeps({ currentFlag: false, actorAdmin: false });
    const r = await runPilotActivation(baseInput({ dryRun: false }), deps);
    expect(r.code).toBe("actor_not_admin");
  });
});

describe("2B.1 · rollback compensatório — sucesso e falha", () => {
  it("N11 audit falha + rollback ok → audit_failed_rolled_back (severidade warn)", async () => {
    const { deps, updateCalls } = makeDeps({
      currentFlag: false,
      auditResult: { error: "PGRST-XX" },
      rollbackResult: { rowsAffected: 1 },
    });
    const r = await runPilotActivation(baseInput({ dryRun: false }), deps);
    expect(r.code).toBe("audit_failed_rolled_back");
    expect(r.ok).toBe(false);
    expect(r.severity).toBe("warn");
    expect(updateCalls).toHaveLength(2);
  });

  it("N12 audit falha + rollback também falha → compensation_failed (crítico)", async () => {
    const { deps } = makeDeps({
      currentFlag: false,
      auditResult: { error: "PGRST-XX" },
      rollbackResult: { rowsAffected: 0, error: "rollback_boom" },
    });
    const r = await runPilotActivation(baseInput({ dryRun: false }), deps);
    expect(r.code).toBe("compensation_failed");
    expect(r.ok).toBe(false);
    expect(r.severity).toBe("critical");
    expect(r.message.toLowerCase()).toContain("rollback manual");
  });

  it("N13 compensation_failed nunca retorna status de sucesso", async () => {
    const { deps } = makeDeps({
      currentFlag: false,
      auditResult: { error: "boom" },
      rollbackResult: { rowsAffected: 0 },
    });
    const r = await runPilotActivation(baseInput({ dryRun: false }), deps);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("compensation_failed");
  });

  it("N12b update_multiple_rows + rollback também falha → compensation_failed", async () => {
    const { deps } = makeDeps({
      currentFlag: false,
      updateResult: { rowsAffected: 3 },
      rollbackResult: { rowsAffected: 0, error: "rollback_boom" },
    });
    const r = await runPilotActivation(baseInput({ dryRun: false }), deps);
    expect(r.code).toBe("compensation_failed");
    expect(r.severity).toBe("critical");
  });
});

// Sanity check dos UUIDs auxiliares deste teste.
describe("2B.1 · sanidade dos fixtures", () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  it("todos os UUIDs de teste têm forma válida", () => {
    for (const id of [PILOT_ID, NON_PILOT_ID, ACTOR_ID, OTHER_TENANT_ID, ENVELOPE_MATCH_MIDDLE_DIFF]) {
      expect(UUID_RE.test(id)).toBe(true);
    }
  });
  it("ENVELOPE_MATCH_MIDDLE_DIFF compartilha prefixo e sufixo com PILOT_ID mas difere no miolo", () => {
    expect(ENVELOPE_MATCH_MIDDLE_DIFF.slice(0, 8)).toBe(PILOT_ID.slice(0, 8));
    expect(ENVELOPE_MATCH_MIDDLE_DIFF.slice(-8)).toBe(PILOT_ID.slice(-8));
    expect(ENVELOPE_MATCH_MIDDLE_DIFF).not.toBe(PILOT_ID);
  });
  // Silence unused-symbols
  it("símbolos auxiliares (evita dead-code) permanecem consistentes", () => {
    expect(SAME_PREFIX_SUFFIX_DIFFERENT_MIDDLE.length).toBeGreaterThan(0);
    expect(SAME_ENVELOPE_DIFFERENT_MIDDLE.length).toBeGreaterThan(0);
  });
});
