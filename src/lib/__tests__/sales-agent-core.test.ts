import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  SalesAgentCore,
  buildSalesAgentCompletionRequest,
  hasRectangularPoolIntent,
  type AgentContext,
  type SalesAgentCompletionRequest,
  type SalesAgentCoreInput,
} from "../sales-agent-core";
import { runSafetyLayer } from "../ai-agent.server";

const salesModel = "provider/sales-model";

const context: AgentContext = {
  settings: {
    company_id: "company-1",
    ai_auto_reply_enabled: true,
    ai_after_hours_only: true,
    ai_initial_message: null,
    ai_max_auto_replies: 3,
    ai_handoff_timeout_minutes: 30,
    ai_agent_name: "Ana",
    business_hours_start: "08:00:00",
    business_hours_end: "18:00:00",
  },
  companyName: "Piscinas Exemplo",
  aiProfile: {
    tone: "consultivo",
    description: "Venda e instalação de piscinas",
    products: null,
    payment_methods: "Pix e cartão",
    avg_lead_time: null,
    region: "SP",
    differentials: "Instalação própria",
    faq: [{ q: "Instala?", a: "Sim." }],
  },
  products: [
    {
      id: "product-1",
      name: "Piscina 6x3",
      category: "Piscinas de fibra",
      description: "Piscina de fibra",
      price: 20_000,
      promoPrice: 18_000,
      images: [],
      notes: "Filtro e bomba",
    },
  ],
  knowledge: [{ question: "Atende interior?", answer: "Sim.", type: "faq" }],
  grounding: {
    catalog: [
      {
        id: "product-1",
        name: "Piscina 6x3",
        category: "Piscinas de fibra",
        description: "Piscina de fibra",
        price: 20_000,
        promoPrice: 18_000,
        images: [],
        notes: "Filtro e bomba",
      },
    ],
    faqKnowledge: [{ question: "Atende interior?", answer: "Sim.", type: "faq" }],
    commercialRules: {
      paymentMethods: "Pix e cartão",
      commercialTerms: "Entrada de 50% conforme contrato",
      paymentPolicy: null,
      installationPolicy: null,
      visitPolicy: null,
      heatingPolicy: null,
      shippingPolicy: null,
      includedItemsPolicy: null,
    },
    approvedCoachLearnings: [
      {
        id: "learning-1",
        category: "commercial",
        title: "Não prometer desconto",
        description: "Encaminhar negociação",
        rule: "Solicitações de desconto exigem atendimento humano",
        productRef: null,
        positiveExample: null,
        negativeExample: null,
        priority: 90,
        confidence: 0.9,
      },
    ],
  },
};
context.catalogForValidation = context.grounding.catalog;

