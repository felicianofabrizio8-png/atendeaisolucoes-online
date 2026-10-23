import { describe, expect, it } from "vitest";
import type { AgentCapabilityProfile } from "../consultative-sales-contracts";
import { buildConsultativeMemorySnapshot, type ConsultativeMemoryInput } from "../consultative-sales-memory";
import {
  evaluateOfflineScenarios,
  renderOfflineEvaluationMarkdown,
  type OfflineScenario,
} from "../consultative-sales-offline-evaluator";
import { buildConsultativeShadowSuggestion } from "../consultative-sales-shadow";

const profile: AgentCapabilityProfile = {
  version: 1,
  autonomyLevel: "assistido",
  salesAgentMode: "assisted",
  consultativeSales: {
    enabled: true,
    maxQualificationQuestionsPerTurn: 1,
    askReactionAfterPresentation: true,
    avoidRepeatedQuestions: true,
  },
  actions: { schedule_followup: true, send_quote: false },
  authorizedObjectionTypes: ["preco", "prazo"],
};

function input(companyId: string, channel: "whatsapp" | "phone" = "whatsapp"): ConsultativeMemoryInput {
  return {
    tenant: {
      companyId,
      conversationId: `${companyId}-conversation`,
      leadId: `${companyId}-lead`,
      scopeType: "whatsapp_conversation" as const,
    },
    channel,
    history: [],
    salesState: {
      productIds: [],
      attributes: {},
      intent: null,
      lastValidProductIds: [],
      lastCatalogQuery: null,
    },
    products: [],
    media: [],
    quotes: [],
    objections: [],
    preferences: [],
    commitments: [],
    followups: [],
    asOf: "2026-10-20T12:00:00.000Z",
  };
}

function scenarios(): OfflineScenario[] {
  const models = input("tenant-piscinas");
  models.history = [
    {
      role: "agent",
      text: "Enviei os modelos para você.",
      id: "pool-presentation",
      externalId: "wamid.pool-presentation",
      productIds: ["pool-model-a"],
      at: "2026-10-17T10:00:00.000Z",
      channel: "whatsapp",
    },
    { role: "lead", text: "Voltei para continuar.", at: "2026-10-20T10:00:00.000Z", channel: "whatsapp" },
  ];
  models.products = [];

  const quote = input("tenant-moveis");
  quote.history = [{ role: "lead", text: "Quero retomar a proposta.", at: "2026-10-20T10:00:00.000Z", channel: "whatsapp" }];
  quote.quotes = [{
    quoteId: "quote-furniture-1",
    version: "v2",
    status: "sent",
    total: 4800,
    sentAt: "2026-10-15T10:00:00.000Z",
    validUntil: "2026-11-15",
    source: "system",
    companyId: "tenant-moveis",
    externalIds: ["provider-quote-furniture-v2"],
  }];

  const draft = input("tenant-servicos", "phone");
  draft.history = [{ role: "lead", text: "Ainda estou avaliando.", at: "2026-10-20T10:00:00.000Z", channel: "phone" }];
  draft.quotes = [{
    quoteId: "quote-service-draft",
    version: "v1",
    status: "draft",
    total: 1200,
    sentAt: null,
    validUntil: "2026-11-01",
    source: "system",
    companyId: "tenant-servicos",
  }];

  const objection = input("tenant-piscinas-2");
  objection.history = [{ role: "lead", text: "Está caro para mim.", at: "2026-10-20T10:00:00.000Z", channel: "whatsapp" }];
  objection.objections = [{ type: "preco", status: "open", source: "lead", observedAt: "2026-10-20T10:00:00.000Z", companyId: "tenant-piscinas-2" }];

  const repeated = input("tenant-moveis-2");
  repeated.history = [
    { role: "agent", text: "O que você achou dos modelos que enviei?", id: "furniture-message", externalId: "wamid.furniture-1", productIds: ["chair-a"], at: "2026-10-17T10:00:00.000Z", channel: "whatsapp" },
    { role: "lead", text: "Gostei do segundo.", at: "2026-10-17T10:01:00.000Z", channel: "whatsapp" },
    { role: "lead", text: "Quero retomar.", at: "2026-10-20T10:00:00.000Z", channel: "whatsapp" },
  ];

  const handoff = input("tenant-servicos-2");
  handoff.history = [{ role: "lead", text: "Quero desconto.", at: "2026-10-20T10:00:00.000Z", channel: "phone" }];
  handoff.objections = [{ type: "desconto", status: "open", source: "lead", observedAt: "2026-10-20T10:00:00.000Z", companyId: "tenant-servicos-2" }];

  return [
    { id: "confirmed-models", sector: "piscinas", description: "Modelos confirmados e retomada após dias.", input: models, profile, expected: { shadowStage: "reaction", shadowQuestion: "O que você achou dos modelos que enviei?", currentHandoff: false, isolation: "same_tenant" } },
    { id: "confirmed-quote", sector: "moveis", description: "Orçamento v2 confirmado e retomado.", input: quote, profile, expected: { shadowStage: "proposal", shadowQuestion: "O que você achou do orçamento enviado?", currentHandoff: false, isolation: "same_tenant" } },
    { id: "draft-quote", sector: "servicos", description: "Rascunho não enviado não gera pergunta de orçamento enviado.", input: draft, profile, expected: { shadowStage: "discovery", shadowQuestion: null, currentHandoff: false, isolation: "same_tenant" } },
    { id: "authorized-objection", sector: "piscinas", description: "Objeção autorizada sem inventar desconto.", input: objection, profile, expected: { shadowStage: "objection", shadowQuestion: null, currentHandoff: false, isolation: "same_tenant" } },
    { id: "answered-question", sector: "moveis", description: "Pergunta de opinião já respondida não é repetida.", input: repeated, profile, expected: { shadowStage: "reaction", shadowQuestion: null, currentHandoff: false, isolation: "same_tenant" } },
    { id: "unauthorized-objection", sector: "servicos", description: "Objeção comercial não autorizada preserva handoff.", input: handoff, profile, expected: { shadowStage: "objection", shadowQuestion: null, currentHandoff: true, isolation: "same_tenant" } },
  ];
}

