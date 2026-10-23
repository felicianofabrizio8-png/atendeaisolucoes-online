import { beforeEach, describe, expect, it, vi } from "vitest";

// Validação de alegações e independência de segmento: o motor só aceita fatos
// (preço, medida, garantia, condição, característica) presentes nos dados
// autorizados da empresa, aceita opinião comercial sem números e não carrega
// vocabulário fixo de nenhum segmento.

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
import { SalesAgentCore, buildSalesAgentCompletionRequest, type AgentContext } from "../sales-agent-core";
import { SALES_AGENT_PLAYBOOK } from "../sales-agent-playbook";
import { searchSalesAgentCatalog } from "../sales-agent-grounding.server";

type Row = Record<string, unknown>;
type Product = AgentContext["grounding"]["catalog"][number];

function product(row: Row): Product {
  return {
    id: row.id as string,
    name: row.name as string,
    model: (row.model as string | null) ?? null,
    sku: null,
    category: (row.category as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    lengthM: (row.length_m as number | null) ?? null,
    widthM: (row.width_m as number | null) ?? null,
    depthM: (row.depth_m as number | null) ?? null,
    capacityL: null,
    shape: (row.shape as string | null) ?? null,
    specifications: (row.specifications as Record<string, unknown>) ?? {},
    includedItems: (row.included_items as string[]) ?? [],
    variants: [],
    price: (row.price as number | null) ?? null,
    promoPrice: null,
    images: [],
    notes: (row.notes as string | null) ?? null,
  } as Product;
}

const POOL = "company-pool";
const FURNITURE = "company-furniture";

const poolRows: Row[] = [
  {
    id: "praia", company_id: POOL, active: true, name: "Piscina de Fibra Praia 6x3", model: "Praia 6x3", category: "Piscinas de fibra",
    description: "Modelo mais vendido para famílias, com prainha e degraus internos.", length_m: 6, width_m: 3, depth_m: 1.4,
    shape: "retangular", included_items: ["Casa de máquinas", "Filtro"], price: 22900,
  },
];
const furnitureRows: Row[] = [
  {
    id: "lisboa", company_id: FURNITURE, active: true, name: "Sofá Lisboa", model: "Lisboa 3 lugares", category: "Sofás",
    description: "Sofá retrátil e reclinável, revestido em linho.", specifications: { material: "linho" }, price: 3200,
  },
  {
    id: "oval", company_id: FURNITURE, active: true, name: "Mesa Oval", model: "Oval 6 lugares", category: "Mesas",
    description: "Mesa de jantar para 6 pessoas.", shape: "oval", price: 1900,
  },
];

const rules = {
  [POOL]: {
    paymentMethods: null,
    commercialTerms: "Desconto acima de 5% só com aprovação do gerente.",
    paymentPolicy: "Pix com 5% de desconto; cartão em até 12x sem juros.",
    installationPolicy: "Instalação feita por equipe própria.",
    nextLoadForecast: null,
    visitPolicy: "Visita técnica gratuita em Campinas e região.",
    heatingPolicy: null,
    shippingPolicy: "Frete grátis até 50 km de Campinas.",
    includedItemsPolicy: null,
  },
  [FURNITURE]: {
    paymentMethods: null,
    commercialTerms: null,
    paymentPolicy: "Cartão em até 10x sem juros.",
    installationPolicy: null,
    nextLoadForecast: null,
    visitPolicy: null,
    heatingPolicy: null,
    shippingPolicy: "Entrega em até 15 dias úteis.",
    includedItemsPolicy: null,
  },
};

function buildContext(companyId: string, catalog: Product[], status: "matches" | "not_requested" = "matches"): AgentContext {
  return {
    settings: {
      company_id: companyId, ai_auto_reply_enabled: true, ai_after_hours_only: false, ai_initial_message: null,
      ai_max_auto_replies: 3, ai_handoff_timeout_minutes: 30, ai_agent_name: "Bruna",
      business_hours_start: "08:00:00", business_hours_end: "18:00:00",
      sales_agent_v2_enabled: true, sales_agent_v2_mode: "automatic",
      // Desconto só pela política estruturada do lojista (a de móveis não tem nenhuma).
      ...(companyId === POOL
        ? { ai_discount_mode: "authorized", ai_discount_rules: [{ percent: 5, condition: "pagamento no Pix" }] }
        : {}),
    },
    companyName: companyId === POOL ? "Piscinas Teste" : "Móveis Teste",
    products: catalog,
    catalogProductIds: catalog.map((p) => p.id),
    catalogForValidation: catalog,
    knowledge: [],
    aiProfile: {
      tone: "consultivo", description: null, products: null, payment_methods: null, avg_lead_time: null, region: null,
      differentials: companyId === POOL ? "Garantia de 5 anos na estrutura." : null, faq: [],
    },
    grounding: {
      catalog,
      catalogSearch: status === "matches" ? { status, products: catalog } : { status, products: [] },
      catalogScope: { companyId, activeOnly: true },
      faqKnowledge: [],
      commercialRules: rules[companyId as keyof typeof rules],
      approvedCoachLearnings: [],
      activeCoachRules: [],
      quickReplies: [],
    },
  } as unknown as AgentContext;
}

function toolCall(name: string, args: Record<string, unknown>) {
  return { choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }] };
}

