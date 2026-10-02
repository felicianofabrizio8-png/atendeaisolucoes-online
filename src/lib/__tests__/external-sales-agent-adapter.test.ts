import { describe, expect, it, vi } from "vitest";
import { callExternalSalesAgent } from "../external-sales-agent-adapter.server";
import type { AgentContextBase } from "../sales-agent-core";

const context = {
  settings: { company_id: "company-1", sales_agent_v2_enabled: true, sales_agent_v2_mode: "silent" },
  companyName: "Empresa", aiProfile: null, products: [], knowledge: [],
  grounding: {
    catalog: [{ id: "p1", name: "Produto", category: null, description: null, price: 10, promoPrice: null, images: [], notes: null }],
    faqKnowledge: [],
    commercialRules: { paymentMethods: null, commercialTerms: null, paymentPolicy: null, installationPolicy: null, visitPolicy: null, heatingPolicy: null, shippingPolicy: null, includedItemsPolicy: null },
    approvedCoachLearnings: [], catalogScope: { companyId: "company-1", activeOnly: true as const },
  },
} as unknown as AgentContextBase;

const input = {
  companyId: "company-1", conversationId: "conversation-1", history: [{ role: "lead" as const, text: "Quero o produto" }], leadName: null, context,
  env: { EXTERNAL_SALES_AGENT_COMPANY_IDS: "company-1", EXTERNAL_SALES_AGENT_ENDPOINT: "https://seller.example.test/decide", EXTERNAL_SALES_AGENT_API_KEY: "secret" },
};

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

describe("external sales agent adapter", () => {
  it("permanece desligado sem allowlist", async () => {
    const result = await callExternalSalesAgent({ ...input, env: { ...input.env, EXTERNAL_SALES_AGENT_COMPANY_IDS: "" } });
    expect(result).toMatchObject({ enabled: false, reason: "disabled", correlationId: expect.any(String) });
  });
  it("envia tenant, correlação, idempotência e aceita resposta válida", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ response: "Posso ajudar?", selected_products: ["p1"], next_action: "ask_budget", commercial_state: { detected_intent: "product_inquiry" } }));
    const result = await callExternalSalesAgent({ ...input, fetchImpl });
    expect(result).toMatchObject({ enabled: true, ok: true }); expect(fetchImpl).toHaveBeenCalledOnce();
    const [, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((request.headers as Record<string, string>)["X-Correlation-Id"]).toEqual(expect.any(String));
    expect((request.headers as Record<string, string>)["Idempotency-Key"]).toContain("company-1");
    expect(JSON.parse(String(request.body)).company_id).toBe("company-1");
  });
  it("rejeita produto fora do catálogo", async () => {
    const result = await callExternalSalesAgent({ ...input, fetchImpl: vi.fn().mockResolvedValue(response({ response: "x", selected_products: ["other"] })) });
    expect(result).toMatchObject({ enabled: true, ok: false, reason: "invalid_response" });
  });
  it("transforma handoff em decisão dominante", async () => {
    const result = await callExternalSalesAgent({ ...input, fetchImpl: vi.fn().mockResolvedValue(response({ handoff: { required: true, reason: "cliente pediu humano" }, selected_products: ["p1"] })) });
    expect(result).toMatchObject({ ok: true, decision: { kind: "handoff", reason: "cliente pediu humano", external_silent: true } });
  });
  it("trata handoff.required=false como resposta normal", async () => {
    const result = await callExternalSalesAgent({ ...input, fetchImpl: vi.fn().mockResolvedValue(response({ response: "Posso ajudar?", handoff: { required: false, reason: null }, selected_products: ["p1"] })) });
    expect(result).toMatchObject({ ok: true, decision: { kind: "reply", message: "Posso ajudar?", external_silent: true } });
  });
  it("mantém compatibilidade com handoff booleano", async () => {
    const handoff = await callExternalSalesAgent({ ...input, fetchImpl: vi.fn().mockResolvedValue(response({ handoff: true, selected_products: ["p1"] })) });
    const reply = await callExternalSalesAgent({ ...input, fetchImpl: vi.fn().mockResolvedValue(response({ response: "Posso ajudar?", handoff: false, selected_products: ["p1"] })) });
    expect(handoff).toMatchObject({ ok: true, decision: { kind: "handoff", external_silent: true } });
    expect(reply).toMatchObject({ ok: true, decision: { kind: "reply", message: "Posso ajudar?", external_silent: true } });
  });
  it("falha fechado para a integração e não lança timeout", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("timeout", "AbortError"));
    const result = await callExternalSalesAgent({ ...input, fetchImpl });
    expect(result).toMatchObject({ enabled: true, ok: false, reason: "timeout" });
  });
  it("audita external_disabled", async () => {
    const onResult = vi.fn();
    await callExternalSalesAgent({ ...input, env: { ...input.env, EXTERNAL_SALES_AGENT_COMPANY_IDS: "" }, onResult });
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, reason: "disabled" }));
  });

  it("audita external_fallback e rejeita timeout remoto acima de 10000 ms", async () => {
    const onResult = vi.fn();
    const result = await callExternalSalesAgent({ ...input, env: { ...input.env, EXTERNAL_SALES_AGENT_TIMEOUT_MS: "10001" }, onResult });
    expect(result).toMatchObject({ enabled: true, ok: false, reason: "config_invalid" });
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, ok: false, reason: "config_invalid" }));
  });
});
