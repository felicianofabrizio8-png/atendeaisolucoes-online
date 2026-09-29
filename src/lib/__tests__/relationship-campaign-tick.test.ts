// Passo das Campanhas de Relacionamento no runtime-tick: kill switch, só
// campanhas automáticas ativadas, dedupe/lock por empresa, falhas isoladas.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  campaigns: [] as Array<Record<string, unknown>>,
  filters: [] as Array<[string, unknown]>,
  queryError: null as null | { message: string },
  realSend: true,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      expect(table).toBe("relationship_campaigns");
      const chain: any = {
        select: () => chain,
        eq: (c: string, v: unknown) => (state.filters.push([c, v]), chain),
        then: (cb: any) =>
          cb(
            state.queryError
              ? { data: null, error: state.queryError }
              : {
                  data: state.campaigns.filter((r) => state.filters.every(([c, v]) => r[c] === v)),
                  error: null,
                },
          ),
      };
      return chain;
    },
  },
}));

const runtime = vi.hoisted(() => ({
  tryDedupe: vi.fn(),
  tryAcquireLock: vi.fn(),
  releaseLock: vi.fn(),
  auditRuntimeEvent: vi.fn(),
}));
vi.mock("@/lib/runtime/RuntimeStateStore.server", () => runtime);

const runner = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/relationship-campaign-dispatcher.server", () => ({
  realSendIsEnabled: () => state.realSend,
  runAutomaticRelationshipBatch: runner.run,
}));

import { runRelationshipCampaignTick } from "../relationship-campaign-tick.server";

const NOW = new Date("2026-09-28T16:00:00.000Z");
const campaign = (id: string, companyId: string, over: Record<string, unknown> = {}) => ({
  id,
  company_id: companyId,
  status: "ready",
  dispatch_mode: "automatic",
  automatic_enabled: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.filters = [];
  state.queryError = null;
  state.realSend = true;
  state.campaigns = [
    campaign("a1", "c1"),
    campaign("a2", "c1"),
    campaign("b1", "c2"),
    campaign("m1", "c3", { dispatch_mode: "manual", automatic_enabled: false }),
    campaign("p1", "c3", { automatic_enabled: false }),
    campaign("d1", "c4", { status: "paused" }),
  ];
  runtime.tryDedupe.mockResolvedValue(true);
  runtime.tryAcquireLock.mockResolvedValue(true);
  runner.run.mockImplementation(async () => ({
    status: "ran",
    results: [{ status: "sent" }, { status: "blocked" }],
  }));
});

describe("runRelationshipCampaignTick", () => {
  it("kill switch desligado: não consulta nem roda nada", async () => {
    state.realSend = false;
    const r = await runRelationshipCampaignTick({ now: NOW });
    expect(r.status).toBe("real_send_disabled");
    expect(state.filters).toEqual([]);
    expect(runner.run).not.toHaveBeenCalled();
    expect(runtime.tryDedupe).not.toHaveBeenCalled();
  });

  it("só campanhas automatic + automatic_enabled + ready, agrupadas por empresa", async () => {
    const r: any = await runRelationshipCampaignTick({ now: NOW });
    expect(state.filters).toEqual([
      ["dispatch_mode", "automatic"],
      ["automatic_enabled", true],
      ["status", "ready"],
    ]);
    expect(runner.run.mock.calls.map((c) => [c[0].companyId, c[0].relationshipCampaignId])).toEqual(
      [
        ["c1", "a1"],
        ["c1", "a2"],
        ["c2", "b1"],
      ],
    );
    expect(r.companies.map((c: any) => c.companyId)).toEqual(["c1", "c2"]);
    expect(r.companies[0].campaigns[0]).toMatchObject({
      campaignId: "a1",
      status: "ran",
      counts: { sent: 1, blocked: 1 },
    });
  });

  it("dedupe e lock por empresa; lock sempre liberado", async () => {
    await runRelationshipCampaignTick({ now: NOW });
    const bucket = Math.floor(NOW.getTime() / 300_000);
    expect(runtime.tryDedupe).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "relationship-campaign-tick",
        resourceKey: "c1",
        companyId: "c1",
        bucket,
      }),
    );
    expect(runtime.tryAcquireLock).toHaveBeenCalledWith(
      expect.objectContaining({ lockKey: "relationship-campaigns:c1", companyId: "c1" }),
    );
    expect(runtime.releaseLock).toHaveBeenCalledTimes(2);
    expect(runtime.auditRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "c1", action: "relationship_campaign_tick" }),
    );
  });

  it("mesma janela já processada (dedupe) ou lock ocupado: empresa pulada", async () => {
    runtime.tryDedupe.mockImplementation(async (p: any) => p.resourceKey !== "c1");
    runtime.tryAcquireLock.mockImplementation(async (p: any) => p.companyId !== "c2");
    const r: any = await runRelationshipCampaignTick({ now: NOW });
    expect(r.companies).toEqual([
      { companyId: "c1", status: "duplicate_prevented" },
      { companyId: "c2", status: "lock_denied" },
    ]);
    expect(runner.run).not.toHaveBeenCalled();
    expect(runtime.releaseLock).not.toHaveBeenCalled();
  });

  it("falha numa campanha não derruba as outras e libera o lock", async () => {
    runner.run.mockImplementation(async (i: any) => {
      if (i.relationshipCampaignId === "a1") throw new Error("boom");
      return { status: "ran", results: [] };
    });
    const r: any = await runRelationshipCampaignTick({ now: NOW });
    expect(r.companies[0].campaigns).toEqual([
      { campaignId: "a1", status: "error", error: "boom" },
      expect.objectContaining({ campaignId: "a2", status: "ran" }),
    ]);
    expect(runner.run).toHaveBeenCalledTimes(3);
    expect(runtime.releaseLock).toHaveBeenCalledTimes(2);
  });

  it("consulta falha (ex.: migration não aplicada): não roda nada", async () => {
    state.queryError = { message: 'column "dispatch_mode" does not exist' };
    const r: any = await runRelationshipCampaignTick({ now: NOW });
    expect(r).toMatchObject({ status: "error" });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("orçamento de tempo esgotado: empresas restantes ficam para o próximo tick", async () => {
    const r: any = await runRelationshipCampaignTick({ now: NOW, budgetMs: -1 });
    expect(r.companies.every((c: any) => c.status === "deferred")).toBe(true);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("repassa o prazo ao lote de cada campanha", async () => {
    await runRelationshipCampaignTick({ now: NOW });
    expect(runner.run.mock.calls[0][0]).toMatchObject({ now: NOW, deadlineAt: expect.any(Number) });
  });
});