async function decide(companyId: string, leadText: string, message: string, options: { suggest?: string[]; status?: "matches" | "not_requested" } = {}) {
  const catalog = (companyId === POOL ? poolRows : furnitureRows).map(product);
  const ctx = buildContext(companyId, catalog, options.status);
  const core = new SalesAgentCore(async () => ({
    ok: true,
    data: toolCall("respond_to_customer", { message, ...(options.suggest ? { suggest_products: options.suggest } : {}) }),
  }));
  return core.decide({
    ctx,
    history: [{ role: "lead", text: leadText }],
    leadName: null,
    model: "provider/sales-model",
    catalogSearch: ctx.grounding.catalogSearch,
  } as never);
}

const pool = (lead: string, message: string, suggest = ["praia"]) => decide(POOL, lead, message, { suggest });
const furniture = (lead: string, message: string, suggest = ["lisboa"]) => decide(FURNITURE, lead, message, { suggest });

describe("preço", () => {
  it("aceita o preço cadastrado citando o nome completo do produto", async () => {
    const decision = await pool("Quanto custa a Praia 6x3?", "A Piscina de Fibra Praia 6x3 está com preço cadastrado de R$ 22.900,00.");
    expect(decision.kind).toBe("reply");
  });

  it("aceita preço com opinião comercial sem números (caso do laboratório)", async () => {
    const message = "A piscina de fibra Praia 6x3 está com preço cadastrado de R$ 22.900,00. Ela é ideal para famílias, com prainha e degraus internos, perfeita para conforto e lazer. Se quiser, posso enviar fotos para você conhecer melhor esse modelo.";
    expect(await pool("Quanto custa a Praia 6x3?", message)).toMatchObject({ kind: "reply", message });
  });

  it("bloqueia preço diferente do cadastrado", async () => {
    expect((await pool("Quanto custa a Praia 6x3?", "A Praia 6x3 custa R$ 19.900,00.")).kind).toBe("handoff");
  });

  it("bloqueia preço inventado em outro segmento", async () => {
    expect((await furniture("Quanto custa o Sofá Lisboa?", "O Sofá Lisboa custa R$ 2.500,00.")).kind).toBe("handoff");
    expect((await furniture("Quanto custa o Sofá Lisboa?", "O Sofá Lisboa custa R$ 3.200,00 e é perfeito para relaxar.")).kind).toBe("reply");
  });
});

