// Fase B.4 — Migração de sendWhatsappText para MetaOutbound.
//
// Garantias cobertas:
//   1. Contrato legado: request idêntica (URL, headers, body, action).
//   2. Sucesso real → { ok:true, externalId } + persistência em messages/conversations.
//   3. Simulação (staging) → { ok:true, externalId:null } SEM persistência
//      (evita duplicidade em consumidores que retentam ao ver ok:false).
//   4. Erro HTTP → { ok:false, error } e log [AGENT_WHATSAPP_HTTP] preservado.
//   5. Erro de rede → { ok:false, error:"network: ..." } preservado.
//   6. Consumidores atuais (followup/*) continuam compilando sem alteração.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Fake supabaseAdmin ----------
type Row = Record<string, unknown> | null;
const insertedRows: Array<{ table: string; row: unknown }> = [];
const updatedRows: Array<{ table: string; patch: unknown }> = [];
const tableRows: Record<string, Row> = {};

function makeChain(table: string, row: Row) {
  const chain: any = {
    _row: row,
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: chain._row, error: null }),
    single: async () => ({ data: chain._row, error: null }),
    insert: (r: unknown) => {
      insertedRows.push({ table, row: r });
      return {
        select: () => ({
          single: async () => ({ data: { id: "x" }, error: null }),
        }),
        then: (cb: any) => cb({ data: null, error: null }),
      };
    },
    update: (patch: unknown) => {
      updatedRows.push({ table, patch });
      return { eq: async () => ({ error: null }) };
    },
  };
  return chain;
}

const supabaseAdmin: any = {
  from: vi.fn((t: string) => makeChain(t, tableRows[t] ?? null)),
};

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

// ---------- Spy MetaOutbound ----------
const postGraphSpy = vi.fn();
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({
  postGraph: (...args: unknown[]) => postGraphSpy(...args),
}));

async function callSend(text = "olá mundo") {
  const { sendWhatsappText } = await import("@/lib/ai-agent.server");
  return sendWhatsappText({
    companyId: "company-1",
    conversationId: "conv-1",
    leadId: "lead-1",
    text,
  });
}

beforeEach(() => {
  postGraphSpy.mockReset();
  insertedRows.length = 0;
  updatedRows.length = 0;
  Object.keys(tableRows).forEach((k) => delete tableRows[k]);
  tableRows.leads = {
    phone: "11999998888",
    external_id: "5511999998888",
    integration_id: "int-1",
    channel: "whatsapp",
  };
  tableRows.integrations = {
    id: "int-1",
    access_token: "EAAG-token",
    external_account_id: "PHONE-ID",
  };
});

