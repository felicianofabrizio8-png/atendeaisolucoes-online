// Qualquer produto/serviço ativo em Produtos, de qualquer empresa e segmento,
// é vendável pelo mesmo caminho: busca do catálogo da empresa → foco da
// conversa → prompt com os fatos normalizados → fatos declarados validados.
// Sem configuração por produto, sem exceção por nome, isolado por company_id.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({ postGraph: vi.fn() }));

import {
  SalesAgentCore,
  type AgentContext,
  type SalesAgentCatalogSearch,
  type SalesAgentCompletion,
  type SalesAgentCompletionRequest,
} from "../sales-agent-core";
import { searchSalesAgentCatalog, type AgentHistory } from "../sales-agent-grounding.server";
import { withConversationFocus, getConversationFocusProductIds } from "../sales-agent-focus";
import { normalizeProductFacts, renderFactValue, UNIVERSAL_FACT_KEYS } from "../catalog-facts";

type Product = AgentContext["grounding"]["catalog"][number];

function product(id: string, name: string, extra: Partial<Product>): Product {
  return {
    id,
    name,
    category: null,
    description: null,
    price: null,
    promoPrice: null,
    images: [],
    notes: null,
    ...extra,
  };
}

// Empresas de segmentos diferentes; cada uma cadastrou do seu jeito
// (colunas legadas, atributos tipados, atributos legados, texto).
const TENANTS: Record<string, Product[]> = {
  piscinas: [
    product("pool-401", "Sol 401", {
      category: "Linha Sol",
      price: 15_900,
      promoPrice: 12_900,
      lengthM: 4,
      widthM: 2.5,
      specifications: { "Profundidade (m)": 1.4, Capacidade: "9.500 litros" },
    }),
    product("pool-402", "Sol 402", {
      category: "Linha Sol",
      price: 16_900,
      lengthM: 4.5,
      widthM: 2.5,
      depthM: 1.4,
      capacityL: 11_000,
    }),
    product("pool-caribe", "Piscina Caribe", {
      category: "Piscinas de fibra",
      price: 28_500,
      lengthM: 6,
      widthM: 3,
      depthM: 1.4,
      shape: "retangular",
    }),
  ],
  moveis: [
    product("sofa-aurora", "Sofá Aurora", {
      category: "Sofás",
      price: 3_490,
      promoPrice: 2_990,
      specifications: {
        Largura: { type: "number", value: 2.1, unit: "m" },
        Revestimento: { type: "text", value: "Linho bege" },
        Lugares: { type: "number", value: 3, unit: null },
      },
    }),
    product("sofa-bella", "Sofá Bella", {
      category: "Sofás",
      price: 2_790,
      specifications: { Largura: "1,80 m", Revestimento: "Veludo cinza" },
    }),
    product("mesa-lisboa", "Mesa de jantar Lisboa", {
      category: "Mesas",
      price: 1_890,
      specifications: { Medidas: "1,80 x 0,90 x 0,78 m", Material: "Madeira maciça" },
    }),
  ],
  eletros: [
    product("fridge-polar", "Refrigerador Polar 480", {
      category: "Refrigeradores",
      price: 4_299,
      specifications: { Volume: "480 litros", Tensão: "220V" },
    }),
    product("micro-brisa", "Micro-ondas Brisa", {
      category: "Micro-ondas",
      price: 799,
      specifications: { "Potência (W)": 1200, Capacidade: "30 L" },
    }),
  ],
  moda: [
    product("tee-basica", "Camiseta Básica", {
      category: "Camisetas",
      price: 59.9,
      specifications: {
        Tamanhos: { type: "list", value: ["P", "M", "G", "GG"] },
        Composição: { type: "text", value: "100% algodão" },
      },
    }),
    product("tenis-runner", "Tênis Runner Pro", {
      category: "Calçados",
      price: 459,
      specifications: { Peso: "280 g", Numeração: ["38", "39", "40", "41", "42"] },
    }),
  ],
  servicos: [
    product("massagem", "Massagem relaxante", {
      category: "Massagens",
      price: 180,
      specifications: { Duração: { type: "number", value: 60, unit: "min" } },
    }),
    product("limpeza", "Limpeza de pele profunda", {
      category: "Estética facial",
      price: 220,
      description: "Sessão de 90 minutos com extração e máscara calmante.",
    }),
  ],
  alimentos: [
    product("bolo-cenoura", "Bolo de cenoura", {
      category: "Bolos",
      price: 65,
      specifications: { Peso: { type: "number", value: 1.2, unit: "kg" }, Rendimento: "12 fatias" },
      includedItems: ["Cobertura de chocolate"],
    }),
  ],
};

