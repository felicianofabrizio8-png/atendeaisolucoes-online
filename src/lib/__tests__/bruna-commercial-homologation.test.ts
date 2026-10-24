import { describe, expect, it } from "vitest";
import { isAutomaticReplyAllowed } from "../ai-reply-control";
import { runSafetyLayer } from "../ai-agent.server";
import { SalesAgentEvalHarness, type SalesAgentEvalFixture } from "../../../tools/sales-agent-eval-harness";
import type { AgentContext, SalesAgentCompletionResponse } from "../sales-agent-core";

type Product = NonNullable<AgentContext["grounding"]["catalog"]>[number];

const products: Record<string, Product> = {
  pool: {
    id: "acme-pool-63",
    name: "Piscina Acme 6x3",
    category: "Piscina",
    description: "Piscina de fibra 6x3 com filtro incluído.",
    price: 20_000,
    promoPrice: 18_000,
    images: ["acme-pool.jpg"],
    notes: "Instalação conforme avaliação técnica.",
  },
  sofa: {
    id: "lar-sofa-3l",
    name: "Sofá Lar 3 lugares",
    category: "Móveis",
    description: "Sofá de três lugares em tecido.",
    price: 5_000,
    promoPrice: null,
    images: ["lar-sofa.jpg"],
    notes: "Prazo confirmado pela equipe.",
  },
  bike: {
    id: "mov-bike-city",
    name: "Bicicleta Move City",
    category: "Bicicletas",
    description: "Bicicleta urbana para uso diário.",
    price: 3_000,
    promoPrice: null,
    images: ["mov-bike.jpg"],
    notes: "Montagem disponível sob consulta.",
  },
};

function context(
  companyId: string,
  companyName: string,
  product: Product,
  commercialTerms: string,
  discountMode: string,
  discountRules: unknown,
): AgentContext {
  return {
    settings: {
      company_id: companyId,
      ai_auto_reply_enabled: true,
      ai_after_hours_only: false,
      ai_initial_message: null,
      ai_max_auto_replies: 3,
      ai_handoff_timeout_minutes: 30,
      ai_agent_name: "Bruna",
      business_hours_start: "08:00:00",
      business_hours_end: "18:00:00",
      sales_agent_master_enabled: true,
      sales_agent_v2_enabled: true,
      ai_discount_mode: discountMode,
      ai_discount_rules: discountRules,
    },
    companyName,
    catalogProductIds: [product.id],
    aiProfile: {
      tone: "consultivo",
      description: `Atendimento comercial da ${companyName}`,
      products: product.name,
      payment_methods: "Pix e cartão",
      avg_lead_time: null,
      region: "SP",
      differentials: "Atendimento consultivo",
      faq: [],
    },
    products: [product],
    catalogForValidation: [product],
    knowledge: [],
    grounding: {
      catalog: [product],
      catalogSearch: { status: "matches", products: [product] },
      faqKnowledge: [],
      commercialRules: {
        paymentMethods: "Pix e cartão",
        commercialTerms,
        paymentPolicy: "Pagamento confirmado antes da reserva.",
        installationPolicy: "Conforme avaliação técnica.",
        visitPolicy: null,
        heatingPolicy: null,
        shippingPolicy: "Frete confirmado pela equipe.",
        includedItemsPolicy: product.notes,
      },
      approvedCoachLearnings: [],
      activeCoachRules: [],
      quickReplies: [],
    },
  };
}

function response(name: string, args: Record<string, unknown>): SalesAgentCompletionResponse {
  return { choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }] };
}

function fixture(
  companyId: string,
  companyName: string,
  product: Product,
  terms: string,
  mode: string,
  rules: unknown,
  completion: SalesAgentCompletionResponse,
  messages: ConstructorParameters<typeof SalesAgentEvalHarness>[0]["messages"] = [],
): SalesAgentEvalFixture {
  return {
    companyId,
    sessionId: `${companyId}-homologation`,
    context: context(companyId, companyName, product, terms, mode, rules),
    messages,
    mockCompletion: async () => completion,
  };
}

const pixFive = [{ percent: 5, condition: "pagamento à vista no Pix" }];

