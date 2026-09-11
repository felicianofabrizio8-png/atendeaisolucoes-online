import { describe, expect, it } from "vitest";
import {
  buildValidatedCatalogReply,
  getAutomaticProductImageIds,
  getRequestedProductLength,
} from "../sales-agent-core";
import {
  extractCurrentProductAttributes,
  selectRelevantSalesAgentProducts,
} from "../sales-agent-grounding.server";

const catalog = [
  {
    id: "pool-5",
    name: "Piscina Sol 500",
    category: "Piscinas",
    description: null,
    lengthM: 5,
    widthM: 2.4,
    price: 20_000,
    promoPrice: null,
    images: [],
    notes: null,
  },
  {
    id: "pool-6",
    name: "Piscina Sol 600",
    category: "Piscinas",
    description: null,
    lengthM: 6,
    widthM: 3,
    price: 24_000,
    promoPrice: null,
    images: [],
    notes: null,
  },
  {
    id: "pool-7-wide",
    name: "Piscina Sol 700",
    category: "Piscinas",
    description: null,
    lengthM: 7,
    widthM: 5.5,
    price: 28_000,
    promoPrice: null,
    images: [],
    notes: null,
  },
];

describe("regressao de resolucao de catalogo", () => {
  it("resolve 8x5 como espaco, mantem opcoes de 5m e encontra uma maior com preco", () => {
    const firstHistory = [{ role: "lead" as const, text: "Tenho um espaco 8x5 m" }];
    const firstCandidates = selectRelevantSalesAgentProducts(catalog, firstHistory);
    const presentedFiveMeterOptions = firstCandidates.filter((product) => product.lengthM === 5);
    const state = {
      attributes: extractCurrentProductAttributes(firstHistory),
      productIds: [],
      intent: "product_inquiry",
      lastValidProductIds: presentedFiveMeterOptions.map((product) => product.id),
    };
    const nextCandidates = selectRelevantSalesAgentProducts(
      catalog,
      [{ role: "lead" as const, text: "Quero uma maior, qual modelo e quanto custa?" }],
      state,
    );

    expect(state.attributes).toMatchObject({ spaceLengthM: 8, spaceWidthM: 5 });
    expect(state.attributes).not.toHaveProperty("lengthM");
    expect(presentedFiveMeterOptions.map((product) => product.id)).toEqual(["pool-5"]);
    expect(nextCandidates.map((product) => product.id)).toEqual(["pool-6"]);
    expect(buildValidatedCatalogReply(nextCandidates, { includePrice: true })).toContain("R$ 24.000,00");
  });

  it("mantem filtro exato para piscina 6x3", () => {
    const result = selectRelevantSalesAgentProducts(catalog, [
      { role: "lead", text: "Quero uma piscina 6x3" },
    ]);

    expect(result.map((product) => product.id)).toEqual(["pool-6"]);
    expect(extractCurrentProductAttributes([{ role: "lead", text: "Quero uma piscina 6x3" }]))
      .toMatchObject({ lengthM: 6, widthM: 3 });
    expect(getRequestedProductLength([{ role: "lead", text: "Quero uma piscina 6x3" }])).toBe(6);
  });

  it("nao transforma a medida do espaco em comprimento exato nem prioriza imagens de 5m", () => {
    const history = [{ role: "lead" as const, text: "Tenho um espaco 8x5 m" }];
    expect(getRequestedProductLength(history)).toBeNull();
    expect(getAutomaticProductImageIds(history, [
      { ...catalog[0], images: ["pool-5.jpg"] },
    ])).toEqual([]);
  });

  it.each(["terreno", "quintal"])("trata %s 8x5 como espaco disponivel", (place) => {
    const history = [{ role: "lead" as const, text: `Tenho um ${place} 8x5 m` }];
    const attributes = extractCurrentProductAttributes(history);

    expect(attributes).toMatchObject({ spaceLengthM: 8, spaceWidthM: 5 });
    expect(attributes).not.toHaveProperty("lengthM");
    expect(attributes).not.toHaveProperty("widthM");
  });

  it("encontra uma piscina menor que a candidata preservada", () => {
    const result = selectRelevantSalesAgentProducts(
      catalog,
      [{ role: "lead", text: "Quero uma menor" }],
      { attributes: {}, productIds: [], intent: "product_inquiry", lastValidProductIds: ["pool-6"] },
    );

    expect(result.map((product) => product.id)).toEqual(["pool-5"]);
  });

  it("mantem comprimento explicito de 5m", () => {
    expect(getRequestedProductLength([{ role: "lead", text: "Quero uma piscina de 5 m" }])).toBe(5);
  });
});
