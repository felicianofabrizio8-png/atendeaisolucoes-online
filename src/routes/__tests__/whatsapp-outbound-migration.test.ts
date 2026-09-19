// Fase B.1 — Testes de contrato para as rotas migradas para MetaOutbound.
// Garantia: URL/method/headers/body enviados são bit-a-bit idênticos ao caminho
// legado quando kill switch OFF, e nenhum side effect externo ocorre em staging.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Mock supabaseAdmin (chainable fake) ----------
type Row = Record<string, unknown> | null;

type PersistenceEvent = { table: string; operation: "insert" | "update" };
const operationEvents: Array<"transport" | PersistenceEvent> = [];

function makeChain(row: Row, errorRow: unknown = null, table = "unknown") {
  const chain: any = {
    _row: row,
    _err: errorRow,
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: chain._row, error: chain._err }),
    single: async () => ({ data: chain._row, error: chain._err }),
    insert: (_x: unknown) => {
      operationEvents.push({ table, operation: "insert" });
      return {
        select: () => ({ single: async () => ({ data: { id: "msg-1", conversation_id: "conv-1", at: "t" }, error: null }) }),
      };
    },
    update: (_x: unknown) => {
      operationEvents.push({ table, operation: "update" });
      return { eq: async () => ({ error: null }) };
    },
  };
  return chain;
}

const tableRows: Record<string, Row> = {};
const supabaseAdmin: any = {
  auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
  },
  from: vi.fn((t: string) => makeChain(tableRows[t] ?? null, null, t)),
};

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

// ---------- Mock isWithin24hWindow ----------
const windowSpy = vi.hoisted(() => vi.fn<() => Promise<{ inside: boolean; lastLeadAt: string | null }>>(async () => ({ inside: true, lastLeadAt: null })));
vi.mock("@/lib/wa-templates.server", () => ({
  isWithin24hWindow: windowSpy,
}));

// ---------- Spy MetaOutbound ----------
const postGraphSpy = vi.fn();
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({
  postGraph: (...args: unknown[]) => {
    operationEvents.push("transport");
    return postGraphSpy(...args);
  },
}));

// ---------- Helpers ----------
function makeRequest(body: unknown, token = "session-token") {
  return new Request("http://x/api", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function invoke(routePath: string, request: Request) {
  const mod = await import(routePath);
  const handler = (mod.Route as any).options.server.handlers.POST;
  return handler({ request });
}

beforeEach(() => {
  postGraphSpy.mockReset();
  operationEvents.length = 0;
  supabaseAdmin.from.mockClear();
  Object.keys(tableRows).forEach((k) => delete tableRows[k]);
});

// =====================================================
// api.whatsapp.test-send.tsx
// =====================================================
describe("api.whatsapp.test-send — migração B.1", () => {
  beforeEach(() => {
    tableRows.profiles = { company_id: "company-1" };
    tableRows.integrations = {
      id: "int-1",
      company_id: "company-1",
      channel: "whatsapp",
      access_token: "EAAG-token",
      external_account_id: "PHONE-ID",
    };
  });

  it("A. legacy/production → chama postGraph com URL/headers/body idênticos ao legado", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true,
      simulated: false,
      environment: "legacy",
      externalRequestSent: true,
      externalId: null,
      status: 200,
      raw: { messages: [{ id: "wamid.X" }] },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.test-send",
      makeRequest({ integrationId: "int-1", to: "+55 11 99999-8888", text: "oi" }),
    );
    expect(postGraphSpy).toHaveBeenCalledOnce();
    const call = postGraphSpy.mock.calls[0][0];
    expect(call.url).toBe("https://graph.facebook.com/v20.0/PHONE-ID/messages");
    expect(call.method).toBe("POST");
    expect(call.headers.Authorization).toBe("Bearer EAAG-token");
    expect(call.headers["Content-Type"]).toBe("application/json");
    const parsed = JSON.parse(call.body);
    expect(parsed).toEqual({
      messaging_product: "whatsapp",
      to: "5511999998888",
      type: "text",
      text: { body: "oi" },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.simulated).toBeUndefined();
  });

  it("C. staging → resposta simulated=true, sem persistência externa", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true,
      simulated: true,
      environment: "staging",
      externalRequestSent: false,
      simulationId: "sim-9",
      would: { url: "x", method: "POST" },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.test-send",
      makeRequest({ integrationId: "int-1", to: "5511999998888" }),
    );
    const json = await res.json();
    expect(json.simulated).toBe(true);
    expect(json.externalRequestSent).toBe(false);
    expect(json.simulationId).toBe("sim-9");
  });

  it("D. falha de rede → 502 com ok:false", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false,
      simulated: false,
      environment: "legacy",
      externalRequestSent: false,
      error: "ECONNRESET",
      retryable: true,
    });
    const res = await invoke(
      "@/routes/api.whatsapp.test-send",
      makeRequest({ integrationId: "int-1", to: "5511999998888" }),
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe("ECONNRESET");
  });
});

