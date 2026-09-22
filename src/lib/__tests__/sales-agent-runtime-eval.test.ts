import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, fetchMock, postGraph, listLearningCandidates, retrieveLearnings, decideSpy } = vi.hoisted(() => ({
  from: vi.fn(),
  fetchMock: vi.fn(),
  postGraph: vi.fn(),
  listLearningCandidates: vi.fn(),
  retrieveLearnings: vi.fn(),
  decideSpy: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({ postGraph }));
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

import { runAgentTick, runAgentTurn } from "../ai-agent.server";
import { SalesAgentCore, type AgentContext, type AgentDecision } from "../sales-agent-core";

const companyId = "company-runtime-eval";
const validProduct = {
  id: "pool-6x3",
  company_id: companyId,
  active: true,
  name: "Piscina 6x3",
  model: "Modelo 6x3",
  category: "Piscinas de fibra",
  description: "Piscina de fibra 6x3",
  price: 20_000,
  promo_price: 18_000,
  images: ["pool-6x3.jpg"],
  notes: "Filtro incluído",
};
const secondProduct = {
  ...validProduct,
  id: "pool-8x4",
  name: "Piscina 8x4",
  model: "Modelo 8x4",
  price: 30_000,
  promo_price: null,
};

type PersistedRow = Record<string, unknown>;
type RuntimeCapture = {
  result: AgentDecision;
  validatedProductIds: string[];
  validatedProducts: Array<Record<string, unknown>>;
  productQueryFilters: Array<Array<[string, unknown]>>;
  coreCalls: number;
  coreInputs: Array<Record<string, unknown>>;
  llmCalls: number;
  transportCalls: number;
  persistedStates: PersistedRow[];
};

type RuntimeOptions = {
  serverProducts?: unknown[];
  contextProducts?: unknown[];
  stateRow?: PersistedRow | null;
  stateError?: unknown;
  upsertError?: unknown;
  completion?: Record<string, unknown>;
  inputOverride?: string;
};

function agentProduct(row: typeof validProduct) {
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    category: row.category,
    description: row.description,
    price: row.price,
    promoPrice: row.promo_price,
    images: row.images,
    notes: row.notes,
  };
}

function buildContext(products: unknown[] = [validProduct, secondProduct]): AgentContext {
  const catalog = products.map((product) => agentProduct(product as typeof validProduct));
  return {
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
    companyName: "Empresa Runtime",
    products: catalog,
    catalogProductIds: catalog.map((product) => product.id),
    catalogForValidation: catalog,
    knowledge: [],
    aiProfile: {
      tone: "consultivo",
      description: "Venda de piscinas",
      products: null,
      payment_methods: "Pix",
      avg_lead_time: null,
      region: "SP",
      differentials: null,
      faq: [],
    },
    grounding: {
      catalog,
      catalogSearch: { status: "matches", products: catalog },
      catalogScope: { companyId, activeOnly: true },
      faqKnowledge: [],
      commercialRules: {
        paymentMethods: "Pix",
        commercialTerms: "Negociação exige atendimento humano.",
        paymentPolicy: null,
        installationPolicy: null,
        nextLoadForecast: null,
        visitPolicy: null,
        heatingPolicy: null,
        shippingPolicy: null,
        includedItemsPolicy: null,
      },
      approvedCoachLearnings: [],
      activeCoachRules: [],
      quickReplies: [],
    },
  };
}

function query(data: unknown, error: unknown = null, upsertError: unknown = null) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data, error })),
    update: vi.fn(),
    insert: vi.fn(async (..._args: unknown[]) => ({ data: null, error: null })),
    upsert: vi.fn(async (..._args: unknown[]) => ({ data: null, error: upsertError })),
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve(resolve({ data, error })),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.update.mockReturnValue(builder);
  return builder;
}

function productQuery(rows: unknown[]) {
  const filters: Array<[string, unknown]> = [];
  const builder = query(rows);
  builder.eq.mockImplementation((column: string, value: unknown) => {
    filters.push([column, value]);
    return builder;
  });
  builder.in.mockImplementation((column: string, values: unknown[]) => {
    filters.push([column, values]);
    return builder;
  });
  const resolvedRows: unknown[] = [];
  builder.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) => {
    const filtered = rows.filter((row) => {
      if (!row || typeof row !== "object") return false;
      const source = row as Record<string, unknown>;
      return filters.every(([column, value]) =>
        column === "company_id" ? source.company_id === value
          : column === "active" ? source.active === value
            : column === "id" && Array.isArray(value) ? value.includes(source.id)
              : true,
      );
    });
    resolvedRows.splice(0, resolvedRows.length, ...filtered);
    return Promise.resolve(resolve({ data: filtered, error: null }));
  };
  return { builder, filters, resolvedRows };
}

