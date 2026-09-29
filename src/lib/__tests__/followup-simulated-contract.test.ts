// Contrato explícito de simulação nos fluxos automáticos do follow-up.
//
// Com o EnvironmentGuard ativo (staging), o transporte devolve
// `simulated: true`. Tick, "Follow-up agora" e reativação — todos via
// `dispatch.ts` — precisam:
//   • em envio real → manter persistência e side-effects;
//   • em simulação → não fabricar externalId, não contar como envio real,
//     não setar reactivated_at e registrar status distinto ('simulated').

/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------- Fake supabaseAdmin (chainable) ----------
const inserted: Array<{ table: string; row: any }> = [];
const updated: Array<{ table: string; patch: any }> = [];
const tableRows: Record<string, Array<Record<string, unknown>>> = {};

function makeChain(table: string) {
  const filters: Array<[string, unknown]> = [];
  const list = () => (tableRows[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
  const chain: any = {
    select: () => chain,
    eq: (col: string, val: unknown) => (filters.push([col, val]), chain),
    order: () => chain,
    gte: () => chain,
    lte: () => chain,
    gt: () => chain,
    lt: () => chain,
    is: () => chain,
    in: () => chain,
    not: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: list()[0] ?? null, error: null }),
    then: (cb: any) => cb({ data: list(), count: list().length, error: null }),
    insert: (r: any) => {
      inserted.push({ table, row: r });
      const res = { data: { id: "x", ...r }, error: null };
      return { select: () => ({ single: async () => res }), then: (cb: any) => cb(res) };
    },
    update: (patch: any) => {
      const upd: any = {
        eq: () => upd,
        is: () => upd,
        then: (cb: any) => {
          updated.push({ table, patch });
          return cb({ error: null });
        },
      };
      return upd;
    },
  };
  return chain;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: vi.fn((t: string) => makeChain(t)) },
}));

// ---------- Transporte ----------
const sendSpy = vi.fn();
vi.mock("@/lib/ai-agent.server", () => ({
  sendWhatsappText: (...args: unknown[]) => sendSpy(...args),
}));
const templateSpy = vi.fn();
vi.mock("@/lib/wa-templates.server", async (importOriginal) => {
  // Render REAL (contrato do template); só busca e envio são simulados.
  const actual = await importOriginal<typeof import("@/lib/wa-templates.server")>();
  return {
    ...actual,
    // Só o legado por propósito existe: sem chamar_novamente não há IA no caminho.
    findApprovedTemplateForPurpose: async (_c: string, purpose: string) =>
      purpose === "followup_resume"
        ? null
        : {
            name: "reativacao_cliente",
            category: "marketing",
            variables: ["var1"],
            components: [{ type: "BODY", text: "Olá {{1}}" }],
          },
    sendWhatsappTemplate: (...args: unknown[]) => templateSpy(...args),
  };
});

vi.mock("@/lib/ai-readiness.server", () => ({ getReadiness: async () => ({ status: "ativa" }) }));
vi.mock("@/lib/followup/gates", () => ({
  canSendFollowupNow: async () => ({ ok: true, remainingToday: 50 }),
}));

const SETTINGS = {
  enabled: true,
  maxPerLead: 3,
  minHoursBetween: 24,
  quoteDelayHours: 24,
  silenceDelayHours: 48,
  visitDelayHours: 24,
  hotDelayHours: 4,
  businessHoursOnly: false,
  businessHoursStart: "00:00",
  businessHoursEnd: "23:59",
  tone: "amigavel",
  templates: { lead_silent: "Oi {{nome}}" },
  initialMessage: null,
  agentName: "Fabri",
  timeZone: "America/Sao_Paulo",
  businessDays: [1, 2, 3, 4, 5, 6, 7],
};
const V2 = {
  humanize: false,
  delayJitterMinutes: 0,
  dailyLimit: 100,
  minResponseRate: 0,
  warmupEnabled: false,
  warmupStartedAt: null,
  reactivationEnabled: true,
  reactivationDays: 30,
  reactivationDailyMax: 5,
  reactivationHoursStart: "00:00",
  reactivationHoursEnd: "23:59",
  reactivationTemplate: "Olá {{nome}}",
};
vi.mock("@/lib/followup/settings", () => ({
  getFollowupSettings: async () => SETTINGS,
  getFollowupV2Settings: async () => V2,
}));

