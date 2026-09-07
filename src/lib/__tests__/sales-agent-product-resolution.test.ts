import { describe, expect, it } from "vitest";
import {
  getPresentedProductIds,
  resolveCatalogProductReferenceWithContext,
} from "../sales-agent-product-resolution";
import { SalesAgentCore, type AgentContext } from "../sales-agent-core";
import { getTrainingMessageProductIds } from "../sales-training-domain";

const catalog = [
  { id: "a", name: "Linha Solaris 401 Praia", model: "401", description: "Piscina clara para área externa" },
  { id: "b", name: "Linha Solaris 402 Canyon", model: "402", description: "Piscina escura para área externa" },
  { id: "c", name: "Linha Solaris 401 Plus", model: "401", description: "Piscina premium para área externa" },
];

function coreContext(products: typeof catalog): AgentContext {
  const mapped = products.map((product) => ({
    ...product,
    category: "Piscinas",
    description: product.description,
    price: product.id === "a" ? 20_000 : 22_000,
    promoPrice: null,
    images: [],
    notes: null,
  }));
  return {
    settings: {
      company_id: "company-1",
      ai_auto_reply_enabled: true,
      ai_after_hours_only: false,
      ai_initial_message: null,
      ai_max_auto_replies: 3,
      ai_handoff_timeout_minutes: 30,
      ai_agent_name: "Ana",
      business_hours_start: "08:00:00",
      business_hours_end: "18:00:00",
    },
    companyName: "Empresa",
    aiProfile: null,
    products: mapped,
    catalogForValidation: mapped,
    knowledge: [],
    grounding: {
      catalog: mapped,
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
}

describe("resolução contextual de produtos", () => {
  it("resolve modelo isolado e nome parcial somente no conjunto apresentado", () => {
    expect(resolveCatalogProductReferenceWithContext("Quanto custa a 401?", catalog, [catalog[0], catalog[1]])).toMatchObject({
      product: catalog[0],
      ambiguous: false,
    });
    expect(resolveCatalogProductReferenceWithContext("Gostei da Praia", catalog, [catalog[0], catalog[1]])).toMatchObject({
      product: catalog[0],
      ambiguous: false,
    });
  });

  it("resolve primeira, segunda e última na ordem apresentada", () => {
    const presented = [catalog[0], catalog[1]];
    expect(resolveCatalogProductReferenceWithContext("a primeira", catalog, presented).product?.id).toBe("a");
    expect(resolveCatalogProductReferenceWithContext("a segunda", catalog, presented).product?.id).toBe("b");
    expect(resolveCatalogProductReferenceWithContext("a última", catalog, presented).product?.id).toBe("b");
  });

  it("prioriza o contexto apresentado e não adivinha ambiguidade", () => {
    expect(resolveCatalogProductReferenceWithContext("401", catalog, [catalog[0], catalog[1]]).product?.id).toBe("a");
    expect(resolveCatalogProductReferenceWithContext("401", catalog, [catalog[0], catalog[2]])).toMatchObject({
      product: null,
      ambiguous: true,
    });
  });

  it("mantém a ordem dos produtos apresentados entre turnos", () => {
    expect(getPresentedProductIds([
      { role: "agent", text: "Mostrei dois", productIds: ["a", "b"] },
      { role: "agent", text: "[imagem: b]", productIds: ["b"] },
      { role: "lead", text: "Gostei da segunda" },
    ])).toEqual(["a", "b"]);
  });

  it("preserva contexto de produtos sugeridos, imagens e simulação no treinamento", () => {
    expect(getTrainingMessageProductIds({
      suggested_products: ["a", "b"],
      product_image_ids: ["b"],
      simulated_product_images: [{ product_id: "a" }],
    })).toEqual(["a", "b"]);
  });

  it.each([
    ["A 401 custa R$ 20.000.", "reply"],
    ["A 401 custa R$ 99.000.", "catalog_unvalidated_objective_claim"],
  ])("valida preço oficial para referência contextual: %s", async (message, expected) => {
    const productCatalog = catalog.slice(0, 2);
    const complete = async () => ({
      ok: true as const,
      data: {
        choices: [{
          message: {
            tool_calls: [{
              function: {
                name: "respond_to_customer",
                arguments: JSON.stringify({ message, suggest_products: ["a"] }),
              },
            }],
          },
        }],
      },
    });
    const decision = await new SalesAgentCore(complete).decide({
      ctx: coreContext(productCatalog),
      history: [
        { role: "agent", text: "Apresentei os modelos", productIds: ["a", "b"] },
        { role: "lead", text: "Qual o valor da 401?" },
      ],
      leadName: null,
      model: "provider/sales-model",
    });
    expect(decision.kind === "handoff" ? decision.reason : decision.kind).toBe(expected);
  });
});
