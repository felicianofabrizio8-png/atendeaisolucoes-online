// Busca por medida/atributo e comparação de preços cadastrados.
// Reproduz: "estava pensando em 6 metros" deixava compatíveis de fora e
// "qual você tem boa de preço?" terminava em handoff. A intenção de comparar
// preços é classificada pelo LLM (tool compare_catalog_prices); a execução é
// determinística, só com produtos e preços cadastrados.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({ postGraph: vi.fn() }));

import {
  COMPARE_CATALOG_PRICES_TOOL,
  SalesAgentCore,
  buildSalesAgentCompletionRequest,
  type AgentContext,
  type SalesAgentCatalogSearch,
  type SalesAgentCompletion,
  type SalesAgentCoreInput,
} from "../sales-agent-core";
import {
  filterProductsByStructuredAttributes,
  searchSalesAgentCatalog,
} from "../sales-agent-grounding.server";
import {
  buildPriceComparisonReply,
  resolvePriceComparisonPool,
} from "../sales-agent-price-comparison";
import { detectHandoffNeeded, runSafetyLayer } from "../ai-agent.server";

type Product = AgentContext["grounding"]["catalog"][number];

function product(id: string, overrides: Partial<Product>): Product {
  return {
    id,
    name: `Item ${id}`,
    category: "Linha",
    description: null,
    price: null,
    promoPrice: null,
    images: [],
    notes: null,
    ...overrides,
  };
}

// Descrições sem "em"/"metros": a busca textual antiga não os achava.
const catalog: Product[] = [
  product("a", { name: "Modelo Aurora", lengthM: 6, widthM: 3, price: 21_000 }),
  product("b", {
    name: "Modelo Brisa",
    lengthM: 6,
    widthM: 2.5,
    price: 18_500,
    promoPrice: 17_900,
  }),
  product("c", { name: "Modelo Coral", lengthM: 6, widthM: 3.2, price: 24_000 }),
  product("d", { name: "Modelo Duna", lengthM: 6, widthM: 2.8, price: 19_990 }),
  product("e", { name: "Modelo Eco 6x3", description: "Linha básica 6x3", price: 16_000 }),
  product("f", {
    name: "Modelo Farol",
    lengthM: 5,
    widthM: 2.5,
    price: 12_000,
    description: "Ideal em espaços menores, 5 metros",
  }),
  product("g", {
    name: "Modelo Grão",
    lengthM: 7,
    widthM: 3.5,
    price: 30_000,
    description: "Grande, em 7 metros",
  }),
  product("h", {
    name: "Modelo Horizonte",
    lengthM: 8,
    widthM: 4,
    price: 36_000,
    description: "Versão estendida em fibra",
  }),
];
const sixMeterIds = ["a", "b", "c", "d", "e"];
const scope = { companyId: "company-x", activeOnly: true as const };

function search(history: SalesAgentCoreInput["history"], products: Product[] = catalog) {
  return searchSalesAgentCatalog("company-x", products, history, null, scope, {});
}