describe("alegações objetivas e comerciais", () => {
  it.each([
    ["garantia diferente da cadastrada", "A Praia 6x3 tem garantia de 10 anos."],
    ["característica não cadastrada", "A Praia 6x3 custa R$ 22.900,00 e é aquecida."],
    ["material não cadastrado", "A Praia 6x3 é feita de fibra de vidro reforçada."],
    ["item não cadastrado", "A Praia 6x3 vem com hidromassagem e LED."],
    ["capacidade de uso não cadastrada", "A Praia 6x3 é ideal para 12 pessoas."],
    ["parcelamento acima da política", "Você pode pagar a Praia 6x3 em 18x sem juros."],
    ["parcelamento por extenso acima da política", "Podemos parcelar em até 18 vezes sem juros."],
    ["desconto acima da política", "Consigo 10% de desconto na Praia 6x3."],
  ])("bloqueia %s", async (_label, message) => {
    const decision = await pool("Me fala da Praia 6x3", message);
    expect(decision.kind).toBe("handoff");
    expect(decision.message).toBeUndefined();
  });

  it.each([
    ["garantia cadastrada", "A Praia 6x3 tem garantia de 5 anos na estrutura."],
    ["item cadastrado", "A Praia 6x3 vem com casa de máquinas e filtro."],
    ["característica da descrição", "A Praia 6x3 é perfeita para a família, com prainha e degraus internos."],
    ["parcelamento da política", "Dá para pagar em até 12x sem juros no cartão."],
    ["parcelamento da política escrito por extenso", "Podemos parcelar a compra no cartão em até 12 vezes sem juros."],
    ["desconto da política", "No Pix você tem 5% de desconto."],
    ["frete da política", "O frete é grátis até 50 km de Campinas."],
  ])("aceita %s", async (_label, message) => {
    expect((await pool("Me fala da Praia 6x3", message)).kind).toBe("reply");
  });

  it("bloqueia condição comercial sem produto citado e sem política", async () => {
    expect((await decide(FURNITURE, "boa tarde", "Boa tarde! Aqui o frete é grátis para todo o Brasil.", { status: "not_requested" })).kind).toBe("handoff");
    expect((await decide(FURNITURE, "boa tarde", "Boa tarde! Todos os produtos têm garantia de 2 anos.", { status: "not_requested" })).kind).toBe("handoff");
  });

  it("valida material pelo cadastro da empresa, sem vocabulário de segmento", async () => {
    expect((await furniture("De que é feito o Lisboa?", "O Sofá Lisboa é revestido em linho.")).kind).toBe("reply");
    expect((await furniture("De que é feito o Lisboa?", "O Sofá Lisboa é revestido em couro legítimo.")).kind).toBe("handoff");
    expect((await furniture("O Lisboa reclina?", "Sim, o Sofá Lisboa é retrátil e reclinável.")).kind).toBe("reply");
    expect((await furniture("O Lisboa é impermeável?", "O Sofá Lisboa é impermeabilizado.")).kind).toBe("handoff");
  });
});

