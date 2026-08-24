import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  SalesAgentCore,
  buildSalesAgentCompletionRequest,
  type AgentContext,
} from "../sales-agent-core";

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
            send_product_images: { type: "array", maxItems: 5 },
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
    expect(request.messages[0].content).toContain("NUNCA negocie desconto, preço, parcelamento");
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
    expect(properties.send_product_images.maxItems).toBe(5);
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
      ctx: context,
      history: [{ role: "lead", text: "Me manda as fotos desses modelos" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision).toMatchObject({
      kind: "reply",
      message:
        "Encontrei no catálogo: Piscina 6x3 — categoria Piscinas de fibra; Piscina de fibra; observações: Filtro e bomba.",
      detected_city: "Campinas",
      detected_state: "São Paulo",
      purchase_timing: "30d",
      customer_stage: "pesquisando",
      suggested_products: ["product-1"],
      product_image_ids: ["product-1"],
    });
    expect(complete).toHaveBeenCalledOnce();
  });

  it("ignora pedido de imagens do modelo quando o cliente não pediu fotos", async () => {
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
                      message: "Temos o modelo 6x3.",
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
      ctx: context,
      history: [{ role: "lead", text: "Quais modelos de 6 metros vocês têm?" }],
      leadName: null,
      model: salesModel,
    });

    expect(decision).toMatchObject({ kind: "reply", product_image_ids: [] });
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

  it("inclui FAQ e regras comerciais sem liberar negociação", () => {
    const request = buildSalesAgentCompletionRequest({
      ctx: context,
      history: [],
      leadName: null,
      model: salesModel,
    });

    expect(request.messages[0].content).toContain("Atende interior? → Sim.");
    expect(request.messages[0].content).toContain("Formas de pagamento: Pix e cartão");
    expect(request.messages[0].content).toContain(
      "Condições cadastradas: Entrada de 50% conforme contrato",
    );
    expect(request.messages[0].content).toContain(
      "somente informe; nunca negocie nem crie condições",
    );
    expect(request.messages[0].content).toContain("NUNCA negocie desconto, preço, parcelamento");
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
                    arguments: JSON.stringify({ message: "Vou encaminhar sua negociação." }),
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

  it("bloqueia produto inexistente antes do envio", async () => {
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
      kind: "handoff",
      reason: "catalog_invalid_product_reference",
    });
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
    expect(decision.message).toContain("formato retangular");
    expect(decision.message).not.toContain("formato quadrado");
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
          commercialRules: { paymentMethods: null, commercialTerms: null },
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
