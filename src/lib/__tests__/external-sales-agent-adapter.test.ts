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
    expect(budgets[0]["X-Request-Timeout-Ms"]).toBe("14000");
    expect(budgets[1]["X-Request-Timeout-Ms"]).toBe("750");
  });
  // Orçamento que desce do tick: o adapter usa o menor entre ele e a config.
  it("usa o orçamento restante do turno como timeout e no header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ response: "Posso ajudar?" }));
    await callExternalSalesAgent({ ...input, budgetMs: 9_000, fetchImpl });
    await callExternalSalesAgent({ ...input, budgetMs: 40_000, fetchImpl });
    const budgets = fetchImpl.mock.calls.map(([, request]) => (request as RequestInit).headers as Record<string, string>);
    expect(budgets[0]["X-Request-Timeout-Ms"]).toBe("8000");
    expect(budgets[1]["X-Request-Timeout-Ms"]).toBe("14000");
  });

  it("sem tempo útil para a Vendedora nem chama e audita budget_exhausted", async () => {
    const fetchImpl = vi.fn();
    const onResult = vi.fn();
    const result = await callExternalSalesAgent({ ...input, budgetMs: 5_999, fetchImpl, onResult });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ enabled: true, ok: false, reason: "budget_exhausted", timing: { budgetMs: 5_999, durationMs: 0 } });
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ reason: "budget_exhausted" }));
  });

  it("toda resposta da Vendedora volta com timing numérico para a auditoria", async () => {
    const onResult = vi.fn();
    const ok = await callExternalSalesAgent({ ...input, budgetMs: 12_000, onResult, fetchImpl: vi.fn().mockResolvedValue(response({ response: "Posso ajudar?" })) });
    const failed = await callExternalSalesAgent({ ...input, budgetMs: 12_000, onResult, fetchImpl: vi.fn().mockResolvedValue(response({ error: "x" }, { status: 502 })) });
    for (const result of [ok, failed]) {
      expect(result).toMatchObject({ enabled: true, timing: { budgetMs: 12_000, durationMs: expect.any(Number) } });
    }
    expect(onResult.mock.calls.map(([result]) => Object.keys((result as { timing: object }).timing).sort())).toEqual([["budgetMs", "durationMs"], ["budgetMs", "durationMs"]]);
  });
  it("registra somente código HTTP, nunca o corpo sensível do erro remoto", async () => {
    const result = await callExternalSalesAgent({ ...input, fetchImpl: vi.fn().mockResolvedValue(new Response("dados do cliente", { status: 422 })) });
    expect(result).toMatchObject({ enabled: true, ok: false, reason: "http_error", httpStatus: 422 });
    expect(JSON.stringify(result)).not.toContain("dados do cliente");
  });
  it("distingue as formas de resposta inválida sem salvar seu conteúdo", async () => {
    const malformed = await callExternalSalesAgent({ ...input, fetchImpl: vi.fn().mockResolvedValue(new Response("não-json")) });
    const shape = await callExternalSalesAgent({ ...input, fetchImpl: vi.fn().mockResolvedValue(response(["unexpected"])) });
    const decision = await callExternalSalesAgent({ ...input, fetchImpl: vi.fn().mockResolvedValue(response({ response: "x", selected_products: ["outro"] })) });
    expect([malformed, shape, decision].map((result) => result.enabled && !result.ok && result.invalidResponseCode))
      .toEqual(["invalid_json", "invalid_shape", "invalid_decision"]);
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

  it("audita external_fallback e rejeita timeout remoto acima de 15000 ms", async () => {
    const onResult = vi.fn();
    const result = await callExternalSalesAgent({ ...input, env: { ...input.env, EXTERNAL_SALES_AGENT_TIMEOUT_MS: "15001" }, onResult });
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
      { id: "p1", name: "Produto", description: "", price: 10, currency: "BRL", category: "", features: ["a: 1"], available: true, source: "catalog" },
    ]);
  });

  // Contrato universal de produto: os atributos comerciais de Produtos chegam à
  // standalone como fatos "Rótulo: valor" (normalizeProductFacts), em qualquer segmento.
  it("envia os atributos comerciais de Produtos em features, para qualquer segmento", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ response: "Posso ajudar?" }));
    const catalog = [
      { id: "pool-7", name: "Piscina Fibra 7", category: "Piscinas", description: "Piscina de fibra.", price: 18990, promoPrice: 16990, images: [], notes: null,
        model: "PF-7", sku: null, lengthM: 7, widthM: 3.5, depthM: 1.4, capacityL: null, shape: "retangular",
        specifications: { Cor: { type: "text", value: "azul" } }, includedItems: ["filtro", "escada"], variants: [] },
      { id: "net-500", name: "Plano Fibra", category: "Internet", description: "Internet residencial.", price: 129, promoPrice: null, images: [], notes: "Instalação em até 5 dias úteis.",
        specifications: { Velocidade: { type: "number", value: 500, unit: "Mbps" }, "Wi-Fi 6": { type: "boolean", value: true } }, includedItems: [], variants: [{ nome: "Mensal" }, { nome: "Anual" }] },
      { id: "solar-6", name: "Kit Solar", category: "Energia", description: "Kit fotovoltaico.", price: 18000, promoPrice: null, images: [], notes: null,
        specifications: { Potência: { type: "number", value: 6, unit: "kWp" }, "Geração mensal": { type: "range", value: { min: 650, max: 780 }, unit: "kWh" } } },
      { id: "curso-40", name: "Curso de Vendas", category: "Cursos", description: "Online.", price: 400, promoPrice: null, images: [], notes: null,
        specifications: { "Carga horária": { type: "number", value: 40, unit: "h" } } },
    ];
    await callExternalSalesAgent({ ...input, context: withCatalog(catalog), fetchImpl });
    const features = Object.fromEntries((sentPayload(fetchImpl).catalog as Array<{ id: string; features: string[] }>).map((item) => [item.id, item.features]));
    expect(features).toEqual({
      "pool-7": ["Modelo: PF-7", "Preço promocional: R$ 16.990,00", "Comprimento: 7 m", "Largura: 3,5 m", "Profundidade: 1,4 m",
        "Medidas (C x L x P): 7 x 3,5 x 1,4 m", "Formato: retangular", "Cor: azul", "Itens inclusos: filtro, escada"],
      "net-500": ["Velocidade: 500 mbps", "Wi-Fi 6: sim", "Variantes: Mensal, Anual", "Observações: Instalação em até 5 dias úteis."],
      "solar-6": ["Potência: 6 kwp", "Geração mensal: 650 a 780 kWh"],
      "curso-40": ["Carga horária: 40 h"],
    });
    // Nenhum campo próprio é repetido em features.
    for (const list of Object.values(features)) expect(list.some((item) => /^(Nome|Categoria|Preço|Descrição):/.test(item))).toBe(false);
  });

  it("produtos sem atributos opcionais (cadastros antigos) seguem com features vazio", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ response: "Posso ajudar?" }));
    await callExternalSalesAgent({ ...input, context: withCatalog([{ id: "p1", name: "Produto", category: "c", description: "d", price: 10 }]), fetchImpl });
    expect(sentPayload(fetchImpl).catalog).toEqual([{ id: "p1", name: "Produto", description: "d", price: 10, currency: "BRL", category: "c", features: [], available: true, source: "catalog" }]);
  });

  it("atributo em conflito com o campo oficial não vira fato", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ response: "Posso ajudar?" }));
    const catalog = [{ id: "p1", name: "Produto", category: null, description: null, price: 10, promoPrice: null, images: [], notes: null, lengthM: 7, specifications: { Comprimento: "8 m" } }];
    await callExternalSalesAgent({ ...input, context: withCatalog(catalog), fetchImpl });
    expect((sentPayload(fetchImpl).catalog as Array<{ features: string[] }>)[0].features).toEqual(["Comprimento: 7 m"]);
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