describe("busca por medida recupera todos os compatíveis ativos", () => {
  it("'estava pensando em 6 metros' traz exatamente os cinco de 6 m", () => {
    const result = search([
      { role: "lead", text: "Gostaria de saber mais informações sobre os produtos" },
      { role: "agent", text: "Claro! Qual a sua cidade?" },
      { role: "lead", text: "estava pensando em 6 metros" },
    ]);
    expect(result.status).toBe("matches");
    if (result.status !== "matches") return;
    expect(result.products.map((p) => p.id).sort()).toEqual(sixMeterIds);
    expect(result.exhaustive).toBe(true);
  });

  it("usa medida principal do nome quando o campo não está cadastrado", () => {
    const matches = filterProductsByStructuredAttributes(catalog, [
      { role: "lead", text: "tem de 6m?" },
    ]);
    expect(matches?.map((p) => p.id)).toContain("e");
  });

  it("combina medidas (comprimento x largura) e capacidade", () => {
    expect(
      filterProductsByStructuredAttributes(catalog, [{ role: "lead", text: "procuro 6x3" }])?.map(
        (p) => p.id,
      ),
    ).toEqual(["a"]);
    const byCapacity = filterProductsByStructuredAttributes(
      [product("x", { capacityL: 5000 }), product("y", { capacityL: 3000 })],
      [{ role: "lead", text: "quero de 5 mil litros" }],
    );
    expect(byCapacity?.map((p) => p.id)).toEqual(["x"]);
  });

  it("outro segmento: filtra pelos campos estruturados do catálogo dessa empresa", () => {
    const otherSegment = [
      product("m1", { name: "Armário Linha Norte", widthM: 1.2, lengthM: 2.1, price: 3_200 }),
      product("m2", { name: "Armário Linha Sul", widthM: 0.9, lengthM: 2.1, price: 2_700 }),
      product("m3", { name: "Painel Linha Leste", widthM: 1.2, lengthM: 1.8, price: 1_900 }),
    ];
    const result = search([{ role: "lead", text: "preciso de largura 1,2 m" }], otherSegment);
    expect(result.status === "matches" && result.products.map((p) => p.id).sort()).toEqual([
      "m1",
      "m3",
    ]);
  });

  it("sem medida na mensagem não filtra; medida sem compatível cai na busca normal", () => {
    expect(
      filterProductsByStructuredAttributes(catalog, [{ role: "lead", text: "quero ver opções" }]),
    ).toBeNull();
    const result = search([{ role: "lead", text: "tem de 12 metros?" }]);
    expect(result.status === "matches" && result.exhaustive).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Comparação de preço: intenção pelo LLM, execução determinística
// ---------------------------------------------------------------------------

const rules = {
  paymentMethods: null,
  commercialTerms: null,
  paymentPolicy: "Pix ou cartão em até 10x sem juros.",
  installationPolicy: null,
  nextLoadForecast: null,
  visitPolicy: null,
  heatingPolicy: null,
  shippingPolicy: "Frete calculado pelo CEP, entrega em até 15 dias úteis.",
  includedItemsPolicy: null,
};

const ctx: AgentContext = {
  settings: {
    company_id: "company-x",
    ai_auto_reply_enabled: true,
    ai_after_hours_only: false,
    ai_initial_message: null,
    ai_max_auto_replies: 5,
    ai_handoff_timeout_minutes: 30,
    ai_agent_name: "Atendente",
    business_hours_start: "08:00",
    business_hours_end: "18:00",
  },
  companyName: "Empresa X",
  aiProfile: null,
  products: catalog,
  catalogForValidation: catalog,
  knowledge: [],
  grounding: {
    catalog,
    catalogSearch: { status: "matches", products: catalog },
    faqKnowledge: [],
    commercialRules: rules,
    approvedCoachLearnings: [],
  },
};

const interpretation: SalesAgentCoreInput["interpretation"] = {
  intent: null,
  attributes: {},
  references: { lastLeadText: "", productIds: [] },
};

/** Conversa do teste real: pediu 6 m e recebeu os cinco compatíveis. */
function realConversation(lastLead: string): SalesAgentCoreInput["history"] {
  return [
    { role: "lead", text: "Gostaria de saber mais informações sobre os produtos" },
    { role: "agent", text: "Claro! Qual a sua cidade?" },
    { role: "lead", text: "estava pensando em 6 metros" },
    { role: "agent", text: "Temos estes modelos de 6 m.", productIds: sixMeterIds },
    { role: "lead", text: lastLead },
  ];
}

function toolCall(name: string, args: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    data: {
      choices: [
        { message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } },
      ],
    },
  });
}

async function decide(
  history: SalesAgentCoreInput["history"],
  complete: ReturnType<typeof vi.fn>,
  extra: Partial<SalesAgentCoreInput> = {},
) {
  const catalogSearch: SalesAgentCatalogSearch = search(history);
  return new SalesAgentCore(complete as unknown as SalesAgentCompletion).decide({
    ctx: { ...ctx, grounding: { ...ctx.grounding, catalogSearch } },
    history,
    leadName: null,
    model: "provider/model",
    interpretation,
    catalogSearch,
    priceComparison: { catalog },
    ...extra,
  });
}

describe("tool compare_catalog_prices no pedido ao LLM", () => {
  it("existe e orienta a separar comparação, negociação e custo-benefício", () => {
    const history = realConversation("Qual voce tem boa de preço ai?");
    const catalogSearch = search(history);
    const request = buildSalesAgentCompletionRequest({
      ctx: { ...ctx, grounding: { ...ctx.grounding, catalogSearch } },
      history,
      leadName: null,
      model: "provider/model",
      interpretation,
      catalogSearch,
    });
    const tool = request.tools
      .map(
        (entry) =>
          entry.function as {
            name: string;
            description: string;
            parameters: { properties: Record<string, unknown> };
          },
      )
      .find((fn) => fn.name === COMPARE_CATALOG_PRICES_TOOL);
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/desconto/i);
    expect(tool?.description).toMatch(/request_human_handoff/);
    expect(tool?.description).toMatch(/custo-benefício/i);
    expect(Object.keys(tool?.parameters.properties ?? {})).toEqual(
      expect.arrayContaining(["order", "product_ids", "other_topics"]),
    );
  });
});

