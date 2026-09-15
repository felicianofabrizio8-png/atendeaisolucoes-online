import { describe, expect, it } from "vitest";
import { searchSalesAgentCatalog } from "../sales-agent-grounding.server";

const catalog = [
  {
    id: "chair-1",
    name: "Cadeira Atlas",
    model: "AT-100",
    sku: "ATL-100",
    category: "Móveis",
    description: "Cadeira ergonômica",
    lengthM: null,
    widthM: null,
    depthM: null,
    capacityL: null,
    shape: null,
    specifications: { material: "aço" },
    includedItems: ["almofada"],
    variants: [{ color: "preta" }],
    price: 499,
    promoPrice: 449,
    images: [],
    notes: "Montagem inclusa",
  },
  {
    id: "lamp-1",
    name: "Luminária Nexo",
    model: "NX-20",
    sku: "NEX-20",
    category: "Iluminação",
    description: "Luminária de mesa",
    lengthM: null,
    widthM: null,
    depthM: null,
    capacityL: null,
    shape: null,
    specifications: { voltage: "110V" },
    includedItems: [],
    variants: [],
    price: 199,
    promoPrice: null,
    images: [],
    notes: null,
  },
];
const scope = { companyId: "company-1", activeOnly: true as const };
const otherScope = { companyId: "company-2", activeOnly: true as const };

describe("sales-agent catalog tool", () => {
  it("encontra produto existente por nome e modelo e preserva preço", () => {
    const byName = searchSalesAgentCatalog("company-1", catalog, [{ role: "lead", text: "Quero a Cadeira Atlas" }], null, scope);
    const byModel = searchSalesAgentCatalog("company-1", catalog, [{ role: "lead", text: "Qual o valor da AT-100?" }], null, scope);

    expect(byName).toMatchObject({ status: "matches", products: [{ id: "chair-1", price: 499, promoPrice: 449 }] });
    expect(byModel).toMatchObject({ status: "matches", products: [{ id: "chair-1" }] });
  });

  it("retorna comparação entre produtos de categorias diferentes", () => {
    const result = searchSalesAgentCatalog("company-1", catalog, [{ role: "lead", text: "Compare a Cadeira Atlas com a Luminária Nexo" }], null, scope);
    expect(result.status).toBe("matches");
    if (result.status === "matches") {
      expect(result.products.map((product) => product.id)).toEqual(["chair-1", "lamp-1"]);
    }
  });

  it("usa product_id no segundo turno para referência contextual", () => {
    const result = searchSalesAgentCatalog(
      "company-1",
      catalog,
      [
        { role: "agent", text: "Mostrei a Cadeira Atlas", productIds: ["chair-1"] },
        { role: "lead", text: "E esse produto tem montagem inclusa?" },
      ],
      { attributes: {}, productIds: ["chair-1"], intent: "product_inquiry", lastValidProductIds: ["chair-1"] },
      scope,
    );
    expect(result).toMatchObject({ status: "matches", products: [{ id: "chair-1" }] });
  });

  it.each(["Tem mais?", "Outro modelo?", "Outras opções?", "E mais algum?"])(
    "continua a última busca para a frase %s e exclui produtos já apresentados",
    (continuation) => {
      const extendedCatalog = [
        ...catalog,
        { ...catalog[0], id: "chair-2", name: "Cadeira Orion", model: "OR-200", sku: "ORI-200" },
      ];
      const result = searchSalesAgentCatalog(
        "company-1",
        extendedCatalog,
        [
          { role: "lead", text: "Quais produtos vocês têm?" },
          { role: "agent", text: "Apresentei duas opções.", productIds: ["chair-1", "lamp-1"] },
          { role: "lead", text: continuation },
        ],
        { attributes: {}, productIds: [], intent: "product_inquiry", lastValidProductIds: ["chair-1", "lamp-1", "chair-2"] },
        scope,
      );

      expect(result).toMatchObject({ status: "matches", products: [{ id: "chair-2" }] });
    },
  );

  it("mantém os critérios da última busca e não vira no_match quando não há mais opções", () => {
    const result = searchSalesAgentCatalog(
      "company-1",
      catalog,
      [
        { role: "lead", text: "Quais produtos vocês têm?" },
        { role: "agent", text: "Apresentei todas as opções.", productIds: ["chair-1", "lamp-1"] },
        { role: "lead", text: "Tem mais?" },
      ],
      { attributes: {}, productIds: [], intent: "product_inquiry", lastValidProductIds: ["chair-1", "lamp-1"] },
      scope,
    );

    expect(result).toEqual({ status: "matches", products: [] });
  });

  it("distingue produto inexistente, catálogo vazio e erro de consulta", () => {
    expect(searchSalesAgentCatalog("company-1", catalog, [{ role: "lead", text: "Tem o produto Atlantis?" }], null, scope)).toMatchObject({
      status: "no_match",
      products: [],
    });
    expect(searchSalesAgentCatalog("company-1", [], [{ role: "lead", text: "Quais produtos vocês têm?" }], null, scope)).toMatchObject({
      status: "empty_catalog",
      products: [],
    });
    expect(searchSalesAgentCatalog("company-1", null as never, [{ role: "lead", text: "Qualquer produto" }], null, scope)).toMatchObject({
      status: "query_error",
    });
  });

  it("não cruza catálogos de empresas diferentes", () => {
    const companyA = searchSalesAgentCatalog("company-1", catalog, [{ role: "lead", text: "Quero a Cadeira Atlas" }], null, scope);
    const companyB = searchSalesAgentCatalog("company-2", [catalog[1]], [{ role: "lead", text: "Quero a Cadeira Atlas" }], null, otherScope);

    expect(companyA).toMatchObject({ status: "matches", products: [{ id: "chair-1" }] });
    expect(companyB).toMatchObject({ status: "no_match", products: [] });
  });
});