describe("Homologação comercial definitiva da Bruna", () => {
  it("aprova 18 cenários nas três empresas usando o Core e as regras comerciais", async () => {
    const companyA = fixture(
      "company-acme",
      "Acme Piscinas",
      products.pool,
      "Desconto autorizado: 5% para pagamento à vista no Pix.",
      "authorized",
      pixFive,
      response("respond_to_customer", {
        message: "A Piscina Acme 6x3 custa R$ 18.000 no preço promocional. No Pix à vista, há 5% conforme a política cadastrada.",
        suggest_products: [products.pool.id],
        fact_claims: [
          { product_id: products.pool.id, fact: "promoPrice", value: 18_000 },
          { product_id: products.pool.id, fact: "price", value: 20_000 },
        ],
      }),
      [
        { role: "lead", content: "Gostei da piscina, mas preciso falar com minha família." },
        { role: "agent", content: "Posso retornar hoje após vocês decidirem?", review_status: "approved" },
      ],
    );
    const companyB = fixture(
      "company-lar",
      "Lar Móveis",
      products.sofa,
      "Sem descontos cadastrados; condições especiais somente com atendimento humano.",
      "none",
      [],
      response("respond_to_customer", {
        message: "Posso confirmar o preço cadastrado de R$ 5.000 e pedir ao responsável uma condição comercial.",
        suggest_products: [products.sofa.id],
        sales_plan: { stage: "consideration", next_action: "handle_objection", customer_context: "cliente pediu condição" },
      }),
      [{ role: "lead", content: "O vendedor ficou de me retornar sobre o orçamento." }],
    );
    const companyC = fixture(
      "company-move",
      "Move Bikes",
      products.bike,
      "Desconto de 3% somente no boleto, sujeito à confirmação humana.",
      "approval_required",
      [{ percent: 3, condition: "boleto, sujeito à confirmação humana" }],
      response("respond_to_customer", {
        message: "A Bicicleta Move City custa R$ 3.000. Posso confirmar a condição de pagamento com a equipe.",
        suggest_products: [products.bike.id],
        sales_plan: { stage: "qualification", next_action: "answer_question", customer_context: "cliente consultou preço" },
      }),
      [{ role: "lead", content: "Estou aguardando a decisão da família e o retorno do vendedor." }],
    );

    const approved = [
      [companyA, "Qual o valor e consigo o desconto do Pix?"],
      [companyA, "Pode me mandar as fotos?"],
      [companyA, "Vou conversar com meu marido e aguardo seu retorno."],
      [companyA, "O orçamento ficou pendente, podemos retomar?"],
      [companyA, "Qual a medida cadastrada?"],
      [companyB, "Quero saber o preço do sofá."],
      [companyB, "Estou comparando modelos e preciso de detalhes."],
      [companyB, "O vendedor prometeu retorno hoje."],
      [companyB, "Pode explicar o prazo cadastrado?"],
      [companyB, "Quero continuar a conversa sobre o orçamento."],
      [companyC, "Qual o preço da bicicleta?"],
      [companyC, "Minha família ainda está decidindo."],
      [companyC, "Fiquei com uma dúvida sobre a montagem."],
      [companyC, "Pode retomar o orçamento pendente?"],
      [companyC, "Quais formas de pagamento estão cadastradas?"],
    ] as const;
    for (const [fixtureData, input] of approved) {
      const result = await new SalesAgentEvalHarness(fixtureData).turn(input);
      expect(result.handoff, `${fixtureData.companyId}: ${input}`).toBe(false);
      expect(result.evidence.companyId).toBe(fixtureData.companyId);
    }

    const blocked = [
      [companyA, response("respond_to_customer", { message: "Também temos o Produto Gold que não está no catálogo.", suggest_products: ["other-company-product"] }), "produto cruzado"],
      [companyB, response("respond_to_customer", { message: "Consigo 10% de desconto para você.", suggest_products: [products.sofa.id] }), "desconto não autorizado"],
      [companyC, response("respond_to_customer", { message: "Garanto a entrega amanhã.", suggest_products: [products.bike.id] }), "promessa não cadastrada"],
    ] as const;
    for (const [base, completion, label] of blocked) {
      const result = await new SalesAgentEvalHarness({ ...base, mockCompletion: async () => completion }).turn(`Cenário: ${label}`);
      expect(result.handoff, `${base.companyId}: ${label}`).toBe(true);
    }

    expect(runSafetyLayer({ kind: "reply", message: "No Pix à vista, há 5% conforme a política." }, companyA.context.grounding.commercialRules.commercialTerms)).toMatchObject({ kind: "reply" });
    expect(runSafetyLayer({ kind: "reply", message: "Posso oferecer 5% de desconto." }, companyB.context.grounding.commercialRules.commercialTerms)).toMatchObject({ kind: "handoff" });
    expect(approved).toHaveLength(15);
    expect(blocked).toHaveLength(3);
  });

  it("mantém continuidade, memória de treinamento e isolamento entre tenants", async () => {
    const base = fixture(
      "company-acme",
      "Acme Piscinas",
      products.pool,
      "Desconto autorizado: 5% para pagamento à vista no Pix.",
      "authorized",
      pixFive,
      response("respond_to_customer", { message: "A piscina é a opção cadastrada para sua medida.", suggest_products: [products.pool.id] }),
      [{ role: "lead", content: "Meu orçamento ficou pendente; retorno depois de falar com a família." }],
    );
    const harness = new SalesAgentEvalHarness(base);
    const first = await harness.turn("Pode retomar o orçamento?");
    expect(first.productIds).toEqual([products.pool.id]);
    harness.reviewLastAgent("approved");
    const second = await harness.turn("Continuando, quero ver as fotos desse modelo.");
    expect(second.productIds).toEqual([products.pool.id]);

    const foreign = { ...base, companyId: "company-lar", sessionId: "company-lar-homologation" };
    expect(() => new SalesAgentEvalHarness(foreign)).toThrow("eval_company_scope_mismatch");
  });

  it("bloqueia mensagens automáticas após takeover, opt-in ausente e empresa desligada", () => {
    expect(isAutomaticReplyAllowed({ scope: "geral", humanTakeoverAt: "2026-10-24T10:00:00Z" })).toEqual({ ok: false, reason: "human_active" });
    expect(isAutomaticReplyAllowed({ scope: "desligado", salesAgentAutoReply: true })).toEqual({ ok: false, reason: "disabled" });
    expect(isAutomaticReplyAllowed({ scope: "teste", conversationEnabled: false })).toEqual({ ok: false, reason: "conversation_not_authorized" });
  });
});
