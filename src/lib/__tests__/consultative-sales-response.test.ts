import { describe, expect, it } from "vitest";
import type { AgentCapabilityProfile } from "../consultative-sales-contracts";
import {
  buildEnabledConsultativeResponseGuidance,
  buildConsultativeResponseGuidance,
  enforceConsultativeQuestionLimit,
  isConsultativeSalesEnabled,
} from "../consultative-sales-response";
import { buildSalesAgentCompletionRequest } from "../sales-agent-core";
import { syntheticContext } from "./fixtures/sales-agent-phase0-fixtures";
import type { ConsultativeMemoryInput } from "../consultative-sales-memory";

const baseProfile: AgentCapabilityProfile = {
  version: 1,
  autonomyLevel: "grounded_reply",
  salesAgentMode: null,
  consultativeSales: {
    enabled: true,
    maxQualificationQuestionsPerTurn: 1,
    askReactionAfterPresentation: true,
    avoidRepeatedQuestions: true,
  },
  actions: {},
  authorizedObjectionTypes: ["budget"],
};

function input(companyId: string, sector: string): ConsultativeMemoryInput {
  return {
    tenant: {
      companyId,
      conversationId: `${companyId}-conversation`,
      leadId: `${companyId}-lead`,
      scopeType: "whatsapp_conversation",
    },
    channel: "whatsapp",
    history: [
      {
        role: "agent",
        text: `Enviei a proposta de ${sector}.`,
        at: "2026-10-18T10:00:00.000Z",
        id: `${companyId}-presentation`,
        externalId: `${companyId}-wamid-1`,
        productIds: [`${companyId}-product`],
        companyId,
      },
      {
        role: "lead",
        text: "Vou avaliar com calma.",
        at: "2026-10-20T10:00:00.000Z",
        companyId,
      },
    ],
    salesState: {
      productIds: [`${companyId}-product`],
      attributes: {},
      intent: "product_inquiry",
      lastValidProductIds: [`${companyId}-product`],
      lastCatalogQuery: null,
    },
    objections: [],
    asOf: "2026-10-20T10:01:00.000Z",
  };
}

