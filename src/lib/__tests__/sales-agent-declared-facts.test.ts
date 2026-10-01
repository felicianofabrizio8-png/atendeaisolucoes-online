// Fatos declarados pela interpretação semântica (fact_claims) e validados
// deterministicamente contra os fatos normalizados de Produtos — em empresas
// de segmentos diferentes, sem rótulo repetido nem lista de sinônimos.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({ postGraph: vi.fn() }));

import {
  SalesAgentCore,
  buildSalesAgentCompletionRequest,
  type AgentContext,
  type SalesAgentCatalogSearch,
  type SalesAgentCompletion,
  type SalesAgentCoreInput,
} from "../sales-agent-core";

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

// Caso real: profundidade só na especificação legada, com unidade no rótulo.
const pool = product("p-401", "Sol 401", {
  category: "Linha Sol",
  price: 15_900,
  promoPrice: 12_900,
  lengthM: 4,
  widthM: 2.5,
  specifications: { "Profundidade (m)": 1.4, Capacidade: "9.500 litros" },
});
const sofa = product("sofa", "Sofá Aurora", {
  category: "Sofás",
  price: 3_490,
  specifications: {
    Largura: { type: "number", value: 2.1, unit: "m" },
    Revestimento: { type: "text", value: "Linho bege" },
    Lugares: { type: "number", value: 3, unit: null },
  },
});
const fridge = product("fridge", "Refrigerador Polar 480", {
  category: "Refrigeradores",
  price: 4_299,
  specifications: { Volume: "480 litros", Tensão: "220V" },
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

function input(turn: Product[], suggest: string[]): SalesAgentCoreInput {
  const search: SalesAgentCatalogSearch = { status: "matches", products: turn };
  return {
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
      { role: "lead", text: "Me fala mais dele?" },
    ],
    leadName: null,
    model: "m",
    interpretation: {
      intent: null,
      attributes: {},
      references: { lastLeadText: "", productIds: [] },
    },
    catalogSearch: search,
  };
}

async function decide(
  message: string,
  turn: Product[],
  suggest: string[],
  factClaims: Array<Record<string, unknown>> | undefined,
) {
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
                    message,
                    suggest_products: suggest,
                    ...(factClaims ? { fact_claims: factClaims } : {}),
                  }),
                },
              },
            ],
          },
        },
      ],
    },
  });
  return new SalesAgentCore(complete as unknown as SalesAgentCompletion).decide(
    input(turn, suggest),
  );
}

describe("prompt e contrato de fatos declarados", () => {
  it("mostra cada fato de Produtos com a chave e exige fact_claims no tool call", () => {
    const request = buildSalesAgentCompletionRequest(input([pool, sofa], ["p-401"]));
    const prompt = String(request.messages[0].content);
    expect(prompt).toContain("Preço promocional cadastrado: R$ 12.900,00 [preco_promocional]");
    expect(prompt).toContain("Profundidade: 1,4 m [profundidade]");
    expect(prompt).toContain("Capacidade: 9.500 L [capacidade]");
    expect(prompt).toContain("Revestimento: Linho bege [revestimento]");
    expect(prompt).toContain("fact_claims");
    const parameters = (
      request.tools[0] as {
        function: {
          parameters: {
            required: string[];
            properties: {
              fact_claims: { items: { properties: { product_id: { enum: string[] } } } };
            };
          };
        };
      }
    ).function.parameters;
    expect(parameters.required).toContain("fact_claims");
    expect(parameters.properties.fact_claims.items.properties.product_id.enum).toEqual([
      "p-401",
      "sofa",
    ]);
  });
});

describe("decisão com fatos declarados", () => {
  it("caso real 401: preço promocional, medidas e profundidade só na especificação passam", async () => {
    const decision = await decide(
      "A Sol 401 está saindo por R$ 12.900,00 na promoção. Ela tem 4 x 2,5 m e 1,40 m de fundura, cabendo 9.500 litros.",
      [pool],
      ["p-401"],
      [
        { product_id: "p-401", fact: "preco_promocional", stated: "R$ 12.900,00" },
        { product_id: "p-401", fact: "medidas", stated: "4 x 2,5 m" },
        { product_id: "p-401", fact: "profundidade", stated: "1,40 m" },
        { product_id: "p-401", fact: "capacidade", stated: "9.500 litros" },
      ],
    );
    expect(decision.kind).toBe("reply");
    expect(decision.fact_claims).toHaveLength(4);
  });

  it("aceita linguagem livre de outro segmento quando os valores conferem", async () => {
    const decision = await decide(
      "O Aurora acomoda três pessoas, mede 2,10 m de largura e vem revestido em linho.",
      [sofa],
      ["sofa"],
      [
        { product_id: "sofa", fact: "lugares", stated: "3" },
        { product_id: "sofa", fact: "largura", stated: "2,10 m" },
        { product_id: "sofa", fact: "revestimento", stated: "linho" },
      ],
    );
    expect(decision.kind).toBe("reply");
  });

  it("bloqueia valor divergente do cadastrado e registra a declaração rejeitada", async () => {
    const decision = await decide(
      "O Polar 480 tem 520 litros e funciona em 220V.",
      [fridge],
      ["fridge"],
      [
        { product_id: "fridge", fact: "volume", stated: "520 litros" },
        { product_id: "fridge", fact: "tensao", stated: "220V" },
      ],
    );
    expect(decision).toMatchObject({
      kind: "handoff",
      reason: "catalog_unvalidated_objective_claim",
      validation_diagnostic: {
        check: "fact_claim",
        rejected_fact_claim: { fact: "volume", stated: "520 litros", reason: "value_mismatch" },
      },
    });
  });

  it("bloqueia unidade incompatível com o atributo declarado", async () => {
    const decision = await decide(
      "O Polar 480 trabalha com 2 cv.",
      [fridge],
      ["fridge"],
      [{ product_id: "fridge", fact: "tensao", stated: "2 cv" }],
    );
    expect(decision).toMatchObject({
      kind: "handoff",
      validation_diagnostic: {
        check: "fact_claim",
        rejected_fact_claim: { reason: "value_mismatch" },
      },
    });
  });

  it("bloqueia atributo que a empresa não cadastrou", async () => {
    const decision = await decide(
      "O Aurora tem garantia de 5 anos.",
      [sofa],
      ["sofa"],
      [{ product_id: "sofa", fact: "garantia", stated: "5 anos" }],
    );
    expect(decision).toMatchObject({
      kind: "handoff",
      validation_diagnostic: { rejected_fact_claim: { reason: "fact_not_registered" } },
    });
  });

  it("bloqueia grandeza afirmada sem declaração", async () => {
    const decision = await decide(
      "O Aurora tem 2,10 m de largura e pesa 45 kg.",
      [sofa],
      ["sofa"],
      [{ product_id: "sofa", fact: "largura", stated: "2,10 m" }],
    );
    expect(decision).toMatchObject({
      kind: "handoff",
      validation_diagnostic: { check: "undeclared_fact", undeclared_quantity: "45 kg" },
    });
  });

  it("sem fact_claims (contrato antigo) segue a validação textual legada", async () => {
    const decision = await decide(
      "A Sol 401 está por R$ 12.900,00 no valor promocional. Medidas: 4 x 2,5 x 1,40 m.",
      [pool],
      ["p-401"],
      undefined,
    );
    expect(decision.kind).toBe("reply");
    expect(decision.fact_claims).toBeUndefined();
  });
});