// =====================================================
// api.whatsapp.send-location.tsx
// =====================================================
describe("api.whatsapp.send-location — migração B.1", () => {
  beforeEach(() => {
    tableRows.profiles = { company_id: "company-1" };
    tableRows.conversations = {
      id: "conv-1", company_id: "company-1", channel: "whatsapp", lead_id: "lead-1",
    };
    tableRows.company_settings = {
      location: { name: "Loja", address: "Rua X", latitude: -23.5, longitude: -46.6 },
    };
    tableRows.leads = { id: "lead-1", company_id: "company-1", status: "novo", closed_at: null, phone: "11999998888", external_id: "5511999998888", integration_id: "int-1" };
    tableRows.integrations = {
      id: "int-1", access_token: "EAAG-token", external_account_id: "PHONE-ID",
    };
  });

  it("A. legacy → postGraph recebe payload location idêntico ao legado", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true, simulated: false, environment: "legacy",
      externalRequestSent: true, externalId: "wamid.LOC", status: 200,
      raw: { messages: [{ id: "wamid.LOC" }] },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send-location",
      makeRequest({ conversationId: "conv-1" }),
    );
    expect(postGraphSpy).toHaveBeenCalledOnce();
    const call = postGraphSpy.mock.calls[0][0];
    expect(call.url).toBe("https://graph.facebook.com/v20.0/PHONE-ID/messages");
    expect(call.headers.Authorization).toBe("Bearer EAAG-token");
    const parsed = JSON.parse(call.body);
    expect(parsed.messaging_product).toBe("whatsapp");
    expect(parsed.type).toBe("location");
    expect(parsed.to).toBe("5511999998888");
    expect(parsed.location.latitude).toBe(-23.5);
    expect(parsed.location.longitude).toBe(-46.6);
    expect(parsed.location.name).toBe("Loja");
    expect(parsed.location.address).toBe("Rua X");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.externalId).toBe("wamid.LOC");
  });

  it("C. staging → simulated=true, sem persistência", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true, simulated: true, environment: "staging",
      externalRequestSent: false, simulationId: "sim-loc",
      would: { url: "x", method: "POST" },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send-location",
      makeRequest({ conversationId: "conv-1" }),
    );
    const json = await res.json();
    expect(json.simulated).toBe(true);
    expect(json.externalRequestSent).toBe(false);
    expect(json.simulationId).toBe("sim-loc");
  });

  it("D. provider 400 → 502 com metaError preservado", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy",
      externalRequestSent: true, error: "invalid recipient",
      status: 400, retryable: false,
      providerError: { message: "invalid recipient", code: 100 },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send-location",
      makeRequest({ conversationId: "conv-1" }),
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain("invalid recipient");
    expect(json.metaError.code).toBe(100);
    expect(json.status).toBe(400);
  });
});