describe("objeção comercial", () => {
  it("responde objeção de preço com valor e condição autorizada", async () => {
    const message = "Entendo! A Praia 6x3 já vem com casa de máquinas e filtro, e no Pix você tem 5% de desconto.";
    expect(await pool("Achei caro, não tem desconto?", message)).toMatchObject({ kind: "reply", message });
  });

  it("não aceita desconto ou preço negociado inventado", async () => {
    expect((await pool("Achei caro, não tem desconto?", "Para você consigo 15% de desconto na Praia 6x3.")).kind).toBe("handoff");
    expect((await pool("Achei caro, não tem desconto?", "Consigo fazer a Praia 6x3 por R$ 20.000,00.")).kind).toBe("handoff");
  });

  it.each([
    "Achei caro, não tem desconto?",
    "Dá pra parcelar?",
    "E a garantia, como é?",
    "Vocês tem frete grátis?",
  ])("objeção/pergunta comercial %j mantém o produto em discussão em vez de 'produto não encontrado'", (text) => {
    const catalog = poolRows.map(product);
    const scope = { companyId: POOL, activeOnly: true as const };
    const state = { productIds: ["praia"], attributes: {}, intent: "orçamento", lastValidProductIds: ["praia"] };
    expect(searchSalesAgentCatalog(POOL, catalog, [{ role: "lead", text }], state, scope, { continuityEnabled: true }))
      .toEqual({ status: "matches", products: [catalog[0]], basis: "focus" });
    // Sem produto em discussão, a pergunta comercial não é tratada como produto inexistente.
    expect(searchSalesAgentCatalog(POOL, catalog, [{ role: "lead", text }], null, scope, { continuityEnabled: true }).status)
      .toBe("not_requested");
  });

  it("sem política de desconto, a mesma frase de desconto não passa (texto livre não autoriza)", async () => {
    expect((await decide(FURNITURE, "Tem desconto?", "No Pix você tem 5% de desconto.", { suggest: ["lisboa"] })).kind).toBe("handoff");
    // Recusar e seguir vendendo é permitido.
    expect((await furniture("Tem desconto?", "O valor do Sofá Lisboa é o cadastrado, sem desconto, e sai em até 10x sem juros.")).kind).toBe("reply");
  });

  it("objeção em outro segmento usa só a política daquela empresa", async () => {
    expect((await furniture("Tá caro", "Entendo! O Sofá Lisboa sai em até 10x sem juros.")).kind).toBe("reply");
    // 12x é política da empresa de piscinas, não da de móveis.
    expect((await furniture("Tá caro", "Entendo! O Sofá Lisboa sai em até 12x sem juros.")).kind).toBe("handoff");
  });
});

describe("motor sem regras fixas de segmento", () => {
  const segmentTerms = /piscin|fibra|vinil|prainha|quadrad|escava|casa de m[aá]quina|motobomba/i;

  it("o playbook genérico não menciona nenhum segmento", () => {
    expect(SALES_AGENT_PLAYBOOK).not.toMatch(segmentTerms);
  });

  it("prompt e ferramentas da empresa de móveis não carregam vocabulário de piscina", () => {
    const catalog = furnitureRows.map(product);
    const ctx = buildContext(FURNITURE, catalog);
    const request = buildSalesAgentCompletionRequest({
      ctx,
      history: [{ role: "lead", text: "boa tarde, quero um sofá" }],
      leadName: null,
      model: "provider/sales-model",
      catalogSearch: ctx.grounding.catalogSearch,
    } as never);
    expect(JSON.stringify(request)).not.toMatch(segmentTerms);
  });

  it("o prompt de cada empresa leva só a política de desconto dela", () => {
    const prompt = (companyId: string, rows: Row[]) => {
      const ctx = buildContext(companyId, rows.map(product));
      return String(buildSalesAgentCompletionRequest({
        ctx,
        history: [{ role: "lead", text: "tem desconto?" }],
        leadName: null,
        model: "provider/sales-model",
        catalogSearch: ctx.grounding.catalogSearch,
      } as never).messages[0].content);
    };
    expect(prompt(FURNITURE, furnitureRows)).toContain("a empresa não oferece desconto");
    expect(prompt(FURNITURE, furnitureRows)).not.toContain("5% — pagamento no Pix");
    expect(prompt(POOL, poolRows)).toContain("- 5% — pagamento no Pix");
  });

  it("formato é validado pelos formatos cadastrados, não por equivalências fixas", async () => {
    expect((await furniture("Tem mesa redonda?", "A Mesa Oval tem formato oval.", ["oval"])).kind).toBe("reply");
    expect((await furniture("Tem mesa redonda?", "A Mesa Oval tem formato redondo.", ["oval"])).kind).not.toBe("reply");
  });
});

// ------------------------------------------------------------------ multiempresa