function gatewayResponse(call: Record<string, unknown>) {
  return {
    choices: [{ message: { tool_calls: [{ function: { name: String(call.name), arguments: JSON.stringify(call.arguments ?? {}) } }] } }],
  };
}

const MEMORY_STATE_KEYS = new Set([
  "company_id",
  "scope_type",
  "scope_id",
  "product_ids",
  "attributes",
  "intent",
  "last_valid_product_ids",
  "last_catalog_query",
  "updated_at",
]);
const MEMORY_ATTRIBUTE_KEYS = new Set([
  "lengthM",
  "widthM",
  "depthM",
  "capacityL",
  "spaceLengthM",
  "spaceWidthM",
  "sizeComparison",
  "shape",
  "variantTerms",
]);
const MEMORY_QUERY_KEYS = new Set(["status", "criteria", "referencedProductIds", "subject", "productReferenceKind", "confirmation", "confidence"]);

function assertWhitelistedMemoryState(row: PersistedRow) {
  expect(Object.keys(row).every((key) => MEMORY_STATE_KEYS.has(key))).toBe(true);
  const attributes = row.attributes;
  expect(attributes && typeof attributes === "object" && !Array.isArray(attributes)).toBe(true);
  expect(Object.keys((attributes ?? {}) as object).every((key) => MEMORY_ATTRIBUTE_KEYS.has(key))).toBe(true);
  const query = row.last_catalog_query;
  if (query == null) return;
  expect(typeof query === "object" && !Array.isArray(query)).toBe(true);
  expect(Object.keys(query as object).every((key) => MEMORY_QUERY_KEYS.has(key))).toBe(true);
  const criteria = (query as { criteria?: unknown }).criteria;
  expect(criteria && typeof criteria === "object" && !Array.isArray(criteria)).toBe(true);
  expect(Object.keys((criteria ?? {}) as object).every((key) => MEMORY_ATTRIBUTE_KEYS.has(key))).toBe(true);
}

function configureRuntime(options: RuntimeOptions = {}) {
  const serverProducts = options.serverProducts ?? [validProduct, secondProduct];
  const persistedStates: PersistedRow[] = [];
  const productQueries: Array<ReturnType<typeof productQuery>> = [];
  const modelHandoffState = options.completion?.name === "request_human_handoff"
    ? {
        product_ids: [validProduct.id, secondProduct.id],
        attributes: {},
        intent: "product_inquiry",
        last_valid_product_ids: [validProduct.id, secondProduct.id],
        last_catalog_query: null,
      }
    : null;
  let storedRow = options.stateRow ?? modelHandoffState;
  const stateQuery = query(
    () => storedRow,
    options.stateError ?? null,
    options.upsertError ?? null,
  );
  stateQuery.maybeSingle.mockImplementation(async () => ({ data: storedRow, error: options.stateError ?? null }));
  stateQuery.upsert.mockImplementation(async (...args: unknown[]) => {
    const row = args[0] as PersistedRow;
    if (!options.upsertError) {
      storedRow = row;
      persistedStates.push(row);
    }
    return { data: null, error: options.upsertError ?? null };
  });
  from.mockImplementation((table: string) => {
    if (table === "products") {
      const current = productQuery(serverProducts);
      productQueries.push(current);
      return current.builder;
    }
    if (table === "conversation_sales_states") return stateQuery;
    if (table === "coach_rules" || table === "coach_rule_versions" || table === "quick_replies") return query([]);
    throw new Error(`unexpected table: ${table}`);
  });
  const context = buildContext(options.contextProducts ?? serverProducts);
  const completion = options.completion ?? {
    name: "respond_to_customer",
    arguments: { message: "Posso ajudar com o catálogo.", suggest_products: [validProduct.id] },
  };
  fetchMock.mockImplementation(async () => ({
    ok: true,
    headers: { get: () => null },
    json: async () => gatewayResponse(completion),
  }));
  return {
    context,
    persistedStates,
    productQueries,
    inputOverride: options.inputOverride ?? (modelHandoffState ? "Tem mais?" : undefined),
  };
}

