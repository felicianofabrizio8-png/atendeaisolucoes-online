import { describe, expect, it } from "vitest";
import type { AgentContext, AgentDecision, SalesAgentCompletionResponse } from "../sales-agent-core";
import { SalesAgentEvalHarness } from "../../../tools/sales-agent-eval-harness";

const companyA = "company-a";
const sessionA = "session-a";
const productA = {
  id: "pool-a",
  name: "Piscina A 6x3",
  category: "Piscina",
  description: "Piscina de fibra 6x3",
  price: 20_000,
  promoPrice: null,
  images: ["pool-a.jpg"],
  notes: "Filtro incluído",
};

function context(companyId = companyA): AgentContext {
  return {
    settings: {
      company_id: companyId,
      ai_auto_reply_enabled: true,
      ai_after_hours_only: false,
      ai_initial_message: null,
      ai_max_auto_replies: 3,
      ai_handoff_timeout_minutes: 30,
      ai_agent_name: "Ana",
      business_hours_start: "08:00:00",
      business_hours_end: "18:00:00",
    },
    companyName: "Empresa A",
    catalogProductIds: [productA.id],
    aiProfile: {
      tone: "consultivo",
      description: "Venda de piscinas",
      products: null,
      payment_methods: "Pix e cartão",
      avg_lead_time: null,
      region: "SP",
      differentials: null,
      faq: [],
    },
    products: [productA],
    catalogForValidation: [productA],
    knowledge: [],
    grounding: {
      catalog: [productA],
      faqKnowledge: [],
      commercialRules: {
        paymentMethods: "Pix e cartão",
        commercialTerms: "Sem desconto; condições especiais somente com atendimento humano.",
        paymentPolicy: null,
        installationPolicy: "Instalação conforme avaliação técnica.",
        visitPolicy: null,
        heatingPolicy: null,
        shippingPolicy: "Frete confirmado pela equipe.",
        includedItemsPolicy: "Filtro incluído.",
      },
      approvedCoachLearnings: [{
        id: "learning-old",
        category: "commercial",
        title: "Regra antiga",
        description: "Não usar preço antigo",
        rule: "Nunca contradiga o catálogo.",
        productRef: productA.id,
        positiveExample: null,
        negativeExample: null,
        priority: 80,
        confidence: 0.9,
      }],
      activeCoachRules: [],
      quickReplies: [],
    },
  };
}

function completion(call: Record<string, unknown>): (request: unknown) => Promise<SalesAgentCompletionResponse> {
  return async () => ({ choices: [{ message: { tool_calls: [{ function: { name: String(call.name), arguments: JSON.stringify(call.arguments ?? {}) } }] } }] });
}

function decision(productIds: string[] = []): AgentDecision {
  return { kind: "reply", message: "Resposta aprovada.", suggested_products: productIds };
}

