// Busca por medida/atributo e comparação de preços cadastrados.
// Reproduz: "estava pensando em 6 metros" deixava compatíveis de fora e
// "qual você tem boa de preço?" terminava em handoff.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({ postGraph: vi.fn() }));

import {
  SalesAgentCore,
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
  isPriceComparisonRequest,
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

function search(history: SalesAgentCoreInput["history"]) {
  return searchSalesAgentCatalog("company-x", catalog, history, null, scope, {});
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

  it("sem medida na mensagem não filtra; medida sem compatível cai na busca normal", () => {
    expect(
      filterProductsByStructuredAttributes(catalog, [{ role: "lead", text: "quero ver opções" }]),
    ).toBeNull();
    const result = search([{ role: "lead", text: "tem de 12 metros?" }]);
    expect(result.status === "matches" && result.exhaustive).toBeFalsy();
  });
});

describe("comparação de preços cadastrados não é negociação", () => {
  it.each([
    "Qual voce tem boa de preço ai?",
    "qual o mais barato?",
    "tem algum mais em conta?",
    "Qual tem o melhor preço?",
    "qual o de menor valor",
    "qual tem melhor custo-benefício?",
  ])("'%s' é comparação", (text) => {
    expect(isPriceComparisonRequest(text)).toBe(true);
  });

  it.each([
    "consegue fazer mais barato?",
    "tem desconto no mais barato?",
    "qual o melhor preço que você faz?",
    "faz por 15 mil?",
    "consegue melhorar o valor?",
    "vou levar em conta",
  ])("'%s' não é comparação", (text) => {
    expect(isPriceComparisonRequest(text)).toBe(false);
  });

  it("pré-check não encaminha comparação, mas encaminha negociação", () => {
    expect(detectHandoffNeeded("tem algum mais barato").needed).toBe(false);
    expect(detectHandoffNeeded("me mostra o de menor preço").needed).toBe(false);
    expect(detectHandoffNeeded("consegue fazer mais barato").needed).toBe(true);
    expect(detectHandoffNeeded("me dá um desconto").needed).toBe(true);
  });

  it("compara o conjunto já apresentado (todos os de 6 m)", () => {
    const result = search([
      { role: "lead", text: "estava pensando em 6 metros" },
      { role: "agent", text: "Temos estes modelos de 6 m.", productIds: sixMeterIds },
      { role: "lead", text: "Qual voce tem boa de preço ai?" },
    ]);
    expect(result.status).toBe("matches");
    if (result.status !== "matches") return;
    expect(result.products.map((p) => p.id).sort()).toEqual(sixMeterIds);
  });

  it("resposta usa só preços cadastrados, do menor para o maior, com promoção", () => {
    const reply = buildPriceComparisonReply(catalog.filter((p) => sixMeterIds.includes(p.id)));
    expect(reply?.productIds).toEqual(["e", "b", "d"]);
    expect(reply?.message).toContain("Modelo Eco 6x3 (R$ 16.000,00)");
    expect(reply?.message).toContain("Modelo Brisa (R$ 17.900,00, promocional)");
    expect(reply?.message).not.toMatch(/desconto|negoci/i);
    expect(buildPriceComparisonReply([product("z", {})])).toBeNull();
  });
});

describe("decide responde comparação sem LLM e sem handoff", () => {
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
      commercialRules: {
        paymentMethods: null,
        commercialTerms: null,
        paymentPolicy: null,
        installationPolicy: null,
        visitPolicy: null,
        heatingPolicy: null,
        shippingPolicy: null,
        includedItemsPolicy: null,
      },
      approvedCoachLearnings: [],
    },
  };
  const interpretation: SalesAgentCoreInput["interpretation"] = {
    intent: null,
    attributes: {},
    references: { lastLeadText: "", productIds: [] },
  };

  async function decide(
    history: SalesAgentCoreInput["history"],
    catalogSearch: SalesAgentCatalogSearch,
    complete: ReturnType<typeof vi.fn>,
  ) {
    return new SalesAgentCore(complete as unknown as SalesAgentCompletion).decide({
      ctx: { ...ctx, grounding: { ...ctx.grounding, catalogSearch } },
      history,
      leadName: null,
      model: "provider/model",
      interpretation,
      catalogSearch,
    });
  }

  it("fluxo do teste real: 6 metros → 'qual boa de preço' responde com preços reais", async () => {
    const history: SalesAgentCoreInput["history"] = [
      { role: "lead", text: "Gostaria de saber mais informações sobre os produtos" },
      { role: "agent", text: "Claro! Qual a sua cidade?" },
      { role: "lead", text: "estava pensando em 6 metros" },
      { role: "agent", text: "Temos estes modelos de 6 m.", productIds: sixMeterIds },
      { role: "lead", text: "Qual voce tem boa de preço ai?" },
    ];
    const complete = vi.fn();
    const decision = await decide(history, search(history), complete);

    expect(complete).not.toHaveBeenCalled();
    expect(decision.kind).toBe("reply");
    expect(decision.fallback_reason).toBe("catalog_price_comparison");
    expect(decision.message).toContain("Modelo Eco 6x3 (R$ 16.000,00)");
    expect(decision.suggested_products).toEqual(["e", "b", "d"]);
    // Continua passando pela camada de segurança sem virar handoff.
    expect(runSafetyLayer(decision, null).kind).toBe("reply");
  });

  it("pedido por medida permite apresentar todos os compatíveis (não só 3)", async () => {
    const history: SalesAgentCoreInput["history"] = [
      { role: "lead", text: "estava pensando em 6 metros" },
    ];
    const complete = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: "respond_to_customer",
                    arguments: JSON.stringify({
                      message: "Temos cinco opções nessa medida, vou te enviar para conhecer.",
                      suggest_products: sixMeterIds,
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    });
    const decision = await decide(history, search(history), complete);
    expect(decision.kind).toBe("reply");
    expect(decision.suggested_products).toEqual(sixMeterIds);
  });

  it("preço inventado continua bloqueado fora da comparação", async () => {
    const history: SalesAgentCoreInput["history"] = [
      { role: "lead", text: "estava pensando em 6 metros" },
    ];
    const complete = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: "respond_to_customer",
                    arguments: JSON.stringify({
                      message: "O Modelo Aurora sai por R$ 9.999.",
                      suggest_products: ["a"],
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    });
    const decision = await decide(history, search(history), complete);
    expect(decision.message ?? "").not.toContain("9.999");
  });
});
