import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, fetchMock, listLearningCandidates, retrieveLearnings } = vi.hoisted(() => ({
  from: vi.fn(),
  fetchMock: vi.fn(),
  listLearningCandidates: vi.fn(),
  retrieveLearnings: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
vi.mock("../coach-learnings/coach-learnings.repository", () => ({ listLearningCandidates }));
vi.mock("../coach-learnings/retriever", () => ({ retrieveLearnings }));
vi.mock("../sales-agent-config.server", () => ({
  resolveSalesAgentLlmConfig: () => ({
    ok: true,
    config: {
      endpoint: "https://gateway.test/v1/chat/completions",
      model: "provider/sales-model",
      apiKey: "test-key",
    },
  }),
}));

import { runAgentTurn } from "../ai-agent.server";
import { SalesAgentCore, type AgentContext } from "../sales-agent-core";

const companyId = "company-1";

const context: AgentContext = {
  settings: {
    company_id: companyId,
    ai_auto_reply_enabled: true,
    ai_after_hours_only: false,
    ai_initial_message: null,
    ai_max_auto_replies: 3,
    ai_handoff_timeout_minutes: 30,
    ai_agent_name: "Ana",
    business_hours_start: "08:00:00",
    business_hours_end: "18:00:00",
  },
  companyName: "Solário Piscinas",
  aiProfile: {
    tone: "consultivo",
    description: "Venda de piscinas",
    products: null,
    payment_methods: "Pix e cartão",
    avg_lead_time: null,
    region: "SP",
    differentials: null,
    faq: [],
  },
  products: [
    {
      id: "product-1",
      name: "Piscina 6x3",
      model: "Modelo 6x3",
      category: "Piscinas de fibra",
      description: "Piscina de fibra",
      price: 20_000,
      promoPrice: null,
      images: [],
      notes: null,
    },
  ],
  knowledge: [],
  grounding: {
    catalog: [
      {
        id: "product-1",
        name: "Piscina 6x3",
        model: "Modelo 6x3",
        category: "Piscinas de fibra",
        description: "Piscina de fibra",
        price: 20_000,
        promoPrice: null,
        images: [],
        notes: null,
      },
    ],
    catalogSearch: { status: "matches", products: [] },
    catalogScope: { companyId, activeOnly: true },
    faqKnowledge: [],
    commercialRules: {
      paymentMethods: null,
      commercialTerms: null,
      paymentPolicy: null,
      installationPolicy: null,
      nextLoadForecast: null,
      visitPolicy: null,
      heatingPolicy: null,
      shippingPolicy: null,
      includedItemsPolicy: null,
    },
    approvedCoachLearnings: [],
  },
};

function query(data: unknown, error: unknown = null, upsertError: unknown = error) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data, error })),
    upsert: vi.fn(async () => ({ data: null, error: upsertError })),
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve(resolve({ data, error })),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  return builder;
}

function configureCoachRules(options: {
  rules?: unknown[];
  versions?: unknown[];
  quickReplies?: unknown[];
  error?: unknown;
  stateData?: unknown;
  stateError?: unknown;
  stateUpsertError?: unknown;
  activeProducts?: unknown[];
}) {
  const rulesQuery = query(options.rules ?? [], options.error ?? null);
  const versionsQuery = query(options.versions ?? []);
  const quickRepliesQuery = query(options.quickReplies ?? []);
  from.mockImplementation((table: string) => {
    if (table === "coach_rules") return rulesQuery;
    if (table === "coach_rule_versions") return versionsQuery;
    if (table === "quick_replies") return quickRepliesQuery;
    if (table === "conversation_sales_states") {
      return query(options.stateData ?? null, options.stateError ?? null, options.stateUpsertError ?? null);
    }
    if (table === "products") return query(options.activeProducts ?? context.grounding.catalog);
    throw new Error(`unexpected table: ${table}`);
  });
  return { rulesQuery, versionsQuery, quickRepliesQuery };
}