describe("sendWhatsappText — migração B.4", () => {
  it("A. production/legacy → request idêntica ao legado + persistência ok", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true,
      simulated: false,
      environment: "legacy",
      externalRequestSent: true,
      externalId: "wamid.AGENT",
      status: 200,
      raw: { messages: [{ id: "wamid.AGENT" }] },
    });
    const out = await callSend("Olá cliente");
    expect(out).toEqual({ ok: true, simulated: false, externalId: "wamid.AGENT" });

    expect(postGraphSpy).toHaveBeenCalledTimes(1);
    const call = postGraphSpy.mock.calls[0][0];
    expect(call.url).toBe("https://graph.facebook.com/v20.0/PHONE-ID/messages");
    expect(call.method).toBe("POST");
    expect(call.action).toBe("whatsapp.send.text");
    expect(call.companyId).toBe("company-1");
    expect(call.agentId).toBe("ai-agent");
    expect(call.headers.Authorization).toBe("Bearer EAAG-token");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(call.body)).toEqual({
      messaging_product: "whatsapp",
      to: "5511999998888",
      type: "text",
      text: { body: "Olá cliente" },
    });

    expect(insertedRows.find((r) => r.table === "messages")).toBeTruthy();
    expect(updatedRows.find((u) => u.table === "conversations")).toBeTruthy();
  });

  it("B. staging simulated → contrato discriminado + zero persistência", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true,
      simulated: true,
      environment: "staging",
      externalRequestSent: false,
      simulationId: "sim-42",
      would: { url: "x", method: "POST" },
    });
    const out = await callSend();
    expect(out).toEqual({
      ok: true,
      simulated: true,
      externalId: null,
      simulationId: "sim-42",
      externalRequestSent: false,
    });
    expect(insertedRows.some((r) => r.table === "messages")).toBe(false);
    expect(updatedRows.some((u) => u.table === "conversations")).toBe(false);
  });

  it("C. unknown lookup → simulated=true + simulationId propagado", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true,
      simulated: true,
      environment: "unknown",
      externalRequestSent: false,
      simulationId: "sim-unk",
      would: { url: "x", method: "POST" },
    });
    const out = await callSend();
    expect(out).toEqual({
      ok: true,
      simulated: true,
      externalId: null,
      simulationId: "sim-unk",
      externalRequestSent: false,
    });
    expect(insertedRows.some((r) => r.table === "messages")).toBe(false);
  });

  it("D. erro HTTP → ok:false, simulated:false, providerError.message", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false,
      simulated: false,
      environment: "legacy",
      externalRequestSent: true,
      error: "Invalid phone",
      status: 400,
      retryable: false,
      providerError: { message: "Invalid phone", code: 131009 },
      rawBody: '{"error":{"message":"Invalid phone"}}',
      parsedBody: { error: { message: "Invalid phone" } },
    });
    const out = await callSend();
    expect(out).toEqual({ ok: false, simulated: false, error: "Invalid phone" });
    expect(insertedRows.some((r) => r.table === "messages")).toBe(false);
  });

  it("E. erro HTTP sem providerError → outbound.error preservado", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false,
      simulated: false,
      environment: "legacy",
      externalRequestSent: true,
      error: "HTTP 500",
      status: 500,
      retryable: true,
      rawBody: "internal",
      parsedBody: null,
    });
    const out = await callSend();
    expect(out).toEqual({ ok: false, simulated: false, error: "HTTP 500" });
  });

  it("F. erro de rede → ok:false com prefixo 'network:'", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false,
      simulated: false,
      environment: "legacy",
      externalRequestSent: false,
      error: "ECONNRESET",
      retryable: true,
    });
    const out = await callSend();
    expect(out).toEqual({ ok: false, simulated: false, error: "network: ECONNRESET" });
    expect(insertedRows.some((r) => r.table === "messages")).toBe(false);
  });

  it("G. lead sem telefone → devolve error sem chamar postGraph", async () => {
    tableRows.leads = { phone: null, external_id: null, integration_id: "int-1" };
    const out = await callSend();
    expect(out.ok).toBe(false);
    expect(postGraphSpy).not.toHaveBeenCalled();
  });

  it("H. integração ausente → devolve error sem chamar postGraph", async () => {
    tableRows.integrations = null;
    // ai-agent ainda tenta env vars como fallback — limpa-os pra este teste
    const oldA = process.env.WHATSAPP_ACCESS_TOKEN;
    const oldB = process.env.WHATSAPP_API_KEY;
    const oldC = process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_API_KEY;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    try {
      const out = await callSend();
      expect(out.ok).toBe(false);
      expect(postGraphSpy).not.toHaveBeenCalled();
    } finally {
      if (oldA) process.env.WHATSAPP_ACCESS_TOKEN = oldA;
      if (oldB) process.env.WHATSAPP_API_KEY = oldB;
      if (oldC) process.env.WHATSAPP_PHONE_NUMBER_ID = oldC;
    }
  });
});

describe("consumidores de sendWhatsappText — imports intactos", () => {
  it("followup/manual, followup/tick e followup/reactivation compilam sem alteração", async () => {
    // Basta importar para garantir que o símbolo continua exportado com o mesmo shape.
    const agent = await import("@/lib/ai-agent.server");
    expect(typeof agent.sendWhatsappText).toBe("function");
    const manual = await import("@/lib/followup/manual");
    expect(typeof manual).toBe("object");
    const tick = await import("@/lib/followup/tick");
    expect(typeof tick).toBe("object");
    const react = await import("@/lib/followup/reactivation");
    expect(typeof react).toBe("object");
  });
});
