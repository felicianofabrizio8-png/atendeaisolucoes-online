// Fase B.3 — Testes de contrato para as rotas migradas:
//   • api.whatsapp.send        (texto principal)
//   • api.whatsapp.templates.send (template aprovado)
//
// Garantias:
//   - URL/method/headers/body enviados ao MetaOutbound são idênticos ao legado;
//   - Em staging (simulated), nenhuma persistência de mensagem/entrega ocorre;
//   - Em erro HTTP, contrato de resposta preservado (metaError/status/rawBody);
//   - Em erro de rede, contrato de resposta preservado.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Mock supabaseAdmin (chainable fake) ----------
type Row = Record<string, unknown> | null;

const insertedRows: Array<{ table: string; row: unknown }> = [];
const updatedRows: Array<{ table: string; patch: unknown }> = [];

function makeChain(table: string, row: Row) {
  const chain: any = {
    _row: row,
    select: () => chain,
    eq: () => chain,
    or: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: chain._row, error: null }),
    single: async () => ({ data: chain._row, error: null }),
    insert: (r: unknown) => {
      insertedRows.push({ table, row: r });
      return {
        select: () => ({
          single: async () => ({
            data: { id: "msg-new", conversation_id: "conv-1", role: "agent", text: "x", at: "t" },
            error: null,
          }),
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

const tableRows: Record<string, Row> = {};
const supabaseAdmin: any = {
  auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
  },
  from: vi.fn((t: string) => makeChain(t, tableRows[t] ?? null)),
};

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

vi.mock("@/lib/wa-templates.server", async () => {
  const actual = await vi.importActual<any>("@/lib/wa-templates.server");
  return {
    ...actual,
    isWithin24hWindow: vi.fn(async () => ({ inside: true, lastLeadAt: null })),
  };
});

// ---------- Spy MetaOutbound ----------
const postGraphSpy = vi.fn();
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({
  postGraph: (...args: unknown[]) => postGraphSpy(...args),
}));

function jsonRequest(body: unknown) {
  return new Request("http://x/api", {
    method: "POST",
    headers: {
      authorization: "Bearer session-token",
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
  insertedRows.length = 0;
  updatedRows.length = 0;
  Object.keys(tableRows).forEach((k) => delete tableRows[k]);
});

// =====================================================
// api.whatsapp.send — texto principal
// =====================================================
describe("api.whatsapp.send — migração B.3 (texto)", () => {
  beforeEach(() => {
    tableRows.profiles = { company_id: "company-1" };
    tableRows.conversations = {
      id: "conv-1", company_id: "company-1", lead_id: "lead-1", channel: "whatsapp",
    };
    tableRows.leads = {
      id: "lead-1", company_id: "company-1",
      phone: "11999998888", external_id: "5511999998888", integration_id: "int-1",
    };
    tableRows.integrations = {
      id: "int-1", access_token: "EAAG-token", external_account_id: "PHONE-ID",
    };
  });

  it("A. production/legacy → URL, headers e body idênticos ao legado; persistência ok", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true, simulated: false, environment: "legacy",
      externalRequestSent: true, externalId: "wamid.TEXT", status: 200,
      raw: { messages: [{ id: "wamid.TEXT" }] },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send",
      jsonRequest({ conversationId: "conv-1", text: "Olá cliente" }),
    );
    expect(res.status).toBe(200);
    expect(postGraphSpy).toHaveBeenCalledTimes(1);
    const call = postGraphSpy.mock.calls[0][0];
    expect(call.url).toBe("https://graph.facebook.com/v20.0/PHONE-ID/messages");
    expect(call.method).toBe("POST");
    expect(call.action).toBe("whatsapp.send.text");
    expect(call.companyId).toBe("company-1");
    expect(call.headers.Authorization).toBe("Bearer EAAG-token");
    expect(call.headers["Content-Type"]).toBe("application/json");
    const bodyObj = JSON.parse(call.body);
    expect(bodyObj).toEqual({
      messaging_product: "whatsapp",
      to: "5511999998888",
      type: "text",
      text: { body: "Olá cliente" },
    });
    const json = await res.json();
    expect(json.externalId).toBe("wamid.TEXT");
    expect(insertedRows.some((r) => r.table === "messages")).toBe(true);
  });

  it("C. staging simulated → nenhuma mensagem persistida, resposta com simulated=true", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true, simulated: true, environment: "staging",
      externalRequestSent: false, simulationId: "sim-1",
      would: { url: "x", method: "POST" },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send",
      jsonRequest({ conversationId: "conv-1", text: "Olá cliente" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.simulated).toBe(true);
    expect(json.externalRequestSent).toBe(false);
    expect(json.simulationId).toBe("sim-1");
    expect(json.environment).toBe("staging");
    expect(insertedRows.some((r) => r.table === "messages")).toBe(false);
    expect(updatedRows.some((u) => u.table === "integrations")).toBe(false);
  });

  it("D1. erro HTTP → status 502, metaError e integrations.last_error atualizado", async () => {
    const rawText = '{"error":{"message":"Invalid phone","code":131009,"type":"OAuthException"}}';
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy",
      externalRequestSent: true, error: "Invalid phone", status: 400,
      retryable: false,
      providerError: { message: "Invalid phone", code: 131009, type: "OAuthException" },
      rawBody: rawText,
      parsedBody: JSON.parse(rawText),
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send",
      jsonRequest({ conversationId: "conv-1", text: "Olá" }),
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("WhatsApp API: Invalid phone");
    expect(json.metaError.code).toBe(131009);
    expect(json.status).toBe(400);
    // nenhuma persistência de mensagem em erro
    expect(insertedRows.some((r) => r.table === "messages")).toBe(false);
    // last_error atualizado
    const patch = updatedRows.find((u) => u.table === "integrations")?.patch as any;
    expect(patch.last_error).toBe("Invalid phone");
  });

  it("D2. erro de rede → status 502, mensagem 'Falha ao enviar'", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy",
      externalRequestSent: false, error: "ECONNRESET", retryable: true,
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send",
      jsonRequest({ conversationId: "conv-1", text: "Olá" }),
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("Falha ao enviar: ECONNRESET");
    expect(insertedRows.some((r) => r.table === "messages")).toBe(false);
  });
});

// =====================================================
// api.whatsapp.templates.send — template aprovado
// =====================================================
describe("api.whatsapp.templates.send — migração B.3 (template)", () => {
  beforeEach(() => {
    tableRows.profiles = { company_id: "company-1" };
    tableRows.conversations = {
      id: "conv-1", company_id: "company-1", lead_id: "lead-1",
    };
    tableRows.whatsapp_templates = {
      id: "tpl-1", company_id: "company-1",
      name: "welcome_solar", language: "pt_BR", category: "UTILITY",
      status: "approved", meta_template_id: "meta-tpl-1",
      body: "Olá {{1}}, tudo bem?",
      variables: ["nome"],
    };
    tableRows.leads = {
      id: "lead-1", company_id: "company-1",
      phone: "11999998888", external_id: "5511999998888", integration_id: "int-1",
    };
    tableRows.integrations = {
      id: "int-1", access_token: "EAAG-token", external_account_id: "PHONE-ID",
    };
  });

  it("A. production/legacy → template name/language/components idênticos ao legado", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true, simulated: false, environment: "legacy",
      externalRequestSent: true, externalId: "wamid.TPL", status: 200,
      raw: { messages: [{ id: "wamid.TPL" }] },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.templates.send",
      jsonRequest({ conversationId: "conv-1", templateId: "tpl-1", variables: { "1": "João" } }),
    );
    expect(res.status).toBe(200);
    expect(postGraphSpy).toHaveBeenCalledTimes(1);
    const call = postGraphSpy.mock.calls[0][0];
    expect(call.url).toBe("https://graph.facebook.com/v20.0/PHONE-ID/messages");
    expect(call.method).toBe("POST");
    expect(call.action).toBe("whatsapp.send.template");
    expect(call.headers.Authorization).toBe("Bearer EAAG-token");
    const bodyObj = JSON.parse(call.body);
    expect(bodyObj.messaging_product).toBe("whatsapp");
    expect(bodyObj.to).toBe("5511999998888");
    expect(bodyObj.type).toBe("template");
    expect(bodyObj.template.name).toBe("welcome_solar");
    expect(bodyObj.template.language).toEqual({ code: "pt_BR" });
    expect(Array.isArray(bodyObj.template.components)).toBe(true);
    // persistência OK
    const msg = insertedRows.find((r) => r.table === "messages")?.row as any;
    expect(msg).toBeTruthy();
    expect(msg.external_id).toBe("wamid.TPL");
    expect(msg.source).toBe("wa_template_manual");
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.externalId).toBe("wamid.TPL");
  });

  it("B. staging simulated → nenhuma persistência; ok:true + simulated:true", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true, simulated: true, environment: "staging",
      externalRequestSent: false, simulationId: "sim-tpl",
      would: { url: "x", method: "POST" },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.templates.send",
      jsonRequest({ conversationId: "conv-1", templateId: "tpl-1", variables: { "1": "João" } }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.simulated).toBe(true);
    expect(json.simulationId).toBe("sim-tpl");
    expect(insertedRows.some((r) => r.table === "messages")).toBe(false);
    expect(updatedRows.some((u) => u.table === "conversations")).toBe(false);
  });

  it("C1. erro HTTP → status preservado (ex.: 400) e mensagem do provider", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy",
      externalRequestSent: true, error: "Template not approved", status: 400,
      retryable: false,
      providerError: { message: "Template not approved", code: 132001 },
      rawBody: '{"error":{"message":"Template not approved","code":132001}}',
      parsedBody: { error: { message: "Template not approved", code: 132001 } },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.templates.send",
      jsonRequest({ conversationId: "conv-1", templateId: "tpl-1" }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Template not approved");
    expect(insertedRows.some((r) => r.table === "messages")).toBe(false);
  });

  it("C2. erro de rede → status 502, mensagem 'network: ...'", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy",
      externalRequestSent: false, error: "ETIMEDOUT", retryable: true,
    });
    const res = await invoke(
      "@/routes/api.whatsapp.templates.send",
      jsonRequest({ conversationId: "conv-1", templateId: "tpl-1" }),
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("network: ETIMEDOUT");
  });
});
