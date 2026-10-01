// Sales Intelligence: competência (igual p/ todos), Business Knowledge (do
// tenant), Customer Context (da conversa) e gate da próxima ação.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({ postGraph: vi.fn() }));

import {
  SALES_NEXT_ACTIONS,
  SALES_STAGES,
  SALES_STAGE_PRINCIPLES,
  UNIVERSAL_SALES_PRINCIPLES,
  buildBusinessKnowledge,
  customerContextFromEventPayload,
  gateSalesTurnPlan,
  mergeCustomerContext,
  parseSalesTurnPlan,
  renderSalesCompetence,
  type CustomerContext,
} from "../sales-agent-intelligence";
import {
  SalesAgentCore,
  buildSalesAgentSystemPrompt,
  type AgentContext,
  type SalesAgentCompletion,
  type SalesAgentCoreInput,
} from "../sales-agent-core";
import { SALES_AGENT_PLAYBOOK } from "../sales-agent-playbook";

// Segmento propositalmente diferente (móveis) para provar que nada é fixo.
const desk = {
  id: "desk-90",
  name: "Mesa Compacta 90",
  category: "Mesas",
  description: "Mesa para home office em espaço reduzido",
  widthM: 0.9,
  price: 890,
  promoPrice: null,
  images: [],
  notes: null,
};
const wideDesk = { ...desk, id: "desk-140", name: "Mesa Ampla 140", widthM: 1.4, price: 1_290 };

function ctx(overrides: Partial<AgentContext["grounding"]["commercialRules"]> = {}): AgentContext {
  return {
    settings: {
      company_id: "company-moveis",
      ai_auto_reply_enabled: true,
      ai_after_hours_only: false,
      ai_initial_message: null,
      ai_max_auto_replies: 5,
      ai_handoff_timeout_minutes: 30,
      ai_agent_name: "Bia",
      business_hours_start: "08:00",
      business_hours_end: "18:00",
    },
    companyName: "Casa Móveis",
    aiProfile: {
      tone: "próximo",
      description: "Móveis para casa e escritório",
      products: null,
      payment_methods: null,
      avg_lead_time: null,
      region: "Curitiba",
      differentials: "Montagem inclusa",
      faq: [],
    },
    products: [desk, wideDesk],
    catalogForValidation: [desk, wideDesk],
    knowledge: [],
    grounding: {
      catalog: [desk, wideDesk],
      catalogSearch: { status: "matches", products: [desk, wideDesk] },
      faqKnowledge: [],
      commercialRules: {
        paymentMethods: null,
        commercialTerms: null,
        paymentPolicy: "Pix ou cartão em até 6x.",
        installationPolicy: null,
        nextLoadForecast: null,
        visitPolicy: null,
        heatingPolicy: null,
        shippingPolicy: "Entrega em até 5 dias úteis.",
        includedItemsPolicy: null,
        ...overrides,
      },
      approvedCoachLearnings: [],
    },
  };
}

const SEGMENT_OR_TENANT_WORDS = /piscin|sol[aá]rio|fibra|vinil|escava|i[cç]amento|prainha/i;

describe("competência de vendas é igual para qualquer empresa", () => {
  it("não contém segmento, empresa ou produto fixo", () => {
    const allText = [
      ...UNIVERSAL_SALES_PRINCIPLES,
      ...SALES_STAGES.flatMap((stage) => [
        SALES_STAGE_PRINCIPLES[stage].goal,
        ...SALES_STAGE_PRINCIPLES[stage].principles,
      ]),
      SALES_AGENT_PLAYBOOK,
    ].join("\n");
    expect(allText).not.toMatch(SEGMENT_OR_TENANT_WORDS);
  });

  it("orienta pelo estágio atual e próximos, não despeja tudo", () => {
    const discovery = renderSalesCompetence("discovery");
    expect(discovery).toContain("Estágio atual — discovery");
    expect(discovery).toContain("Próximo possível — recommendation");
    expect(discovery).not.toContain("— negotiation");
    const objection = renderSalesCompetence("objection");
    expect(objection).toContain("Estágio atual — objection");
    expect(objection).toContain("Próximo possível — closing");
    expect(objection).not.toContain("— discovery");
  });
});