describe("comparação classificada pelo LLM, respondida só com o catálogo", () => {
  // Formas variadas — inclusive sem nenhuma expressão de preço conhecida. O
  // código não interpreta a frase: só executa a intenção devolvida pelo LLM.
  it.each([
    "Qual voce tem boa de preço ai?",
    "qual pesa menos no bolso?",
    "e qual sai por menos entre essas?",
    "tem alguma mais em conta?",
    "which one is cheaper?",
    "me indica a de menor investimento",
  ])("'%s' → menores preços reais do conjunto apresentado", async (text) => {
    const decision = await decide(
      realConversation(text),
      toolCall(COMPARE_CATALOG_PRICES_TOOL, { order: "lowest_first" }),
    );
    expect(decision.kind).toBe("reply");
    expect(decision.fallback_reason).toBe("catalog_price_comparison");
    expect(decision.message).toContain("Modelo Eco 6x3 (R$ 16.000,00)");
    expect(decision.message).toContain("Modelo Brisa (R$ 17.900,00, promocional)");
    expect(decision.suggested_products).toEqual(["e", "b", "d"]);
    expect(runSafetyLayer(decision, null).kind).toBe("reply");
  });

  it("maior preço quando o LLM classifica como highest_first", async () => {
    const decision = await decide(
      realConversation("e a mais top de valor?"),
      toolCall(COMPARE_CATALOG_PRICES_TOOL, { order: "highest_first" }),
    );
    expect(decision.message).toContain("maior valor é Modelo Coral (R$ 24.000,00)");
  });

  it("IDs e valores vindos do modelo não inventam preço nem produto", async () => {
    const decision = await decide(
      realConversation("qual a mais barata?"),
      toolCall(COMPARE_CATALOG_PRICES_TOOL, {
        order: "lowest_first",
        product_ids: ["inexistente", "outro-tenant"],
        price: 1,
      }),
    );
    expect(decision.message).not.toMatch(/R\$ 1,00|inexistente|outro-tenant/);
    expect(decision.suggested_products?.every((id) => catalog.some((p) => p.id === id))).toBe(true);
  });

  it("produtos citados pelo cliente restringem o conjunto", async () => {
    const decision = await decide(
      realConversation("entre a Aurora e a Coral, qual é mais barata?"),
      toolCall(COMPARE_CATALOG_PRICES_TOOL, { order: "lowest_first", product_ids: ["a", "c"] }),
    );
    expect(decision.suggested_products).toEqual(["a", "c"]);
    expect(decision.message).toContain("mais em conta é Modelo Aurora (R$ 21.000,00)");
  });

  it("sem contexto nem medida compara o catálogo ativo", () => {
    const pool = resolvePriceComparisonPool({
      catalog,
      history: [{ role: "lead", text: "qual o mais em conta?" }],
    });
    expect(pool).toHaveLength(catalog.length);
  });

  it("conjunto sem preço cadastrado não inventa: vai para humano", async () => {
    const noPrice = catalog.map((p) => ({ ...p, price: null, promoPrice: null }));
    const decision = await decide(
      [{ role: "lead", text: "qual o mais barato?" }],
      toolCall(COMPARE_CATALOG_PRICES_TOOL, { order: "lowest_first" }),
      { priceComparison: { catalog: noPrice } },
    );
    expect(decision).toMatchObject({ kind: "handoff", reason: "catalog_price_unavailable" });
  });
});

