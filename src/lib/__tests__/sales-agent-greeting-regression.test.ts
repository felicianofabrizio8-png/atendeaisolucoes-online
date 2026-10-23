import { beforeEach, describe, expect, it, vi } from "vitest";

// Regressão: "boa tarde, tudo bem?" fazia a busca de catálogo casar "boa" com a
// descrição de um produto ("boa para receber amigos") ou cair no padrão
// "primeiros N produtos"; o produto ia para o prompt, para o fallback
// determinístico ("Encontrei no catálogo: ...") e para a memória comercial.

const { from, fetchMock, listLearningCandidates, retrieveLearnings } = vi.hoisted(() => ({
  from: vi.fn(),
  fetchMock: vi.fn(),
  listLearningCandidates: vi.fn(),
  retrieveLearnings: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({ postGraph: vi.fn() }));
vi.mock("../coach-learnings/coach-learnings.repository", () => ({ listLearningCandidates }));
vi.mock("../coach-learnings/retriever", () => ({ retrieveLearnings }));
vi.mock("../sales-agent-config.server", () => ({
  resolveSalesAgentLlmConfig: () => ({
    ok: true,
    config: { endpoint: "https://gateway.test/v1/chat/completions", model: "provider/sales-model", apiKey: "test-key" },
  }),
}));

import { runAgentTurn } from "../ai-agent.server";
import { SalesAgentCore, type AgentContext } from "../sales-agent-core";
import { searchSalesAgentCatalog } from "../sales-agent-grounding.server";
import { interpretStructuredSalesTurn } from "../sales-agent-interpretation";
import type { ConversationSalesState } from "../conversation-sales-state";

const companyId = "company-greeting-regression";
const scope = { companyId, activeOnly: true as const };

type Row = Record<string, unknown>;

function catalogProduct(row: Row) {
  return {
    id: row.id as string,
    name: row.name as string,
    model: (row.model as string | null) ?? null,
    sku: null,
    category: (row.category as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    lengthM: (row.length_m as number | null) ?? null,
    widthM: (row.width_m as number | null) ?? null,
    depthM: null,
    capacityL: null,
    shape: null,
    specifications: {},
    includedItems: [],
    variants: [],
    price: (row.price as number | null) ?? null,
    promoPrice: null,
    images: [],
    notes: (row.notes as string | null) ?? null,
  };
}

// Catálogo genérico (móveis): descrições com palavras de cortesia comuns.
const furnitureRows: Row[] = [
  { id: "sofa-lisboa", company_id: companyId, active: true, name: "Sofá Lisboa", model: "Lisboa 3 lugares", category: "Sofás", description: "Sofá retrátil muito bom para salas pequenas, fica bem em qualquer ambiente.", price: 3200 },
  { id: "sofa-porto", company_id: companyId, active: true, name: "Sofá Porto", model: "Porto 2 lugares", category: "Sofás", description: "Boa opção para quem recebe visitas à tarde e à noite.", price: 2700 },
  { id: "mesa-tudo", company_id: companyId, active: true, name: "Mesa Jantar Oval", model: "Oval 6 lugares", category: "Mesas", description: "Mesa para tudo: refeições, trabalho e jogos.", price: 1900 },
];
// O caso real do laboratório: "boa" na descrição da Atol.
const poolRows: Row[] = [
  { id: "pool-atol", company_id: companyId, active: true, name: "Piscina de Fibra Atol 7x3,5", model: "Atol 7x3,5", category: "Piscinas de fibra", description: "Piscina ampla com banco interno e prainha, boa para receber amigos.", length_m: 7, width_m: 3.5, price: 28900 },
  { id: "pool-praia", company_id: companyId, active: true, name: "Piscina de Fibra Praia 6x3", model: "Praia 6x3", category: "Piscinas de fibra", description: "Modelo mais vendido para famílias.", length_m: 6, width_m: 3, price: 22900 },
];

const furniture = furnitureRows.map(catalogProduct);
const pools = poolRows.map(catalogProduct);

function search(products: ReturnType<typeof catalogProduct>[], text: string, salesState: ConversationSalesState | null = null) {
  return searchSalesAgentCatalog(companyId, products, [{ role: "lead", text }], salesState, scope, { continuityEnabled: true });
}

const GREETINGS = [
  "boa tarde, tudo bem?",
  "Bom dia!",
  "oi",
  "Olá, boa noite",
  "Oi Bruna, tudo bem?",
  "e aí, tudo certo?",
  "obrigado!",
];

describe("interpretação: saudação é um turno social, não comercial", () => {
  it.each(GREETINGS)("classifica %j como social", (text) => {
    expect(interpretStructuredSalesTurn([{ role: "lead", text }]).intent).toBe("social");
  });

  it.each([
    "boa tarde, quanto custa o sofá?",
    "Oi, vocês têm piscina 6x3?",
    "bom dia, quero ver os modelos",
  ])("mantém a intenção comercial em %j", (text) => {
    expect(interpretStructuredSalesTurn([{ role: "lead", text }]).intent).not.toBe("social");
  });
});

describe("busca de catálogo: só consulta produtos quando há necessidade comercial", () => {
  it.each(GREETINGS)("saudação %j não consulta catálogo (móveis)", (text) => {
    expect(search(furniture, text)).toEqual({ status: "not_requested", products: [] });
  });

  it("saudação não casa 'boa' com a descrição da piscina Atol (caso do laboratório)", () => {
    expect(search(pools, "boa tarde, tudo bem?")).toEqual({ status: "not_requested", products: [] });
  });

  it("mensagem sem necessidade de produto não devolve 'primeiros N' do catálogo", () => {
    expect(search(furniture, "vocês entregam em Campinas?")).toEqual({ status: "not_requested", products: [] });
  });

  it("pedido genérico consulta o catálogo", () => {
    const result = search(furniture, "quais produtos vocês têm?");
    expect(result.status).toBe("matches");
    expect(result.status === "matches" && result.products.map((p) => p.id)).toEqual(["sofa-lisboa", "sofa-porto", "mesa-tudo"]);
  });

  it("saudação com necessidade na mesma mensagem consulta o catálogo", () => {
    const result = search(furniture, "Oi, tudo bem? Quero ver os sofás");
    expect(result.status).toBe("matches");
    expect(result.status === "matches" && result.products.map((p) => p.id)).toEqual(
      expect.arrayContaining(["sofa-lisboa", "sofa-porto"]),
    );
    expect(result.status === "matches" && result.products.map((p) => p.id)).not.toContain("mesa-tudo");
  });

  it("interesse específico encontra o produto citado", () => {
    expect(search(furniture, "quanto custa o Sofá Lisboa?")).toEqual({ status: "matches", products: [furniture[0]] });
  });

  it("continuidade: sem termos de produto, mantém os produtos já em discussão", () => {
    const state: ConversationSalesState = { productIds: ["sofa-lisboa"], attributes: {}, intent: "product_inquiry", lastValidProductIds: ["sofa-lisboa"] };
    // "focus": produtos vindos da memória da conversa, não de busca nova.
    expect(search(furniture, "moro em Campinas, entrega em quanto tempo?", state)).toEqual({ status: "matches", products: [furniture[0]], basis: "focus" });
  });
});

function buildContext(): AgentContext {
  return {
    settings: {
      company_id: companyId,
      ai_auto_reply_enabled: true,
      ai_after_hours_only: false,
      ai_initial_message: null,
      ai_max_auto_replies: 3,
      ai_handoff_timeout_minutes: 30,
      ai_agent_name: "Bruna",
      business_hours_start: "08:00:00",
      business_hours_end: "18:00:00",
      sales_agent_v2_enabled: true,
      sales_agent_v2_mode: "automatic",
    },
    companyName: "Loja Fictícia",
    products: furniture,
    catalogProductIds: furniture.map((p) => p.id),
    catalogForValidation: furniture,
    knowledge: [],
    aiProfile: null,
    grounding: {
      catalog: furniture,
      catalogSearch: { status: "not_requested", products: [] },
      catalogScope: scope,
      faqKnowledge: [],
      commercialRules: {
        paymentMethods: null, commercialTerms: null, paymentPolicy: null, installationPolicy: null,
        nextLoadForecast: null, visitPolicy: null, heatingPolicy: null, shippingPolicy: null, includedItemsPolicy: null,
      },
      approvedCoachLearnings: [],
      activeCoachRules: [],
      quickReplies: [],
    },
  } as unknown as AgentContext;
}

function toolCall(name: string, args: Record<string, unknown>) {
  return { choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }] };
}

describe("SalesAgentCore com catálogo não consultado", () => {
  it("responde a saudação sem produtos no prompt, nas sugestões ou no fallback", async () => {
    const requests: Array<{ messages: Array<{ content: string }> }> = [];
    const core = new SalesAgentCore(async (request) => {
      requests.push(request as never);
      return { ok: true, data: toolCall("respond_to_customer", { message: "Boa tarde! Tudo ótimo, e com você? Como posso te ajudar hoje?" }) };
    });
    const decision = await core.decide({
      ctx: buildContext(),
      history: [{ role: "lead", text: "boa tarde, tudo bem?" }],
      leadName: null,
      model: "provider/sales-model",
      catalogSearch: { status: "not_requested", products: [] },
    } as never);

    expect(decision.kind).toBe("reply");
    expect(decision.message).toBe("Boa tarde! Tudo ótimo, e com você? Como posso te ajudar hoje?");
    expect(decision.suggested_products ?? []).toEqual([]);
    const systemPrompt = requests[0].messages[0].content;
    for (const product of furniture) expect(systemPrompt).not.toContain(product.id);
  });

  it("se o modelo citar um produto sem pedido, não despeja o catálogo como resposta", async () => {
    const core = new SalesAgentCore(async () => ({
      ok: true,
      data: toolCall("respond_to_customer", { message: "Boa tarde! Temos o Sofá Lisboa por R$ 3.200, quer ver?" }),
    }));
    const decision = await core.decide({
      ctx: buildContext(),
      history: [{ role: "lead", text: "boa tarde, tudo bem?" }],
      leadName: null,
      model: "provider/sales-model",
      catalogSearch: { status: "not_requested", products: [] },
    } as never);

    expect(decision.message ?? "").not.toContain("Encontrei no catálogo");
    expect(decision.suggested_products ?? []).toEqual([]);
  });
});

describe("SalesAgentCore: só registra como sugerido o produto efetivamente apresentado", () => {
  async function decideWith(message: string, catalogSearch: { status: "matches" | "not_requested"; products: typeof furniture }, extra: Record<string, unknown> = {}) {
    const core = new SalesAgentCore(async () => ({ ok: true, data: toolCall("respond_to_customer", { message, ...extra }) }));
    return core.decide({
      ctx: buildContext(),
      history: [{ role: "lead", text: catalogSearch.status === "matches" ? "quero ver os sofás" : "boa tarde, tudo bem?" }],
      leadName: null,
      model: "provider/sales-model",
      catalogSearch,
    } as never);
  }
  const sofas = { status: "matches" as const, products: furniture.slice(0, 2) };

  it("pergunta de qualificação sem produto citado não vira sugestão", async () => {
    const decision = await decideWith("Claro! Para qual ambiente seria o sofá e quantos lugares você precisa?", sofas);
    expect(decision.kind).toBe("reply");
    expect(decision.presented_product_ids ?? []).toEqual([]);
  });

  it("produto citado pelo nome sem ID continua registrado", async () => {
    const decision = await decideWith("O Sofá Lisboa é retrátil e fica ótimo em salas pequenas. Quer saber o preço?", sofas);
    expect(decision.kind).toBe("reply");
    expect(decision.presented_product_ids).toEqual(["sofa-lisboa"]);
  });

  it("produtos indicados pelo modelo continuam registrados", async () => {
    const decision = await decideWith("Temos estas duas opções de sofá.", sofas, { suggest_products: ["sofa-lisboa", "sofa-porto"] });
    expect(decision.suggested_products).toEqual(["sofa-lisboa", "sofa-porto"]);
  });

  it.each([
    "Boa tarde! Qual modelo você procura? Posso ajudar.",
    "Boa tarde! Posso te ajudar a encontrar o produto ideal. Me conta o que você procura.",
    "Boa tarde! Vamos achar o modelo certo para você. Me conta como é o seu espaço.",
  ])("referência genérica em saudação não é tratada como citação de produto: %j", async (message) => {
    const decision = await decideWith(message, { status: "not_requested", products: [] });
    expect(decision).toMatchObject({ kind: "reply", message });
  });

  it("medida não verificada continua bloqueada", async () => {
    const decision = await decideWith("Boa tarde! Trabalhamos com opções de 4 a 8 metros. Como posso ajudar.", { status: "not_requested", products: [] });
    expect(decision.kind).toBe("handoff");
  });
});

// ------------------------------------------------------------------ runAgentTurn + memória

function memoryStore(rows: Row[]) {
  const tables: Record<string, Row[]> = { products: rows, conversation_sales_states: [] };
  const persisted: Row[] = [];
  from.mockImplementation((table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let single = false;
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    Object.assign(builder, {
      select: chain, order: chain, limit: chain,
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
      in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; },
      maybeSingle: () => { single = true; return builder; },
      insert: async () => ({ data: null, error: null }),
      upsert: async (row: Row) => {
        const list = tables.conversation_sales_states;
        const index = list.findIndex((r) => r.scope_id === row.scope_id && r.company_id === row.company_id);
        if (index >= 0) list[index] = row; else list.push(row);
        persisted.push(row);
        return { data: null, error: null };
      },
      then: (resolve: (value: unknown) => unknown) => {
        const data = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
        return Promise.resolve(resolve({ data: single ? data[0] ?? null : data, error: null }));
      },
    });
    return builder;
  });
  return { persisted, current: () => tables.conversation_sales_states[0] ?? null };
}