// ---------- Ciclo: um ciclo vencido, resultado aplicado de verdade é outro teste ----------
const CYCLE = {
  id: "cycle-1",
  company_id: "company-1",
  conversation_id: "conv-1",
  lead_id: "lead-1",
  reason: "lead_silent",
  reference_key: "msg:m1",
  reference_at: "2026-01-01T00:00:00Z",
  state: "active",
  attempts: 0,
  max_attempts: 3,
  failures: 0,
  next_followup_at: "2026-01-02T00:00:00Z",
  metadata: { signal: "nossa mensagem sem resposta" },
};
const applySpy = vi.fn(async () => ({ state: "active", nextFollowupAt: "2026-01-05T00:00:00Z" }));
vi.mock("@/lib/followup/candidates", () => ({
  scanFollowupOpportunities: async () => ({ candidates: [], pendingAttendance: 0 }),
  classifyConversation: async () => ({ kind: "active", cycleId: "cycle-1" }),
}));
vi.mock("@/lib/followup/cycles", () => ({
  openCycle: async () => null,
  dueCycles: async () => [CYCLE],
  activeCycleFor: async () => CYCLE,
  reanchorIfWeSpokeAgain: async () => null,
  applyDispatchOutcome: (...args: unknown[]) => applySpy(...(args as [])),
}));
const window24h = vi.hoisted(() => ({ outside: false }));
vi.mock("@/lib/followup/safety", () => ({
  isOutsideWhatsappWindow: async () => window24h.outside,
}));

import { runFollowupTickForCompany } from "@/lib/followup/tick";
import { runManualFollowup } from "@/lib/followup/manual";
import { runReactivation } from "@/lib/followup/reactivation";

function liveConversation(id: string, leadId: string) {
  tableRows.conversations = [
    {
      id,
      company_id: "company-1",
      lead_id: leadId,
      ai_status: null,
      ai_handling: false,
      human_takeover_at: null,
    },
  ];
  tableRows.leads = [{ id: leadId, company_id: "company-1", name: "Ana", status: "novo" }];
  tableRows.messages = [];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-15T15:00:00Z"));
  sendSpy.mockReset();
  templateSpy.mockReset();
  applySpy.mockClear();
  inserted.length = 0;
  updated.length = 0;
  Object.keys(tableRows).forEach((k) => delete tableRows[k]);
  window24h.outside = false;
  liveConversation("conv-1", "lead-1");
});
afterEach(() => vi.useRealTimers());

const fup = () => inserted.find((r) => r.table === "follow_ups")!.row;
const event = () => inserted.find((r) => r.table === "ai_flow_events")!.row;

describe("tick — simulated não é contado como envio real", () => {
  it("simulated: follow_up 'simulated' + followup_simulated + result.simulated++", async () => {
    sendSpy.mockResolvedValueOnce({
      ok: true,
      simulated: true,
      externalId: null,
      simulationId: "sim-tick",
      externalRequestSent: false,
    });
    const result = await runFollowupTickForCompany("company-1");
    expect(result.sent).toBe(0);
    expect(result.simulated).toBe(1);
    expect(result.errors).toEqual([]);
    expect(fup()).toMatchObject({ status: "simulated", cycle_id: "cycle-1" });
    expect(fup().metadata).toMatchObject({
      simulated: true,
      simulation_id: "sim-tick",
      external_request_sent: false,
    });
    expect(fup().metadata.external_id).toBeUndefined();
    expect(event()).toMatchObject({
      event_type: "followup_simulated",
      payload: { simulation_id: "sim-tick" },
    });
    // simulado avança o ciclo (senão reenviaria a cada tick em staging)
    expect(applySpy).toHaveBeenCalledWith(
      CYCLE,
      expect.objectContaining({ status: "simulated" }),
      expect.anything(),
    );
  });

  it("real: status 'sent', followup_sent e external_id preservado", async () => {
    sendSpy.mockResolvedValueOnce({ ok: true, simulated: false, externalId: "wamid.REAL" });
    const result = await runFollowupTickForCompany("company-1");
    expect(result).toMatchObject({ sent: 1, simulated: 0 });
    expect(fup()).toMatchObject({ status: "sent" });
    expect(fup().metadata.external_id).toBe("wamid.REAL");
    expect(event().event_type).toBe("followup_sent");
  });

  it("falha real: status 'failed' + followup_failed + result.errors", async () => {
    sendSpy.mockResolvedValueOnce({ ok: false, simulated: false, error: "Invalid phone" });
    const result = await runFollowupTickForCompany("company-1");
    expect(result).toMatchObject({ sent: 0, simulated: 0 });
    expect(result.errors).toHaveLength(1);
    expect(fup()).toMatchObject({ status: "failed" });
    expect(fup().metadata.error).toBe("Invalid phone");
  });
});

