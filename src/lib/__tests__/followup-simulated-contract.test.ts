// Fase B.4.1 — Contrato explícito de simulação nos fluxos automáticos.
//
// Verifica que cada consumidor de sendWhatsappText:
//   • em envio real → mantém persistência e side-effects legados;
//   • em simulação → não fabrica externalId, não infla contagem real,
//     não infla auto_reply_count, não seta reactivated_at e registra
//     evento/status distintos que impedem reenvio imediato.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// ---------- Fake supabaseAdmin (chainable) ----------
type Row = Record<string, unknown> | Row[] | null;
const inserted: Array<{ table: string; row: any }> = [];
const updated: Array<{ table: string; patch: any }> = [];
const tableRows: Record<string, Row> = {};

function makeChain(table: string, row: Row) {
  const filters: Array<[string, unknown]> = [];
  const chain: any = {
    _row: row,
    select: () => chain,
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return chain;
    },
    order: () => chain,
    gte: () => chain,
    lte: () => chain,
    lt: () => chain,
    is: () => chain,
    in: () => chain,
    not: () => chain,
    or: () => chain,
    limit: () => chain,
  };
  const applyFilters = (arr: Row[]) =>
    arr.filter((r) =>
      filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v),
    );
  chain.maybeSingle = async () => {
    const list = Array.isArray(chain._row)
      ? applyFilters(chain._row as Row[])
      : chain._row
        ? applyFilters([chain._row])
        : [];
    return { data: list[0] ?? null, error: null };
  };
  chain.single = chain.maybeSingle;
  chain.then = (cb: (r: { data: Row[]; error: null }) => void) =>
    cb({
      data: Array.isArray(chain._row)
        ? applyFilters(chain._row as Row[])
        : chain._row
          ? applyFilters([chain._row])
          : [],
      error: null,
    });
  chain.insert = (r: any) => {
    inserted.push({ table, row: r });
    return {
      select: () => ({ single: async () => ({ data: { id: "x" }, error: null }) }),
      then: (cb: any) => cb({ data: null, error: null }),
    };
  };
  chain.update = (patch: any) => {
    updated.push({ table, patch });
    return { eq: async () => ({ error: null }) };
  };
  return chain;
}
const supabaseAdmin: any = {
  from: vi.fn((t: string) => makeChain(t, tableRows[t] ?? null)),
};
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

// ---------- Spy sendWhatsappText ----------
const sendSpy = vi.fn();
vi.mock("@/lib/ai-agent.server", () => ({
  sendWhatsappText: (...args: unknown[]) => sendSpy(...args),
}));

beforeEach(() => {
  sendSpy.mockReset();
  inserted.length = 0;
  updated.length = 0;
  Object.keys(tableRows).forEach((k) => delete tableRows[k]);
});