async function evaluateConfiguredTurn(
  input: string,
  configured: ReturnType<typeof configureRuntime>,
  history: Array<{ role: "lead" | "agent" | "system"; text: string; productIds?: string[] }> = [],
): Promise<RuntimeCapture> {
  const { context, persistedStates, productQueries } = configured;
  const result = await runAgentTurn({
    ctx: context,
    history: [...history, { role: "lead", text: configured.inputOverride ?? input }],
    leadName: null,
    salesStateScope: { scopeType: "whatsapp_conversation", scopeId: "conversation-runtime-eval" },
  });
  const validatedProductIds = (productQueries[0]?.resolvedRows ?? [])
    .filter((product): product is { id: string } => Boolean(product) && typeof product === "object" && typeof (product as { id?: unknown }).id === "string")
    .map((product) => product.id);
  return {
    result,
    validatedProductIds,
    validatedProducts: (productQueries[0]?.resolvedRows ?? [])
      .filter((product): product is Record<string, unknown> => Boolean(product) && typeof product === "object") ,
    productQueryFilters: productQueries.map((productQuery) => productQuery.filters),
    coreCalls: decideSpy.mock.calls.length,
    coreInputs: decideSpy.mock.calls.map((call) => call[0] as Record<string, unknown>),
    llmCalls: fetchMock.mock.calls.length,
    transportCalls: postGraph.mock.calls.length,
    persistedStates: [...persistedStates],
  };
}

async function evaluate(
  input: string,
  options: RuntimeOptions = {},
  history: Array<{ role: "lead" | "agent" | "system"; text: string; productIds?: string[] }> = [],
): Promise<RuntimeCapture> {
  const configured = configureRuntime(options);
  return evaluateConfiguredTurn(input, configured, history);
}

function coreCatalogIds(capture: RuntimeCapture): string[] {
  const input = capture.coreInputs[0];
  const search = input?.catalogSearch as { products?: Array<{ id: string }> } | undefined;
  return search?.products?.map((product) => product.id) ?? [];
}

function assertUniversalRuntimeInvariants(capture: RuntimeCapture) {
  const allowedIds = new Set(capture.validatedProductIds);
  for (const filters of capture.productQueryFilters) {
    expect(filters).toEqual(expect.arrayContaining([["company_id", companyId], ["active", true]]));
  }
  for (const input of capture.coreInputs) {
    const search = input.catalogSearch as { products?: Array<{ id: string }> };
    expect((search.products ?? []).every((product) => allowedIds.has(product.id))).toBe(true);
    const context = input.ctx as AgentContext;
    expect(context.grounding.catalog.every((product) => allowedIds.has(product.id))).toBe(true);
  }
  const returnedIds = [
    ...(capture.result.suggested_products ?? []),
    ...(capture.result.product_image_ids ?? []),
  ];
  expect(returnedIds.every((id) => allowedIds.has(id))).toBe(true);
  if (capture.result.kind === "reply" && typeof capture.result.message === "string") {
    const catalogPrices = new Set(
      capture.validatedProducts.flatMap((product) =>
        [product.price, product.promo_price, product.promoPrice]
          .filter((price): price is number => typeof price === "number"),
      ),
    );
    for (const match of capture.result.message.matchAll(/R\$\s*([\d.]+)(?:,\d{1,2})?/gi)) {
      expect(catalogPrices.has(Number(match[1].replace(/\./g, "")))).toBe(true);
    }
  }
  for (const state of capture.persistedStates) assertWhitelistedMemoryState(state);
}