describe("Follow-up agora — resposta ao admin discrimina simulação", () => {
  it("simulated: sendStatus='simulated', externalId=null, simulated=true", async () => {
    sendSpy.mockResolvedValueOnce({
      ok: true,
      simulated: true,
      externalId: null,
      simulationId: "sim-manual",
      externalRequestSent: false,
    });
    const out = await runManualFollowup({
      companyId: "company-1",
      userId: "user-1",
      conversationId: "conv-1",
    });
    expect(out).toMatchObject({
      eligible: true,
      sendStatus: "simulated",
      simulated: true,
      simulationId: "sim-manual",
      externalId: null,
    });
    expect(fup()).toMatchObject({ status: "simulated", trigger_reason: "manual_admin" });
    expect(fup().metadata.external_id).toBeUndefined();
  });

  it("real: sendStatus='sent', simulated=false, externalId preservado", async () => {
    sendSpy.mockResolvedValueOnce({ ok: true, simulated: false, externalId: "wamid.MAN" });
    const out = await runManualFollowup({
      companyId: "company-1",
      userId: "user-1",
      conversationId: "conv-1",
    });
    expect(out).toMatchObject({ sendStatus: "sent", simulated: false, externalId: "wamid.MAN" });
    expect(fup().metadata.external_id).toBe("wamid.MAN");
  });
});

describe("reativação — via template, simulação não marca reactivated_at", () => {
  beforeEach(() => {
    liveConversation("conv-r", "lead-r");
    tableRows.leads = [
      {
        id: "lead-r",
        company_id: "company-1",
        name: "Bruno",
        status: "novo",
        updated_at: "2020-01-01",
      },
    ];
    tableRows.follow_ups = [];
    // Lead parado há semanas: sempre fora da janela de 24h.
    window24h.outside = true;
  });

  it("simulated: follow_up 'simulated', leads intocado, out.simulated++", async () => {
    templateSpy.mockResolvedValueOnce({
      ok: true,
      simulated: true,
      externalId: null,
      simulationId: "sim-react",
    });
    const out = await runReactivation("company-1");
    expect(out).toMatchObject({ sent: 0, simulated: 1 });
    expect(sendSpy).not.toHaveBeenCalled(); // nada de texto livre fora da janela
    expect(fup()).toMatchObject({
      status: "simulated",
      trigger_reason: "reactivation",
      rule_type: "returning_customer",
    });
    expect(fup().metadata.simulation_id).toBe("sim-react");
    expect(updated.some((u) => u.table === "leads")).toBe(false);
  });

  it("real: status 'sent' + reactivated_at + out.sent++", async () => {
    templateSpy.mockResolvedValueOnce({ ok: true, simulated: false, externalId: "wamid.REACT" });
    const out = await runReactivation("company-1");
    expect(out).toMatchObject({ sent: 1, simulated: 0 });
    expect(fup().metadata.external_id).toBe("wamid.REACT");
    expect((updated.find((u) => u.table === "leads")?.patch as any).reactivated_at).toBeDefined();
  });

  it("dedupe: simulação recente do mesmo lead → pulado sem enviar", async () => {
    tableRows.follow_ups = [
      {
        id: "prev-sim",
        company_id: "company-1",
        lead_id: "lead-r",
        rule_type: "returning_customer",
        status: "simulated",
      },
    ];
    const out = await runReactivation("company-1");
    expect(out).toMatchObject({ sent: 0, simulated: 0 });
    expect(out.skipped[0]?.reason).toBe("reativação já simulada");
    expect(templateSpy).not.toHaveBeenCalled();
  });
});