describe("custo-benefício e negociação", () => {
  it("custo-benefício respondido pelo LLM segue o caminho normal validado", async () => {
    const decision = await decide(
      realConversation("qual tem melhor custo-benefício?"),
      toolCall("respond_to_customer", {
        message: "Depende do seu espaço e uso. Quer que eu te ajude a comparar os itens inclusos?",
      }),
    );
    expect(decision.kind).toBe("reply");
    expect(decision.fallback_reason).toBeUndefined();
    expect(decision.message).not.toContain("mais em conta");
  });

  it("negociação classificada pelo LLM vai para humano", async () => {
    const decision = await decide(
      realConversation("consegue fazer mais barato pra mim?"),
      toolCall("request_human_handoff", { reason: "negociação de valor" }),
    );
    expect(decision.kind).toBe("handoff");
  });

  it("turno sensível a preço: texto livre do LLM continua indo para humano", async () => {
    const decision = await decide(
      realConversation("tem algum mais barato"),
      toolCall("respond_to_customer", { message: "Consigo ver um valor melhor para você." }),
      { priceSensitive: true },
    );
    expect(decision).toMatchObject({ kind: "handoff", reason: "pre_check_price_sensitive" });
  });

  it("turno sensível a preço: comparação determinística é permitida", async () => {
    const decision = await decide(
      realConversation("tem algum mais barato"),
      toolCall(COMPARE_CATALOG_PRICES_TOOL, { order: "lowest_first" }),
      { priceSensitive: true },
    );
    expect(decision.kind).toBe("reply");
    expect(decision.message).toContain("R$ 16.000,00");
  });

  it("pré-check: palavra de preço ambígua é adiada; desconto continua humano", () => {
    expect(
      detectHandoffNeeded("tem algum mais barato", null, { deferPriceSensitive: true }),
    ).toEqual({
      needed: false,
      priceSensitive: true,
    });
    expect(detectHandoffNeeded("tem algum mais barato").needed).toBe(true);
    expect(
      detectHandoffNeeded("me dá um desconto no mais barato", null, { deferPriceSensitive: true })
        .needed,
    ).toBe(true);
  });
});

describe("mensagem com mais de uma intenção", () => {
  it("'qual é a mais barata e como funciona o frete?' responde as duas partes", async () => {
    const decision = await decide(
      realConversation("qual é a mais barata e como funciona o frete?"),
      toolCall(COMPARE_CATALOG_PRICES_TOOL, { order: "lowest_first", other_topics: ["delivery"] }),
    );
    expect(decision.kind).toBe("reply");
    expect(decision.message).toContain("Modelo Eco 6x3 (R$ 16.000,00)");
    expect(decision.message).toContain(rules.shippingPolicy);
    expect(decision.grounding_sources).toEqual(["catalog", "commercial_rules"]);
  });

  it("assunto extra detectado mesmo se o LLM não listar o tópico", async () => {
    const decision = await decide(
      realConversation("qual a mais barata e parcela no cartão?"),
      toolCall(COMPARE_CATALOG_PRICES_TOOL, { order: "lowest_first" }),
    );
    expect(decision.message).toContain(rules.paymentPolicy);
  });

  it("assunto extra sem política cadastrada não é respondido pela metade", async () => {
    const decision = await decide(
      realConversation("qual a mais barata e vocês instalam?"),
      toolCall(COMPARE_CATALOG_PRICES_TOOL, {
        order: "lowest_first",
        other_topics: ["installation"],
      }),
    );
    expect(decision).toMatchObject({ kind: "handoff", reason: "secondary_topic_without_policy" });
  });

  it("a comparação nunca menciona desconto/negociação", () => {
    const reply = buildPriceComparisonReply(catalog.filter((p) => sixMeterIds.includes(p.id)));
    expect(reply?.message).not.toMatch(/desconto|negoci/i);
    expect(buildPriceComparisonReply([product("z", {})])).toBeNull();
  });
});
