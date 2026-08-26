import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  SalesAgentCore,
  buildSalesAgentCompletionRequest,
  hasRectangularPoolIntent,
  type AgentContext,
  type SalesAgentCompletionRequest,
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

  it("preserva prompt, ferramentas e somente as 20 mensagens mais recentes", () => {
    const history = Array.from({ length: 22 }, (_, index) => ({
      role: (index % 2 === 0 ? "lead" : "agent") as "lead" | "agent",
      text: `mensagem-${index}`,
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
      history: [],
      leadName: null,
      model: salesModel,
    });

    expect(request.messages[0].content).toContain("Piscina 6x3");
    expect(request.messages[0].content).toContain("Categoria: Piscinas de fibra");
    expect(request.messages[0].content).toContain("Preço cadastrado: R$ 20.000,00");
    expect(request.messages[0].content).toContain("Preço promocional cadastrado: R$ 18.000,00");
  });

  it("preserva o preço promocional cadastrado do produto selecionado", async () => {
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
      history: [],
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
                      message: "Dados inventados pelo modelo.",
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
      history: [],
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
});