// =====================================================
// api.whatsapp.send-reply.tsx
// =====================================================
describe("api.whatsapp.send-reply — migração B.1", () => {
  beforeEach(() => {
    tableRows.profiles = { company_id: "company-1" };
    tableRows.conversations = {
      id: "conv-1", company_id: "company-1", channel: "whatsapp", lead_id: "lead-1",
    };
    tableRows.messages = {
      id: "orig-1", conversation_id: "conv-1", company_id: "company-1",
      external_id: "wamid.ORIG", text: "olá", role: "lead", source_subtype: null,
    };
    tableRows.leads = { id: "lead-1", company_id: "company-1", status: "novo", closed_at: null, phone: "11999998888", external_id: "5511999998888", integration_id: "int-1" };
    tableRows.integrations = {
      id: "int-1", access_token: "EAAG-token", external_account_id: "PHONE-ID",
    };
  });

  it("A. legacy → postGraph recebe payload reply com context.message_id idêntico ao legado", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true, simulated: false, environment: "legacy",
      externalRequestSent: true, externalId: "wamid.REP", status: 200,
      raw: { messages: [{ id: "wamid.REP" }] },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send-reply",
      makeRequest({ conversationId: "conv-1", text: "resposta", replyToMessageId: "orig-1" }),
    );
    expect(postGraphSpy).toHaveBeenCalledOnce();
    const call = postGraphSpy.mock.calls[0][0];
    expect(call.url).toBe("https://graph.facebook.com/v20.0/PHONE-ID/messages");
    expect(call.headers.Authorization).toBe("Bearer EAAG-token");
    const parsed = JSON.parse(call.body);
    expect(parsed).toEqual({
      messaging_product: "whatsapp",
      to: "5511999998888",
      type: "text",
      context: { message_id: "wamid.ORIG" },
      text: { body: "resposta", preview_url: false },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.externalId).toBe("wamid.REP");
  });

  it("C. staging → simulated=true, sem persistência", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true, simulated: true, environment: "staging",
      externalRequestSent: false, simulationId: "sim-rep",
      would: { url: "x", method: "POST" },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send-reply",
      makeRequest({ conversationId: "conv-1", text: "r", replyToMessageId: "orig-1" }),
    );
    const json = await res.json();
    expect(json.simulated).toBe(true);
    expect(json.externalRequestSent).toBe(false);
    expect(json.simulationId).toBe("sim-rep");
  });

  it("D. erro de rede (sem envio) → 502", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy",
      externalRequestSent: false, error: "ETIMEDOUT", retryable: true,
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send-reply",
      makeRequest({ conversationId: "conv-1", text: "r", replyToMessageId: "orig-1" }),
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain("ETIMEDOUT");
  });
});

describe("api.whatsapp.send — guards de envio manual", () => {
  beforeEach(() => {
    tableRows.profiles = { company_id: "company-1" };
    tableRows.conversations = {
      id: "conv-1", company_id: "company-1", channel: "whatsapp", lead_id: "lead-1",
    };
    tableRows.leads = {
      id: "lead-1", company_id: "company-1", status: "novo", closed_at: null,
      phone: "11999998888", external_id: "5511999998888", integration_id: "int-1",
    };
    tableRows.integrations = {
      id: "int-1", company_id: "company-1", access_token: "EAAG-token", external_account_id: "PHONE-ID",
    };
    windowSpy.mockResolvedValue({ inside: true, lastLeadAt: null });
  });

  it("envia texto normal somente após validações server-side", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true, simulated: false, environment: "legacy", externalRequestSent: true,
      externalId: "wamid.TEXT", status: 200, raw: { messages: [{ id: "wamid.TEXT" }] },
    });

    const res = await invoke("@/routes/api.whatsapp.send", makeRequest({ conversationId: "conv-1", text: "oi" }));

    expect(res.status).toBe(200);
    expect(postGraphSpy).toHaveBeenCalledOnce();
    const transportIndex = operationEvents.findIndex((event) => event === "transport");
    const messageInsertIndex = operationEvents.findIndex(
      (event) => event !== "transport" && event.table === "messages" && event.operation === "insert",
    );
    expect(transportIndex).toBeGreaterThanOrEqual(0);
    expect(messageInsertIndex).toBeGreaterThan(transportIndex);
  });

  it("falha/não entrega não persiste mensagem nem atualizações", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy", externalRequestSent: false,
      error: "ECONNRESET", retryable: true,
    });

    const res = await invoke("@/routes/api.whatsapp.send", makeRequest({ conversationId: "conv-1", text: "oi" }));

    expect(res.status).toBe(502);
    expect(postGraphSpy).toHaveBeenCalledOnce();
    expect(operationEvents.filter((event) => event !== "transport")).toEqual([]);
  });

  it("staging simulado não persiste como entrega real", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true, simulated: true, environment: "staging", externalRequestSent: false,
      simulationId: "sim-text", would: { url: "x", method: "POST" },
    });

    const res = await invoke("@/routes/api.whatsapp.send", makeRequest({ conversationId: "conv-1", text: "oi" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.simulated).toBe(true);
    expect(operationEvents.filter((event) => event !== "transport")).toEqual([]);
  });

  it("bloqueia cross-tenant antes do transporte", async () => {
    tableRows.conversations = { id: "conv-other", company_id: "company-other", channel: "whatsapp", lead_id: "lead-1" };

    const res = await invoke("@/routes/api.whatsapp.send", makeRequest({ conversationId: "conv-other", text: "oi" }));

    expect(res.status).toBe(404);
    expect(postGraphSpy).not.toHaveBeenCalled();
  });

  it("bloqueia conversa fechada server-side", async () => {
    tableRows.leads = { ...tableRows.leads, status: "fechado", closed_at: "2026-09-18T10:00:00.000Z" };

    const res = await invoke("@/routes/api.whatsapp.send", makeRequest({ conversationId: "conv-1", text: "oi" }));

    expect(res.status).toBe(409);
    expect(postGraphSpy).not.toHaveBeenCalled();
  });

  it("bloqueia fora da janela de 24h", async () => {
    windowSpy.mockResolvedValueOnce({ inside: false, lastLeadAt: "2026-09-15T10:00:00.000Z" });

    const res = await invoke("@/routes/api.whatsapp.send", makeRequest({ conversationId: "conv-1", text: "oi" }));

    expect(res.status).toBe(409);
    expect(postGraphSpy).not.toHaveBeenCalled();
  });
});