describe("Sales Agent runtime eval determinístico", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    const originalDecide = SalesAgentCore.prototype.decide;
    vi.spyOn(SalesAgentCore.prototype, "decide").mockImplementation(async function (this: SalesAgentCore, ...args) {
      decideSpy(...args);
      return originalDecide.apply(this, args);
    });
    vi.stubGlobal("fetch", fetchMock);
    listLearningCandidates.mockResolvedValue([]);
    retrieveLearnings.mockReturnValue({ selected: [], scored: [], metrics: {} });
  });

  it("usa somente preço e promoção do catálogo", async () => {
    const capture = await evaluate("Qual o preço e a promoção?", {
      serverProducts: [validProduct],
      completion: {
        name: "respond_to_customer",
        arguments: { message: "Custa R$ 20.000 e a promoção é R$ 18.000.", suggest_products: [validProduct.id] },
      },
    });
    expect(capture.result).toMatchObject({ kind: "reply", message: expect.stringContaining("18.000") });
    expect(capture.result).not.toMatchObject({ message: expect.stringContaining("10.000") });
    expect(capture.coreCalls).toBe(1);
    expect(capture.llmCalls).toBe(1);
    assertUniversalRuntimeInvariants(capture);
  });

  it("rejeita preço antigo ou inventado", async () => {
    const capture = await evaluate("Qual o preço?", {
      serverProducts: [validProduct],
      completion: {
        name: "respond_to_customer",
        arguments: { message: "A piscina custa R$ 10.000.", suggest_products: [validProduct.id] },
      },
    });
    expect(capture.result).not.toMatchObject({ message: expect.stringContaining("10.000") });
    expect(capture.coreCalls).toBe(1);
    assertUniversalRuntimeInvariants(capture);
  });

  it("bloqueia cross-tenant e produto inativo antes do Core", async () => {
    const unsafe = [
      validProduct,
      { ...secondProduct, company_id: "other-company" },
      { ...validProduct, id: "inactive", active: false },
    ];
    const capture = await evaluate("Quais produtos estão disponíveis?", {
      serverProducts: [validProduct],
      contextProducts: unsafe,
    });
    expect(coreCatalogIds(capture)).toEqual([validProduct.id]);
    expect(capture.coreInputs[0].ctx).toMatchObject({ catalogProductIds: [validProduct.id] });
    expect(capture.result).not.toMatchObject({ suggested_products: expect.arrayContaining(["inactive", "pool-8x4"]) });
    assertUniversalRuntimeInvariants(capture);
  });

  it("descarta IDs históricos inválidos", async () => {
    const capture = await evaluate(
      "Qual o preço do Modelo 6x3?",
      { serverProducts: [validProduct] },
      [{ role: "agent", text: "Produto anterior", productIds: [validProduct.id, "cross-tenant", "inactive"] }],
    );
    const input = capture.coreInputs[0];
    expect((input.history as Array<{ productIds?: string[] }>)[0].productIds).toEqual([validProduct.id]);
    expect((input.interpretation as { references: { productIds: string[] } }).references.productIds).toEqual([validProduct.id]);
    assertUniversalRuntimeInvariants(capture);
  });

  it("preserva referência multi-turno válida e 'tem mais?'", async () => {
    const first = await evaluate("Quais modelos de piscina vocês têm?", { serverProducts: [validProduct, secondProduct] });
    expect(coreCatalogIds(first)).toContain(validProduct.id);
    vi.clearAllMocks();
    listLearningCandidates.mockResolvedValue([]);
    retrieveLearnings.mockReturnValue({ selected: [], scored: [], metrics: {} });
    const second = await evaluate(
      "Tem mais?",
      { serverProducts: [validProduct, secondProduct], stateRow: first.persistedStates.at(-1) ?? null },
      [{ role: "agent", text: "A piscina 6x3 é uma opção.", productIds: [validProduct.id] }],
    );
    expect(second.coreCalls).toBe(1);
    expect(coreCatalogIds(second)).toEqual([secondProduct.id]);
    expect(second.llmCalls).toBe(1);
    assertUniversalRuntimeInvariants(second);
  });

  it("memory error independente faz nova busca", async () => {
    const capture = await evaluate(
      "Qual o preço da piscina 6x3?",
      { stateError: new Error("memory unavailable"), serverProducts: [validProduct] },
      [{ role: "agent", text: "Produto antigo", productIds: ["stale-product"] }],
    );
    expect(capture.result.kind).toBe("reply");
    expect(capture.coreInputs[0].memoryStatus).toBe("missing");
    expect(coreCatalogIds(capture)).toEqual([validProduct.id]);
    expect(capture.llmCalls).toBe(1);
    expect(capture.persistedStates).toEqual([]);
    assertUniversalRuntimeInvariants(capture);
  });

  it("memory error contextual faz handoff sem LLM", async () => {
    const capture = await evaluate(
      "O segundo é maior?",
      { stateError: new Error("memory unavailable") },
      [{ role: "agent", text: "Apresentei duas opções.", productIds: [validProduct.id] }],
    );
    expect(capture.result).toMatchObject({ kind: "handoff", reason: "conversation_sales_state_load_failed" });
    expect(capture.coreCalls).toBe(1);
    expect(capture.llmCalls).toBe(0);
    expect(capture.transportCalls).toBe(0);
    expect(capture.persistedStates).toEqual([]);
    assertUniversalRuntimeInvariants(capture);
  });

  it("falha de upsert não contamina resposta nem estado futuro", async () => {
    const capture = await evaluate("Qual o preço?", { serverProducts: [validProduct], upsertError: new Error("upsert failed") });
    expect(capture.result.kind).toBe("reply");
    expect(capture.result).not.toMatchObject({ reason: "conversation_sales_state_save_failed" });
    expect(capture.persistedStates).toEqual([]);
    expect(capture.llmCalls).toBe(1);
    assertUniversalRuntimeInvariants(capture);
  });

  it("persiste memória sem fatos comerciais", async () => {
    const capture = await evaluate("Qual o preço?", {
      serverProducts: [validProduct],
      completion: {
        name: "respond_to_customer",
        arguments: { message: "O catálogo informa o valor vigente.", suggest_products: [validProduct.id] },
      },
    });
    expect(capture.persistedStates.length).toBeGreaterThan(0);
    for (const row of capture.persistedStates) assertWhitelistedMemoryState(row);
    for (const row of capture.persistedStates) {
      expect(row.last_catalog_query).toEqual(expect.objectContaining({ status: expect.any(String) }));
    }
    assertUniversalRuntimeInvariants(capture);
  });

  it("handoff não dispara transporte", async () => {
    const capture = await evaluate("Preciso negociar condições.", {
      serverProducts: [validProduct, secondProduct],
      completion: { name: "request_human_handoff", arguments: { reason: "negociação comercial" } },
    });
    expect(capture.result).toMatchObject({ kind: "handoff" });
    expect(capture.llmCalls).toBe(1);
    expect(postGraph).not.toHaveBeenCalled();
    assertUniversalRuntimeInvariants(capture);
  });


  it("runAgentTick faz handoff produtivo sem transporte", async () => {
    const conversationId = "conversation-tick-handoff";
    const leadId = "lead-tick-handoff";
    const conversation = {
      id: conversationId, company_id: companyId, lead_id: leadId, channel: "whatsapp",
      ai_handling: false, ai_status: null, auto_reply_count: 0, last_auto_reply_at: null,
      human_takeover_at: null, detected_city: null, detected_state: null,
      detected_pool_size: null, detected_intent: null, detected_interest: null,
      detected_budget: null, purchase_timing: null, customer_stage: null,
      lead_temperature: null, lead_score: 0, lead_ready_to_close: false,
      detected_objections: [],
    };
    const settings = buildContext().settings;
    const aiProfile = {
      tone: "consultivo", description: "Venda de piscinas", products: null,
      payment_methods: "Pix", avg_lead_time: null, region: "SP",
      differentials: null, faq: [],
    };
    let conversationReads = 0;

    from.mockImplementation((table: string) => {
      if (table === "conversations") {
        const builder = query(null);
        builder.maybeSingle.mockImplementation(async () => {
          conversationReads += 1;
          return conversationReads === 1
            ? { data: conversation, error: null }
            : { data: { id: conversationId }, error: null };
        });
        return builder;
      }
      if (table === "company_settings") return query(settings);
      if (table === "companies") return query({ name: "Empresa Runtime" });
      if (table === "ai_profiles") return query(aiProfile);
      if (table === "integrations") return query({ id: "wa-int-1" });
      if (table === "messages") return query([{
        role: "lead", text: "Quero fechar agora",
        at: "2026-09-19T12:00:00.000Z", source_metadata: {},
      }]);
      if (
        table === "products" || table === "marketing_knowledge_base" || table === "ai_knowledge_proposals" ||
        table === "coach_rules" || table === "coach_rule_versions" ||
        table === "quick_replies" || table === "ai_flow_events" ||
        table === "leads"
      ) return query([]);
      throw new Error(`unexpected table in runAgentTick handoff test: ${table}`);
    });

    const result = await runAgentTick(conversationId);

    expect(result).toMatchObject({ ok: true, action: "handoff" });
    expect(postGraph).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upsert falho nao contamina o segundo turno", async () => {
    const configured = configureRuntime({
      serverProducts: [validProduct],
      upsertError: new Error("upsert failed"),
    });
    const first = await evaluateConfiguredTurn("Qual o preco?", configured);
    expect(first.result.kind).toBe("reply");
    expect(first.persistedStates).toEqual([]);

    vi.clearAllMocks();
    listLearningCandidates.mockResolvedValue([]);
    retrieveLearnings.mockReturnValue({ selected: [], scored: [], metrics: {} });
    const second = await evaluateConfiguredTurn(
      "Qual o preco da piscina 6x3?",
      configured,
      [{ role: "agent", text: "Produto anterior", productIds: [validProduct.id] }],
    );
    expect(second.coreInputs[0].memoryStatus).toBe("missing");
    expect(second.result.kind).toBe("reply");
    expect(second.persistedStates).toEqual([]);
    assertUniversalRuntimeInvariants(second);
  });
});
