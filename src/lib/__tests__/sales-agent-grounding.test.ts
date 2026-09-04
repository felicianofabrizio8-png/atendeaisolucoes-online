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
  selectRelevantSalesAgentCoachRules,
  selectRelevantSalesAgentQuickReplies,
  selectRelevantSalesAgentProducts,
} from "../sales-agent-grounding.server";
import type { ActiveCoachRuleGrounding } from "../coach-rules/coach-rules.repository";
import type { QuickReplyGrounding } from "../quick-replies/quick-replies.repository";

function coachRule(
  id: string,
  category: string,
  title: string,
  content: string,
): ActiveCoachRuleGrounding {
  return {
    ruleId: id,
    versionId: `version-${id}`,
    versionNumber: 1,
    category: category as ActiveCoachRuleGrounding["category"],
    ruleType: "instruction",
    title,
    content,
    priority: 50,
    scopeKind: "company",
    scopeRef: {},
  };
}

function quickReply(
  name: string,
  category: string,
  content: string,
  sort_order = 0,
): QuickReplyGrounding {
  return { name, category, content, sort_order };
}

function query(result: { data: unknown; error?: unknown }, reject?: Error) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
    then: (
      resolve: (value: { data: unknown; error?: unknown }) => unknown,
      rejectPromise: (reason: Error) => unknown,
    ) => (reject ? rejectPromise(reject) : resolve(result)),
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

  it("inclui regra ativa relevante e exclui regra irrelevante", () => {
    const selected = selectRelevantSalesAgentCoachRules(
      [
        coachRule("payment", "payments", "Pagamento", "Informe Pix e cartão."),
        coachRule("tone", "tone", "Tom", "Seja cordial."),
      ],
      [{ role: "lead", text: "Quais formas de pagamento vocês aceitam?" }],
    );

    expect(selected.map((rule) => rule.ruleId)).toEqual(["payment"]);
  });

  it("limita regras relevantes a no mÃ¡ximo trÃªs", () => {
    const rules = [
      coachRule("payment", "payments", "Pagamento", "Informe pagamento e Pix."),
      coachRule("warranty", "after_sales", "Garantia", "Explique a garantia do casco."),
      coachRule("installation", "sales", "Instalação", "Explique a instalação e materiais."),
      coachRule("discount", "discounts", "Desconto", "Não conceda desconto."),
    ];

    expect(
      selectRelevantSalesAgentCoachRules(rules, [
        { role: "lead", text: "Quero saber pagamento, garantia, instalação e desconto" },
      ]),
    ).toHaveLength(3);
  });

  it("nÃ£o retorna regras sem contexto aplicÃ¡vel", () => {
    expect(
      selectRelevantSalesAgentCoachRules(
        [coachRule("payment", "payments", "Pagamento", "Informe Pix.")],
        [],
      ),
    ).toEqual([]);
  });

  it("rejeita coincidÃªncia genÃ©rica sem sinal de tÃ³pico", () => {
    expect(
      selectRelevantSalesAgentCoachRules(
        [coachRule("generic", "sales", "Orientação", "Atenda o cliente com atenção.")],
        [{ role: "lead", text: "Olá, tudo bem?" }],
      ),
    ).toEqual([]);
  });

  it("encontra Por Conta do Cliente por responsabilidade e itens da obra", () => {
    const porConta = quickReply(
      "Por Conta do Cliente",
      "Orçamento",
      "Remoção da terra, água, contrapiso, energia, drenagem e materiais.",
    );

    expect(
      selectRelevantSalesAgentQuickReplies(
        [porConta],
        [{ role: "lead", text: "Quais itens ficam por conta do cliente?" }],
      ),
    ).toEqual([porConta]);
    expect(
      selectRelevantSalesAgentQuickReplies(
        [porConta],
        [{ role: "lead", text: "O contrapiso e a energia ficam com quem?" }],
      ),
    ).toEqual([porConta]);
  });

  it("nÃ£o inclui quick reply para mensagem irrelevante", () => {
    expect(
      selectRelevantSalesAgentQuickReplies(
        [quickReply("Por Conta do Cliente", "Orçamento", "Água e materiais.")],
        [{ role: "lead", text: "Olá, tudo bem?" }],
      ),
    ).toEqual([]);
  });

  it("nÃ£o suprime quick replies por tÃ³pico do histÃ³rico sem fonte duplicada", () => {
    const porConta = quickReply("Por Conta do Cliente", "Orçamento", "Água e materiais.");

    expect(
      selectRelevantSalesAgentQuickReplies(
        [porConta],
        [{ role: "lead", text: "Falamos de pagamento antes; agora, o que fica por conta?" }],
      ),
    ).toEqual([porConta]);
  });

  it("limita quick replies relevantes a no máximo duas", () => {
    const replies = [
      quickReply("Por Conta do Cliente", "Orçamento", "Contrapiso, água e energia."),
      quickReply("Materiais da instalação", "Orçamento", "Materiais e drenagem."),
      quickReply("Itens inclusos", "Orçamento", "Itens e brindes inclusos."),
    ];

    expect(
      selectRelevantSalesAgentQuickReplies(replies, [
        { role: "lead", text: "Quais itens, materiais e o que fica por conta do cliente?" },
      ]),
    ).toHaveLength(2);
  });

  it("trunca o conteúdo selecionado sem alterar sua origem", () => {
    const content = "contrapiso ".repeat(100);
    const selected = selectRelevantSalesAgentQuickReplies(
      [quickReply("Por Conta do Cliente", "Orçamento", content)],
      [{ role: "lead", text: "O contrapiso fica por conta do cliente?" }],
    );

    expect(selected).toHaveLength(1);
    expect(selected[0].content).toHaveLength(500);
    expect(selected[0].content.endsWith("…")).toBe(true);
  });

  it("nÃ£o duplica fontes estruturadas de pagamento ou garantia", () => {
    const replies = [
      quickReply("Pagamento", "Orçamento", "Pix, cartão e parcelamento."),
      quickReply("Garantia", "Orçamento", "Garantia do casco."),
    ];

    expect(
      selectRelevantSalesAgentQuickReplies(replies, [
        { role: "lead", text: "Quais formas de pagamento vocês aceitam?" },
      ], {}, { paymentMethods: "Pix e cartão em até 10 vezes." }),
    ).toEqual([]);
    expect(
      selectRelevantSalesAgentQuickReplies(replies, [
        { role: "lead", text: "Qual é a garantia do casco?" },
      ], {}, { guarantees: "Garantia de 10 anos para o casco." }),
    ).toEqual([]);
  });

  it("nÃ£o duplica coach rules, playbook ou catÃ¡logo", () => {
    const reply = quickReply("Orientação", "Orçamento", "Apresente a piscina Caribe com instalação.");

    expect(
      selectRelevantSalesAgentQuickReplies(
        [reply],
        [{ role: "lead", text: "Quero saber sobre a instalação da piscina Caribe." }],
        {},
        {
          coachRules: [{ title: "Instalação", content: "Apresente a piscina Caribe com instalação." }],
          playbook: "Apresente a piscina Caribe com instalação.",
          catalog: [{ name: "Piscina Caribe", description: "Instalação inclusa." }],
        },
      ),
    ).toEqual([]);
  });

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
    const commercial = query({
      data: {
        commercial_terms: "Entrada de 50%",
        payment_policy: "Pix ou cartão conforme condição vigente",
        installation_policy: "Confirmar avaliação técnica",
        next_load_forecast: "Primeira quinzena do mês",
        visit_policy: "Agendar com a equipe",
        heating_policy: "Validar compatibilidade antes de oferecer",
        shipping_policy: "Frete confirmado pela equipe",
        included_items_policy: "Informar somente itens cadastrados no produto",
      },
    });
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
    expect(grounding.commercialRules).toMatchObject({
      paymentPolicy: "Pix ou cartão conforme condição vigente",
      installationPolicy: "Confirmar avaliação técnica",
      nextLoadForecast: "Primeira quinzena do mês",
      visitPolicy: "Agendar com a equipe",
      heatingPolicy: "Validar compatibilidade antes de oferecer",
      shippingPolicy: "Frete confirmado pela equipe",
      includedItemsPolicy: "Informar somente itens cadastrados no produto",
    });
    expect(grounding.approvedCoachLearnings).toEqual([]);
    expect(products.eq).toHaveBeenCalledWith("active", true);
    expect(products.limit).not.toHaveBeenCalled();
    expect(knowledge.eq).toHaveBeenCalledWith("status", "approved");
  });

  it("usa fallback quando o catálogo falha sem derrubar o grounding", async () => {
    const products = query({ data: null }, new Error("catalog unavailable"));
    const knowledge = query({ data: [{ question: "Instala?", answer: "Sim.", type: "faq" }] });
    const commercial = query({
      data: { commercial_terms: "Entrada", payment_policy: "Pix", next_load_forecast: null },
    });
    from.mockImplementation((table: string) =>
      table === "products" ? products : table === "ai_knowledge_proposals" ? knowledge : commercial,
    );

    await expect(loadSalesAgentGrounding("company-1")).resolves.toMatchObject({
      catalog: [],
      faqKnowledge: [{ question: "Instala?", answer: "Sim.", type: "faq" }],
      commercialRules: { commercialTerms: "Entrada", paymentPolicy: "Pix" },
    });
  });

  it("preserva as demais fontes quando a FAQ retorna erro do Supabase", async () => {
    const products = query({ data: [{ id: "product-1", name: "Piscina" }] });
    const knowledge = query({ data: null, error: new Error("faq unavailable") });
    const commercial = query({
      data: { commercial_terms: "Entrada", payment_policy: "Pix", next_load_forecast: null },
    });
    from.mockImplementation((table: string) =>
      table === "products" ? products : table === "ai_knowledge_proposals" ? knowledge : commercial,
    );

    await expect(loadSalesAgentGrounding("company-1")).resolves.toMatchObject({
      catalog: [{ id: "product-1" }],
      faqKnowledge: [],
      commercialRules: { commercialTerms: "Entrada", paymentPolicy: "Pix" },
    });
  });

  it("preserva catálogo e FAQ quando as regras comerciais falham", async () => {
    const products = query({ data: [{ id: "product-1", name: "Piscina" }] });
    const knowledge = query({ data: [{ question: "Instala?", answer: "Sim.", type: "faq" }] });
    const commercial = query({ data: null }, new Error("commercial unavailable"));
    from.mockImplementation((table: string) =>
      table === "products" ? products : table === "ai_knowledge_proposals" ? knowledge : commercial,
    );

    await expect(loadSalesAgentGrounding("company-1")).resolves.toMatchObject({
      catalog: [{ id: "product-1" }],
      faqKnowledge: [{ question: "Instala?" }],
      commercialRules: { commercialTerms: null, paymentPolicy: null, nextLoadForecast: null },
    });
  });

  it("seleciona por 6 metros somente produtos reais correspondentes", () => {
    const products = [
      {
        id: "six",
        name: "Piscina 6x3",
        category: "Piscinas de fibra",
        description: "Modelo com 6 metros de comprimento",
        lengthM: 6,
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
        lengthM: 5,
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

  it.each([
    [4, ["Sol 400", "Sol 401 Canyon", "Sol 402 Tapajós"]],
    [5, ["Sol 500", "Sol 500 Praia", "Sol 501 Canyon"]],
    [
      6,
      [
        "Sol 600",
        "Sol 600 Praia",
        "Sol 601 Canyon",
        "Sol 601 SPA",
        "Sol 602 Tapajós",
        "Sol 603 Enseada",
        "Sol 604 Salinas",
        "Sol 604 Salinas Semi Pastilhada",
        "Sol 604 Pastilhada",
      ],
    ],
    [7, ["Sol 700", "Sol 700 Praia"]],
    [8, ["Sol 800", "Sol 800 Praia", "Sol 801 Canyon", "Sol 801 SPA"]],
    [10, ["Sol 1000", "Sol 1000 Praia"]],
  ])("retorna todos os produtos reais com length_m %i", (length, names) => {
    const catalog = [
      ...names.map((name, index) => ({
        id: `${length}-${index}`,
        name,
        category: "Piscinas de fibra",
        description: null,
        lengthM: length,
        price: null,
        promoPrice: null,
        images: [],
        notes: null,
      })),
      {
        id: `other-${length}`,
        name: `Outro tamanho ${length}`,
        category: "Piscinas de fibra",
        description: null,
        lengthM: length + 1,
        price: null,
        promoPrice: null,
        images: [],
        notes: null,
      },
      {
        id: `legacy-${length}`,
        name: `Nome legado ${length} metros`,
        category: "Piscinas de fibra",
        description: null,
        price: null,
        promoPrice: null,
        images: [],
        notes: null,
      },
    ];

    expect(
      selectRelevantSalesAgentProducts(catalog, [
        { role: "lead", text: `Quero conhecer as piscinas de ${length} m` },
      ]).map((product) => product.name),
    ).toEqual(names);
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

  it("inclui produtos de aquecimento e suas specifications para a pergunta técnica", () => {
    const heatingByCategory = {
      id: "heat-category",
      name: "Equipamento térmico",
      category: "Aquecedores",
      description: null,
      specifications: { potencia_btu: 75_000, tecnologia: "trocador de calor" },
      price: null,
      promoPrice: null,
      images: [],
      notes: null,
    };
    const heatingBySpecifications = {
      id: "heat-specifications",
      name: "Linha Conforto",
      category: "Climatização",
      description: null,
      specifications: { tipo: "aquecedor solar", funcionamento: "circulação de água" },
      price: null,
      promoPrice: null,
      images: [],
      notes: null,
    };
    const irrelevant = {
      id: "irrelevant",
      name: "Kit de limpeza",
      category: "Acessórios",
      description: "Itens para manutenção",
      specifications: { material: "plástico" },
      price: null,
      promoPrice: null,
      images: [],
      notes: null,
    };

    const selected = selectRelevantSalesAgentProducts(
      [heatingByCategory, heatingBySpecifications, irrelevant],
      [{ role: "lead", text: "Como funciona o aquecimento da piscina?" }],
    );

    expect(selected).toEqual([heatingByCategory, heatingBySpecifications]);
    expect(selected.map((product) => product.specifications)).toEqual([
      heatingByCategory.specifications,
      heatingBySpecifications.specifications,
    ]);
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

  it.each([
    "piscina quadrada",
    "modelos quadrados",
    "modelo quadrada",
    "piscina mais quadrada",
    "piscina reta",
    "modelos retos",
  ])("interpreta %s como intenção por linhas retas sem alterar shape", (text) => {
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
    const round = { ...rectangular, id: "round", name: "Piscina curva", shape: "redonda" };
    const selected = selectRelevantSalesAgentProducts(
      [rectangular, round],
      [{ role: "lead", text }],
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

    expect(listLearningCandidates).toHaveBeenCalledWith(expect.anything(), "company-1", 30);
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

  it("limita o catálogo sem filtro a três produtos", () => {
    const catalog = Array.from({ length: 5 }, (_, index) => ({
      id: `product-${index}`,
      name: `Piscina ${index + 1}`,
      category: "Piscinas",
      description: null,
      price: 10_000,
      promoPrice: null,
      images: [],
      notes: null,
    }));

    expect(
      selectRelevantSalesAgentProducts(catalog, [
        { role: "lead", text: "Quero conhecer as opcoes" },
      ]),
    ).toHaveLength(3);
  });

  it("ranqueia o modelo mencionado antes de limitar as opcoes", () => {
    const catalog = ["Outro 6", "Alto 6", "Caribe 6", "Compacto 6"].map((model) => ({
      id: model,
      name: `Piscina ${model}`,
      model: null,
      category: "Piscinas",
      description: null,
      price: 10_000,
      promoPrice: null,
      images: [],
      notes: null,
    }));

    const selected = selectRelevantSalesAgentProducts(catalog, [
      { role: "lead", text: "Quero uma piscina com Caribe" },
    ]);

    expect(selected).toHaveLength(3);
    expect(selected[0].id).toBe("Caribe 6");
  });

  it("encontra produto por nome exato normalizado", () => {
    const catalog = [
      {
        id: "sol-500-praia",
        name: "Sol 500 Praia",
        category: "Piscinas",
        description: null,
        price: 20_000,
        promoPrice: null,
        images: [],
        notes: null,
      },
      {
        id: "sol-501",
        name: "Sol 501 Canyon",
        category: "Piscinas",
        description: null,
        price: 21_000,
        promoPrice: null,
        images: [],
        notes: null,
      },
    ];

    expect(
      selectRelevantSalesAgentProducts(catalog, [
        { role: "lead", text: "E a SOL 500 PRAIA, quanto está?" },
      ]).map((product) => product.id),
    ).toEqual(["sol-500-praia"]);
  });

  it("não trata nome semelhante como match exato", () => {
    const catalog = [
      {
        id: "sol-500-praia",
        name: "Sol 500 Praia",
        category: "Piscinas",
        description: null,
        price: 20_000,
        promoPrice: null,
        images: [],
        notes: null,
      },
      {
        id: "sol-500-praiano",
        name: "Sol 500 Praiano",
        category: "Piscinas",
        description: null,
        price: 21_000,
        promoPrice: null,
        images: [],
        notes: null,
      },
    ];

    expect(
      selectRelevantSalesAgentProducts(catalog, [
        { role: "lead", text: "Quanto está a Sol 500 Praiano?" },
      ]).map((product) => product.id),
    ).toContain("sol-500-praiano");
    expect(
      selectRelevantSalesAgentProducts(catalog, [
        { role: "lead", text: "Quanto está a Sol 500 Praiano?" },
      ]).map((product) => product.id),
    ).not.toContain("sol-500-praia");
  });

  it("mantém o produto encontrado por nome entre os três selecionados", () => {
    const catalog = [
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `other-${index}`,
        name: `Outra piscina ${index}`,
        category: "Piscinas",
        description: null,
        price: 10_000,
        promoPrice: null,
        images: [],
        notes: null,
      })),
      {
        id: "sol-500-praia",
        name: "Sol 500 Praia",
        category: "Piscinas",
        description: null,
        price: 20_000,
        promoPrice: null,
        images: [],
        notes: null,
      },
    ];

    expect(
      selectRelevantSalesAgentProducts(catalog, [
        { role: "lead", text: "Quero saber o preço da Sol 500 Praia" },
      ]).map((product) => product.id),
    ).toContain("sol-500-praia");
  });

  it("usa medida persistida para filtrar mesmo sem repeti-la no texto", () => {
    const catalog = [
      {
        id: "six",
        name: "Piscina 6x3",
        category: "Piscinas",
        description: null,
        lengthM: 6,
        widthM: 3,
        price: 10_000,
        promoPrice: null,
        images: [],
        notes: null,
      },
      {
        id: "five",
        name: "Piscina 5x3",
        category: "Piscinas",
        description: null,
        lengthM: 5,
        widthM: 3,
        price: 9_000,
        promoPrice: null,
        images: [],
        notes: null,
      },
    ];

    expect(
      selectRelevantSalesAgentProducts(
        catalog,
        [{ role: "lead", text: "Pode me mostrar as opcoes?" }],
        { attributes: { lengthM: 6, widthM: 3 }, productIds: [], intent: null, lastValidProductIds: [] },
      ).map((product) => product.id),
    ).toEqual(["six"]);
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