const rules = {
  paymentMethods: null,
  commercialTerms: null,
  paymentPolicy: null,
  installationPolicy: null,
  visitPolicy: null,
  heatingPolicy: null,
  shippingPolicy: null,
  includedItemsPolicy: null,
};

function search(companyId: string, history: AgentHistory): SalesAgentCatalogSearch {
  const catalog = TENANTS[companyId];
  const lexical = searchSalesAgentCatalog(
    companyId,
    catalog,
    history,
    null,
    { companyId, activeOnly: true },
    { continuityEnabled: true },
  ) as SalesAgentCatalogSearch;
  const focus = getConversationFocusProductIds(history).flatMap((id) => {
    const found = catalog.find((item) => item.id === id);
    return found ? [found] : [];
  });
  return withConversationFocus(lexical, focus);
}

/**
 * LLM simulado: responde sobre o produto-alvo só se ele chegou ao prompt
 * com os fatos; afirma o fato pedido com as próprias palavras e o declara.
 */
function llmAnswering(target: Product, factKey: string) {
  return vi.fn(async (request: SalesAgentCompletionRequest) => {
    const prompt = String(request.messages[0].content);
    const fact = normalizeProductFacts(target).facts.find((candidate) => candidate.key === factKey);
    if (!prompt.includes(`(ID: ${target.id})`) || !fact) {
      return {
        ok: true as const,
        data: {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: "request_human_handoff",
                      arguments: JSON.stringify({ reason: "produto_fora_do_prompt" }),
                    },
                  },
                ],
              },
            },
          ],
        },
      };
    }
    const stated = renderFactValue(fact.value);
    return {
      ok: true as const,
      data: {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: "respond_to_customer",
                    arguments: JSON.stringify({
                      message: `Sobre o ${target.name}: ${fact.label.toLowerCase()} ${stated}. Posso te ajudar com mais alguma coisa?`,
                      suggest_products: [target.id],
                      fact_claims: [{ product_id: target.id, fact: factKey, stated }],
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    };
  });
}

async function sell(companyId: string, history: AgentHistory, target: Product, factKey: string) {
  const catalogSearch = search(companyId, history);
  const turn = catalogSearch.status === "matches" ? catalogSearch.products : [];
  const complete = llmAnswering(target, factKey);
  const decision = await new SalesAgentCore(complete as unknown as SalesAgentCompletion).decide({
    ctx: {
      settings: {
        company_id: companyId,
        ai_auto_reply_enabled: true,
        ai_after_hours_only: false,
        ai_initial_message: null,
        ai_max_auto_replies: 5,
        ai_handoff_timeout_minutes: 30,
        ai_agent_name: "A",
        business_hours_start: "08:00",
        business_hours_end: "18:00",
      },
      companyName: companyId,
      aiProfile: null,
      products: turn,
      catalogForValidation: turn,
      knowledge: [],
      grounding: {
        catalog: turn,
        catalogSearch,
        faqKnowledge: [],
        commercialRules: rules,
        approvedCoachLearnings: [],
      },
    },
    history,
    leadName: null,
    model: "m",
    interpretation: {
      intent: null,
      attributes: {},
      references: { lastLeadText: "", productIds: [] },
    },
    catalogSearch,
  });
  return { decision, catalogSearch };
}