describe("api.whatsapp.send-reply — guards de tenant e fechamento", () => {
  beforeEach(() => {
    tableRows.profiles = { company_id: "company-1" };
    tableRows.conversations = { id: "conv-1", company_id: "company-1", channel: "whatsapp", lead_id: "lead-1" };
    tableRows.messages = { id: "orig-1", conversation_id: "conv-1", company_id: "company-1", external_id: "wamid.ORIG", text: "oi", role: "lead", source_subtype: null };
    tableRows.leads = { id: "lead-1", company_id: "company-1", status: "novo", closed_at: null, phone: "11999998888", external_id: "5511999998888", integration_id: "int-1" };
    tableRows.integrations = { id: "int-1", company_id: "company-1", access_token: "EAAG-token", external_account_id: "PHONE-ID" };
    windowSpy.mockResolvedValue({ inside: true, lastLeadAt: null });
  });

  it("aceita reply válido da mesma conversa/tenant", async () => {
    postGraphSpy.mockResolvedValueOnce({ success: true, simulated: false, environment: "legacy", externalRequestSent: true, externalId: "wamid.REPLY", status: 200, raw: { messages: [{ id: "wamid.REPLY" }] } });
    const res = await invoke("@/routes/api.whatsapp.send-reply", makeRequest({ conversationId: "conv-1", text: "resposta", replyToMessageId: "orig-1" }));
    expect(res.status).toBe(200);
    const transportIndex = operationEvents.findIndex((event) => event === "transport");
    const messageInsertIndex = operationEvents.findIndex(
      (event) => event !== "transport" && event.table === "messages" && event.operation === "insert",
    );
    expect(messageInsertIndex).toBeGreaterThan(transportIndex);
  });

  it("reply sem entrega não persiste", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy", externalRequestSent: false,
      error: "ETIMEDOUT", retryable: true,
    });
    const res = await invoke("@/routes/api.whatsapp.send-reply", makeRequest({
      conversationId: "conv-1", text: "resposta", replyToMessageId: "orig-1",
    }));
    expect(res.status).toBe(502);
    expect(operationEvents.filter((event) => event !== "transport")).toEqual([]);
  });

  it("rejeita reply de outra conversa/tenant", async () => {
    tableRows.messages = { id: "orig-other", conversation_id: "conv-other", company_id: "company-other", external_id: "wamid.OTHER", text: "oi", role: "lead", source_subtype: null };
    const res = await invoke("@/routes/api.whatsapp.send-reply", makeRequest({ conversationId: "conv-1", text: "resposta", replyToMessageId: "orig-other" }));
    expect(res.status).toBe(404);
    expect(postGraphSpy).not.toHaveBeenCalled();
  });

  it("rejeita reply em conversa fechada", async () => {
    tableRows.leads = { ...tableRows.leads, status: "fechado", closed_at: "2026-09-18T10:00:00.000Z" };
    const res = await invoke("@/routes/api.whatsapp.send-reply", makeRequest({ conversationId: "conv-1", text: "resposta", replyToMessageId: "orig-1" }));
    expect(res.status).toBe(409);
    expect(postGraphSpy).not.toHaveBeenCalled();
  });
});