describe("SalesAgentCore", () => {
  it("prioriza uma correção salva da sessão na próxima pergunta semelhante", async () => {
    const correction = "Comece entendendo a necessidade do cliente antes de sugerir uma solução.";
    const complete = vi.fn(async (request: SalesAgentCompletionRequest) => {
      const prompt = request.messages[1].content;
      expect(prompt).toContain("CORREÇÕES APROVADAS DESTA SESSÃO");
      expect(prompt).toContain("Como devo começar o atendimento?");
      expect(prompt).toContain(correction);
      expect(prompt.indexOf("Conversa até agora")).toBeLessThan(
        prompt.indexOf("CORREÇÕES APROVADAS DESTA SESSÃO"),
      );
      expect(prompt).toContain("prioridade sobre os aprendizados do Coach");
      expect(prompt).toContain("catálogo e POLÍTICAS OFICIAIS continuam soberanos");
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
                      arguments: JSON.stringify({ message: correction }),
                    },
                  },
                ],
              },
            },
          ],
        },
      };
    });

    const decision = await new SalesAgentCore(complete).decide({
      ctx: context,
      history: [{ role: "lead", text: "Qual é a melhor forma de iniciar o atendimento?" }],
      leadName: "Cliente simulado",
      model: salesModel,
      sessionCorrections: [
        { question: "Como devo começar o atendimento?", correction },
      ],
    });

    expect(decision).toMatchObject({ kind: "reply", message: correction });
  });

  it("preserva a correção salva ao repetir uma pergunta por comprimento", async () => {
    const correction =
      "Temos sim. Temos duas opções de 7 metros: a Sol 700 e a Sol 700 Praia. Vou te mostrar as duas para você conhecer.";
    const products = [
      { ...context.grounding.catalog[0], id: "sol-700", name: "Sol 700", lengthM: 7 },
      {
        ...context.grounding.catalog[0],
        id: "sol-700-praia",
        name: "Sol 700 Praia",
        lengthM: 7,
      },
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
                      message: correction,
                      suggest_products: ["sol-700", "sol-700-praia"],
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const decision = await new SalesAgentCore(complete).decide({
      ctx: {
        ...context,
        products,
        grounding: { ...context.grounding, catalog: products },
      },
      history: [{ role: "lead", text: "Você tem piscina de 7 metros?" }],
      leadName: "Cliente simulado",
      model: salesModel,
      sessionCorrections: [{ question: "Você tem piscina de 7 metros?", correction }],
    });

    expect(decision).toMatchObject({
      kind: "reply",
      message: correction,
      suggested_products: ["sol-700", "sol-700-praia"],
      learning_ids_used: [],
    });
    expect(decision.message).not.toContain("Encontrei no catálogo");
  });
  const validatedProduct = {
    ...context.products[0],
    name: "Piscina 6x3",
    model: "Caribe 6",
    lengthM: 6,
    widthM: 3,
    depthM: 1.4,
    capacityL: 24000,
    shape: "retangular",
    specifications: { material: "fibra" },
    includedItems: ["Filtro", "Bomba"],
  };
const validationContext: AgentContext = {
    ...context,
    products: [validatedProduct],
    catalogForValidation: [validatedProduct],
    grounding: { ...context.grounding, catalog: [validatedProduct] },
};

  function completionWithMessage(message: string, suggestProducts = ["product-1"]) {
    return {
      ok: true as const,
      data: {
        choices: [{
          message: {
            tool_calls: [{
              function: {
                name: "respond_to_customer",
                arguments: JSON.stringify({ message, suggest_products: suggestProducts }),
              },
            }],
          },
        }],
      },
    };
  }

  it.each([
    ["preço inventado", "A Piscina 6x3 custa R$ 99.999,00.", "catalog_unvalidated_objective_claim"],
    ["preço antigo", "A Piscina 6x3 custa R$ 19.000,00.", "catalog_unvalidated_objective_claim"],
    ["medida inventada", "A Piscina 6x3 mede 7x3 m.", "catalog_unvalidated_objective_claim"],
    ["característica inventada", "A Piscina 6x3 tem aquecimento solar.", "catalog_unvalidated_objective_claim"],
    ["dado correto do catálogo", "A Piscina 6x3 custa R$ 20.000,00 e mede 6x3 m.", "reply"],
    ["conversa sem dado objetivo", "Claro, posso entender melhor o que você procura.", "reply"],
  ])("valida %s contra o catálogo atual", async (_, message, expectedReason) => {
    const core = new SalesAgentCore(vi.fn().mockResolvedValue(completionWithMessage(message)));
    const decision = await core.decide({
      ctx: validationContext,
      history: [{ role: "lead", text: "Quero conhecer esse modelo" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision.kind === "handoff" ? decision.reason : decision.kind).toBe(expectedReason);
  });

  it.each([
    ["A 500 praia custa R$ 20.000,00.", "reply"],
    ["A 500 praia custa R$ 99.999,00.", "catalog_unvalidated_objective_claim"],
  ])("valida preço de alias de produto: %s", async (message, expected) => {
    const product = {
      ...validatedProduct,
      name: "Sol 500 Praia",
      price: 20_000,
      promoPrice: null,
    };
    const core = new SalesAgentCore(vi.fn().mockResolvedValue(completionWithMessage(message)));
    const decision = await core.decide({
      ctx: {
        ...validationContext,
        products: [product],
        catalogForValidation: [product],
        grounding: { ...validationContext.grounding, catalog: [product] },
      },
      history: [
        { role: "agent", text: "Apresentei a Sol 501" },
        { role: "lead", text: "E a 500 praia?" },
      ],
      leadName: null,
      model: salesModel,
    });
    expect(decision.kind === "handoff" ? decision.reason : decision.kind).toBe(expected);
  });

  it("não confunde price com promoPrice e aceita preço em milhares", async () => {
    const core = new SalesAgentCore(vi.fn().mockResolvedValue(
      completionWithMessage("A Piscina 6x3 custa R$ 20 mil e a promoção custa R$ 20 mil."),
    ));
    const decision = await core.decide({
      ctx: validationContext,
      history: [{ role: "lead", text: "Qual é o preço?" }],
      leadName: null,
      model: salesModel,
    });
    expect(decision).toMatchObject({ kind: "handoff", reason: "catalog_unvalidated_objective_claim" });
  });

  it.each([
    "A Piscina 6x3 custa 20 mil.",
    "A Piscina 6x3 fica em 20.000.",
    "20 mil",
    "20.000",
  ])("reconhece %s como preço em contexto monetário", async (message) => {
    const core = new SalesAgentCore(vi.fn().mockResolvedValue(completionWithMessage(message)));
    const decision = await core.decide({
      ctx: validationContext,
      history: [{ role: "lead", text: "Qual é o preço dessa piscina?" }],
      leadName: null,
      model: salesModel,
    });
    expect(decision.kind).toBe("reply");
  });

  it("não trata 20.000 como preço sem contexto monetário", async () => {
    const core = new SalesAgentCore(vi.fn().mockResolvedValue(completionWithMessage("20.000")));
    const decision = await core.decide({
      ctx: validationContext,
      history: [{ role: "lead", text: "Qual a capacidade da piscina?" }],
      leadName: null,
      model: salesModel,
    });
    expect(decision.kind).toBe("reply");
  });

  it.each([
    ["potência correta", "A Piscina 6x3 tem potência 2 cv.", "reply"],
    ["potência incorreta", "A Piscina 6x3 tem potência 3 cv.", "catalog_unvalidated_objective_claim"],
    ["sinônimo técnico correto", "A Piscina 6x3 tem tensão 220 V.", "reply"],
    ["campo técnico diferente", "A Piscina 6x3 tem tensão 2 cv.", "catalog_unvalidated_objective_claim"],
  ])("valida %s no campo semântico correto", async (_, message, expected) => {
    const product = {
      ...validatedProduct,
      specifications: { potencia: "2 cv", voltagem: "220 V" },
    };
    const core = new SalesAgentCore(vi.fn().mockResolvedValue(completionWithMessage(message)));
    const decision = await core.decide({
      ctx: {
        ...validationContext,
        products: [product],
        catalogForValidation: [product],
        grounding: { ...validationContext.grounding, catalog: [product] },
      },
      history: [{ role: "lead", text: "Quero os dados técnicos" }],
      leadName: null,
      model: salesModel,
    });
    expect(decision.kind === "handoff" ? decision.reason : decision.kind).toBe(expected);
  });

  it("não valida fato objetivo com catálogo compacto quando falta o catálogo completo", async () => {
    const core = new SalesAgentCore(vi.fn().mockResolvedValue(
      completionWithMessage("A Piscina 6x3 custa R$ 99.999,00"),
    ));
    const decision = await core.decide({
      ctx: { ...validationContext, catalogForValidation: undefined },
      history: [{ role: "lead", text: "Qual é o preço?" }],
      leadName: null,
      model: salesModel,
    });
    expect(decision).toMatchObject({ kind: "handoff", reason: "catalog_unvalidated_objective_claim" });
  });

  it("não aceita característica confirmada apenas em campo semântico errado", async () => {
    const wrongFieldProduct = {
      ...validatedProduct,
      variants: [{ name: "Azul", color: "azul" }],
      specifications: { cor: "fibra" },
    };
    const core = new SalesAgentCore(vi.fn().mockResolvedValue(
      completionWithMessage("A Piscina 6x3 tem cor fibra."),
    ));
    const decision = await core.decide({
      ctx: {
        ...validationContext,
        products: [wrongFieldProduct],
        catalogForValidation: [wrongFieldProduct],
        grounding: { ...validationContext.grounding, catalog: [wrongFieldProduct] },
      },
      history: [{ role: "lead", text: "Qual a cor?" }],
      leadName: null,
      model: salesModel,
    });
    expect(decision).toMatchObject({ kind: "handoff", reason: "catalog_unvalidated_objective_claim" });
  });

  it.each([
    "Vou verificar o preço.",
    "Posso consultar a medida?",
    "Qual o modelo?",
  ])("não bloqueia intenção de consulta: %s", async (message) => {
    const core = new SalesAgentCore(vi.fn().mockResolvedValue(completionWithMessage(message)));
    const decision = await core.decide({
      ctx: validationContext,
      history: [{ role: "lead", text: "Pode me ajudar?" }],
      leadName: null,
      model: salesModel,
    });
    expect(decision.kind).toBe("reply");
  });

  it.each<[string, SalesAgentCoreInput["history"]]>([
    ["A Piscina 6x3 custa 20 mil.", [{ role: "lead", text: "Quero o preço dessa piscina" }]],
    ["20 mil", [{ role: "lead", text: "Qual é o preço?" }]],
    ["20.000", [{ role: "lead", text: "Qual é o preço?" }]],
  ])("reconhece preço com contexto atual/imediato: %s", async (message, history) => {
    const core = new SalesAgentCore(vi.fn().mockResolvedValue(completionWithMessage(message)));
    const decision = await core.decide({ ctx: validationContext, history, leadName: null, model: salesModel });
    expect(decision.kind).toBe("reply");
  });

  it("prioriza contexto técnico atual sobre histórico antigo de preço", async () => {
    const core = new SalesAgentCore(vi.fn().mockResolvedValue(completionWithMessage("20.000")));
    const decision = await core.decide({
      ctx: validationContext,
      history: [
        { role: "lead", text: "Qual é o preço?" },
        { role: "lead", text: "E a capacidade em litros?" },
      ],
      leadName: null,
      model: salesModel,
    });
    expect(decision.kind).toBe("reply");
  });

  it("não usa menção monetária antiga sem resposta direta", async () => {
    const core = new SalesAgentCore(vi.fn().mockResolvedValue(completionWithMessage("20.000")));
    const decision = await core.decide({
      ctx: validationContext,
      history: [
        { role: "lead", text: "Qual é o preço?" },
        { role: "lead", text: "Também gostaria de saber sobre instalação." },
      ],
      leadName: null,
      model: salesModel,
    });
    expect(decision.kind).toBe("reply");
  });

  it("não valida perguntas, hipóteses ou intenções como fatos do agente", async () => {
    for (const message of [
      "Qual o preço de R$ 99.999?",
      "Seria 20 mil?",
      "Pode ser 2 cv?",
      "Vou consultar o valor de 20 mil.",
    ]) {
      const core = new SalesAgentCore(vi.fn().mockResolvedValue(completionWithMessage(message)));
      const decision = await core.decide({
        ctx: validationContext,
        history: [{ role: "lead", text: "Pode verificar isso?" }],
        leadName: null,
        model: salesModel,
      });
      expect(decision.kind).toBe("reply");
    }
  });

  it("não transforma capacidade em preço após histórico monetário", async () => {
    const product = { ...validatedProduct, capacityL: 20_000 };
    const core = new SalesAgentCore(vi.fn().mockResolvedValue(
      completionWithMessage("A capacidade é 20.000 L."),
    ));
    const decision = await core.decide({
      ctx: {
        ...validationContext,
        products: [product],
        catalogForValidation: [product],
        grounding: { ...validationContext.grounding, catalog: [product] },
      },
      history: [
        { role: "lead", text: "Qual é o preço?" },
        { role: "lead", text: "Qual a capacidade?" },
      ],
      leadName: null,
      model: salesModel,
    });
    expect(decision.kind).toBe("reply");
  });

  it.each([
    ["A Piscina 6x3 tem potência 2 cv.", "reply"],
    ["A Piscina 6x3 tem potência 20 cv.", "catalog_unvalidated_objective_claim"],
    ["A Piscina 6x3 tem potência 2.5 cv.", "catalog_unvalidated_objective_claim"],
    ["A Piscina 6x3 tem tensão 220 V.", "reply"],
    ["A Piscina 6x3 tem tensão 2 cv.", "catalog_unvalidated_objective_claim"],
  ])("valida valor técnico e unidade exatamente: %s", async (message, expected) => {
    const product = {
      ...validatedProduct,
      specifications: { potencia: "2 cv", voltagem: "220 V" },
    };
    const core = new SalesAgentCore(vi.fn().mockResolvedValue(completionWithMessage(message)));
    const decision = await core.decide({
      ctx: {
        ...validationContext,
        products: [product],
        catalogForValidation: [product],
        grounding: { ...validationContext.grounding, catalog: [product] },
      },
      history: [{ role: "lead", text: "Quero os dados técnicos" }],
      leadName: null,
      model: salesModel,
    });
    expect(decision.kind === "handoff" ? decision.reason : decision.kind).toBe(expected);
  });

  it("preserva prompt, ferramentas e somente as 20 mensagens mais recentes", () => {
    const history = Array.from({ length: 22 }, (_, index) => ({
      role: (index % 2 === 0 ? "lead" : "agent") as "lead" | "agent",
      text: index === 20 ? "Quero saber pagamento, garantia e prazo" : `mensagem-${index}`,
    }));

    const request = buildSalesAgentCompletionRequest({
      ctx: context,
      history,
      leadName: "Maria",
      model: salesModel,
    });

    expect(request.model).toBe(salesModel);
    expect(request).not.toHaveProperty("reasoning_effort");
    expect(request.tool_choice).toBe("auto");
    expect(request.tools).toHaveLength(2);
    expect(request.tools[0]).toMatchObject({
      function: {
        parameters: {
          properties: {
            send_product_images: { type: "array", maxItems: 10 },
          },
        },
      },
    });
    expect(request.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ name: "respond_to_customer" }),
        }),
        expect.objectContaining({
          function: expect.objectContaining({ name: "request_human_handoff" }),
        }),
      ]),
    );
    expect(request.messages[0].content).toContain('Você é "Ana", pré-atendente automático');
    expect(request.messages[0].content).toContain("NUNCA invente nem negocie desconto, preço");
    expect(request.messages[0].content).toContain("Piscina 6x3");
    expect(request.messages[1].content).not.toContain("Cliente: mensagem-0\n");
    expect(request.messages[1].content).not.toContain("Atendente: mensagem-1\n");
    expect(request.messages[1].content).toContain("Cliente: mensagem-2");
    expect(request.messages[1].content).toContain("Atendente: mensagem-21");
  });

  it("permite sugerir todos os sete produtos reais de 6 metros e limita somente imagens", () => {
    const catalog = Array.from({ length: 7 }, (_, index) => ({
      id: `product-6m-${index + 1}`,
      name: `Piscina 6 metros ${index + 1}`,
      category: "Piscinas de fibra",
      description: "Piscina com 6 metros de comprimento",
      lengthM: 6,
      price: 20_000 + index,
      promoPrice: null,
      images: [],
      notes: null,
    }));
    const request = buildSalesAgentCompletionRequest({
      ctx: {
        ...context,
        products: catalog,
        grounding: { ...context.grounding, catalog },
      },
      history: [{ role: "lead", text: "Quais piscinas de 6 metros vocês têm?" }],
      leadName: null,
      model: salesModel,
    });
    const properties = (
      request.tools[0] as {
        function: {
          parameters: {
            properties: Record<string, { maxItems?: number; items?: { enum?: string[] } }>;
          };
        };
      }
    ).function.parameters.properties;

    expect(properties.suggest_products).not.toHaveProperty("maxItems");
    expect(properties.suggest_products.items?.enum).toEqual(catalog.map((product) => product.id));
    expect(properties.send_product_images.maxItems).toBe(10);
  });

  it.each(["gpt-5.6-luna", "openai/gpt-5.6-luna"])(
    "desabilita reasoning para function tools no modelo %s",
    (model) => {
      const request = buildSalesAgentCompletionRequest({
        ctx: context,
        history: [],
        leadName: null,
        model,
      });

      expect(request.reasoning_effort).toBe("none");
      expect(request.tool_choice).toBe("auto");
      expect(request.tools).toHaveLength(2);
    },
  );

  it("não duplica payment_methods no prompt", () => {
    const request = buildSalesAgentCompletionRequest({
      ctx: context,
      history: [{ role: "lead", text: "Quais formas de pagamento vocês aceitam?" }],
      leadName: null,
      model: salesModel,
    });
    expect(request.messages[0].content.match(/Pix e cartão/g)).toHaveLength(1);
  });

  it("limita histórico longo por caracteres e preserva o mais recente", () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      role: "lead" as const,
      text: `mensagem-antiga-${index} ${"x".repeat(600)}`,
    }));
    history[19].text = `mensagem-mais-recente ${"y".repeat(600)}`;
    const request = buildSalesAgentCompletionRequest({
      ctx: context,
      history,
      leadName: null,
      model: salesModel,
    });
    const userPrompt = request.messages[1].content;
    expect(userPrompt.length).toBeLessThan(6500);
    expect(userPrompt).toContain("mensagem-mais-recente");
    expect(userPrompt).not.toContain("mensagem-antiga-0");
  });

  it("trunca cada coach rule longa", () => {
    const request = buildSalesAgentCompletionRequest({
      ctx: {
        ...context,
        grounding: {
          ...context.grounding,
          activeCoachRules: [{
            ruleId: "rule-1",
            versionId: "version-1",
            versionNumber: 1,
            category: "sales",
            ruleType: "instruction",
            title: "Regra longa",
            content: "z".repeat(2000),
            priority: 1,
            scopeKind: "company",
            scopeRef: null,
          }],
        },
      },
      history: [],
      leadName: null,
      model: salesModel,
    });
    const line = request.messages[0].content.split("\n").find((item) => item.includes("Regra longa"));
    expect(line?.length ?? 0).toBeLessThanOrEqual(603);
  });

  it("trunca cada learning longo", () => {
    const request = buildSalesAgentCompletionRequest({
      ctx: {
        ...context,
        grounding: {
          ...context.grounding,
          approvedCoachLearnings: [{
            ...context.grounding.approvedCoachLearnings[0],
            title: "Learning longo",
            rule: "z".repeat(2000),
          }],
        },
      },
      history: [],
      leadName: null,
      model: salesModel,
    });
    const line = request.messages[0].content.split("\n").find((item) => item.includes("Learning longo"));
    expect(line?.length ?? 0).toBeLessThanOrEqual(603);
  });

  it("mantém a decisão estruturada e a normalização atuais", async () => {
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
                      message: "Posso ajudar com essa piscina.",
                      detected_city: "Campinas",
                      detected_state: "São Paulo",
                      purchase_timing: "30 dias",
                      customer_stage: "PESQUISANDO",
                      suggest_products: ["product-1"],
                      send_product_images: ["product-1"],
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    });
    const core = new SalesAgentCore(complete);

    const decision = await core.decide({
      ctx: {
        ...context,
        products: context.products.map((product) => ({ ...product, images: ["image.jpg"] })),
        grounding: {
          ...context.grounding,
          catalog: context.grounding.catalog.map((product) => ({
            ...product,
            images: ["image.jpg"],
          })),
        },
      },
      history: [{ role: "lead", text: "Me manda as fotos desses modelos" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision).toMatchObject({
      kind: "reply",
      message: "Posso ajudar com essa piscina.",
      detected_city: "Campinas",
      detected_state: "São Paulo",
      purchase_timing: "30d",
      customer_stage: "pesquisando",
      suggested_products: ["product-1"],
      product_image_ids: ["product-1"],
    });
    expect(complete).toHaveBeenCalledOnce();
  });

  it("aceita imagens válidas indicadas pelo modelo sem exigir pedido de fotos", async () => {
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
                      message: "Temos a Piscina 6x3.",
                      suggest_products: ["product-1"],
                      send_product_images: ["product-1"],
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    });
    const core = new SalesAgentCore(complete);

    const decision = await core.decide({
      ctx: {
        ...context,
        products: context.products.map((product) => ({ ...product, images: ["image.jpg"] })),
        grounding: {
          ...context.grounding,
          catalog: context.grounding.catalog.map((product) => ({
            ...product,
            images: ["image.jpg"],
          })),
        },
      },
      history: [{ role: "lead", text: "Quais modelos de 6 metros vocês têm?" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision).toMatchObject({ kind: "reply", product_image_ids: ["product-1"] });
  });

  it("envia imagens válidas no mesmo turno quando promete mostrar o produto", async () => {
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
                      message: "Temos essa opção. Vou te mostrar o produto agora.",
                      suggest_products: ["product-1"],
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    });
    const product = { ...context.grounding.catalog[0], images: ["image.jpg"] };

    const decision = await new SalesAgentCore(complete).decide({
      ctx: {
        ...context,
        products: [product],
        grounding: { ...context.grounding, catalog: [product] },
      },
      history: [{ role: "lead", text: "Quais modelos vocês têm?" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision).toMatchObject({
      kind: "reply",
      message: "Temos essa opção. Vou te mostrar o produto agora.",
      product_image_ids: ["product-1"],
    });
  });

  it("inclui produto e preço do grounding no contexto do modelo", () => {
    const request = buildSalesAgentCompletionRequest({
      ctx: context,
      history: [{ role: "lead", text: "Quero saber pagamento" }],
      leadName: null,
      model: salesModel,
    });

    expect(request.messages[0].content).toContain("Piscina 6x3");
    expect(request.messages[0].content).toContain("Categoria: Piscinas de fibra");
    expect(request.messages[0].content).toContain("Preço cadastrado: R$ 20.000,00");
    expect(request.messages[0].content).toContain("Preço promocional cadastrado: R$ 18.000,00");
  });

  it("inclui FAQ e regras comerciais sem liberar negociação", () => {
    const request = buildSalesAgentCompletionRequest({
      ctx: context,
      history: [{ role: "lead", text: "Quero saber pagamento e se atende interior" }],
      leadName: null,
      model: salesModel,
    });

    expect(request.messages[0].content).toContain("Atende interior? → Sim.");
    expect(request.messages[0].content).toContain("Pagamento (cadastro legado): Pix e cartão");
    expect(request.messages[0].content).toContain(
      "Condições cadastradas: Entrada de 50% conforme contrato",
    );
    expect(request.messages[0].content).toContain(
      "somente informe, nunca negocie nem crie condições",
    );
    expect(request.messages[0].content).toContain("NUNCA invente nem negocie desconto, preço");
  });

  it("filtra FAQ irrelevante e prioriza a fonte aprovada", () => {
    const request = buildSalesAgentCompletionRequest({
      ctx: {
        ...context,
        aiProfile: {
          ...context.aiProfile!,
          faq: [
            { q: "Como funciona o pagamento?", a: "Resposta do perfil." },
            { q: "Qual a garantia?", a: "Resposta irrelevante." },
          ],
        },
        grounding: {
          ...context.grounding,
          faqKnowledge: [
            { question: "Como funciona o pagamento?", answer: "Resposta aprovada.", type: "faq" },
          ],
        },
      },
      history: [{ role: "lead", text: "Quero saber como funciona o pagamento" }],
      leadName: null,
      model: salesModel,
    });

    expect(request.messages[0].content).toContain("Resposta aprovada.");
    expect(request.messages[0].content).not.toContain("Resposta do perfil.");
    expect(request.messages[0].content).not.toContain("Resposta irrelevante.");
  });

  it("deduplica FAQ normalizada e limita a seis itens de 400 caracteres", () => {
    const faqs = Array.from({ length: 8 }, (_, index) => ({
      question: `Pagamento opção ${index + 1}`,
      answer: `${"Condição cadastrada. ".repeat(40)}${index + 1}`,
      type: "faq",
    }));
    const request = buildSalesAgentCompletionRequest({
      ctx: {
        ...context,
        aiProfile: {
          ...context.aiProfile!,
          faq: [{ q: " PAGAMENTO OPÇÃO 1 ", a: `${"Condição cadastrada. ".repeat(40)}1` }],
        },
        grounding: { ...context.grounding, faqKnowledge: faqs },
      },
      history: [{ role: "lead", text: "Quero informações de pagamento" }],
      leadName: null,
      model: salesModel,
    });
    const faqSection = request.messages[0].content.split("FAQ:\n")[1].split("\n\nBASE")[0];
    expect(faqSection.match(/^\d+\. /gm)).toHaveLength(6);
    expect(faqSection.split("\n").every((line) => line.length <= 400)).toBe(true);
  });

  it("deduplica conteúdo normalizado mesmo com perguntas diferentes", () => {
    const request = buildSalesAgentCompletionRequest({
      ctx: {
        ...context,
        grounding: {
          ...context.grounding,
          faqKnowledge: [
            { question: "Qual o pagamento?", answer: "Aceitamos Pix e cartão.", type: "faq" },
          ],
        },
        aiProfile: {
          ...context.aiProfile!,
          faq: [{ q: "Quais formas de pagar?", a: "aceitamos PIX e cartão." }],
        },
      },
      history: [{ role: "lead", text: "Quais formas de pagamento vocês aceitam?" }],
      leadName: null,
      model: salesModel,
    });
    const content = request.messages[0].content;
    expect(content.match(/Aceitamos Pix e cartão\./gi)).toHaveLength(1);
  });

  it("usa ctx.knowledge como fallback sem duplicar o FAQ do perfil", () => {
    const request = buildSalesAgentCompletionRequest({
      ctx: {
        ...context,
        grounding: { ...context.grounding, faqKnowledge: [] },
        knowledge: [{ question: "Atende interior?", answer: "Sim.", type: "faq" }],
        aiProfile: {
          ...context.aiProfile!,
          faq: [{ q: "Atende interior?", a: "Sim." }],
        },
      },
      history: [{ role: "lead", text: "Vocês atendem o interior?" }],
      leadName: null,
      model: salesModel,
    });
    const content = request.messages[0].content;
    expect(content.match(/Atende interior\? → Sim\./g)).toHaveLength(1);
  });

  it("não inclui FAQ quando não há relevância na conversa", () => {
    const request = buildSalesAgentCompletionRequest({
      ctx: context,
      history: [{ role: "lead", text: "Olá, tudo bem?" }],
      leadName: null,
      model: salesModel,
    });
    expect(request.messages[0].content).not.toContain("Atende interior? → Sim.");
  });

  it("faz handoff quando o cliente pede parcelamento diferente do cadastrado", async () => {
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
                      message: "A primeira está por R$ 18.000,00.",
                      suggest_products: ["product-1"],
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const decision = await new SalesAgentCore(complete).decide({
      ctx: context,
      history: [{ role: "lead", text: "Gostei da primeira, quanto custa?" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision).toMatchObject({
      kind: "reply",
      message: "A primeira está por R$ 18.000,00.",
      suggested_products: ["product-1"],
    });
    expect(runSafetyLayer(decision)).toEqual(decision);
  });

  it("rejeita preço sem fonte e usa fallback factual", async () => {
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
                      message: "A primeira custa R$ 17.500,00.",
                      suggest_products: ["product-1"],
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const decision = await new SalesAgentCore(complete).decide({
      ctx: context,
      history: [{ role: "lead", text: "Quanto custa?" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision.message).toContain("Encontrei no catálogo");
    expect(decision.message).toContain("preço R$ 18.000,00");
    expect(decision.message).not.toContain("17.500");
    expect(decision.learning_ids_used).toEqual([]);
  });

  it("inclui FAQ e regras comerciais sem liberar negociação", () => {
    const request = buildSalesAgentCompletionRequest({
      ctx: context,
      history: [{ role: "lead", text: "Vocês atendem o interior?" }],
      leadName: null,
      model: salesModel,
    });

    expect(request.messages[0].content).toContain("Atende interior? → Sim.");
    expect(request.messages[0].content).toContain("Pagamento (cadastro legado): Pix e cartão");
    expect(request.messages[0].content).toContain(
      "Condições cadastradas: Entrada de 50% conforme contrato",
    );
    expect(request.messages[0].content).toContain(
      "POLÍTICAS OFICIAIS",
    );
    expect(request.messages[0].content).toContain("NUNCA invente nem negocie desconto, preço");
  });

  it("prioriza política oficial de pagamento e separa políticas de fatos do catálogo", () => {
    const request = buildSalesAgentCompletionRequest({
      ctx: {
        ...context,
        grounding: {
          ...context.grounding,
          commercialRules: {
            ...context.grounding.commercialRules,
            paymentPolicy: "Pagamento somente após validação da equipe",
            installationPolicy: "Instalação sujeita a avaliação técnica",
          },
        },
      },
      history: [],
      leadName: null,
      model: salesModel,
    });
    const prompt = request.messages[0].content;

    expect(prompt).toContain("Pagamento: Pagamento somente após validação da equipe");
    expect(prompt).not.toContain("Pagamento (cadastro legado): Pix e cartão");
    expect(prompt).toContain("Instalação: Instalação sujeita a avaliação técnica");
    expect(prompt).toContain("prevalecem sobre Coach e FAQ");
    expect(prompt).toContain("não use como fonte de fatos de produto");
  });

  it("registra políticas oficiais como fonte mesmo sem campos legados", async () => {
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
                    arguments: JSON.stringify({ message: "Podemos orientar a visita." }),
                  },
                },
              ],
            },
          },
        ],
      },
    });
    const core = new SalesAgentCore(complete);
    const decision = await core.decide({
      ctx: {
        ...context,
        knowledge: [],
        grounding: {
          ...context.grounding,
          faqKnowledge: [],
          approvedCoachLearnings: [],
          commercialRules: {
            paymentMethods: null,
            commercialTerms: null,
            paymentPolicy: null,
            installationPolicy: null,
            visitPolicy: "Visitas precisam ser agendadas",
            heatingPolicy: null,
            shippingPolicy: null,
            includedItemsPolicy: null,
          },
        },
      },
      history: [],
      leadName: null,
      model: salesModel,
    });

    expect(decision.grounding_sources).toContain("commercial_rules");
  });

  it("inclui learning ativo e registra as fontes fornecidas", async () => {
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
                      message: "Vou encaminhar sua negociação.",
                      learning_ids_used: ["learning-1"],
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    });
    const core = new SalesAgentCore(complete);

    const decision = await core.decide({
      ctx: context,
      history: [],
      leadName: null,
      model: salesModel,
    });
    const request = complete.mock.calls[0][0];

    expect(request.messages[0].content).toContain(
      "Não prometer desconto: Solicitações de desconto exigem atendimento humano",
    );
    expect(decision.learning_ids_used).toEqual(["learning-1"]);
    expect(decision.grounding_sources).toEqual([
      "catalog",
      "faq_knowledge",
      "commercial_rules",
      "coach_learnings",
    ]);
  });

  it("registra quick_replies somente quando hÃ¡ quick reply no grounding", async () => {
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
                    arguments: JSON.stringify({ message: "Segue a informaÃ§Ã£o." }),
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const decision = await new SalesAgentCore(complete).decide({
      ctx: {
        ...context,
        grounding: {
          ...context.grounding,
          quickReplies: [
            {
              name: "Por Conta do Cliente",
              category: "OrÃ§amento",
              content: "Contrapiso e Ã¡gua.",
              sort_order: 12,
            },
          ],
        },
      },
      history: [{ role: "lead", text: "O que fica por conta do cliente?" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision.grounding_sources).toContain("quick_replies");
    expect(complete.mock.calls[0][0].messages[0].content).toContain("Contrapiso e Ã¡gua.");
  });

  it("não usa exemplos nem referência de produto do learning como fato de catálogo", () => {
    const request = buildSalesAgentCompletionRequest({
      ctx: {
        ...context,
        grounding: {
          ...context.grounding,
          approvedCoachLearnings: [
            {
              ...context.grounding.approvedCoachLearnings[0],
              positiveExample: "Claro! Temos opções de fibra. Qual tamanho procura?",
              negativeExample: "Como posso ajudar?",
              productRef: "Modelo Antigo 9x4",
            },
          ],
        },
      },
      history: [{ role: "lead", text: "Quero informações das piscinas" }],
      leadName: null,
      model: salesModel,
    });

    expect(request.messages[0].content).not.toContain("Exemplo recomendado");
    expect(request.messages[0].content).not.toContain("Modelo Antigo 9x4");
    expect(request.messages[0].content).toContain("somente orientação de comportamento comercial");
  });

  it("usa fallback factual para produto inexistente", async () => {
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
                      message: "Temos o modelo Atlântida.",
                      suggest_products: ["product-missing"],
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const decision = await new SalesAgentCore(complete).decide({
      ctx: context,
      history: [{ role: "lead", text: "Quais modelos vocês têm?" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision).toMatchObject({
      kind: "reply",
      suggested_products: ["product-1"],
      learning_ids_used: [],
    });
    expect(decision.message).toContain("Encontrei no catálogo");
    expect(decision.message).not.toContain("Atlântida");
  });

  it("responde com todos os comprimentos compatíveis mesmo se o modelo pedir handoff", async () => {
    const products = [
      { ...context.grounding.catalog[0], id: "sol-600", name: "Sol 600", lengthM: 6, images: [] },
      { ...context.grounding.catalog[0], id: "sol-601", name: "Sol 601 Canyon", lengthM: 6, images: [] },
    ];
    const core = new SalesAgentCore(
      vi.fn().mockResolvedValue({
        ok: true,
        data: {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: "request_human_handoff",
                      arguments: JSON.stringify({ reason: "sem fotos ou disponibilidade" }),
                    },
                  },
                ],
              },
            },
          ],
        },
      }),
    );

    const decision = await core.decide({
      ctx: {
        ...context,
        products,
        grounding: { ...context.grounding, catalog: products },
      },
      history: [{ role: "lead", text: "Quais piscinas de 6 metros vocês têm?" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision).toMatchObject({
      kind: "reply",
      suggested_products: ["sol-600", "sol-601"],
      product_image_ids: [],
    });
    expect(decision.message).toContain("Sol 600");
    expect(decision.message).toContain("Sol 601 Canyon");
    expect(decision.message).not.toMatch(/dispon[ií]vel|estoque/i);
  });

  it("produto válido retorna somente dados reais do registro", async () => {
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
                      message: "Modelo inventado com especificação inventada.",
                      suggest_products: ["product-1"],
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const decision = await new SalesAgentCore(complete).decide({
      ctx: context,
      history: [{ role: "lead", text: "Quero conhecer a piscina de 6 metros" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision.message).toContain("Piscina 6x3 — categoria Piscinas de fibra");
    expect(decision.message).toContain("Piscina de fibra");
    expect(decision.message).toContain("Filtro e bomba");
    expect(decision.message).not.toContain("Modelo inventado");
  });

  it("usa somente fatos estruturados reais no prompt e na resposta validada", async () => {
    const structuredProduct = {
      ...context.grounding.catalog[0],
      model: "Caribe 6",
      sku: "CAR-6X3-AZ",
      lengthM: 6,
      widthM: 3,
      depthM: 1.4,
      capacityL: 24_000,
      shape: "retangular",
      specifications: { material: "fibra" },
      includedItems: ["Filtro", "Bomba"],
      variants: [{ name: "Azul", color: "azul" }],
    };
    const structuredContext: AgentContext = {
      ...context,
      products: [structuredProduct],
      catalogForValidation: [structuredProduct],
      grounding: { ...context.grounding, catalog: [structuredProduct] },
    };
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
                      message: "Modelo Atlântida com especificação inventada.",
                      suggest_products: ["product-1"],
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const decision = await new SalesAgentCore(complete).decide({
      ctx: structuredContext,
      history: [{ role: "lead", text: "Qual a profundidade e a cor dele?" }],
      leadName: null,
      model: salesModel,
    });
    const prompt = complete.mock.calls[0][0].messages[0].content;

    expect(prompt).toContain("Modelo: Caribe 6");
    expect(prompt).toContain("SKU: CAR-6X3-AZ");
    expect(prompt).toContain("Comprimento: 6 m");
    expect(prompt).toContain("Largura: 3 m");
    expect(prompt).toContain("Profundidade: 1.4 m");
    expect(prompt).toContain("Capacidade: 24000 L");
    expect(prompt).toContain("Formato real: retangular");
    expect(prompt).toContain('Especificações: {"material":"fibra"}');
    expect(prompt).toContain('Variantes/cores: [{"name":"Azul","color":"azul"}]');
    expect(decision.message).toContain("modelo Caribe 6");
    expect(decision.message).toContain("dimensões 6 x 3 x 1.4 m");
    expect(decision.message).toContain("capacidade 24000 L");
    expect(decision.message).toContain("formato retangular");
    expect(decision.message).toContain("variantes/cores: Azul/azul");
    expect(decision.message).not.toContain("Dados inventados");
  });

  it("mantém formato real retangular ao atender intenção por quadrada", async () => {
    const rectangularProduct = {
      ...context.grounding.catalog[0],
      shape: "retangular",
    };
    const rectangularContext: AgentContext = {
      ...context,
      products: [rectangularProduct],
      grounding: { ...context.grounding, catalog: [rectangularProduct] },
    };
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
                    arguments: JSON.stringify({ message: "É uma piscina quadrada." }),
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const decision = await new SalesAgentCore(complete).decide({
      ctx: rectangularContext,
      history: [{ role: "lead", text: "Quero uma piscina quadrada" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision).toMatchObject({ kind: "reply", suggested_products: ["product-1"] });
    expect(decision.message).toContain("você procura uma piscina com linhas retas");
    expect(decision.message).toContain("formato retangular");
    expect(decision.message).not.toContain("formato quadrado");
  });

  it.each([
    "piscina quadrada",
    "modelos quadrados",
    "modelo quadrada",
    "piscina mais quadrada/reta",
    "modelo reto",
  ])("normaliza a variação comercial %s", (text) => {
    expect(hasRectangularPoolIntent([{ role: "lead", text }])).toBe(true);
  });

  it("learning antigo não cria produto quando a resposta não traz ID válido", async () => {
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
                    arguments: JSON.stringify({ message: "Temos o modelo Atlântida 9x4." }),
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const decision = await new SalesAgentCore(complete).decide({
      ctx: context,
      history: [{ role: "lead", text: "Tem o modelo Atlântida?" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision).toMatchObject({ kind: "reply", suggested_products: ["product-1"] });
    expect(decision.message).toContain("Piscina 6x3");
    expect(decision.message).not.toContain("Atlântida");
  });

  it("catálogo vazio não chama o modelo para inventar produto", async () => {
    const complete = vi.fn();
    const emptyContext: AgentContext = {
      ...context,
      products: [],
      grounding: { ...context.grounding, catalog: [] },
    };

    const decision = await new SalesAgentCore(complete).decide({
      ctx: emptyContext,
      history: [{ role: "lead", text: "Quero uma piscina de 6 metros" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision).toMatchObject({ kind: "handoff", reason: "catalog_product_not_found" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("sem grounding estruturado mantém catálogo e conhecimento legados como fallback", () => {
    const request = buildSalesAgentCompletionRequest({
      ctx: {
        ...context,
        grounding: {
          catalog: [],
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
      },
      history: [{ role: "lead", text: "Vocês atendem o interior?" }],
      leadName: null,
      model: salesModel,
    });

    expect(request.messages[0].content).toContain("Piscina 6x3");
    expect(request.messages[0].content).toContain("Atende interior? → Sim.");
    expect(request.messages[0].content).not.toContain("Preço cadastrado:");
    expect(request.messages[0].content).not.toContain("REGRAS COMERCIAIS CADASTRADAS");
    expect(request.messages[0].content).not.toContain("APRENDIZADOS ATIVOS DO COACH");
  });

  it.each([
    [{ ok: false, reason: "gateway_network_fail" }, "gateway_network_fail"],
    [{ ok: true, data: {} }, "no_tool_call"],
    [
      {
        ok: true,
        data: {
          choices: [
            {
              message: {
                tool_calls: [{ function: { name: "respond_to_customer", arguments: "{" } }],
              },
            },
          ],
        },
      },
      "tool_args_parse_fail",
    ],
  ])("preserva os fallbacks de handoff", async (completion, reason) => {
    const core = new SalesAgentCore(vi.fn().mockResolvedValue(completion));
    await expect(
      core.decide({ ctx: context, history: [], leadName: null, model: salesModel }),
    ).resolves.toMatchObject({
      kind: "handoff",
      reason,
      grounding_sources: ["catalog", "faq_knowledge", "commercial_rules", "coach_learnings"],
    });
  });

  it("não contém acesso próprio a infraestrutura ou persistência", () => {
    const sourcePath = fileURLToPath(new URL("../sales-agent-core.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toMatch(/\bsupabase\b|\.from\s*\(|\bfetch\s*\(|\bpostGraph\b|process\.env/);
    expect(source).not.toMatch(/sendWhatsapp|ai_flow_events|conversations|leads/);
  });

  it("orienta prazo normal pelas regras de carga e instalação e limita o handoff", () => {
    const request = buildSalesAgentCompletionRequest({
      ctx: {
        ...context,
        grounding: {
          ...context.grounding,
          commercialRules: {
            ...context.grounding.commercialRules,
            installationPolicy: "Instalação em até 10 dias úteis",
            shippingPolicy: "Carga em até 2 dias úteis",
            nextLoadForecast: "Primeira quinzena do mês",
          },
        },
      },
      history: [{ role: "lead", text: "Qual o prazo normal?" }],
      leadName: null,
      model: salesModel,
    });
    const prompt = request.messages[0].content;

    expect(prompt).toContain("REGRAS DE CARGA E INSTALAÇÃO");
    expect(prompt).toContain("Instalação: Instalação em até 10 dias úteis");
    expect(prompt).toContain("Frete: Carga em até 2 dias úteis");
    expect(prompt).toContain("Próxima carga prevista: Primeira quinzena do mês");
    expect(prompt).toContain(
      "Para perguntas sobre prazo de carga/instalação, só chame request_human_handoff se o cliente exigir uma data específica ou antecipada",
    );
    expect(prompt).not.toContain("Se o cliente pedir qualquer item acima, chame request_human_handoff.");
  });

  it("não invalida resposta que usa modelo genericamente sem produto específico", async () => {
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
                      message: "O prazo depende do modelo e da agenda de instalação.",
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const decision = await new SalesAgentCore(complete).decide({
      ctx: context,
      history: [{ role: "lead", text: "Qual o prazo para instalação de vocês?" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision).toMatchObject({
      kind: "reply",
      message: "O prazo depende do modelo e da agenda de instalação.",
    });
  });

  it("valida todos os IDs antes de limitar recomendações a três", async () => {
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
                      message: "Encontrei algumas opções.",
                      suggest_products: ["product-1", "product-1", "product-1", "product-missing"],
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const decision = await new SalesAgentCore(complete).decide({
      ctx: context,
      history: [{ role: "lead", text: "Quais modelos vocês têm?" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision.kind).toBe("reply");
    expect(decision.message).toContain("Encontrei no catálogo");
    expect(decision.message).not.toContain("product-missing");
    expect(decision.suggested_products).not.toContain("product-missing");
  });
});