function sharedStore(rows: Row[]) {
  const tables: Record<string, Row[]> = { products: rows, conversation_sales_states: [] };
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
        const index = list.findIndex((r) => r.company_id === row.company_id && r.scope_type === row.scope_type && r.scope_id === row.scope_id);
        if (index >= 0) list[index] = row; else list.push(row);
        return { data: null, error: null };
      },
      then: (resolve: (value: unknown) => unknown) => {
        const data = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
        return Promise.resolve(resolve({ data: single ? data[0] ?? null : data, error: null }));
      },
    });
    return builder;
  });
  return { state: (companyId: string) => tables.conversation_sales_states.find((r) => r.company_id === companyId) ?? null };
}

describe("catálogo e memória por empresa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    listLearningCandidates.mockResolvedValue([]);
    retrieveLearnings.mockReturnValue({ selected: [], scored: [], metrics: {} });
  });

  it("busca de catálogo não encontra produto de outra empresa", () => {
    const furnitureCatalog = furnitureRows.map(product);
    const result = searchSalesAgentCatalog(FURNITURE, furnitureCatalog, [{ role: "lead", text: "quanto custa a Praia 6x3?" }], null, { companyId: FURNITURE, activeOnly: true }, { continuityEnabled: true });
    expect(result.status === "matches" ? result.products.map((p) => p.id) : []).not.toContain("praia");
  });

  it("mesma sessão em duas empresas mantém catálogos e memórias separados", async () => {
    const store = sharedStore([...poolRows, ...furnitureRows]);
    const reply = (args: Record<string, unknown>) => fetchMock.mockResolvedValueOnce({ ok: true, headers: { get: () => null }, json: async () => toolCall("respond_to_customer", args) });

    reply({ message: "A Praia 6x3 custa R$ 22.900,00.", suggest_products: ["praia"] });
    const poolDecision = await runAgentTurn({
      ctx: buildContext(POOL, poolRows.map(product)),
      history: [{ role: "lead", text: "quanto custa a Praia 6x3?" }],
      leadName: null,
      salesStateScope: { scopeType: "training_session", scopeId: "same-session" },
    });
    const poolPrompt = String(JSON.parse(String(fetchMock.mock.calls[0][1].body)).messages[0].content);

    reply({ message: "O Sofá Lisboa custa R$ 3.200,00.", suggest_products: ["lisboa"] });
    const furnitureDecision = await runAgentTurn({
      ctx: buildContext(FURNITURE, furnitureRows.map(product)),
      history: [{ role: "lead", text: "quanto custa o Sofá Lisboa?" }],
      leadName: null,
      salesStateScope: { scopeType: "training_session", scopeId: "same-session" },
    });
    const furniturePrompt = String(JSON.parse(String(fetchMock.mock.calls[1][1].body)).messages[0].content);

    expect(poolDecision).toMatchObject({ kind: "reply", suggested_products: ["praia"] });
    expect(furnitureDecision).toMatchObject({ kind: "reply", suggested_products: ["lisboa"] });
    expect(poolPrompt).not.toMatch(/lisboa|oval/i);
    expect(furniturePrompt).not.toMatch(/praia/i);
    expect(store.state(POOL)).toMatchObject({ product_ids: ["praia"] });
    expect(store.state(FURNITURE)).toMatchObject({ product_ids: ["lisboa"] });
  });

  it("modelo que sugere produto de outra empresa é recusado", async () => {
    sharedStore([...poolRows, ...furnitureRows]);
    fetchMock.mockResolvedValueOnce({ ok: true, headers: { get: () => null }, json: async () => toolCall("respond_to_customer", { message: "Veja também a Praia 6x3.", suggest_products: ["praia"] }) });
    const decision = await runAgentTurn({
      ctx: buildContext(FURNITURE, furnitureRows.map(product)),
      history: [{ role: "lead", text: "quanto custa o Sofá Lisboa?" }],
      leadName: null,
      salesStateScope: { scopeType: "training_session", scopeId: "s-cross" },
    });
    expect(decision.kind).toBe("handoff");
  });
});
