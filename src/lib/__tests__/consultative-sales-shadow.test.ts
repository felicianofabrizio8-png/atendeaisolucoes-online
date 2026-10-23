import { describe, expect, it } from "vitest";
import type { AgentCapabilityProfile } from "../consultative-sales-contracts";
import { buildConsultativeMemorySnapshot, type ConsultativeMemoryInput } from "../consultative-sales-memory";
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

function buildInput(companyId = "tenant-piscinas", channel: "whatsapp" | "phone" = "whatsapp"): ConsultativeMemoryInput {
  return {
    tenant: {
      companyId,
      conversationId: `${companyId}-conversation`,
      leadId: `${companyId}-lead`,
      scopeType: "whatsapp_conversation",
    },
    channel,
    salesState: {
      productIds: ["product-a"],
      attributes: { shape: "retangular" },
      intent: "product_inquiry",
      lastValidProductIds: ["product-a"],
      lastCatalogQuery: null,
    },
    history: [
      {
        role: "agent",
        text: "Enviei os modelos para você.",
        at: "2026-10-18T10:00:00.000Z",
        id: "presentation-message",
        externalId: "wamid.synthetic-presentation",
        productIds: ["product-a"],
        channel,
      },
      {
        role: "lead",
        text: "Gostei do primeiro, mas preciso pensar.",
        at: "2026-10-18T10:05:00.000Z",
        channel,
      },
    ],
    products: [],
    media: [],
    quotes: [],
    objections: [],
    preferences: [{
      key: "formato",
      value: "retangular",
      status: "active",
      source: "lead",
      observedAt: "2026-10-18T09:55:00.000Z",
    }],
    commitments: [],
    followups: [],
    stage: "reaction",
    asOf: "2026-10-20T10:00:00.000Z",
  };
}

describe("consultative sales shadow engine", () => {
  it("retoma apresentação confirmada e gera no máximo uma pergunta de opinião", () => {
    const input = buildInput();
    const snapshot = buildConsultativeMemorySnapshot(input);
    const suggestion = buildConsultativeShadowSuggestion(input.tenant, snapshot, profile);

    expect(suggestion.enabled).toBe(true);
    expect(suggestion.stage).toBe("reaction");
    expect(suggestion.lastPresentation).toMatchObject({ confirmed: true, productId: "product-a" });
    expect(suggestion.responseSuggestion.objective).toBe("resume_presentation");
    expect(suggestion.advancementQuestion).toBe("O que você achou dos modelos que enviei?");
    expect((suggestion.advancementQuestion?.match(/\?/g) ?? [])).toHaveLength(1);
    expect(suggestion.preferences).toEqual(expect.arrayContaining([expect.objectContaining({ key: "formato" })]));
  });

  it("não repete pergunta ainda pendente e reconhece pergunta já respondida", () => {
    const input = buildInput();
    input.history = [
      ...input.history,
      {
        role: "agent",
        text: "O que você achou dos modelos que enviei?",
        at: "2026-10-18T10:10:00.000Z",
        channel: "whatsapp",
      },
      {
        role: "lead",
        text: "Gostei do segundo.",
        at: "2026-10-18T10:11:00.000Z",
        channel: "whatsapp",
      },
    ];
    const snapshot = buildConsultativeMemorySnapshot(input);
    const suggestion = buildConsultativeShadowSuggestion(input.tenant, snapshot, profile);

    expect(suggestion.answeredQuestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ answered: true, text: "O que você achou dos modelos que enviei?" }),
    ]));
    expect(suggestion.advancementQuestion).toBeNull();
  });

  it("retoma após dias usando orçamento confirmado, sem inventar envio de rascunho", () => {
    const input = buildInput("tenant-servicos");
    input.history = [{ role: "lead", text: "Voltei para avaliar a proposta.", at: "2026-10-25T10:00:00.000Z", channel: "phone" }];
    input.channel = "phone";
    input.quotes = [{
      quoteId: "quote-service",
      version: "v3",
      status: "sent",
      total: 4800,
      sentAt: "2026-10-18T10:00:00.000Z",
      validUntil: "2026-11-18",
      source: "system",
      companyId: "tenant-servicos",
      channel: "phone",
      externalIds: ["provider-quote-v3"],
    }];
    const snapshot = buildConsultativeMemorySnapshot(input);
    const suggestion = buildConsultativeShadowSuggestion(input.tenant, snapshot, profile);

    expect(suggestion.channel).toBe("phone");
    expect(suggestion.lastPresentation).toMatchObject({ kind: "quote", quoteId: "quote-service", version: "v3" });
    expect(suggestion.advancementQuestion).toBe("O que você achou do orçamento enviado?");
    expect(suggestion.responseSuggestion.text).not.toContain("R$");
    expect(suggestion.responseSuggestion.text).not.toContain("disponível");
  });

  it("isola tenant e não aceita snapshot de outra empresa", () => {
    const input = buildInput("tenant-moveis");
    const snapshot = buildConsultativeMemorySnapshot(input);
    expect(() => buildConsultativeShadowSuggestion({
      companyId: "tenant-outro",
      conversationId: input.tenant.conversationId,
      leadId: input.tenant.leadId,
    }, snapshot, profile)).toThrow("consultative_shadow_tenant_mismatch");
  });

  it("não usa hardcode setorial e recomenda handoff para objeção não autorizada", () => {
    const input = buildInput("tenant-moveis");
    input.history = [{ role: "lead", text: "Tenho uma necessidade específica.", at: "2026-10-20T10:00:00.000Z" }];
    input.products = [{ productId: "chair-1", status: "preferred", source: "lead", observedAt: "2026-10-20T10:00:00.000Z", companyId: "tenant-moveis" }];
    input.objections = [{ type: "custom_sector_objection", status: "open", source: "lead", observedAt: "2026-10-20T10:00:00.000Z", companyId: "tenant-moveis" }];
    const snapshot = buildConsultativeMemorySnapshot(input);
    const suggestion = buildConsultativeShadowSuggestion(input.tenant, snapshot, profile);

    expect(suggestion.kind).toBe("handoff_recommended");
    expect(suggestion.blockedReason).toBe("objection_not_authorized_for_tenant");
    expect(suggestion.advancementQuestion).toBeNull();
    expect(JSON.stringify(suggestion).toLowerCase()).not.toContain("piscina");
  });
});