// =====================================================
// followup/tick.ts
// =====================================================
describe("followup/tick — simulated não é contado como envio real", () => {
  it("simulated: insere follow_up status='simulated' + evento followup_simulated + result.simulated++", async () => {
    // Bypass dependências indiretas
    vi.doMock("@/lib/ai-readiness.server", () => ({
      getReadiness: async () => ({ status: "ativa" }),
    }));
    vi.doMock("@/lib/wa-templates.server", () => ({
      findApprovedTemplateForPurpose: async () => null,
      sendWhatsappTemplate: async () => ({ ok: true, externalId: null }),
    }));
    vi.doMock("../followup/candidates", () => ({
      findCandidates: async () => [
        {
          conversationId: "conv-1",
          leadId: "lead-1",
          rule: "lead_silent",
          lastClientMessageAt: "2026-01-01T00:00:00Z",
          signal: "cliente sumiu",
        },
      ],
    }));
    vi.doMock("../followup/safety", () => ({
      canSend: async () => ({ ok: true, attempt: 1, outsideWindow: false }),
    }));
    vi.doMock("../followup/defaults", () => ({
      firstName: (n: string) => n,
      isWithinBusinessHours: () => true,
    }));
    vi.doMock("../followup/gates", () => ({
      canSendFollowupNow: async () => ({ ok: true }),
    }));
    vi.doMock("../followup/message", () => ({
      buildMessage: async () => ({ text: "olá" }),
    }));
    vi.doMock("../followup/settings", () => ({
      getFollowupSettings: async () => ({
        enabled: true,
        businessHoursOnly: false,
        businessHoursStart: "00:00",
        businessHoursEnd: "23:59",
      }),
      getFollowupV2Settings: async () => null,
    }));

    sendSpy.mockResolvedValueOnce({
      ok: true,
      simulated: true,
      externalId: null,
      simulationId: "sim-tick",
      externalRequestSent: false,
    });

    const { runFollowupTickForCompany } = await import("@/lib/followup/tick");
    const result = await runFollowupTickForCompany("company-1");

    expect(result.sent).toBe(0);
    expect(result.simulated).toBe(1);
    expect(result.errors).toEqual([]);

    const fup = inserted.find((r) => r.table === "follow_ups")!.row;
    expect(fup.status).toBe("simulated");
    expect(fup.metadata.simulated).toBe(true);
    expect(fup.metadata.simulation_id).toBe("sim-tick");
    expect(fup.metadata.external_request_sent).toBe(false);
    // Não fabrica external_id
    expect(fup.metadata.external_id).toBeUndefined();

    const event = inserted.find((r) => r.table === "ai_flow_events")!.row;
    expect(event.event_type).toBe("followup_simulated");
    expect(event.payload.simulation_id).toBe("sim-tick");
  });

  it("real: mantém status='sent', event followup_sent e external_id preservado", async () => {
    sendSpy.mockResolvedValueOnce({
      ok: true,
      simulated: false,
      externalId: "wamid.REAL",
    });
    const { runFollowupTickForCompany } = await import("@/lib/followup/tick");
    const result = await runFollowupTickForCompany("company-1");
    expect(result.sent).toBe(1);
    expect(result.simulated).toBe(0);
    const fup = inserted.find((r) => r.table === "follow_ups")!.row;
    expect(fup.status).toBe("sent");
    expect(fup.metadata.external_id).toBe("wamid.REAL");
    const event = inserted.find((r) => r.table === "ai_flow_events")!.row;
    expect(event.event_type).toBe("followup_sent");
  });

  it("falha real: preserva status='failed' + followup_failed + result.errors", async () => {
    sendSpy.mockResolvedValueOnce({
      ok: false,
      simulated: false,
      error: "Invalid phone",
    });
    const { runFollowupTickForCompany } = await import("@/lib/followup/tick");
    const result = await runFollowupTickForCompany("company-1");
    expect(result.sent).toBe(0);
    expect(result.simulated).toBe(0);
    expect(result.errors.length).toBe(1);
    const fup = inserted.find((r) => r.table === "follow_ups")!.row;
    expect(fup.status).toBe("failed");
    expect(fup.metadata.error).toBe("Invalid phone");
  });

  // Limpa os doMocks locais para não vazarem para os describes seguintes
  // (manual/reactivation) — sem isso, o mock parcial de `../followup/settings`
  // sobrescreveria os dados reais que manual/reactivation esperam.
  afterAll(() => {
    vi.doUnmock("@/lib/ai-readiness.server");
    vi.doUnmock("@/lib/wa-templates.server");
    vi.doUnmock("../followup/candidates");
    vi.doUnmock("../followup/safety");
    vi.doUnmock("../followup/defaults");
    vi.doUnmock("../followup/gates");
    vi.doUnmock("../followup/message");
    vi.doUnmock("../followup/settings");
    vi.resetModules();
  });
});

