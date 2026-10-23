import { describe, expect, it } from "vitest";
import {
  applyCommercialEvent,
  assertTenantContextScope,
  createActionReceipt,
  type AgentCapabilityProfile,
  type CommercialEvent,
  type TenantContext,
} from "../consultative-sales-contracts";
import { EMPTY_CONVERSATION_SALES_STATE } from "../conversation-sales-state";

const companyA = "tenant-sintetico-piscinas";
const companyB = "tenant-sintetico-moveis";

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
  actions: {
    present_catalog: true,
    send_product_images: true,
    send_quote: false,
    request_human_handoff: true,
  },
  authorizedObjectionTypes: ["preco", "prazo"],
};

function context(companyId: string): TenantContext {
  return {
    companyId,
    conversationId: `conversation-${companyId}`,
    leadId: `lead-${companyId}`,
    scopeType: "whatsapp_conversation",
    settings: {
      company_id: companyId,
      ai_auto_reply_enabled: true,
      ai_after_hours_only: false,
      ai_initial_message: null,
      ai_max_auto_replies: 5,
      ai_handoff_timeout_minutes: 30,
      ai_agent_name: "Atende Aí",
      business_hours_start: "08:00",
      business_hours_end: "18:00",
    },
    capabilityProfile: profile,
    catalogScope: { companyId, activeOnly: true },
    groundingSources: ["catalog", "commercial_rules"],
    timezone: "America/Sao_Paulo",
  };
}

function event(
  ctx: TenantContext,
  phase: CommercialEvent["phase"],
  overrides: Partial<CommercialEvent> = {},
): CommercialEvent {
  return {
    eventId: `${phase}-event`,
    actionId: "action-1",
    companyId: ctx.companyId,
    conversationId: ctx.conversationId,
    leadId: ctx.leadId,
    channel: "whatsapp",
    kind: "send_product_images",
    phase,
    occurredAt: `2026-10-20T${phase === "requested" ? "10:00:00" : phase === "executed" ? "10:00:01" : "10:00:02"}.000Z`,
    actor: phase === "confirmed" ? "provider" : "ai",
    groundingSources: ["catalog"],
    ...overrides,
  };
}

describe("consultative sales contracts", () => {
  it("preserva o estado de vendas existente dentro do estado consultivo", () => {
    const state = {
      salesState: {
        ...EMPTY_CONVERSATION_SALES_STATE,
        productIds: ["product-a"],
        intent: "product_inquiry",
      },
      stage: "presentation" as const,
      preferences: [],
      products: [{ productId: "product-a", status: "presented" as const, source: "agent" as const, observedAt: "2026-10-20T10:00:00.000Z" }],
      media: [],
      quotes: [],
      objections: [],
      commitments: [],
      nextAction: null,
      lastQuestion: "O que você achou do modelo?",
      updatedAt: "2026-10-20T10:00:00.000Z",
    };

    expect(state.salesState.productIds).toEqual(["product-a"]);
    expect(state.salesState.intent).toBe("product_inquiry");
    expect(state.stage).toBe("presentation");
    expect(state.lastQuestion).toContain("achou");
  });

  it("isola contexto, catálogo e eventos por empresa e conversa", () => {
    const a = context(companyA);
    const b = context(companyB);
    const receipt = createActionReceipt({
      actionId: "action-1",
      companyId: a.companyId,
      conversationId: a.conversationId,
      leadId: a.leadId,
      kind: "send_product_images",
      idempotencyKey: "idem-a-1",
      requestedAt: "2026-10-20T10:00:00.000Z",
    });

    expect(() => assertTenantContextScope(a, event(b, "requested"))).toThrow("tenant_context_scope_mismatch");
    expect(() => applyCommercialEvent(receipt, event(b, "executed"))).toThrow("commercial_event_scope_mismatch");
    expect(a.catalogScope.companyId).toBe(companyA);
    expect(b.catalogScope.companyId).toBe(companyB);
    expect(a.catalogScope.companyId).not.toBe(b.catalogScope.companyId);
  });

  it("distingue solicitado, executado e confirmado", () => {
    const ctx = context(companyA);
    const requested = createActionReceipt({
      actionId: "action-1",
      companyId: ctx.companyId,
      conversationId: ctx.conversationId,
      leadId: ctx.leadId,
      kind: "send_product_images",
      idempotencyKey: "idem-a-1",
      requestedAt: "2026-10-20T10:00:00.000Z",
    });
    expect(requested.status).toBe("requested");
    expect(requested.confirmedAt).toBeNull();

    const executed = applyCommercialEvent(requested, event(ctx, "executed"));
    expect(executed.status).toBe("executed");
    expect(executed.executedAt).toBe("2026-10-20T10:00:01.000Z");
    expect(executed.confirmedAt).toBeNull();

    expect(() => applyCommercialEvent(executed, event(ctx, "confirmed"))).toThrow(
      "commercial_confirmation_reference_required",
    );
    const confirmed = applyCommercialEvent(executed, event(ctx, "confirmed", {
      externalId: "wamid.synthetic-1",
    }));
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmedAt).toBe("2026-10-20T10:00:02.000Z");
    expect(confirmed.externalId).toBe("wamid.synthetic-1");
  });

  it("não regride confirmação nem transforma falha em sucesso", () => {
    const ctx = context(companyA);
    const receipt = createActionReceipt({
      actionId: "action-1",
      companyId: ctx.companyId,
      conversationId: ctx.conversationId,
      leadId: ctx.leadId,
      kind: "send_product_images",
      idempotencyKey: "idem-a-1",
      requestedAt: "2026-10-20T10:00:00.000Z",
    });
    const confirmed = applyCommercialEvent(receipt, event(ctx, "confirmed", {
      artifactId: "message-synthetic-1",
    }));
    expect(applyCommercialEvent(confirmed, event(ctx, "executed")).status).toBe("confirmed");
    expect(applyCommercialEvent(receipt, event(ctx, "failed", { failureReason: "provider_timeout" })))
      .toMatchObject({ status: "failed", failureReason: "provider_timeout" });
  });
});