/** Primeiro atributo da empresa (não universal) — o que diferencia o item. */
function firstAttributeKey(item: Product): string {
  const universal = new Set<string>(Object.values(UNIVERSAL_FACT_KEYS));
  const fact = normalizeProductFacts(item).facts.find((candidate) => !universal.has(candidate.key));
  return fact?.key ?? UNIVERSAL_FACT_KEYS.price;
}

function priceKey(item: Product): string {
  return item.promoPrice ? UNIVERSAL_FACT_KEYS.promoPrice : UNIVERSAL_FACT_KEYS.price;
}

/** Nome sem a palavra comum da categoria ("Sofá Aurora" → "Aurora"). */
function shortName(item: Product, catalog: Product[]): string {
  const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const tokens = item.name.split(/\s+/);
  const distinctive = tokens.filter(
    (token) =>
      token.length >= 3 &&
      catalog.filter((other) => normalize(other.name).split(/\s+/).includes(normalize(token)))
        .length === 1,
  );
  return distinctive.join(" ") || item.name;
}

const cases = Object.entries(TENANTS).flatMap(([companyId, catalog]) =>
  catalog.map((item) => ({ companyId, catalog, item })),
);

describe.each(cases)("$companyId · $item.name", ({ companyId, catalog, item }) => {
  it("pergunta de preço pelo nome cadastrado", async () => {
    const { decision } = await sell(
      companyId,
      [{ role: "lead", text: `Quanto custa o ${item.name}?` }],
      item,
      priceKey(item),
    );
    expect(decision.kind).toBe("reply");
    expect(decision.fact_claims?.[0]).toMatchObject({ productId: item.id });
  });

  it("referência curta (só a parte que distingue o item)", async () => {
    const { decision, catalogSearch } = await sell(
      companyId,
      [{ role: "lead", text: `E o ${shortName(item, catalog)}, quanto tá?` }],
      item,
      priceKey(item),
    );
    expect(catalogSearch.status === "matches" ? catalogSearch.products[0]?.id : null).toBe(item.id);
    expect(decision.kind).toBe("reply");
  });

  it("característica cadastrada pela empresa (qualquer tipo)", async () => {
    const { decision } = await sell(
      companyId,
      [{ role: "lead", text: `Me fala mais sobre o ${item.name}` }],
      item,
      firstAttributeKey(item),
    );
    expect(decision.kind).toBe("reply");
  });

  it("continuação sem nomear o item (foco da conversa)", async () => {
    const { decision } = await sell(
      companyId,
      [
        { role: "lead", text: "Quais opções vocês têm?" },
        { role: "agent", text: `Temos o ${item.name}.`, productIds: [item.id] },
        { role: "lead", text: "Gostei. E quanto tá?" },
      ],
      item,
      priceKey(item),
    );
    expect(decision.kind).toBe("reply");
  });

  it("isolamento: o item nunca aparece na busca de outra empresa", () => {
    for (const other of Object.keys(TENANTS).filter((tenant) => tenant !== companyId)) {
      const result = search(other, [{ role: "lead", text: `Quanto custa o ${item.name}?` }]);
      const ids =
        result.status === "matches" || result.status === "ambiguous" ? result.products : [];
      expect(ids.map((candidate) => candidate.id)).not.toContain(item.id);
    }
  });
});

