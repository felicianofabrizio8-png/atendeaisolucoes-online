// Afirmações objetivas validadas fato a fato, contra o campo correspondente
// de Produtos. Reproduz o falso positivo real: resposta correta com preço
// promocional + medidas + capacidade era bloqueada (objective_claim).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({ postGraph: vi.fn() }));

import {
  SalesAgentCore,
  type AgentContext,
  type SalesAgentCatalogSearch,
  type SalesAgentCompletion,
} from "../sales-agent-core";
import { extractNumericFacts } from "../sales-agent-fact-claims";

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

// Mesmos fatos do caso real (price 15.900, promo 12.900, 4 x 2,5 x 1,40 m, 9.500 L).
const structured = product("p-401", "Linha 401", {
  category: "Linha de fibra",
  price: 15_900,
  promoPrice: 12_900,
  lengthM: 4,
  widthM: 2.5,
  depthM: 1.4,
  capacityL: 9_500,
});
// Mesmo produto com profundidade/capacidade só no texto do cadastro.
const textOnly = product("p-401", "Linha 401", {
  category: "Linha de fibra",
  price: 15_900,
  promoPrice: 12_900,
  lengthM: 4,
  widthM: 2.5,
  description: "Medidas externas 4 x 2,5 x 1,40 m. Capacidade de 9.500 litros.",
});
const other = product("p-600", "Linha 600", {
  price: 21_900,
  lengthM: 6,
  widthM: 3,
  capacityL: 20_000,
});

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

async function decide(message: string, turn: Product[], suggest: string[]) {
  const search: SalesAgentCatalogSearch = { status: "matches", products: turn };
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
                  arguments: JSON.stringify({ message, suggest_products: suggest }),
                },
              },
            ],
          },
        },
      ],
    },
  });
  return new SalesAgentCore(complete as unknown as SalesAgentCompletion).decide({
    ctx: {
      settings: {
        company_id: "c",
        ai_auto_reply_enabled: true,
        ai_after_hours_only: false,
        ai_initial_message: null,
        ai_max_auto_replies: 5,
        ai_handoff_timeout_minutes: 30,
        ai_agent_name: "A",
        business_hours_start: "08:00",
        business_hours_end: "18:00",
      },
      companyName: "X",
      aiProfile: null,
      products: turn,
      catalogForValidation: turn,
      knowledge: [],
      grounding: {
        catalog: turn,
        catalogSearch: search,
        faqKnowledge: [],
        commercialRules: rules,
        approvedCoachLearnings: [],
      },
    },
    history: [
      { role: "agent", text: "Esta é a opção.", productIds: suggest },
      { role: "lead", text: "Eu gostei. Qual o valor?" },
    ],
    leadName: null,
    model: "m",
    interpretation: {
      intent: null,
      attributes: {},
      references: { lastLeadText: "", productIds: [] },
    },
    catalogSearch: search,
  });
}

const REAL_REPLY =
  "A Linha 401 está por R$ 12.900,00 no valor promocional.\nMedidas externas: 4 x 2,5 x 1,40 m\nCapacidade: 9.500 litros";

describe("caso real: preço promocional + medidas + capacidade", () => {
  it.each([
    ["campos estruturados", structured],
    ["profundidade/capacidade só no texto do cadastro", textOnly],
  ])("resposta correta passa (%s)", async (_label, item) => {
    const decision = await decide(REAL_REPLY, [item], ["p-401"]);
    expect(decision.kind).toBe("reply");
    expect(decision.message).toBe(REAL_REPLY);
    expect(decision.validation_diagnostic).toBeUndefined();
  });
});

describe("redações variadas com fatos corretos passam", () => {
  it.each([
    "A Linha 401 está saindo por R$ 12.900,00.",
    "A Linha 401 fica em R$ 12.900,00 à vista.",
    "O modelo Linha 401 está saindo por R$ 12.900,00.",
    "A Linha 401 é de fibra e está saindo por R$ 12.900,00.",
    "A Linha 401 sai de R$ 15.900,00 por R$ 12.900,00.",
    "A Linha 401 está na promoção por R$ 12.900,00 (de R$ 15.900,00).",
    "A Linha 401 está por R$ 12.900,00 no preço promocional; o valor normal é R$ 15.900,00.",
    "Ela tem 4 x 2,5 x 1,40 m e capacidade de 9.500 litros, por R$ 12.900,00.",
    "Medidas: 4 x 2,5 m.\nProfundidade: 1,40 m.\nValor promocional: R$ 12.900,00.",
  ])("'%s'", async (reply) => {
    const decision = await decide(reply, [structured], ["p-401"]);
    expect(decision.kind).toBe("reply");
    expect(decision.message).toBe(reply);
  });
});