describe("consultative response integration", () => {
  it("mantém a flag nova independente do shadow e desligada por ausência", () => {
    expect(isConsultativeSalesEnabled({})).toBe(false);
    expect(isConsultativeSalesEnabled({ consultative_sales_enabled: false })).toBe(false);
    expect(isConsultativeSalesEnabled({ consultative_sales_enabled: true })).toBe(true);
    expect(isConsultativeSalesEnabled({ consultative_shadow_enabled: true } as never)).toBe(false);
  });

  it("compara flag desligada e ligada sem alterar o contexto legado", () => {
    const value = input("tenant-retail", "móveis");
    expect(buildEnabledConsultativeResponseGuidance(
      { consultative_sales_enabled: false, consultative_capability_profile: baseProfile },
      value.tenant,
      value,
    )).toBeNull();
    expect(buildEnabledConsultativeResponseGuidance(
      { consultative_sales_enabled: true, consultative_capability_profile: baseProfile },
      value.tenant,
      value,
    )).toMatchObject({ stage: "reaction", objective: "resume_presentation" });
  });

  it("gera continuidade multissetor sem hardcode e no máximo uma pergunta", () => {
    const a = input("tenant-retail", "móveis");
    const b = input("tenant-servicos", "consultoria");
    const guidanceA = buildConsultativeResponseGuidance(a.tenant, a, baseProfile);
    const guidanceB = buildConsultativeResponseGuidance(b.tenant, b, baseProfile);

    expect(guidanceA?.objective).toBe("resume_presentation");
    expect(guidanceA?.advancementQuestion).toBe("O que você achou dos modelos que enviei?");
    expect(guidanceA?.advancementQuestion?.match(/\?/g)).toHaveLength(1);
    expect(guidanceB?.instruction.toLowerCase()).not.toContain("piscina");
    expect(guidanceA?.handoffRecommended).toBe(false);
  });

  it("não permite tratar objeção não autorizada como resposta automática", () => {
    const value = input("tenant-health", "serviços de saúde");
    value.objections = [{
      type: "regulatory_exception",
      status: "open",
      source: "lead",
      observedAt: "2026-10-20T10:00:00.000Z",
      companyId: value.tenant.companyId,
    }];
    const guidance = buildConsultativeResponseGuidance(value.tenant, value, baseProfile);
    expect(guidance?.handoffRecommended).toBe(true);
    expect(JSON.stringify(guidance).toLowerCase()).not.toContain("send");
  });

  it("bloqueia resposta com duas perguntas somente quando a orientação consultiva está ativa", () => {
    const value = input("tenant-retail", "móveis");
    const guidance = buildConsultativeResponseGuidance(value.tenant, value, baseProfile);
    const reply = { kind: "reply" as const, message: "Qual medida? E qual prazo?", grounding_sources: [] };
    expect(enforceConsultativeQuestionLimit(reply, guidance)).toMatchObject({
      kind: "handoff",
      reason: "consultative_multiple_questions",
    });
    expect(enforceConsultativeQuestionLimit(reply, null)).toBe(reply);
  });

  it("remove somente perguntas equivalentes e preserva o conteúdo autorizado", () => {
    const value = input("tenant-moveis", "móveis");
    const guidance = buildConsultativeResponseGuidance(value.tenant, value, baseProfile);
    const reply = {
      kind: "reply" as const,
      message: "Posso ajudar. Qual a medida? E qual é a medida?",
      grounding_sources: [],
    };
    expect(enforceConsultativeQuestionLimit(reply, guidance)).toMatchObject({
      kind: "reply",
      message: "Posso ajudar. Qual a medida?",
    });
  });

  it("mantém handoff para perguntas distintas, compostas ou ambíguas", () => {
    const value = input("tenant-clinic", "serviços de saúde");
    const guidance = buildConsultativeResponseGuidance(value.tenant, value, baseProfile);
    const distinct = { kind: "reply" as const, message: "Qual a medida? Qual o prazo?", grounding_sources: [] };
    const compound = { kind: "reply" as const, message: "Qual a medida e o prazo estimado?", grounding_sources: [] };
    expect(enforceConsultativeQuestionLimit(distinct, guidance)).toMatchObject({ kind: "handoff" });
    expect(enforceConsultativeQuestionLimit(compound, guidance)).toBe(compound);
    expect(enforceConsultativeQuestionLimit({
      ...distinct,
      message: "Você teve alguma objeção? Posso enviar uma alternativa?",
    }, guidance)).toMatchObject({ kind: "handoff" });
  });

  it("injeta somente orientação no prompt, sem criar ferramenta ou ação nova", () => {
    const value = input("tenant-retail", "móveis");
    const guidance = buildConsultativeResponseGuidance(value.tenant, value, baseProfile);
    const request = buildSalesAgentCompletionRequest({
      ctx: syntheticContext,
      history: value.history.map(({ role, text, productIds }) => ({
        role: role === "human" ? "agent" : role,
        text,
        productIds: [...(productIds ?? [])],
      })),
      leadName: null,
      model: "synthetic-model",
      catalogSearch: syntheticContext.grounding.catalogSearch,
      interpretation: {
        intent: "product_inquiry",
        attributes: {},
        references: { lastLeadText: "Vou avaliar com calma.", productIds: [] },
      },
      consultativeGuidance: guidance,
    });
    expect(request.messages[0].content).toContain("MEMÓRIA COMERCIAL CONSULTIVA AUTORIZADA");
    expect(request.messages[0].content).toContain("O que você achou dos modelos que enviei?");
    // A orientação não acrescenta ferramenta: as mesmas do pedido sem orientação.
    const withoutGuidance = buildSalesAgentCompletionRequest({
      ctx: syntheticContext,
      history: [],
      leadName: null,
      model: "synthetic-model",
      catalogSearch: syntheticContext.grounding.catalogSearch,
      interpretation: { intent: null, attributes: {}, references: { lastLeadText: "", productIds: [] } },
    });
    expect(request.tools).toEqual(withoutGuidance.tools);
    expect(JSON.stringify(request.tools)).not.toContain("schedule_followup");
    expect(JSON.stringify(request.tools)).not.toContain("send_quote");
  });

  it("retoma mídia confirmada e orçamento enviado após dias sem inventar evidência", () => {
    const value = input("tenant-services", "consultoria");
    value.history = [{
      role: "agent",
      text: "Enviei a foto do modelo avaliado.",
      at: "2026-10-15T10:00:00.000Z",
      externalId: "wamid-photo-confirmed",
      productIds: ["service-model"],
      sourceMetadata: { media_kind: "image", product_id: "service-model" },
      companyId: value.tenant.companyId,
    }, {
      role: "lead",
      text: "Voltei hoje para continuar.",
      at: "2026-10-20T10:00:00.000Z",
      companyId: value.tenant.companyId,
    }];
    value.quotes = [{
      quoteId: "quote-confirmed",
      version: "2026-10-15T10:00:00.000Z",
      status: "sent",
      total: 4200,
      sentAt: "2026-10-15T10:01:00.000Z",
      validUntil: "2026-11-15",
      source: "system",
      companyId: value.tenant.companyId,
    }];
    const guidance = buildConsultativeResponseGuidance(value.tenant, value, baseProfile);
    expect(guidance?.advancementQuestion).toBe("O que você achou do orçamento enviado?");
    expect(guidance?.instruction).not.toContain("R$");
    expect(guidance?.instruction).not.toContain("disponível");
  });

  it("rejeita memória de outra empresa antes de orientar a resposta", () => {
    const value = input("tenant-a", "varejo");
    expect(() => buildConsultativeResponseGuidance({
      ...value.tenant,
      companyId: "tenant-b",
    }, value, baseProfile)).toThrow("consultative_shadow_tenant_mismatch");
  });
});