// Respostas naturais (redação livre do LLM) sobre atributos que cada empresa
// criou com o próprio rótulo — inclusive cor/formato/material fora das
// colunas legadas.
const VARIADOS: Product[] = [
  product("tee-cores", "Camiseta Gola V", {
    category: "Camisetas",
    price: 79,
    specifications: { Cores: { type: "list", value: ["Azul", "Preto"] } },
  }),
  product("mesa-oslo", "Mesa Oslo", {
    category: "Mesas",
    price: 990,
    specifications: { Formato: "Redondo", Diâmetro: "1,10 m" },
  }),
  product("cadeira-eames", "Cadeira Eames", {
    category: "Cadeiras",
    price: 290,
    specifications: { Material: "Polipropileno", Cor: "Branca" },
  }),
  product("filtro-pureza", "Filtro Pureza", {
    category: "Purificadores",
    price: 349,
    specifications: {
      Vazão: "2 L/min",
      "Troca do refil": { type: "number", value: 6, unit: "meses" },
    },
  }),
  product("sofa-aurora-2", "Sofá Aurora", {
    category: "Sofás",
    price: 3_490,
    promoPrice: 2_990,
    specifications: { Largura: { type: "number", value: 2.1, unit: "m" } },
  }),
  product("sofa-bella-2", "Sofá Bella", {
    category: "Sofás",
    price: 2_790,
    specifications: { Largura: "1,80 m" },
  }),
  product("bolo-2", "Bolo de cenoura", {
    category: "Bolos",
    price: 65,
    specifications: { Rendimento: "12 fatias" },
  }),
  product("limpeza-2", "Limpeza de pele profunda", {
    category: "Estética facial",
    price: 220,
    description: "Sessão de 90 minutos com extração e máscara calmante.",
  }),
];
TENANTS.variados = VARIADOS;

function llmReplying(message: string, suggest: string[], claims: Array<Record<string, unknown>>) {
  return vi.fn(async () => ({
    ok: true as const,
    data: {
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: "respond_to_customer",
                  arguments: JSON.stringify({
                    message,
                    suggest_products: suggest,
                    fact_claims: claims,
                  }),
                },
              },
            ],
          },
        },
      ],
    },
  }));
}

async function reply(
  lead: string,
  message: string,
  suggest: string[],
  claims: Array<Record<string, unknown>>,
) {
  const history: AgentHistory = [{ role: "lead", text: lead }];
  const catalogSearch = search("variados", history);
  const turn = catalogSearch.status === "matches" ? catalogSearch.products : [];
  return new SalesAgentCore(
    llmReplying(message, suggest, claims) as unknown as SalesAgentCompletion,
  ).decide({
    ctx: {
      settings: {
        company_id: "variados",
        ai_auto_reply_enabled: true,
        ai_after_hours_only: false,
        ai_initial_message: null,
        ai_max_auto_replies: 5,
        ai_handoff_timeout_minutes: 30,
        ai_agent_name: "A",
        business_hours_start: "08:00",
        business_hours_end: "18:00",
      },
      companyName: "variados",
      aiProfile: null,
      products: turn,
      catalogForValidation: turn,
      knowledge: [],
      grounding: {
        catalog: turn,
        catalogSearch,
        faqKnowledge: [],
        commercialRules: rules,
        approvedCoachLearnings: [],
      },
    },
    history,
    leadName: null,
    model: "m",
    interpretation: {
      intent: null,
      attributes: {},
      references: { lastLeadText: "", productIds: [] },
    },
    catalogSearch,
  });
}

const claim = (product_id: string, fact: string, stated: string) => ({ product_id, fact, stated });

