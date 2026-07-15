// Contrato de migração: ativação de campanha Meta → passa por MetaOutbound.
// Não faz IO real: valida shape da chamada e paridade do body form-urlencoded.

import { describe, it, expect, vi } from "vitest";
import { postGraph } from "@/lib/outbound/MetaOutbound.server";
import { isSimulation, isRealDelivery } from "@/lib/outbound/MetaOutboundContract";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const USER = "33333333-3333-3333-3333-333333333333";

function fakeOk(body: unknown = { success: true }): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("campaign activate → MetaOutbound (Fase B.6.1)", () => {
  it("production: envia POST form-urlencoded status=ACTIVE idêntico ao legado", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return fakeOk({ success: true });
    });
    const r = await postGraph({
      companyId: COMPANY,
      userId: USER,
      action: "meta.campaign.activate.campaign",
      url: "https://graph.facebook.com/v21.0/123456789",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "status=ACTIVE&access_token=EAAtoken",
      logicalPayload: { object: "campaign", id: "123456789", status: "ACTIVE" },
      guardDeps: {
        isEnabled: async () => false,
        lookupEnv: async () => ({ ok: true, environment: "production", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "x" }),
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(isRealDelivery(r)).toBe(true);
    expect(captured.url).toBe("https://graph.facebook.com/v21.0/123456789");
    expect(captured.init?.method).toBe("POST");
    expect((captured.init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(captured.init?.body).toBe("status=ACTIVE&access_token=EAAtoken");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("staging: NÃO chama fetch e retorna simulação", async () => {
    const fetchSpy = vi.fn();
    const r = await postGraph({
      companyId: COMPANY,
      userId: USER,
      action: "meta.campaign.activate.adset",
      url: "https://graph.facebook.com/v21.0/987654321",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "status=ACTIVE&access_token=EAAtoken",
      logicalPayload: { object: "adset", id: "987654321", status: "ACTIVE" },
      guardDeps: {
        isEnabled: async () => true,
        lookupEnv: async () => ({ ok: true, environment: "staging", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "sim-activate-1" }),
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(isSimulation(r)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    if (!isSimulation(r)) throw new Error("unreachable");
    expect(r.simulationId).toBe("sim-activate-1");
    expect(r.externalRequestSent).toBe(false);
  });

  it("staging: logicalPayload sanitizado nunca contém access_token", async () => {
    let logged: unknown = null;
    await postGraph({
      companyId: COMPANY,
      userId: USER,
      action: "meta.campaign.activate.ad",
      url: "https://graph.facebook.com/v21.0/555",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "status=ACTIVE&access_token=EAAsecretToken",
      logicalPayload: { object: "ad", id: "555", status: "ACTIVE" },
      guardDeps: {
        isEnabled: async () => true,
        lookupEnv: async () => ({ ok: true, environment: "staging", cachedAt: 0 }),
        logger: async (rec) => {
          logged = rec.payloadSanitized;
          return { ok: true, id: "sim-x" };
        },
      },
      fetchImpl: (async () => {
        throw new Error("não deveria ser chamado");
      }) as unknown as typeof fetch,
    });
    expect(JSON.stringify(logged)).not.toContain("EAAsecretToken");
  });
});