describe("SalesAgentEvalHarness", () => {
  it("mantém catálogo/políticas soberanos e bloqueia fato inválido", async () => {
    const harness = new SalesAgentEvalHarness({
      companyId: companyA,
      sessionId: sessionA,
      context: context(),
      mockCompletion: completion({
        name: "respond_to_customer",
        arguments: { message: "A piscina custa R$ 10.000 e o frete é grátis.", suggest_products: [productA.id] },
      }),
    });

    const result = await harness.turn("Quanto custa e qual o frete?");

    expect(result.handoff).toBe(false);
    expect(result.message).not.toContain("10.000");
    expect(result.message).not.toContain("frete é grátis");
    expect(result.productIds).toEqual([productA.id]);
  });

  it("expõe correção no próximo prompt sem transformar learning antigo em autoridade factual", async () => {
    let prompt = "";
    const correction = "Pergunte a medida antes de sugerir um produto.";
    const harness = new SalesAgentEvalHarness({
      companyId: companyA,
      sessionId: sessionA,
      context: context(),
      messages: [
        { role: "lead", content: "Como começo?" },
        { role: "agent", content: "Sugira imediatamente.", review_status: "corrected", correction_text: correction, decision: decision() },
      ],
      mockCompletion: async (request) => {
        prompt = String((request as { messages?: Array<{ content?: string }> }).messages?.[0]?.content ?? "");
        return (await completion({ name: "respond_to_customer", arguments: { message: "Vou entender a medida antes de sugerir." } })(request));
      },
    });

    const result = await harness.turn("Qual o próximo passo?");

    expect(prompt).toContain(correction);
    expect(prompt).toContain("prevalecem sobre Coach rules e learnings conflitantes");
    expect(result.handoff).toBe(false);
  });

  it("executa rejeicao -> correcao -> proximo turno sem repetir o erro", async () => {
    const rejected = "Sugira imediatamente sem perguntar a medida.";
    const corrected = "Pergunte a medida antes de sugerir um produto.";
    let calls = 0;
    const harness = new SalesAgentEvalHarness({
      companyId: companyA,
      sessionId: sessionA,
      context: context(),
      mockCompletion: async (request) => {
        calls += 1;
        const prompt = String((request as { messages?: Array<{ content?: string }> }).messages?.[0]?.content ?? "");
        const message = calls === 1 || !prompt.includes(corrected) ? rejected : "Vou perguntar a medida antes de sugerir.";
        return completion({ name: "respond_to_customer", arguments: { message } })(request);
      },
    });

    const first = await harness.turn("Quero uma piscina.");
    harness.reviewLastAgent("corrected", corrected);
    const next = await harness.turn("Qual o proximo passo?");

    expect(first.message).toBe(rejected);
    expect(harness.history.map((item) => item.text)).not.toContain(rejected);
    expect(harness.history.map((item) => item.text)).toContain("Vou perguntar a medida antes de sugerir.");
    expect(next.message).not.toBe(rejected);
  });

  it("registra approved automaticamente e preserva contexto no turno seguinte", async () => {
    const harness = new SalesAgentEvalHarness({
      companyId: companyA,
      sessionId: sessionA,
      context: context(),
      mockCompletion: completion({ name: "respond_to_customer", arguments: { message: "Essa e a Piscina A 6x3.", suggest_products: [productA.id] } }),
    });

    await harness.turn("Gostei dessa piscina.");
    harness.reviewLastAgent("approved");
    await harness.turn("Pode me falar mais dela?");

    expect(harness.currentState.productIds).toEqual([productA.id]);
    expect(harness.history.map((item) => item.productIds)).toContainEqual([productA.id]);
  });

  it("remove estado de resposta rejeitada e preserva IDs de resposta aprovada", () => {
    const harness = new SalesAgentEvalHarness({
      companyId: companyA,
      sessionId: sessionA,
      context: context(),
      state: { attributes: {}, intent: null, productIds: ["pool-rejected"], lastValidProductIds: ["pool-rejected"] },
      messages: [
        { role: "agent", content: "produto rejeitado", review_status: "rejected", decision: decision(["pool-rejected"]) },
        { role: "agent", content: "produto aprovado", review_status: "approved", decision: decision([productA.id]) },
      ],
      mockCompletion: completion({ name: "respond_to_customer", arguments: { message: "Certo." } }),
    });

    expect(harness.currentState.productIds).toEqual([productA.id]);
    expect(harness.currentState.lastValidProductIds).toEqual([productA.id]);
    expect(harness.history.map((item) => item.text)).not.toContain("produto rejeitado");
    expect(harness.history.map((item) => item.productIds)).toContainEqual([productA.id]);
  });

  it("preserva handoff e normaliza evidências sem transporte externo", async () => {
    const harness = new SalesAgentEvalHarness({
      companyId: companyA,
      sessionId: sessionA,
      context: context(),
      mockCompletion: completion({ name: "request_human_handoff", arguments: { reason: "confirmação comercial" } }),
    });

    const result = await harness.turn("Preciso negociar uma condição.");

    expect(result).toMatchObject({ message: null, productIds: [], handoff: true, reason: "confirmação comercial" });
    expect(result.evidence).toMatchObject({ companyId: companyA, scopeType: "training_session", sessionId: sessionA });
    expect(result.evidence.availableCatalogProductIds).toEqual([productA.id]);
    expect(result.evidence.decisionGroundingSources).toContain("catalog");
  });

  it("bloqueia product_image_ids invalidos separadamente", async () => {
    const transport = { calls: 0, send: async () => { transport.calls += 1; } };
    const harness = new SalesAgentEvalHarness({
      companyId: companyA,
      sessionId: sessionA,
      context: context(),
      transport,
      mockCompletion: completion({ name: "respond_to_customer", arguments: { message: "Veja esta opcao.", send_product_images: ["image-from-other-company"] } }),
    });

    const result = await harness.turn("Quero ver uma imagem.");

    expect(result.transportInvoked).toBe(false);
    expect(transport.calls).toBe(0);
    expect(result.productIds).toEqual([]);
    expect(result.handoff).toBe(true);
  });

  it("isola company_id e training_session", async () => {
    expect(() => new SalesAgentEvalHarness({
      companyId: "company-b",
      sessionId: sessionA,
      context: context(companyA),
      mockCompletion: completion({ name: "respond_to_customer", arguments: { message: "não deve executar" } }),
    })).toThrow("eval_company_scope_mismatch");

    const first = new SalesAgentEvalHarness({ companyId: companyA, sessionId: "session-1", context: context(), mockCompletion: completion({ name: "respond_to_customer", arguments: { message: "A" } }) });
    const otherProduct = { ...productA, id: "pool-b", name: "Piscina B" };
    const secondContext = context("company-b");
    secondContext.grounding.catalog = [otherProduct];
    secondContext.catalogForValidation = [otherProduct];
    secondContext.products = [otherProduct];
    const second = new SalesAgentEvalHarness({ companyId: "company-b", sessionId: "session-2", context: secondContext, mockCompletion: completion({ name: "respond_to_customer", arguments: { message: "B", suggest_products: [otherProduct.id] } }) });
    expect((await first.turn("Quero A")).evidence.availableCatalogProductIds).toEqual([productA.id]);
    expect((await second.turn("Quero B")).evidence.availableCatalogProductIds).toEqual([otherProduct.id]);
    expect(first.history.map((item) => item.text)).not.toContain("B");
    expect(second.history.map((item) => item.text)).not.toContain("A");
  });
});
