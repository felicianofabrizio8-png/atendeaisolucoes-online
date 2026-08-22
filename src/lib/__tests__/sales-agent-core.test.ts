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
      description: "Piscina de fibra",
      price: 20_000,
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
        description: "Piscina de fibra",
        price: 20_000,
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
    expect(request.tool_choice).toBe("auto");
    expect(request.tools).toHaveLength(2);
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

    expect(decision).toMatchObject({
      kind: "reply",
      message: "Posso ajudar com essa piscina.",
      detected_city: "Campinas",
      detected_state: "São Paulo",
      purchase_timing: "30d",
      customer_stage: "pesquisando",
      suggested_products: ["product-1"],
    });
    expect(complete).toHaveBeenCalledOnce();
  });

  it("inclui produto e preço do grounding no contexto do modelo", () => {
    const request = buildSalesAgentCompletionRequest({
      ctx: context,
      history: [],
      leadName: null,
      model: salesModel,
    });

    expect(request.messages[0].content).toContain("Piscina 6x3");
    expect(request.messages[0].content).toContain("Preço cadastrado: R$ 20.000,00");
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
    expect(decision.grounding_sources).toEqual([
      "catalog",
      "faq_knowledge",
      "commercial_rules",
      "coach_learnings",
    ]);
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