describe("runAgentTurn: memória comercial não recebe produtos sem interesse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    listLearningCandidates.mockResolvedValue([]);
    retrieveLearnings.mockReturnValue({ selected: [], scored: [], metrics: {} });
  });

  async function turn(history: Array<{ role: "lead" | "agent"; text: string; productIds?: string[] }>, reply: Record<string, unknown>) {
    fetchMock.mockResolvedValueOnce({ ok: true, headers: { get: () => null }, json: async () => toolCall("respond_to_customer", reply) });
    return runAgentTurn({
      ctx: buildContext(),
      history,
      leadName: null,
      salesStateScope: { scopeType: "training_session", scopeId: "session-greeting" },
    });
  }

  it("saudação → pedido → continuidade", async () => {
    const store = memoryStore(furnitureRows);

    const greeting = await turn([{ role: "lead", text: "boa tarde, tudo bem?" }], { message: "Boa tarde! Tudo bem, e você? Em que posso ajudar?" });
    expect(greeting.kind).toBe("reply");
    expect(greeting.suggested_products ?? []).toEqual([]);
    expect(store.current()).toMatchObject({ product_ids: [], last_valid_product_ids: [] });
    const greetingPrompt = JSON.parse(String(fetchMock.mock.calls[0][1].body)).messages[0].content as string;
    for (const product of furniture) expect(greetingPrompt).not.toContain(product.id);

    const history = [
      { role: "lead" as const, text: "boa tarde, tudo bem?" },
      { role: "agent" as const, text: "Boa tarde! Tudo bem, e você? Em que posso ajudar?" },
      { role: "lead" as const, text: "quero ver os sofás" },
    ];
    const request = await turn(history, { message: "Temos o Sofá Lisboa e o Sofá Porto. Para qual ambiente?", suggest_products: ["sofa-lisboa", "sofa-porto"] });
    expect(request.kind).toBe("reply");
    expect(request.suggested_products).toEqual(["sofa-lisboa", "sofa-porto"]);
    expect(store.current()).toMatchObject({ product_ids: ["sofa-lisboa", "sofa-porto"] });

    const thanks = await turn(
      [...history, { role: "agent", text: "Temos o Sofá Lisboa e o Sofá Porto. Para qual ambiente?", productIds: ["sofa-lisboa", "sofa-porto"] }, { role: "lead", text: "obrigado!" }],
      { message: "Imagina! Fico à disposição." },
    );
    expect(thanks.kind).toBe("reply");
    expect(store.current()).toMatchObject({ product_ids: ["sofa-lisboa", "sofa-porto"] });
  });

  it("pedido genérico respondido com pergunta não grava produtos selecionados", async () => {
    const store = memoryStore(furnitureRows);
    const decision = await turn([{ role: "lead", text: "quero ver os sofás" }], { message: "Claro! Para qual ambiente seria e quantos lugares você precisa?" });
    expect(decision.kind).toBe("reply");
    expect(decision.presented_product_ids ?? []).toEqual([]);
    expect(store.current()).toMatchObject({ product_ids: [] });
  });
});