describe("respostas naturais sobre atributos criados pela empresa", () => {
  it.each([
    [
      "cor cadastrada como atributo (não em variantes)",
      "Tem a Camiseta Gola V em que cor?",
      "A Camiseta Gola V vem na cor azul ou preto.",
      ["tee-cores"],
      [claim("tee-cores", "cores", "azul ou preto")],
    ],
    [
      "formato cadastrado como atributo (coluna shape vazia)",
      "A Mesa Oslo é de que formato?",
      "O formato da Mesa Oslo é redondo, com 1,10 m de diâmetro.",
      ["mesa-oslo"],
      [claim("mesa-oslo", "formato", "redondo"), claim("mesa-oslo", "diametro", "1,10 m")],
    ],
    [
      "material e cor em atributos legados",
      "Qual o material da Cadeira Eames?",
      "A Cadeira Eames é feita de polipropileno, na cor branca.",
      ["cadeira-eames"],
      [
        claim("cadeira-eames", "material", "polipropileno"),
        claim("cadeira-eames", "cor", "branca"),
      ],
    ],
    [
      "palavra que coincide com vocabulário de outro segmento (filtro)",
      "Como funciona o Filtro Pureza?",
      "O Filtro Pureza tem vazão de 2 L/min e a troca do refil é a cada 6 meses.",
      ["filtro-pureza"],
      [
        claim("filtro-pureza", "vazao", "2 L/min"),
        claim("filtro-pureza", "troca_do_refil", "6 meses"),
      ],
    ],
    [
      "preço normal e promocional na mesma frase",
      "Quanto tá o Sofá Aurora?",
      "O Sofá Aurora de R$ 3.490,00 está saindo por R$ 2.990,00 na promoção.",
      ["sofa-aurora-2"],
      [
        claim("sofa-aurora-2", "preco", "R$ 3.490,00"),
        claim("sofa-aurora-2", "preco_promocional", "R$ 2.990,00"),
      ],
    ],
    [
      "dois produtos na mesma resposta",
      "Qual a largura do Aurora e do Bella?",
      "O Sofá Aurora tem 2,10 m de largura e o Sofá Bella tem 1,80 m.",
      ["sofa-aurora-2", "sofa-bella-2"],
      [claim("sofa-aurora-2", "largura", "2,10 m"), claim("sofa-bella-2", "largura", "1,80 m")],
    ],
    [
      "quantidade com unidade própria do negócio",
      "O Bolo de cenoura serve quantas pessoas?",
      "O Bolo de cenoura rende 12 fatias.",
      ["bolo-2"],
      [claim("bolo-2", "rendimento", "12 fatias")],
    ],
    [
      "fato só na descrição (fallback legado sinalizado)",
      "Quanto tempo dura a Limpeza de pele profunda?",
      "A Limpeza de pele profunda dura 90 minutos, com extração e máscara calmante.",
      ["limpeza-2"],
      [claim("limpeza-2", "descricao", "90 minutos, com extração e máscara calmante")],
    ],
  ])("%s", async (_, lead, message, suggest, claims) => {
    const decision = await reply(lead, message, suggest, claims);
    expect(decision.validation_diagnostic ?? null).toBeNull();
    expect(decision.kind).toBe("reply");
  });

  it.each([
    [
      "cor que não existe no cadastro",
      "Tem a Camiseta Gola V em vermelho?",
      "Temos a Camiseta Gola V na cor vermelha.",
      ["tee-cores"],
      [claim("tee-cores", "cores", "vermelha")],
    ],
    [
      "material de outro produto",
      "Qual o material da Mesa Oslo?",
      "A Mesa Oslo é de polipropileno.",
      ["mesa-oslo"],
      [claim("mesa-oslo", "material", "polipropileno")],
    ],
    [
      "medida divergente",
      "Qual a largura do Sofá Bella?",
      "O Sofá Bella tem 2,10 m de largura.",
      ["sofa-bella-2"],
      [claim("sofa-bella-2", "largura", "2,10 m")],
    ],
  ])("bloqueia: %s", async (_, lead, message, suggest, claims) => {
    const decision = await reply(lead, message, suggest, claims);
    expect(decision.kind).not.toBe("reply");
  });
});

describe("busca por grandeza cadastrada em qualquer atributo", () => {
  const firstIds = (companyId: string, text: string) => {
    const result = search(companyId, [{ role: "lead", text }]);
    return result.status === "matches" ? result.products.map((item) => item.id) : [];
  };

  it.each([
    ["eletros", "Tem algum de 1200 W?", ["micro-brisa"]],
    ["eletros", "Procuro uma de 480 litros", ["fridge-polar"]],
    ["moveis", "Tem sofá com 2,10 m de largura?", ["sofa-aurora"]],
    ["moda", "Tem algo com 280 g?", ["tenis-runner"]],
    ["alimentos", "Tem bolo de 1,2 kg?", ["bolo-cenoura"]],
    ["piscinas", "Tem piscina de 9.500 litros?", ["pool-401"]],
  ])("%s: %s", (companyId, text, expected) => {
    expect(firstIds(companyId, text)).toEqual(expected);
  });
});