describe("offline current seller versus ConsultativeSalesShadow", () => {
  it("avalia continuidade, artefatos, retomadas, objeções e setores sem envio real", () => {
    const report = evaluateOfflineScenarios(scenarios());

    expect(report.realDelivery).toBe(false);
    expect(report.totals.scenarios).toBe(6);
    expect(report.totals.passed).toBe(6);
    expect(report.totals.critical).toBe(0);
    expect(report.scenarios.find((result) => result.scenario.id === "confirmed-models")?.shadow.advancementQuestion)
      .toBe("O que você achou dos modelos que enviei?");
    expect(report.scenarios.find((result) => result.scenario.id === "draft-quote")?.shadow.advancementQuestion)
      .toBeNull();
    expect(report.scenarios.find((result) => result.scenario.id === "answered-question")?.shadow.advancementQuestion)
      .toBeNull();
    expect(report.scenarios.find((result) => result.scenario.id === "unauthorized-objection")?.shadow.kind)
      .toBe("handoff_recommended");
  });

  it("rejeita snapshot de empresa diferente", () => {
    const source = scenarios()[0];
    const snapshot = buildConsultativeMemorySnapshot(source.input);
    expect(() => buildConsultativeShadowSuggestion({
      companyId: "tenant-estranho",
      conversationId: source.input.tenant.conversationId,
      leadId: source.input.tenant.leadId,
    }, snapshot, profile)).toThrow("consultative_shadow_tenant_mismatch");
  });

  it("gera relatório markdown com critérios de ativação", () => {
    const markdown = renderOfflineEvaluationMarkdown(evaluateOfflineScenarios(scenarios()));
    expect(markdown).toContain("Avaliação offline");
    expect(markdown).toContain("confirmed-quote");
    expect(markdown).toContain("Perguntas de opinião somente para artefatos confirmados");
    expect(markdown).toContain("sem entrega real");
  });
});