describe("Business Knowledge vem do cadastro do tenant", () => {
  it("capacidades e limites derivados do cadastro", () => {
    const knowledge = buildBusinessKnowledge(ctx());
    expect(knowledge.offering).toBe("Móveis para casa e escritório");
    expect(knowledge.policyTopics).toEqual(["pagamento", "entrega"]);
    expect(knowledge.capabilities).toEqual({
      priceComparison: true,
      visit: false,
      closing: "human",
      negotiation: "not_authorized",
    });
    expect(
      buildBusinessKnowledge(ctx({ visitPolicy: "Visita técnica gratuita." })).capabilities.visit,
    ).toBe(true);
  });
});

describe("Customer Context", () => {
  it("acumula observações sem duplicar e mantém o estágio", () => {
    const first = mergeCustomerContext(null, {
      stage: "discovery",
      nextAction: "discover_needs",
      context: { needs: ["montar home office"] },
    });
    const second = mergeCustomerContext(first, {
      stage: "objection",
      nextAction: "handle_objection",
      context: { needs: ["Montar home office"], objections: ["achou caro"] },
      presentedProductIds: ["desk-90"],
    });
    expect(second.stage).toBe("objection");
    expect(second.needs).toHaveLength(1);
    expect(second.objections).toEqual(["achou caro"]);
    expect(second.presentedProductIds).toEqual(["desk-90"]);
  });

  it("ignora valores inválidos e limita tamanho", () => {
    const merged = mergeCustomerContext(null, {
      stage: "inventado",
      nextAction: "dar_desconto",
      context: { needs: [42, "x".repeat(500), ...Array.from({ length: 20 }, (_, i) => `n${i}`)] },
    });
    expect(merged.stage).toBeNull();
    expect(merged.lastNextAction).toBeNull();
    expect(merged.needs.length).toBeLessThanOrEqual(8);
    expect(merged.needs.every((need) => need.length <= 140)).toBe(true);
  });

  it("lê o evento persistido de forma tolerante", () => {
    expect(customerContextFromEventPayload(null)).toBeNull();
    expect(
      customerContextFromEventPayload({ customer_context: { stage: "closing", needs: ["a"] } }),
    ).toMatchObject({
      stage: "closing",
      needs: ["a"],
    });
  });
});

describe("gate da próxima ação", () => {
  const knowledge = buildBusinessKnowledge(ctx());

  it("negociação identificada pelo LLM vai para humano", () => {
    const plan = parseSalesTurnPlan({ stage: "negotiation", next_action: "handle_objection" })!;
    expect(gateSalesTurnPlan(plan, { knowledge, suggestedProductIds: [] })).toMatchObject({
      outcome: "handoff",
      reason: "negotiation_not_authorized",
    });
  });

  it("intenção de compra: responde e o atendente conclui", () => {
    const plan = parseSalesTurnPlan({ stage: "closing", next_action: "confirm_purchase_intent" })!;
    expect(gateSalesTurnPlan(plan, { knowledge, suggestedProductIds: ["desk-90"] })).toMatchObject({
      outcome: "reply",
      afterReply: "handoff_for_closing",
    });
  });

  it("recomendação sem produto validado é ajustada", () => {
    const plan = parseSalesTurnPlan({
      stage: "recommendation",
      next_action: "recommend_products",
    })!;
    const gate = gateSalesTurnPlan(plan, { knowledge, suggestedProductIds: [] });
    expect(gate.plan.nextAction).toBe("answer_question");
    expect(gate.plan.adjustments).toContain("recommendation_without_products");
  });

  it("plano ausente ou inválido não bloqueia a resposta", () => {
    expect(parseSalesTurnPlan(undefined)).toBeNull();
    expect(parseSalesTurnPlan({ stage: "x", next_action: "y" })).toBeNull();
    expect(SALES_NEXT_ACTIONS).not.toContain("offer_discount");
  });
});