function configureGateway() {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: "respond_to_customer",
                    arguments: JSON.stringify({ message: "Posso ajudar com essa informação." }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

describe("runAgentTurn coach_rules integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    listLearningCandidates.mockResolvedValue([]);
    retrieveLearnings.mockReturnValue({ selected: [], scored: [], metrics: {} });
    configureGateway();
  });

  it("executa o pipeline produtivo na ordem contexto -> interpretação -> catálogo -> decisão -> redação", async () => {
    const events: string[] = [];
    let interpretationObserved = false;
    const catalogRows = new Proxy([...context.grounding.catalog], {
      get(target, property, receiver) {
        return Reflect.get(target, property, receiver);
      },
    });
    const groundedContext: AgentContext = {
      ...context,
      grounding: { ...context.grounding },
    };
    Object.defineProperty(groundedContext.grounding, "catalog", {
      configurable: true,
      get: () => {
        events.push(interpretationObserved ? "catalogSearch" : "context");
        return catalogRows;
      },
    });
    const history = new Proxy(
      [{ role: "lead" as const, text: "Qual o preço do Modelo 6x3?" }],
      {
        get(target, property, receiver) {
          if (property === Symbol.iterator && !interpretationObserved) {
            interpretationObserved = true;
            events.push("interpretation");
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    fetchMock.mockImplementation(async () => {
      events.push("gateway");
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => {
          events.push("decision");
          return {
            choices: [{
              message: {
                tool_calls: [{
                  function: {
                    name: "respond_to_customer",
                    arguments: JSON.stringify({
                      message: "  Posso ajudar você com esse produto.  ",
                      suggest_products: ["product-1"],
                    }),
                  },
                }],
              },
            }],
          };
        },
      };
    });
    configureCoachRules({});
    const decideSpy = vi.spyOn(SalesAgentCore.prototype, "decide");

    const result = await runAgentTurn({
      ctx: groundedContext,
      history,
      leadName: null,
    });

    expect(events).toContain("gateway");
    expect(events).toContain("decision");
    expect(result).toMatchObject({ kind: "reply", message: "Posso ajudar você com esse produto." });
    expect(decideSpy).toHaveBeenCalledTimes(1);
    expect(decideSpy.mock.calls[0][0].interpretation).toMatchObject({
      intent: "product_inquiry",
      references: { lastLeadText: "Qual o preço do Modelo 6x3?" },
    });
    expect(decideSpy.mock.calls[0][0].catalogSearch).toMatchObject({
      status: "matches",
      products: [{ id: "product-1", model: "Modelo 6x3", price: 20_000 }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events.slice(events.indexOf("decision") + 1)).not.toContain("catalogSearch");
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.messages.some((message: { content?: string }) =>
      message.content?.includes("Modelo 6x3"))).toBe(true);
    decideSpy.mockRestore();
  });

  it("mantém erro de memória distinto de ausência e não permite continuidade em erro", async () => {
    configureCoachRules({ stateData: null });
    const missing = await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "Qual o preço do Modelo 6x3?" }],
      leadName: null,
      salesStateScope: { scopeType: "whatsapp_conversation", scopeId: "conversation-1" },
    });
    expect(missing.kind).toBe("reply");

    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    configureGateway();
    configureCoachRules({ stateError: new Error("memory unavailable") });
    const failed = await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "Tem mais algum modelo?" }],
      leadName: null,
      salesStateScope: { scopeType: "whatsapp_conversation", scopeId: "conversation-1" },
    });
    expect(failed).toMatchObject({ kind: "handoff", reason: "conversation_sales_state_load_failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("memory error independent turn performs a fresh deterministic search", async () => {
    configureCoachRules({ stateError: new Error("memory unavailable") });
    const decideSpy = vi.spyOn(SalesAgentCore.prototype, "decide");
    const result = await runAgentTurn({
      ctx: context,
      history: [
        { role: "agent", text: "Apresentei o modelo antigo.", productIds: ["stale-product"] },
        { role: "lead", text: "Qual o preço do Modelo 6x3?", productIds: ["stale-product"] },
      ],
      leadName: null,
      salesStateScope: { scopeType: "whatsapp_conversation", scopeId: "conversation-1" },
    });
    expect(result.kind).toBe("reply");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(decideSpy.mock.calls[0][0].memoryStatus).toBe("missing");
    expect(decideSpy.mock.calls[0][0].interpretation.references.productIds).toEqual([]);
    const freshCatalog = decideSpy.mock.calls[0][0].catalogSearch;
    expect("products" in freshCatalog ? freshCatalog.products.map((p: { id: string }) => p.id) : []).toEqual(["product-1"]);
    expect(decideSpy.mock.calls[0][0].history.every((item: { productIds?: string[] }) => !item.productIds)).toBe(true);
    decideSpy.mockRestore();
  });

  it("memory error contextual turn blocks safely without calling the LLM", async () => {
    configureCoachRules({ stateError: new Error("memory unavailable") });
    const decideSpy = vi.spyOn(SalesAgentCore.prototype, "decide");
    const result = await runAgentTurn({
      ctx: context,
      history: [
        { role: "agent", text: "Apresentei duas opções.", productIds: ["stale-product"] },
        { role: "lead", text: "O segundo é maior?", productIds: ["stale-product"] },
      ],
      leadName: null,
      salesStateScope: { scopeType: "whatsapp_conversation", scopeId: "conversation-1" },
    });
    expect(result).toMatchObject({ kind: "handoff", reason: "conversation_sales_state_load_failed" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(decideSpy).toHaveBeenCalledOnce();
    expect(decideSpy.mock.calls[0][0].interpretation.references.productIds).toEqual([]);
    decideSpy.mockRestore();
  });

  it("does not send cross-tenant or inactive products to Core", async () => {
    const unsafeContext = {
      ...context,
      grounding: {
        ...context.grounding,
        catalog: [
          ...context.grounding.catalog,
          { ...context.grounding.catalog[0], id: "other-tenant", company_id: "company-2" },
          { ...context.grounding.catalog[0], id: "inactive", active: false },
        ],
      },
    } as AgentContext;
    configureCoachRules({ activeProducts: [context.grounding.catalog[0]] });
    const decideSpy = vi.spyOn(SalesAgentCore.prototype, "decide");
    await runAgentTurn({
      ctx: unsafeContext,
      history: [{ role: "lead", text: "Quais modelos estão disponíveis?" }],
      leadName: null,
    });
    const coreInput = decideSpy.mock.calls[0][0];
    expect("products" in coreInput.catalogSearch ? coreInput.catalogSearch.products.map((p: { id: string }) => p.id) : []).toEqual(["product-1"]);
    expect(coreInput.ctx.grounding.catalog.map((p: { id: string }) => p.id)).toEqual(["product-1"]);
    decideSpy.mockRestore();
  });

  it("reconciles historical product IDs against the server-validated catalog", async () => {
    configureCoachRules({ activeProducts: [context.grounding.catalog[0]] });
    const decideSpy = vi.spyOn(SalesAgentCore.prototype, "decide");
    await runAgentTurn({
      ctx: context,
      history: [
        { role: "agent", text: "Produto anterior", productIds: ["product-1", "cross-tenant", "inactive"] },
        { role: "lead", text: "Qual o preço do Modelo 6x3?" },
      ],
      leadName: null,
    });
    expect(decideSpy.mock.calls[0][0].interpretation.references.productIds).toEqual(["product-1"]);
    expect(decideSpy.mock.calls[0][0].history[0].productIds).toEqual(["product-1"]);
    decideSpy.mockRestore();
  });

  it("switches safely between previously presented products across persisted turns", async () => {
    const products = [
      { ...context.grounding.catalog[0], id: "pool-801", name: "Sol 801", model: "Sol 801", price: 18_900 },
      { ...context.grounding.catalog[0], id: "pool-802", name: "Sol 802", model: "Sol 802", price: 19_900 },
      { ...context.grounding.catalog[0], id: "pool-801-spa", name: "Sol 801 SPA", model: "Sol 801 SPA", price: 28_900 },
    ];
    let persistedState: any = null;

    configureCoachRules({ activeProducts: products });

    from.mockImplementation((table: string) => {
      if (table === "conversation_sales_states") {
        const q = query(persistedState);
        (q.upsert as any).mockImplementation(async (row: any) => {
          persistedState = row;
          return { data: null, error: null };
        });
        return q;
      }
      if (table === "products") return query(products);
      if (table === "coach_rules" || table === "coach_rule_versions" || table === "quick_replies") {
        return query([]);
      }
      throw new Error(`unexpected table: ${table}`);
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { tool_calls: [{ function: {
          name: "respond_to_customer",
          arguments: JSON.stringify({ message: "A Sol 802 custa R$ 19.900,00." }),
        } }] } }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { tool_calls: [{ function: {
          name: "respond_to_customer",
          arguments: JSON.stringify({ message: "A Sol 801 custa R$ 18.900,00." }),
        } }] } }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { tool_calls: [{ function: {
          name: "respond_to_customer",
          arguments: JSON.stringify({ message: "A Sol 801 SPA custa R$ 28.900,00." }),
        } }] } }],
      }), { status: 200, headers: { "content-type": "application/json" } }));

    const scope = {
      scopeType: "whatsapp_conversation" as const,
      scopeId: "conversation-1",
    };
    const ctx = {
      ...context,
      products,
      grounding: { ...context.grounding, catalog: products },
    };

    const first = await runAgentTurn({
      ctx,
      history: [
        { role: "agent", text: "Apresentei a Sol 801 e a Sol 802.", productIds: ["pool-801", "pool-802"] },
        { role: "lead", text: "Eu gostei da 802. Qual o valor dela?" },
      ],
      leadName: null,
      salesStateScope: scope,
    });

    expect(first.kind).toBe("reply");

    const second = await runAgentTurn({
      ctx,
      history: [
        { role: "agent", text: "Apresentei a Sol 801 e a Sol 802.", productIds: ["pool-801", "pool-802"] },
        { role: "lead", text: "Eu gostei da 802. Qual o valor dela?" },
        { role: "agent", text: "A Sol 802 custa R$ 19.900,00.", productIds: ["pool-802"] },
        { role: "lead", text: "E essa Sol 801 qual o valor?" },
      ],
      leadName: null,
      salesStateScope: scope,
    });

    expect(second).toMatchObject({
      kind: "reply",
      message: "A Sol 801 custa R$ 18.900,00.",
    });

    const third = await runAgentTurn({
      ctx,
      history: [
        { role: "agent", text: "Apresentei a Sol 801 e a Sol 802.", productIds: ["pool-801", "pool-802"] },
        { role: "lead", text: "Eu gostei da 802. Qual o valor dela?" },
        { role: "agent", text: "A Sol 802 custa R$ 19.900,00.", productIds: ["pool-802"] },
        { role: "lead", text: "E essa Sol 801 qual o valor?" },
        { role: "agent", text: "A Sol 801 custa R$ 18.900,00.", productIds: ["pool-801"] },
        { role: "lead", text: "E a Sol 801 SPA, qual o valor?" },
      ],
      leadName: null,
      salesStateScope: scope,
    });

    expect(third).toMatchObject({
      kind: "reply",
      message: "A Sol 801 SPA custa R$ 28.900,00.",
    });
  });
  it("continues the previous agent offer after a short affirmative reply", async () => {
    const product = {
      ...context.grounding.catalog[0],
      id: "pool-802",
      name: "Sol 802",
      model: "Sol 802",
      price: 19_900,
      includedItems: ["piscina", "filtro", "motobomba"],
    };

    configureCoachRules({ activeProducts: [product] });

    const result = await runAgentTurn({
      ctx: {
        ...context,
        products: [product],
        grounding: { ...context.grounding, catalog: [product] },
      },
      history: [
        { role: "lead", text: "Gostei da 802. Qual o valor dela?" },
        {
          role: "agent",
          text: "A Sol 802 custa R$ 19.900,00. Posso te explicar também o que está incluso no projeto?",
          productIds: ["pool-802"],
        },
        { role: "lead", text: "pode sim" },
      ],
      leadName: null,
    });

    expect(result).toMatchObject({
      kind: "reply",
    });
    expect(result.message).toMatch(/inclu/i);
    expect(result.message).not.toMatch(/Sol 1000|Sol 400/);
  });
  it("does not contaminate the response when memory upsert fails", async () => {
    configureCoachRules({ stateUpsertError: new Error("upsert failed") });
    const result = await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "Qual o preço do Modelo 6x3?" }],
      leadName: null,
      salesStateScope: { scopeType: "whatsapp_conversation", scopeId: "conversation-1" },
    });
    expect(result).toMatchObject({ kind: "reply" });
    expect(result).not.toMatchObject({ reason: "conversation_sales_state_save_failed" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("carrega regras pelo supabaseAdmin com o company_id correto", async () => {
    const { rulesQuery, versionsQuery } = configureCoachRules({
      rules: [
        {
          id: "rule-1",
          company_id: companyId,
          active_version_id: "version-1",
          category: "payments",
          rule_type: "instruction",
          priority: 80,
          scope_kind: "company",
          scope_ref: {},
        },
      ],
      versions: [
        {
          id: "version-1",
          rule_id: "rule-1",
          company_id: companyId,
          version_number: 2,
          status: "approved",
          title: "Pagamento",
          content: "Informe Pix e cartão.",
        },
      ],
    });

    await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "Quais formas de pagamento vocês aceitam?" }],
      leadName: null,
    });

    expect(from).toHaveBeenCalledWith("coach_rules");
    expect(from).toHaveBeenCalledWith("coach_rule_versions");
    expect(rulesQuery.eq).toHaveBeenCalledWith("company_id", companyId);
    expect(versionsQuery.eq).toHaveBeenCalledWith("company_id", companyId);
    expect(versionsQuery.eq).toHaveBeenCalledWith("status", "approved");
  });

  it("coloca quick reply relevante no prompt e preserva company_id", async () => {
    const { quickRepliesQuery } = configureCoachRules({
      quickReplies: [
        {
          name: "Por Conta do Cliente",
          category: "Orçamento",
          content: "Contrapiso, água, energia e materiais.",
          sort_order: 12,
        },
      ],
    });

    await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "O contrapiso fica por conta do cliente?" }],
      leadName: null,
    });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.messages[0].content).toContain("Contrapiso, água, energia e materiais.");
    expect(quickRepliesQuery.eq).toHaveBeenCalledWith("company_id", companyId);
    expect(quickRepliesQuery.eq).toHaveBeenCalledWith("active", true);
    expect(quickRepliesQuery.limit).toHaveBeenCalledWith(20);
  });

  it("nÃ£o coloca quick reply irrelevante no prompt", async () => {
    configureCoachRules({
      quickReplies: [
        {
          name: "Por Conta do Cliente",
          category: "Orçamento",
          content: "Contrapiso, água e energia.",
          sort_order: 12,
        },
      ],
    });

    await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "Olá, tudo bem?" }],
      leadName: null,
    });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.messages[0].content).not.toContain("Contrapiso, água e energia.");
  });

  it("continua o turno quando a leitura de quick replies falha", async () => {
    const rulesQuery = query([]);
    const versionsQuery = query([]);
    const quickRepliesQuery = query([], new Error("database unavailable"));
    from.mockImplementation((table: string) => {
      if (table === "coach_rules") return rulesQuery;
      if (table === "coach_rule_versions") return versionsQuery;
      if (table === "quick_replies") return quickRepliesQuery;
      if (table === "products") return query(context.grounding.catalog);
      throw new Error(`unexpected table: ${table}`);
    });

    const decision = await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "O contrapiso fica por conta do cliente?" }],
      leadName: null,
    });

    expect(decision.kind).toBe("reply");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("continua o turno quando a leitura de coach_rules falha", async () => {
    configureCoachRules({ error: new Error("database unavailable") });

    const decision = await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "Quais formas de pagamento vocês aceitam?" }],
      leadName: null,
    });

    expect(decision.kind).toBe("reply");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("coloca a regra relevante carregada efetivamente no prompt", async () => {
    const { versionsQuery } = configureCoachRules({
      rules: [
        {
          id: "rule-payment",
          company_id: companyId,
          active_version_id: "version-payment",
          category: "payments",
          rule_type: "instruction",
          priority: 80,
          scope_kind: "company",
          scope_ref: {},
        },
      ],
      versions: [
        {
          id: "version-payment",
          rule_id: "rule-payment",
          company_id: companyId,
          version_number: 1,
          status: "approved",
          category: "payments",
          rule_type: "instruction",
          title: "Pagamento",
          content: "Informe Pix e cartão sem negociar desconto.",
        },
      ],
    });

    await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "Quais formas de pagamento vocês aceitam?" }],
      leadName: null,
    });

    expect(from).toHaveBeenCalledWith("coach_rule_versions");
    expect(versionsQuery.in).toHaveBeenCalledWith("id", ["version-payment"]);
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.messages[0].content).toContain("Informe Pix e cartão sem negociar desconto.");
  });

  it("preserva o isolamento quando a empresa não possui regras", async () => {
    const { rulesQuery } = configureCoachRules({ rules: [], versions: [] });

    await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "Quais formas de pagamento vocês aceitam?" }],
      leadName: null,
    });

    expect(rulesQuery.eq).toHaveBeenCalledWith("company_id", companyId);
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.messages[0].content).not.toContain("REGRAS ATIVAS APLICÁVEIS");
  });
});