// =====================================================
// followup/manual.ts
// =====================================================
describe("followup/manual — resposta ao admin discrimina simulação", () => {
  beforeEach(() => {
    tableRows.company_settings = {
      company_id: "company-1",
      ai_followup_enabled: true,
      ai_followup_business_hours_only: false,
      ai_agent_name: "Fabri",
      ai_followup_templates: null,
    };
    tableRows.conversations = {
      id: "conv-m",
      company_id: "company-1",
      lead_id: "lead-m",
      ai_status: null,
      ai_handling: false,
      human_takeover_at: null,
      last_message_at: new Date().toISOString(),
      lead_temperature: "morno",
    };
    tableRows.leads = { id: "lead-m", name: "Ana", product: null };
    tableRows.messages = [
      { role: "lead", at: new Date().toISOString(), conversation_id: "conv-m" },
    ];
    tableRows.follow_ups = null;
  });

  it("simulated: sendStatus='simulated', externalId=null, simulated=true", async () => {
    sendSpy.mockResolvedValueOnce({
      ok: true,
      simulated: true,
      externalId: null,
      simulationId: "sim-manual",
      externalRequestSent: false,
    });
    const { runManualFollowup } = await import("@/lib/followup/manual");
    const out = await runManualFollowup({
      companyId: "company-1",
      userId: "user-1",
      conversationId: "conv-m",
    });
    expect(out.eligible).toBe(true);
    expect(out.sendStatus).toBe("simulated");
    expect(out.simulated).toBe(true);
    expect(out.simulationId).toBe("sim-manual");
    expect(out.externalId).toBeNull();
    const fup = inserted.find((r) => r.table === "follow_ups")!.row;
    expect(fup.status).toBe("simulated");
    expect(fup.metadata.simulated).toBe(true);
    expect(fup.metadata.external_id).toBeUndefined();
  });

  it("real: sendStatus='sent', simulated=false, externalId preservado", async () => {
    sendSpy.mockResolvedValueOnce({
      ok: true,
      simulated: false,
      externalId: "wamid.MAN",
    });
    const { runManualFollowup } = await import("@/lib/followup/manual");
    const out = await runManualFollowup({
      companyId: "company-1",
      userId: "user-1",
      conversationId: "conv-m",
    });
    expect(out.sendStatus).toBe("sent");
    expect(out.simulated).toBe(false);
    expect(out.externalId).toBe("wamid.MAN");
    const fup = inserted.find((r) => r.table === "follow_ups")!.row;
    expect(fup.status).toBe("sent");
    expect(fup.metadata.external_id).toBe("wamid.MAN");
  });
});

// =====================================================
// followup/reactivation.ts
// =====================================================
describe("followup/reactivation — simulação não marca reactivated_at", () => {
  beforeEach(() => {
    // Isola dependências externas do reactivation
    vi.doMock("../followup/settings", () => ({
      getFollowupV2Settings: async () => ({
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
      }),
      getFollowupSettings: async () => null,
    }));
    vi.doMock("../followup/gates", () => ({
      canSendFollowupNow: async () => ({ ok: true }),
    }));
    vi.resetModules();

    tableRows.leads = [
      { id: "lead-r", name: "Bruno", phone: "11999", updated_at: "2020-01-01" },
    ];
    tableRows.conversations = { id: "conv-r" };
    tableRows.follow_ups = []; // nenhum simulated prévio
  });

  afterAll(() => {
    vi.doUnmock("../followup/settings");
    vi.doUnmock("../followup/gates");
    vi.resetModules();
  });




  it("simulated: insere follow_up status='simulated', NÃO atualiza leads.reactivated_at, incrementa out.simulated", async () => {
    sendSpy.mockResolvedValueOnce({
      ok: true,
      simulated: true,
      externalId: null,
      simulationId: "sim-react",
      externalRequestSent: false,
    });
    const { runReactivation } = await import("@/lib/followup/reactivation");
    const out = await runReactivation("company-1");
    expect(out.sent).toBe(0);
    expect(out.simulated).toBe(1);
    const fup = inserted.find((r) => r.table === "follow_ups")!.row;
    expect(fup.status).toBe("simulated");
    expect(fup.metadata.simulated).toBe(true);
    expect(fup.metadata.simulation_id).toBe("sim-react");
    // Não deve tocar em leads (que marcaria reactivated_at)
    expect(updated.some((u) => u.table === "leads")).toBe(false);
  });

  it("real: insere status='sent' + atualiza leads.reactivated_at + out.sent++", async () => {
    sendSpy.mockResolvedValueOnce({
      ok: true,
      simulated: false,
      externalId: "wamid.REACT",
    });
    const { runReactivation } = await import("@/lib/followup/reactivation");
    const out = await runReactivation("company-1");
    expect(out.sent).toBe(1);
    expect(out.simulated).toBe(0);
    const fup = inserted.find((r) => r.table === "follow_ups")!.row;
    expect(fup.status).toBe("sent");
    expect(fup.metadata.external_id).toBe("wamid.REACT");
    const leadPatch = updated.find((u) => u.table === "leads")?.patch as any;
    expect(leadPatch.reactivated_at).toBeDefined();
  });

  it("dedupe: se já existe follow_up simulado recente, o lead é pulado sem chamar sendWhatsappText", async () => {
    tableRows.follow_ups = [{ id: "prev-sim" }];
    const { runReactivation } = await import("@/lib/followup/reactivation");
    const out = await runReactivation("company-1");
    expect(out.sent).toBe(0);
    expect(out.simulated).toBe(0);
    expect(out.skipped[0]?.reason).toBe("reativação já simulada");
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
