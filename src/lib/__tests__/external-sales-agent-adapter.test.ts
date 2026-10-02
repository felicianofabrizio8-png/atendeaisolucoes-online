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
  it("informa à standalone o orçamento do turno descontando a rede", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ response: "Posso ajudar?" }));
    await callExternalSalesAgent({ ...input, fetchImpl });
    await callExternalSalesAgent({ ...input, env: { ...input.env, EXTERNAL_SALES_AGENT_TIMEOUT_MS: "1500" }, fetchImpl });
    const budgets = fetchImpl.mock.calls.map(([, request]) => (request as RequestInit).headers as Record<string, string>);
    expect(budgets[0]["X-Request-Timeout-Ms"]).toBe("9000");
    expect(budgets[1]["X-Request-Timeout-Ms"]).toBe("750");
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

  it("normaliza lastCatalogQuery estruturado para o contrato string/null da standalone", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ response: "Posso ajudar?", selected_products: ["p1"] }));
    const result = await callExternalSalesAgent({
      ...input,
      nextCatalogQuery: { status: "matches", criteria: { widthM: 3 }, referencedProductIds: ["p1"] },
      fetchImpl,
    });
    expect(result).toMatchObject({ enabled: true, ok: true });
    const [, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body)).next_catalog_query).toBeNull();
  });

  // Espelha _request_from_payload/Product.from_dict de vendedora/http_api.py: qualquer
  // divergência aqui vira HTTP 400 na standalone.
  function sentPayload(fetchImpl: ReturnType<typeof vi.fn>) {
    const [, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    return JSON.parse(String(request.body)) as Record<string, unknown>;
  }
  function withCatalog(catalog: unknown[]) {
    return { ...context, grounding: { ...context.grounding, catalog } } as unknown as AgentContextBase;
  }

  it("envia todos os campos obrigatórios da standalone com os tipos esperados", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ response: "Posso ajudar?" }));
    await callExternalSalesAgent({ ...input, leadName: undefined as unknown as null, commercialState: [], fetchImpl });
    const body = sentPayload(fetchImpl);
    for (const key of ["company_id", "message", "history", "lead_name", "catalog", "commercial_state", "next_catalog_query", "authorized_context"]) expect(body).toHaveProperty(key);
    expect(body).toMatchObject({ company_id: "company-1", message: "Quero o produto", lead_name: null, commercial_state: {}, next_catalog_query: null });
    expect(body.authorized_context).toEqual(expect.any(Object));
  });

  it("envia só produtos com preço numérico e sem null que vire o fato \"None\"", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ response: "Posso ajudar?", selected_products: ["p1"] }));
    const catalog = [
      { id: "p1", name: "Produto", category: null, description: null, price: 10, promoPrice: null, images: ["x"], notes: null, specifications: { a: 1 } },
      { id: "p2", name: "Sob consulta", category: "c", description: "d", price: null, promoPrice: 5, images: [], notes: null },
      { id: "p3", name: "", category: null, description: null, price: 3, promoPrice: null, images: [], notes: null },
    ];
    await callExternalSalesAgent({ ...input, context: withCatalog(catalog), fetchImpl });
    expect(sentPayload(fetchImpl).catalog).toEqual([
      { id: "p1", name: "Produto", description: "", price: 10, currency: "BRL", category: "", available: true, source: "catalog" },
    ]);
  });

  it("não aceita produto que ficou fora do catálogo enviado", async () => {
    const catalog = [
      { id: "p1", name: "Produto", category: null, description: null, price: 10, promoPrice: null, images: [], notes: null },
      { id: "p2", name: "Sob consulta", category: null, description: null, price: null, promoPrice: null, images: [], notes: null },
    ];
    const result = await callExternalSalesAgent({ ...input, context: withCatalog(catalog), fetchImpl: vi.fn().mockResolvedValue(response({ response: "x", selected_products: ["p2"] })) });
    expect(result).toMatchObject({ enabled: true, ok: false, reason: "invalid_response" });
  });

  it("usa papéis user/assistant e não duplica a mensagem atual no history", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ response: "Posso ajudar?" }));
    const history = [
      { role: "lead" as const, text: "Oi" },
      { role: "agent" as const, text: "Olá!", productIds: ["p1"] },
      { role: "lead" as const, text: " Quero o produto " },
    ];
    await callExternalSalesAgent({ ...input, history, fetchImpl });
    const body = sentPayload(fetchImpl);
    expect(body.message).toBe("Quero o produto");
    expect(body.history).toEqual([{ role: "user", text: "Oi" }, { role: "assistant", text: "Olá!", productIds: ["p1"] }]);
  });

  it("não chama a standalone sem mensagem do lead e cai no fallback", async () => {
    const fetchImpl = vi.fn();
    const onResult = vi.fn();
    const result = await callExternalSalesAgent({ ...input, history: [{ role: "agent", text: "Olá" }, { role: "lead", text: "   " }], fetchImpl, onResult });
    expect(result).toMatchObject({ enabled: true, ok: false, reason: "invalid_request" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ reason: "invalid_request" }));
  });

  it("não chama a standalone quando o corpo excede o limite dela", async () => {
    const fetchImpl = vi.fn();
    const big = { ...context, knowledge: ["x".repeat(1_000_001)] } as unknown as AgentContextBase;
    const result = await callExternalSalesAgent({ ...input, context: big, fetchImpl });
    expect(result).toMatchObject({ enabled: true, ok: false, reason: "invalid_request" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
