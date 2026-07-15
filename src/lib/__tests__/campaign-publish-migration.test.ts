// Fase B.6.2 — Contrato de migração da publicação de campanha Meta Ads.
//
// Cobertura:
//   1) graphWrite JSON: paridade byte-a-byte com o graphFetch legado em production
//      (mesmo url, method, headers, body).
//   2) graphWrite FormData: passa o MESMO objeto FormData ao fetch — sem
//      re-serialização para JSON, sem Content-Type manual (boundary do runtime).
//   3) Staging: graphWrite curto-circuita — fetch NUNCA é chamado, nem para JSON
//      nem para FormData; logicalPayload sanitizado não vaza binário.
//   4) Guard probe upfront: assertOutbound decide antes da 1ª escrita e devolve
//      `proceed=false` em staging com `simulationId` (contrato do short-circuit).
//   5) Falha 4xx: preserva status/message/body (sem inventar sucesso).
//
// Não instancia a server fn `publishCampaign` (dependências fortes de Supabase/
// storage/jimp). A paridade da orquestração é validada em staging pelo usuário.

import { describe, it, expect, vi } from "vitest";
import { postGraph } from "@/lib/outbound/MetaOutbound.server";
import { isSimulation, isRealDelivery, isFailure } from "@/lib/outbound/MetaOutboundContract";
import { assertOutbound } from "@/lib/environment/EnvironmentGuard.server";

const COMPANY = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const GRAPH = "https://graph.facebook.com/v21.0";
const ACT_ID = "act_9999";

function fakeOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("campaign publish → MetaOutbound (Fase B.6.2)", () => {
  it("1) create_campaign JSON: production preserva url/method/headers/body idênticos", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return fakeOk({ id: "120210000000000001" });
    });
    const payload = {
      name: "Solário — teste",
      objective: "OUTCOME_LEADS",
      status: "ACTIVE",
      special_ad_categories: [],
      buying_type: "AUCTION",
      is_adset_budget_sharing_enabled: false,
    };
    const r = await postGraph<{ id: string }>({
      companyId: COMPANY,
      userId: USER,
      action: "meta.campaign.create_campaign",
      url: `${GRAPH}/${ACT_ID}/campaigns?access_token=EAAtoken`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      logicalPayload: { endpoint: `${GRAPH}/${ACT_ID}/campaigns`, payload },
      guardDeps: {
        isEnabled: async () => false,
        lookupEnv: async () => ({ ok: true, environment: "production", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "x" }),
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(isRealDelivery(r)).toBe(true);
    expect(captured.url).toBe(`${GRAPH}/${ACT_ID}/campaigns?access_token=EAAtoken`);
    expect(captured.init?.method).toBe("POST");
    expect((captured.init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(captured.init?.body).toBe(JSON.stringify(payload));
  });

  it("2) upload adimages FormData: passa o MESMO objeto fd ao fetch, sem Content-Type manual", async () => {
    let receivedBody: BodyInit | null | undefined;
    let receivedHeaders: unknown;
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      receivedBody = init.body;
      receivedHeaders = init.headers;
      return fakeOk({ images: { foo: { hash: "abc123hash" } } });
    });
    const fd = new FormData();
    fd.append("access_token", "EAAtoken");
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])], { type: "image/jpeg" });
    fd.append("source", blob, "campaign_x.jpg");

    const r = await postGraph<{ images?: Record<string, { hash: string }> }>({
      companyId: COMPANY,
      userId: USER,
      action: "meta.campaign.upload_adimages",
      url: `${GRAPH}/${ACT_ID}/adimages`,
      method: "POST",
      body: fd,
      logicalPayload: {
        endpoint: `${GRAPH}/${ACT_ID}/adimages`,
        filename: "campaign_x.jpg",
        content_type: "image/jpeg",
        size_bytes: 5,
      },
      guardDeps: {
        isEnabled: async () => false,
        lookupEnv: async () => ({ ok: true, environment: "production", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "x" }),
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(isRealDelivery(r)).toBe(true);
    // Mesma referência de FormData chega ao fetch — sem JSON.stringify.
    expect(receivedBody).toBe(fd);
    expect(receivedBody).toBeInstanceOf(FormData);
    // Nenhum Content-Type manual — boundary será gerado pelo runtime do fetch.
    expect(receivedHeaders).toBeUndefined();
    if (isRealDelivery(r)) {
      expect(r.raw?.images?.foo?.hash).toBe("abc123hash");
    }
  });

  it("3a) staging JSON: fetch NUNCA é chamado, retorna simulation", async () => {
    const fetchSpy = vi.fn();
    const r = await postGraph({
      companyId: COMPANY,
      userId: USER,
      action: "meta.campaign.create_adset",
      url: `${GRAPH}/${ACT_ID}/adsets`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "adset" }),
      guardDeps: {
        isEnabled: async () => true,
        lookupEnv: async () => ({ ok: true, environment: "staging", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "sim-adset" }),
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(isSimulation(r)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("3b) staging FormData: fetch NUNCA lê o Blob; logicalPayload sanitizado sem binário", async () => {
    const fetchSpy = vi.fn();
    let logged: unknown = null;
    const fd = new FormData();
    fd.append("access_token", "EAAsecret_STAGING");
    const bigPixels = new Uint8Array(2048).fill(0xaa);
    fd.append("source", new Blob([bigPixels], { type: "image/jpeg" }), "img.jpg");

    const r = await postGraph({
      companyId: COMPANY,
      userId: USER,
      action: "meta.campaign.upload_adimages",
      url: `${GRAPH}/${ACT_ID}/adimages`,
      method: "POST",
      body: fd,
      logicalPayload: {
        endpoint: `${GRAPH}/${ACT_ID}/adimages`,
        filename: "img.jpg",
        content_type: "image/jpeg",
        size_bytes: 2048,
      },
      guardDeps: {
        isEnabled: async () => true,
        lookupEnv: async () => ({ ok: true, environment: "staging", cachedAt: 0 }),
        logger: async (rec) => {
          logged = rec.payloadSanitized;
          return { ok: true, id: "sim-upload" };
        },
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(isSimulation(r)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    const asJson = JSON.stringify(logged);
    // logicalPayload não contém token nem binário — apenas metadados.
    expect(asJson).not.toContain("EAAsecret_STAGING");
    expect(asJson).not.toContain("aaaaaaaa"); // hex do byte 0xaa não aparece na sanitização
    expect(asJson).toContain("img.jpg");
    expect(asJson).toContain("2048");
  });

  it("4) guard probe upfront: staging → proceed=false com simulationId (contrato do short-circuit)", async () => {
    const decision = await assertOutbound(
      {
        companyId: COMPANY,
        userId: USER,
        action: "meta.campaign.publish",
        targetUrl: `${GRAPH}/${ACT_ID}/campaigns`,
        method: "POST",
        payload: {
          campaign_id: "camp-uuid",
          campaign_name: "Solário — Beta",
          ad_account_id: ACT_ID,
          page_id: "PAGE_123",
          steps_planned: ["upload_media/adimages", "create_campaign", "create_adset", "create_creative", "create_ad", "activate_campaign", "activate_adset", "activate_ad"],
        },
      },
      {
        isEnabled: async () => true,
        lookupEnv: async () => ({ ok: true, environment: "staging", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "sim-publish-main" }),
      },
    );
    expect(decision.proceed).toBe(false);
    if (decision.proceed) throw new Error("unreachable");
    expect(decision.environment).toBe("staging");
    expect(decision.simulationId).toBe("sim-publish-main");
    expect(decision.reason).toBe("staging_tenant");
  });

  it("4b) guard probe upfront: production/legacy → proceed=true", async () => {
    const decisionProd = await assertOutbound(
      { companyId: COMPANY, action: "meta.campaign.publish" },
      {
        isEnabled: async () => true,
        lookupEnv: async () => ({ ok: true, environment: "production", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "x" }),
      },
    );
    expect(decisionProd.proceed).toBe(true);

    const decisionLegacy = await assertOutbound(
      { companyId: COMPANY, action: "meta.campaign.publish" },
      {
        isEnabled: async () => false,
        lookupEnv: async () => ({ ok: true, environment: "staging", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "x" }),
      },
    );
    expect(decisionLegacy.proceed).toBe(true);
    if (decisionLegacy.proceed) {
      expect(decisionLegacy.environment).toBe("legacy");
    }
  });

  it("5) create_ad falha 4xx: status/message/parsedBody preservados", async () => {
    const rawText = JSON.stringify({
      error: { message: "Invalid parameter", code: 100, error_subcode: 1487390, fbtrace_id: "ABC" },
    });
    const fetchSpy = vi.fn(async () => new Response(rawText, {
      status: 400,
      headers: { "content-type": "application/json" },
    }));
    const r = await postGraph({
      companyId: COMPANY,
      userId: USER,
      action: "meta.campaign.create_ad",
      url: `${GRAPH}/${ACT_ID}/ads`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", adset_id: "y", creative: { creative_id: "z" }, status: "ACTIVE" }),
      guardDeps: {
        isEnabled: async () => false,
        lookupEnv: async () => ({ ok: true, environment: "production", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "x" }),
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(isFailure(r)).toBe(true);
    if (!isFailure(r)) throw new Error("unreachable");
    expect(r.status).toBe(400);
    expect(r.error).toBe("Invalid parameter");
    expect(r.rawBody).toBe(rawText);
    expect((r.parsedBody as { error?: { code?: number } })?.error?.code).toBe(100);
    // Falha 4xx não é retryable (contrato do MetaOutbound).
    expect(r.retryable).toBe(false);
  });
});
