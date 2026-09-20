import { describe, expect, it } from "vitest";
import {
  searchSalesAgentCatalog,
  type CatalogSearchOptions,
} from "../sales-agent-grounding.server";

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
  it("exige company_id e escopo ativo no contrato da ferramenta", () => {
    expect(searchSalesAgentCatalog("company-1", catalog, [], null, null as never)).toMatchObject({
      status: "query_error",
    });
    expect(searchSalesAgentCatalog("company-1", catalog, [], null, { companyId: "company-2", activeOnly: true })).toMatchObject({
      status: "query_error",
    });
    expect(searchSalesAgentCatalog("company-1", catalog, [], null, { companyId: "company-1", activeOnly: false as never })).toMatchObject({
      status: "query_error",
    });
  });

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

  it("resolve referência abreviada ao modelo apresentado antes de consultar preço", () => {
    const presentedCatalog = [
      { ...catalog[0], id: "pool-500", name: "Sol 500", model: "Sol 500", sku: "SOL-500", price: 14000, promoPrice: null },
      { ...catalog[0], id: "pool-500-praia", name: "Sol 500 Praia", model: "Sol 500 Praia", sku: "SOL-500-P", price: 14500, promoPrice: null },
      { ...catalog[0], id: "pool-501", name: "Sol 501", model: "Sol 501", sku: "SOL-501", price: 14900, promoPrice: null },
    ];

    const result = searchSalesAgentCatalog(
      "company-1",
      presentedCatalog,
      [
        { role: "agent", text: "Apresentei três opções.", productIds: ["pool-500", "pool-500-praia", "pool-501"] },
        { role: "lead", text: "Eu gostei da 501. qual o valor?" },
      ],
      {
        attributes: {},
        productIds: [],
        intent: "product_inquiry",
        lastValidProductIds: ["pool-500", "pool-500-praia", "pool-501"],
      },
      scope,
    );

    expect(result).toMatchObject({
      status: "matches",
      products: [{ id: "pool-501", price: 14900 }],
    });
  });
  it("prefere o nome completo apresentado quando outro produto apenas estende esse nome", () => {
    const presentedCatalog = [
      {
        ...catalog[0],
        id: "pool-801",
        name: "Sol 801",
        model: "Sol 801",
        price: 18_900,
      },
      {
        ...catalog[0],
        id: "pool-801-spa",
        name: "Sol 801 SPA",
        model: "Sol 801 SPA",
        price: 21_900,
      },
      {
        ...catalog[0],
        id: "pool-802",
        name: "Sol 802",
        model: "Sol 802",
        price: 19_900,
      },
    ];

    const result = searchSalesAgentCatalog(
      "company-1",
      presentedCatalog,
      [
        {
          role: "agent",
          text: "Apresentei três opções.",
          productIds: ["pool-801", "pool-801-spa", "pool-802"],
        },
        {
          role: "lead",
          text: "E essa Sol 801 qual o valor?",
        },
      ],
      {
        attributes: {},
        productIds: [],
        intent: "product_inquiry",
        lastValidProductIds: ["pool-802"],
      },
      scope,
    );

    expect(result).toMatchObject({
      status: "matches",
      products: [{ id: "pool-801", price: 18_900 }],
    });
  });
  it("prefere a variante completa mais específica quando ela é citada explicitamente", () => {
    const presentedCatalog = [
      { ...catalog[0], id: "pool-801", name: "Sol 801", model: "Sol 801", price: 18_900 },
      { ...catalog[0], id: "pool-801-spa", name: "Sol 801 SPA", model: "Sol 801 SPA", price: 21_900 },
    ];

    const result = searchSalesAgentCatalog(
      "company-1",
      presentedCatalog,
      [
        { role: "agent", text: "Apresentei as duas opções.", productIds: ["pool-801", "pool-801-spa"] },
        { role: "lead", text: "E essa Sol 801 SPA qual o valor?" },
      ],
      {
        attributes: {},
        productIds: [],
        intent: "product_inquiry",
        lastValidProductIds: ["pool-801"],
      },
      scope,
    );

    expect(result).toMatchObject({
      status: "matches",
      products: [{ id: "pool-801-spa", price: 21_900 }],
    });
  });
  it("não escolhe produto quando a referência abreviada apresentada é ambígua", () => {
    const ambiguousCatalog = [
      { ...catalog[0], id: "model-501-a", name: "Linha 501 A", model: "501 A", sku: "501-A" },
      { ...catalog[0], id: "model-501-b", name: "Linha 501 B", model: "501 B", sku: "501-B" },
      { ...catalog[0], id: "model-600", name: "Linha 600", model: "600", sku: "600" },
    ];

    const result = searchSalesAgentCatalog(
      "company-1",
      ambiguousCatalog,
      [
        { role: "agent", text: "Apresentei três opções.", productIds: ["model-501-a", "model-501-b", "model-600"] },
        { role: "lead", text: "Gostei da 501. Qual o valor?" },
      ],
      {
        attributes: {},
        productIds: [],
        intent: "product_inquiry",
        lastValidProductIds: ["model-501-a", "model-501-b", "model-600"],
      },
      scope,
    );

    expect(result.status).toBe("ambiguous");
  });
  it("mantem continuidade comercial V2 no estado e catalogo validados", () => {
    const presentedCatalog = [
      { ...catalog[0], id: "sol-700", name: "Sol 700", model: "Sol 700", price: 17_900 },
      { ...catalog[0], id: "sol-801", name: "Sol 801", model: "Sol 801", price: 18_900 },
      { ...catalog[0], id: "sol-801-spa", name: "Sol 801 SPA", model: "Sol 801 SPA", price: 21_900 },
      { ...catalog[0], id: "sol-802", name: "Sol 802", model: "Sol 802", price: 19_900 },
    ];
    const v2 = { continuityEnabled: true, structuredInterpretation: { intent: "product_inquiry", confirmation: "none" } };
    const confirmation = { continuityEnabled: true, structuredInterpretation: { intent: "confirmation", confirmation: "affirmative" } };
    const state = { attributes: {}, productIds: [], intent: "product_inquiry", lastValidProductIds: ["sol-700"] };
    const search = (history: { role: "lead" | "agent"; text: string; productIds?: string[] }[], options: CatalogSearchOptions = v2) =>
      searchSalesAgentCatalog("company-1", presentedCatalog, history, state, scope, options);

    expect(search([
      { role: "agent", text: "Apresentei a Sol 700.", productIds: ["sol-700"] },
      { role: "lead", text: "Ja e completa?" },
    ])).toMatchObject({ status: "matches", products: [{ id: "sol-700", price: 17_900 }] });

    expect(search([
      { role: "agent", text: "Apresentei a Sol 700.", productIds: ["sol-700"] },
      { role: "lead", text: "e a 801 quanto ta?" },
    ])).toMatchObject({ status: "matches", products: [{ id: "sol-801", price: 18_900 }] });
    for (const [text, subject] of [
      ["e a 801 quanto ta?", "price"],
      ["e a 801 o que vem incluso?", "product"],
      ["e a 801 tem fotos?", "product"],
      ["e a 801 quais medidas?", "dimensions"],
    ] as const) {
      expect(search([
        { role: "agent", text: "Apresentei a Sol 700.", productIds: ["sol-700"] },
        { role: "lead", text },
      ], { continuityEnabled: true, structuredInterpretation: { intent: "product_inquiry", subject, confirmation: "none" } })).toMatchObject({
        status: "matches",
        products: [{ id: "sol-801" }],
      });
    }


    expect(search([
      { role: "agent", text: "A Sol 700 custa R$ 17.900,00. Posso explicar o que acompanha?", productIds: ["sol-700"] },
      { role: "lead", text: "pode sim" },
    ], confirmation)).toMatchObject({ status: "matches", products: [{ id: "sol-700" }] });

    expect(search([
      { role: "agent", text: "Apresentei Sol 700, Sol 801 e Sol 802.", productIds: ["sol-700", "sol-801", "sol-802"] },
      { role: "lead", text: "gostei da segunda" },
    ])).toMatchObject({ status: "matches", products: [{ id: "sol-801" }] });

    expect(search([
      { role: "agent", text: "Apresentei Sol 801 e Sol 801 SPA.", productIds: ["sol-801", "sol-801-spa"] },
      { role: "lead", text: "gostei da 801" },
    ])).toMatchObject({ status: "ambiguous" });

    const dimensionResult = search([
      { role: "agent", text: "Apresentei a Sol 700.", productIds: ["sol-700"] },
      { role: "lead", text: "7 ou 8 metros" },
    ]);
    expect(dimensionResult.status).toBe("matches");
    if (dimensionResult.status === "matches") {
      expect(dimensionResult.products).not.toHaveLength(1);
    }
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
