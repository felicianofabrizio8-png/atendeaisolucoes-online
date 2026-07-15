// Fase B.5 — Migração mecânica de sendWhatsappTemplate para MetaOutbound.
//
// Verifica:
//  • Request idêntica ao legado (URL, headers, body, template.name, language, components).
//  • Envio real → status inserido em `messages`, conversa atualizada, template_sent logado.
//  • Falha HTTP → não persiste mensagem, preserva rawBody/parsedBody/metaError.
//  • Falha de rede → não persiste, prefixo "network: ".
//  • Simulação → não fabrica externalId, não persiste mensagem, não loga template_sent,
//    retorna simulated=true + simulationId + externalRequestSent=false.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Fake supabaseAdmin ----------
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
    return { then: (cb: any) => cb({ data: null, error: null }) };
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

// ---------- Spy postGraph ----------
const postGraphSpy = vi.fn();
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({
  postGraph: (...args: unknown[]) => postGraphSpy(...args),
}));

// ---------- Seed base ----------
function seedHappy() {
  tableRows.leads = {
    id: "lead-1",
    phone: "11999999999",
    external_id: "11999999999",
    integration_id: "int-1",
    name: "Ana",
  };
  tableRows.integrations = {
    id: "int-1",
    company_id: "c1",
    channel: "whatsapp",
    active: true,
    access_token: "TKN",
    external_account_id: "PHONE_ID",
  };
  tableRows.whatsapp_templates = {
    id: "tpl-1",
    company_id: "c1",
    integration_id: "int-1",
    meta_template_id: "MT-1",
    name: "followup_orcamento",
    language: "pt_BR",
    category: "marketing",
    status: "approved",
    components: [
      { type: "BODY", text: "Olá {{1}}, tudo bem?" },
    ],
    variables: ["var1"],
    purpose: "quote_no_reply",
    auto_use: true,
    last_synced_at: null,
    meta_payload: {},
  };
}

beforeEach(() => {
  postGraphSpy.mockReset();
  inserted.length = 0;
  updated.length = 0;
  Object.keys(tableRows).forEach((k) => delete tableRows[k]);
  seedHappy();
});

describe("sendWhatsappTemplate — paridade de request via MetaOutbound", () => {
  it("envio real: URL/headers/body idênticos ao legado + persiste mensagem + template_sent", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true,
      simulated: false,
      environment: "production",
      externalRequestSent: true,
      externalId: "wamid.TPL",
      status: 200,
      raw: { messages: [{ id: "wamid.TPL" }] },
    });

    const { sendWhatsappTemplate } = await import("@/lib/wa-templates.server");
    const out = await sendWhatsappTemplate({
      companyId: "c1",
      conversationId: "conv-1",
      leadId: "lead-1",
      purpose: "quote_no_reply",
      variables: { var1: "Ana" },
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.simulated).toBe(false);
    expect(out.externalId).toBe("wamid.TPL");

    // Paridade de request
    expect(postGraphSpy).toHaveBeenCalledTimes(1);
    const call = postGraphSpy.mock.calls[0][0];
    expect(call.action).toBe("whatsapp.send.template");
    expect(call.url).toBe("https://graph.facebook.com/v20.0/PHONE_ID/messages");
    expect(call.method).toBe("POST");
    expect(call.headers.Authorization).toBe("Bearer TKN");
    expect(call.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(call.body);
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.to).toBe("11999999999");
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("followup_orcamento");
    expect(body.template.language.code).toBe("pt_BR");
    expect(body.template.components[0].type).toBe("body");
    expect(body.template.components[0].parameters[0]).toEqual({ type: "text", text: "Ana" });

    // Persistência
    const msg = inserted.find((r) => r.table === "messages");
    expect(msg).toBeDefined();
    expect(msg!.row.external_id).toBe("wamid.TPL");
    expect(msg!.row.source_subtype).toBe("template");
    expect(updated.find((u) => u.table === "conversations")).toBeDefined();
    const evt = inserted.find(
      (r) => r.table === "ai_flow_events" && r.row.event_type === "template_sent",
    );
    expect(evt).toBeDefined();
  });

  it("simulação: não fabrica externalId, não persiste mensagem, não loga template_sent", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true,
      simulated: true,
      environment: "staging",
      externalRequestSent: false,
      simulationId: "sim-tpl",
      would: { url: "x", method: "POST" },
    });

    const { sendWhatsappTemplate } = await import("@/lib/wa-templates.server");
    const out = await sendWhatsappTemplate({
      companyId: "c1",
      conversationId: "conv-1",
      leadId: "lead-1",
      purpose: "quote_no_reply",
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.simulated).toBe(true);
    if (!out.simulated) return;
    expect(out.externalId).toBeNull();
    expect(out.simulationId).toBe("sim-tpl");
    expect(out.externalRequestSent).toBe(false);

    // Nenhuma persistência de mensagem
    expect(inserted.find((r) => r.table === "messages")).toBeUndefined();
    expect(updated.find((u) => u.table === "conversations")).toBeUndefined();
    // Não loga template_sent
    expect(
      inserted.find(
        (r) => r.table === "ai_flow_events" && r.row.event_type === "template_sent",
      ),
    ).toBeUndefined();
  });

  it("falha HTTP: preserva metaError + rawBody + parsedBody, não persiste mensagem", async () => {
    const rawBody = '{"error":{"message":"Template paused","code":132,"type":"WhatsApp","error_subcode":2494072}}';
    postGraphSpy.mockResolvedValueOnce({
      success: false,
      simulated: false,
      environment: "production",
      externalRequestSent: true,
      error: "Template paused",
      status: 400,
      retryable: false,
      providerError: { message: "Template paused" },
      rawBody,
      parsedBody: JSON.parse(rawBody),
    });

    const { sendWhatsappTemplate } = await import("@/lib/wa-templates.server");
    const out = await sendWhatsappTemplate({
      companyId: "c1",
      conversationId: "conv-1",
      leadId: "lead-1",
      purpose: "quote_no_reply",
    });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.simulated).toBe(false);
    expect(out.error).toBe("Template paused");
    expect(out.status).toBe(400);
    expect(out.rawBody).toBe(rawBody);
    expect(out.metaError?.code).toBe(132);
    expect(out.metaError?.subcode).toBe(2494072);
    expect(inserted.find((r) => r.table === "messages")).toBeUndefined();
  });

  it("falha de rede: prefixo network:, não persiste mensagem", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false,
      simulated: false,
      environment: "production",
      externalRequestSent: false,
      error: "socket hang up",
      retryable: true,
    });

    const { sendWhatsappTemplate } = await import("@/lib/wa-templates.server");
    const out = await sendWhatsappTemplate({
      companyId: "c1",
      conversationId: "conv-1",
      leadId: "lead-1",
      purpose: "quote_no_reply",
    });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("network: socket hang up");
    expect(inserted.find((r) => r.table === "messages")).toBeUndefined();
  });
});