describe("prompt separa competência, negócio e cliente", () => {
  const customer: CustomerContext = {
    stage: "objection",
    lastNextAction: "handle_objection",
    needs: ["montar home office"],
    preferences: ["pouco espaço"],
    objections: ["achou caro"],
    buyingSignals: [],
    presentedProductIds: ["desk-90"],
  };

  it("monta as três camadas sem hardcode de segmento", () => {
    const prompt = buildSalesAgentSystemPrompt(
      ctx(),
      [{ role: "lead", text: "achei caro" }],
      [],
      customer,
    );
    expect(prompt).toContain("vendedora consultiva");
    expect(prompt).toContain("COMPETÊNCIA DE VENDAS");
    expect(prompt).toContain("Estágio atual — objection");
    expect(prompt).toContain("CONHECIMENTO DO NEGÓCIO — Casa Móveis");
    expect(prompt).toContain("Montagem inclusa");
    expect(prompt).toContain("CONTEXTO DO CLIENTE");
    expect(prompt).toContain("achou caro");
    expect(prompt).not.toMatch(/pré-atendente|FORA do horário|apenas qualifique/);
    expect(prompt).not.toMatch(SEGMENT_OR_TENANT_WORDS);
  });
});

describe("decide aplica o plano escolhido pelo LLM", () => {
  const interpretation: SalesAgentCoreInput["interpretation"] = {
    intent: null,
    attributes: {},
    references: { lastLeadText: "", productIds: [] },
  };

  function respond(args: Record<string, unknown>) {
    return vi.fn().mockResolvedValue({
      ok: true,
      data: {
        choices: [
          {
            message: {
              tool_calls: [
                { function: { name: "respond_to_customer", arguments: JSON.stringify(args) } },
              ],
            },
          },
        ],
      },
    });
  }

  async function decide(args: Record<string, unknown>, text = "quero a mesa") {
    const context = ctx();
    return new SalesAgentCore(respond(args) as unknown as SalesAgentCompletion).decide({
      ctx: context,
      history: [{ role: "lead", text }],
      leadName: null,
      model: "provider/model",
      interpretation,
      catalogSearch: context.grounding.catalogSearch,
    });
  }

  it("resposta com plano válido carrega o plano", async () => {
    const decision = await decide({
      message: "A Mesa Compacta 90 cabe bem em espaço reduzido.",
      suggest_products: ["desk-90"],
      sales_plan: {
        stage: "recommendation",
        next_action: "recommend_products",
        customer_context: { needs: ["home office"], preferences: ["pouco espaço"] },
      },
    });
    expect(decision.kind).toBe("reply");
    expect(decision.sales_plan).toMatchObject({
      stage: "recommendation",
      nextAction: "recommend_products",
    });
    expect(decision.after_reply).toBeNull();
  });

  it("negociação escolhida pelo LLM não envia o texto dele", async () => {
    const decision = await decide(
      {
        message: "Posso ver uma condição melhor para você.",
        sales_plan: { stage: "negotiation", next_action: "handle_objection" },
      },
      "dá pra fazer por menos?",
    );
    expect(decision).toMatchObject({ kind: "handoff", reason: "negotiation_not_authorized" });
  });

  it("fechamento: confirma e marca conclusão pelo atendente", async () => {
    const decision = await decide({
      message: "Ótima escolha! Já deixo tudo anotado para concluirmos.",
      suggest_products: ["desk-90"],
      sales_plan: {
        stage: "closing",
        next_action: "confirm_purchase_intent",
        customer_context: { buying_signals: ["quer comprar"] },
      },
    });
    expect(decision).toMatchObject({ kind: "reply", after_reply: "handoff_for_closing" });
  });

  it("plano não libera fato inventado: preço fora do cadastro continua bloqueado", async () => {
    const decision = await decide({
      message: "A Mesa Compacta 90 sai por R$ 500.",
      suggest_products: ["desk-90"],
      sales_plan: { stage: "recommendation", next_action: "present_value" },
    });
    expect(decision.message ?? "").not.toContain("500");
  });

  it("sem plano (modelo antigo) continua funcionando", async () => {
    const decision = await decide({ message: "Claro, posso te ajudar a escolher." });
    expect(decision.kind).toBe("reply");
    expect(decision.sales_plan).toBeUndefined();
  });
});
