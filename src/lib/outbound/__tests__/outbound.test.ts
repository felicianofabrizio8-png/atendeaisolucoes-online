import { describe, it, expect, vi } from "vitest";
import { postGraph } from "../MetaOutbound.server";
import type { OutboundResult } from "../MetaOutboundContract";
import { isSimulation, isRealDelivery, isFailure } from "../MetaOutboundContract";

const COMPANY = "22222222-2222-2222-2222-222222222222";

function fakeResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("MetaOutbound.postGraph", () => {
  it("guard bloqueou → retorna simulação, nunca chama fetch", async () => {
    const fetchSpy = vi.fn();
    const r: OutboundResult = await postGraph({
      companyId: COMPANY,
      action: "whatsapp.send.text",
      url: "https://graph.facebook.com/v20.0/x/messages",
      body: JSON.stringify({ to: "+5511999998888", text: "olá" }),
      guardDeps: {
        isEnabled: async () => true,
        lookupEnv: async () => ({ ok: true, environment: "staging", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "sim-1" }),
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(isSimulation(r)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    if (!isSimulation(r)) throw new Error("unreachable");
    expect(r.externalRequestSent).toBe(false);
    expect(r.simulationId).toBe("sim-1");
    expect(r.would.url).toContain("graph.facebook.com");
    expect(r.would.method).toBe("POST");
  });

  it("guard bloqueou por lookup_failed → simulação com env=unknown, sem fetch", async () => {
    const fetchSpy = vi.fn();
    const r = await postGraph({
      companyId: COMPANY,
      action: "whatsapp.send.text",
      url: "https://graph.facebook.com/v20.0/x/messages",
      guardDeps: {
        isEnabled: async () => true,
        lookupEnv: async () => ({ ok: false, reason: "not_found" }),
        logger: async () => ({ ok: true, id: null }),
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(isSimulation(r)).toBe(true);
    if (!isSimulation(r)) throw new Error("unreachable");
    expect(r.environment).toBe("unknown");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("logger falhou em staging → SIMULAÇÃO com id=null; fetch NUNCA chamado", async () => {
    const fetchSpy = vi.fn();
    const r = await postGraph({
      companyId: COMPANY,
      action: "whatsapp.send.text",
      url: "https://graph.facebook.com/v20.0/x/messages",
      guardDeps: {
        isEnabled: async () => true,
        lookupEnv: async () => ({ ok: true, environment: "staging", cachedAt: 0 }),
        logger: async () => ({ ok: false, id: null, error: "db down" }),
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(isSimulation(r)).toBe(true);
    if (!isSimulation(r)) throw new Error("unreachable");
    expect(r.simulationId).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("production com flag ON → chama fetch com mesmos url/method/headers/body", async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      // Preserva assinatura do request idêntica ao caminho legado.
      expect(url).toBe("https://graph.facebook.com/v20.0/PHONE_ID/messages");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer EAAG-real");
      expect(init.body).toBe(JSON.stringify({ to: "999", text: "oi" }));
      return fakeResponse(200, { messages: [{ id: "wamid.XYZ" }] });
    });
    const r = await postGraph({
      companyId: COMPANY,
      action: "whatsapp.send.text",
      url: "https://graph.facebook.com/v20.0/PHONE_ID/messages",
      headers: { Authorization: "Bearer EAAG-real", "Content-Type": "application/json" },
      body: JSON.stringify({ to: "999", text: "oi" }),
      extractExternalId: (j) =>
        (j as { messages?: Array<{ id: string }> }).messages?.[0]?.id ?? null,
      guardDeps: {
        isEnabled: async () => true,
        lookupEnv: async () => ({ ok: true, environment: "production", cachedAt: 0 }),
        logger: async () => {
          throw new Error("logger não deveria ser chamado em production");
        },
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(isRealDelivery(r)).toBe(true);
    if (!isRealDelivery(r)) throw new Error("unreachable");
    expect(r.externalId).toBe("wamid.XYZ");
    expect(r.externalRequestSent).toBe(true);
    expect(r.environment).toBe("production");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("kill switch OFF (legacy/Solário) → chama fetch idêntico, environment=legacy", async () => {
    const fetchSpy = vi.fn(async () => fakeResponse(200, { messages: [{ id: "wamid.A" }] }));
    const r = await postGraph({
      companyId: COMPANY,
      action: "whatsapp.send.text",
      url: "https://graph.facebook.com/v20.0/x/messages",
      headers: { Authorization: "Bearer EAAG" },
      body: '{"to":"1"}',
      guardDeps: {
        isEnabled: async () => false,
        lookupEnv: async () => ({ ok: true, environment: "staging", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "x" }),
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(isRealDelivery(r)).toBe(true);
    if (!isRealDelivery(r)) throw new Error("unreachable");
    expect(r.environment).toBe("legacy");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("provider retornou 4xx → OutboundFailure retryable=false", async () => {
    const fetchSpy = vi.fn(
      async () => fakeResponse(400, { error: { message: "invalid recipient" } }),
    );
    const r = await postGraph({
      companyId: COMPANY,
      action: "whatsapp.send.text",
      url: "https://graph.facebook.com/v20.0/x/messages",
      guardDeps: {
        isEnabled: async () => false,
        lookupEnv: async () => ({ ok: true, environment: "production", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "x" }),
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(isFailure(r)).toBe(true);
    if (!isFailure(r)) throw new Error("unreachable");
    expect(r.retryable).toBe(false);
    expect(r.externalRequestSent).toBe(true);
    expect(r.status).toBe(400);
    expect(r.error).toBe("invalid recipient");
  });

  it("provider retornou 429 → retryable=true", async () => {
    const r = await postGraph({
      companyId: COMPANY,
      action: "whatsapp.send.text",
      url: "https://graph.facebook.com/v20.0/x/messages",
      guardDeps: {
        isEnabled: async () => false,
        lookupEnv: async () => ({ ok: true, environment: "production", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "x" }),
      },
      fetchImpl: (async () => fakeResponse(429, { error: { message: "too many" } })) as unknown as typeof fetch,
    });
    expect(isFailure(r)).toBe(true);
    if (!isFailure(r)) throw new Error("unreachable");
    expect(r.retryable).toBe(true);
  });

  it("erro de rede → OutboundFailure sem request enviado, retryable=true", async () => {
    const r = await postGraph({
      companyId: COMPANY,
      action: "whatsapp.send.text",
      url: "https://graph.facebook.com/v20.0/x/messages",
      guardDeps: {
        isEnabled: async () => false,
        lookupEnv: async () => ({ ok: true, environment: "production", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "x" }),
      },
      fetchImpl: (async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
    });
    expect(isFailure(r)).toBe(true);
    if (!isFailure(r)) throw new Error("unreachable");
    expect(r.retryable).toBe(true);
    expect(r.externalRequestSent).toBe(false);
    expect(r.error).toContain("ECONNRESET");
  });

  it("falha 4xx JSON → rawBody preserva texto original, parsedBody = objeto, providerError e status corretos", async () => {
    const rawText = '{"error":{"message":"bad audio","code":100,"error_subcode":2494048,"fbtrace_id":"ABC"}}';
    const fetchSpy = vi.fn(async () =>
      new Response(rawText, {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    const r = await postGraph({
      companyId: COMPANY,
      action: "whatsapp.send.audio",
      url: "https://graph.facebook.com/v20.0/x/messages",
      guardDeps: {
        isEnabled: async () => false,
        lookupEnv: async () => ({ ok: true, environment: "production", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "x" }),
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(isFailure(r)).toBe(true);
    if (!isFailure(r)) throw new Error("unreachable");
    expect(r.rawBody).toBe(rawText);
    expect(r.parsedBody).toEqual(JSON.parse(rawText));
    expect((r.providerError as { code?: number })?.code).toBe(100);
    expect(r.status).toBe(400);
    expect(r.error).toBe("bad audio");
  });

  it("falha com corpo NÃO-JSON → rawBody preservado integralmente, parsedBody=null", async () => {
    const rawText = "upstream 502 gateway";
    const fetchSpy = vi.fn(async () =>
      new Response(rawText, { status: 502, headers: { "content-type": "text/plain" } }),
    );
    const r = await postGraph({
      companyId: COMPANY,
      action: "whatsapp.send.audio",
      url: "https://graph.facebook.com/v20.0/x/messages",
      guardDeps: {
        isEnabled: async () => false,
        lookupEnv: async () => ({ ok: true, environment: "production", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "x" }),
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(isFailure(r)).toBe(true);
    if (!isFailure(r)) throw new Error("unreachable");
    expect(r.rawBody).toBe(rawText);
    expect(r.parsedBody).toBeNull();
    expect(r.status).toBe(502);
    expect(r.retryable).toBe(true);
  });

  it("simulação staging → NÃO fabrica rawBody/parsedBody", async () => {
    const r = await postGraph({
      companyId: COMPANY,
      action: "whatsapp.send.audio",
      url: "https://graph.facebook.com/v20.0/x/messages",
      guardDeps: {
        isEnabled: async () => true,
        lookupEnv: async () => ({ ok: true, environment: "staging", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "sim-1" }),
      },
      fetchImpl: (async () => {
        throw new Error("não deveria ser chamado");
      }) as unknown as typeof fetch,
    });
    expect(isSimulation(r)).toBe(true);
    const asAny = r as unknown as Record<string, unknown>;
    expect(asAny.rawBody).toBeUndefined();
    expect(asAny.parsedBody).toBeUndefined();
  });

  it("erro de rede → NÃO fabrica rawBody (fetch nunca completou)", async () => {
    const r = await postGraph({
      companyId: COMPANY,
      action: "whatsapp.send.audio",
      url: "https://graph.facebook.com/v20.0/x/messages",
      guardDeps: {
        isEnabled: async () => false,
        lookupEnv: async () => ({ ok: true, environment: "production", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "x" }),
      },
      fetchImpl: (async () => {
        throw new Error("ENETDOWN");
      }) as unknown as typeof fetch,
    });
    expect(isFailure(r)).toBe(true);
    if (!isFailure(r)) throw new Error("unreachable");
    expect(r.rawBody).toBeUndefined();
    expect(r.parsedBody).toBeUndefined();
    expect(r.externalRequestSent).toBe(false);
  });

  it("sucesso 200 → contrato de sucesso inalterado (sem rawBody/parsedBody)", async () => {
    const fetchSpy = vi.fn(async () => fakeResponse(200, { messages: [{ id: "wamid.OK" }] }));
    const r = await postGraph({
      companyId: COMPANY,
      action: "whatsapp.send.text",
      url: "https://graph.facebook.com/v20.0/x/messages",
      extractExternalId: (j) =>
        (j as { messages?: Array<{ id: string }> }).messages?.[0]?.id ?? null,
      guardDeps: {
        isEnabled: async () => false,
        lookupEnv: async () => ({ ok: true, environment: "production", cachedAt: 0 }),
        logger: async () => ({ ok: true, id: "x" }),
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(isRealDelivery(r)).toBe(true);
    if (!isRealDelivery(r)) throw new Error("unreachable");
    const asAny = r as unknown as Record<string, unknown>;
    expect(asAny.rawBody).toBeUndefined();
    expect(asAny.parsedBody).toBeUndefined();
    expect(r.externalId).toBe("wamid.OK");
  });
});