describe("fato inventado ou do produto errado continua bloqueado", () => {
  it.each([
    ["preço inventado", "A Linha 401 está saindo por R$ 11.500,00."],
    ["promoção com o valor normal", "A Linha 401 está na promoção por R$ 15.900,00."],
    ["dimensão errada", "A Linha 401 tem 4 x 3 x 1,40 m."],
    ["capacidade errada", "A Linha 401 tem capacidade de 12.000 litros."],
    ["recurso inexistente", "A Linha 401 tem aquecimento solar."],
  ])("%s", async (_label, reply) => {
    const decision = await decide(reply, [structured], ["p-401"]);
    expect(decision.message ?? "").not.toBe(reply);
  });

  it("preço de outro produto atribuído ao nomeado", async () => {
    const reply = "A Linha 401 está saindo por R$ 21.900,00.";
    const decision = await decide(reply, [structured, other], ["p-401", "p-600"]);
    expect(decision.message ?? "").not.toBe(reply);
  });

  it("capacidade de outro produto atribuída ao nomeado", async () => {
    const reply = "A Linha 401 tem capacidade de 20.000 litros.";
    const decision = await decide(reply, [structured, other], ["p-401", "p-600"]);
    expect(decision.message ?? "").not.toBe(reply);
  });

  it("dois produtos na mesma resposta: cada fato contra o seu produto", async () => {
    const ok = "A Linha 401 sai por R$ 12.900,00 e a Linha 600 por R$ 21.900,00.";
    expect((await decide(ok, [structured, other], ["p-401", "p-600"])).message).toBe(ok);
    const swapped = "A Linha 401 sai por R$ 21.900,00 e a Linha 600 por R$ 12.900,00.";
    expect((await decide(swapped, [structured, other], ["p-401", "p-600"])).message ?? "").not.toBe(
      swapped,
    );
  });
});

describe("outro segmento", () => {
  const fridge = product("g-480", "Refrigerador Polar 480", {
    category: "Refrigeradores",
    price: 4_299,
    promoPrice: 3_999,
    lengthM: 1.86,
    widthM: 0.7,
    depthM: 0.73,
    capacityL: 480,
  });

  it("preço promocional + normal + capacidade + medidas corretos passam", async () => {
    const reply =
      "O Refrigerador Polar 480 sai por R$ 3.999,00 na promoção (preço normal R$ 4.299,00).\nCapacidade: 480 litros\nMedidas: 1,86 x 0,70 x 0,73 m";
    const decision = await decide(reply, [fridge], ["g-480"]);
    expect(decision.kind).toBe("reply");
    expect(decision.message).toBe(reply);
  });

  it("capacidade inventada é bloqueada", async () => {
    const reply = "O Refrigerador Polar 480 tem 520 litros.";
    const decision = await decide(reply, [fridge], ["g-480"]);
    expect(decision.message ?? "").not.toBe(reply);
  });
});

describe("extração tipada de fatos", () => {
  it("rótulo promocional vale só para o preço da própria oração", () => {
    const facts = extractNumericFacts(
      "R$ 12.900,00 no valor promocional; o valor normal é R$ 15.900,00.",
    );
    expect(facts.prices).toEqual([
      { value: 12_900, promo: true },
      { value: 15_900, promo: false },
    ]);
  });

  it("separa dimensões, medidas e capacidade sem confundir com preço", () => {
    const facts = extractNumericFacts(
      "Medidas 4 x 2,5 x 1,40 m, profundidade 1,40 m, 9.500 litros.",
    );
    expect(facts.dimensions).toEqual([[4, 2.5, 1.4]]);
    expect(facts.measures).toEqual([1.4]);
    expect(facts.capacities).toEqual([9_500]);
    expect(facts.prices).toEqual([]);
  });
});
