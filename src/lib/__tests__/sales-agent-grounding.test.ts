import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, listLearningCandidates, retrieveLearnings } = vi.hoisted(() => ({
  from: vi.fn(),
  listLearningCandidates: vi.fn(),
  retrieveLearnings: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
vi.mock("../coach-learnings/coach-learnings.repository", () => ({ listLearningCandidates }));
vi.mock("../coach-learnings/retriever", () => ({ retrieveLearnings }));

import {
  loadRelevantSalesAgentLearnings,
  loadSalesAgentGrounding,
  selectRelevantSalesAgentProducts,
} from "../sales-agent-grounding.server";

function query(result: { data: unknown }) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (value: { data: unknown }) => unknown) => Promise.resolve(resolve(result)),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockResolvedValue(result);
  builder.maybeSingle.mockResolvedValue(result);
  return builder;
}

describe("SalesAgent grounding", () => {
  beforeEach(() => vi.clearAllMocks());

  it("carrega catálogo, conhecimento e regras comerciais da empresa", async () => {
    const products = query({
      data: [
        {
          id: "product-1",
          name: "Piscina 6x3",
          model: "Caribe 6",
          sku: "CAR-6X3",
          description: "Fibra",
          length_m: 6,
          width_m: 3,
          depth_m: 1.4,
          capacity_l: 24_000,
          shape: "retangular",
          specifications: { material: "fibra" },
          included_items: ["Filtro", "Bomba"],
          variants: [{ name: "Azul", color: "azul" }],
          price: 20_000,
          promo_price: 18_000,
          category: "Piscinas de fibra",
          images: ["image.jpg", 123],
          notes: "Filtro incluso",
        },
      ],
    });
    const knowledge = query({ data: [{ question: "Instala?", answer: "Sim.", type: "faq" }] });
    const commercial = query({ data: { commercial_terms: "Entrada de 50%" } });
    from.mockImplementation((table: string) => {
      if (table === "products") return products;
      if (table === "ai_knowledge_proposals") return knowledge;
      if (table === "marketing_knowledge_base") return commercial;
      throw new Error(`unexpected table: ${table}`);
    });

    const grounding = await loadSalesAgentGrounding("company-1");

    expect(grounding.catalog[0]).toMatchObject({
      id: "product-1",
      model: "Caribe 6",
      sku: "CAR-6X3",
      category: "Piscinas de fibra",
      lengthM: 6,
      widthM: 3,
      depthM: 1.4,
      capacityL: 24_000,
      shape: "retangular",
      specifications: { material: "fibra" },
      includedItems: ["Filtro", "Bomba"],
      variants: [{ name: "Azul", color: "azul" }],
      price: 20_000,
      promoPrice: 18_000,
      images: ["image.jpg"],
    });
    expect(grounding.faqKnowledge).toEqual([{ question: "Instala?", answer: "Sim.", type: "faq" }]);
    expect(grounding.commercialRules.commercialTerms).toBe("Entrada de 50%");
    expect(grounding.approvedCoachLearnings).toEqual([]);
    expect(products.eq).toHaveBeenCalledWith("active", true);
    expect(products.limit).not.toHaveBeenCalled();
    expect(knowledge.eq).toHaveBeenCalledWith("status", "approved");
  });

  it("seleciona por 6 metros somente produtos reais correspondentes", () => {
    const products = [
      {
        id: "six",
        name: "Piscina 6x3",
        category: "Piscinas de fibra",
        description: "Modelo com 6 metros de comprimento",
        price: 20_000,
        promoPrice: null,
        images: [],
        notes: null,
      },
      {
        id: "five",
        name: "Piscina 5x2,5",
        category: "Piscinas de fibra",
        description: "Modelo compacto",
        price: 15_000,
        promoPrice: null,
        images: [],
        notes: null,
      },
    ];

    expect(
      selectRelevantSalesAgentProducts(products, [
        { role: "lead", text: "Quero ver piscinas de 6 metros" },
      ]).map((product) => product.id),
    ).toEqual(["six"]);
  });

  it("combina dimensão, profundidade, litragem, shape, modelo, SKU e variante", () => {
    const catalog = [
      {
        id: "caribe",
        name: "Piscina Caribe",
        model: "Caribe 6",
        sku: "CAR-6X3-AZ",
        category: "Piscinas de fibra",
        description: "Modelo de linhas retas",
        lengthM: 6,
        widthM: 3,
        depthM: 1.4,
        capacityL: 24_000,
        shape: "retangular",
        specifications: { material: "fibra" },
        includedItems: ["Filtro"],
        variants: [{ name: "Azul", color: "azul" }],
        price: 20_000,
        promoPrice: null,
        images: [],
        notes: null,
      },
      {
        id: "redonda",
        name: "Piscina Lua",
        model: "Lua 5",
        sku: "LUA-5-BR",
        category: "Piscinas de fibra",
        description: "Modelo curvo",
        lengthM: 5,
        widthM: 5,
        depthM: 1.2,
        capacityL: 15_000,
        shape: "redonda",
        specifications: {},
        includedItems: [],
        variants: [{ name: "Branca", color: "branca" }],
        price: 15_000,
        promoPrice: null,
        images: [],
        notes: null,
      },
    ];
    const select = (text: string) =>
      selectRelevantSalesAgentProducts(catalog, [{ role: "lead", text }]).map(
        (product) => product.id,
      );

    expect(select("Quero uma piscina 6x3")).toEqual(["caribe"]);
    expect(select("Qual tem profundidade 1,40 m?")).toEqual(["caribe"]);
    expect(select("Preciso de 24 mil litros")).toEqual(["caribe"]);
    expect(select("Quero formato retangular")).toEqual(["caribe"]);
    expect(select("Quero o modelo Caribe 6")).toEqual(["caribe"]);
    expect(select("SKU CAR-6X3-AZ")).toEqual(["caribe"]);
    expect(select("Tem na cor azul?")).toEqual(["caribe"]);
    expect(select("Preciso de profundidade 9 m")).toEqual([]);
  });

  it("preserva product_id escolhido em pergunta seguinte", () => {
    const catalog = [
      {
        id: "chosen",
        name: "Piscina escolhida",
        category: "Piscinas de fibra",
        description: null,
        depthM: 1.4,
        price: 10_000,
        promoPrice: null,
        images: [],
        notes: null,
      },
      {
        id: "other",
        name: "Outra piscina",
        category: "Piscinas de fibra",
        description: null,
        depthM: 1.2,
        variants: [{ color: "azul" }],
        price: 9_000,
        promoPrice: null,
        images: [],
        notes: null,
      },
    ];

    expect(
      selectRelevantSalesAgentProducts(catalog, [
        { role: "agent", text: "Produto apresentado", productIds: ["chosen"] },
        { role: "lead", text: "Qual é a profundidade dele?" },
      ]).map((product) => product.id),
    ).toEqual(["chosen"]);

    expect(
      selectRelevantSalesAgentProducts(catalog, [
        { role: "agent", text: "Produto apresentado", productIds: ["chosen"] },
        { role: "lead", text: "Ele tem variante azul?" },
      ]).map((product) => product.id),
    ).toEqual([]);
  });

  it("interpreta quadrada como intenção por linhas retas sem alterar shape", () => {
    const rectangular = {
      id: "rect",
      name: "Piscina reta",
      category: "Piscinas de fibra",
      description: null,
      shape: "retangular",
      price: 10_000,
      promoPrice: null,
      images: [],
      notes: null,
    };
    const selected = selectRelevantSalesAgentProducts(
      [rectangular],
      [{ role: "lead", text: "Quero uma piscina quadrada" }],
    );

    expect(selected).toEqual([rectangular]);
    expect(selected[0].shape).toBe("retangular");
  });

  it("ranqueia candidatos pela mensagem atual e preserva company_id", async () => {
    const relevant = {
      id: "learning-1",
      company_id: "company-1",
      status: "active",
      category: "tone",
      title: "Abertura sobre piscinas",
      description: "Resposta treinada",
      rule_structured: "Responder à solicitação de informações sobre piscinas",
      product_ref: null,
      positive_example: "Claro! Qual tamanho você procura?",
      negative_example: "Como posso ajudar?",
      priority: 50,
      confidence: 0.7,
    };
    listLearningCandidates.mockResolvedValue([relevant]);
    retrieveLearnings.mockReturnValue({ selected: [relevant], scored: [], metrics: {} });

    const learnings = await loadRelevantSalesAgentLearnings("company-1", [
      { role: "agent", text: "Olá" },
      { role: "lead", text: "Gostaria de informações das piscinas" },
    ]);

    expect(listLearningCandidates).toHaveBeenCalledWith(expect.anything(), "company-1", 50);
    expect(retrieveLearnings).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        currentMessage: "Gostaria de informações das piscinas",
        maxSelected: 5,
      }),
    );
    expect(learnings[0]).toMatchObject({
      id: "learning-1",
      positiveExample: "Claro! Qual tamanho você procura?",
      negativeExample: "Como posso ajudar?",
    });
  });

  it("não cria efeitos externos durante o grounding", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../sales-agent-grounding.server.ts", import.meta.url), "utf8"),
    );
    expect(source).not.toMatch(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.rpc\s*\(|\bfetch\s*\(/);
    expect(source).not.toMatch(/incrementLearningUsage|recordCoachLearningRetrieval/);
  });

  it("persiste e recarrega contexto de product_id sem alterar tabelas", async () => {
    const agentSource = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../ai-agent.server.ts", import.meta.url), "utf8"),
    );
    expect(agentSource).toContain("catalog_product_ids");
    expect(agentSource).toContain('select("role, text, at, source_metadata")');
    expect(agentSource).toContain("productIds: decision.suggested_products");
  });
});
