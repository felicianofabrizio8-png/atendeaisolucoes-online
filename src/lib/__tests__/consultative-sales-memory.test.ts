import { describe, expect, it } from "vitest";
import { EMPTY_CONVERSATION_SALES_STATE } from "../conversation-sales-state";
import { buildConsultativeMemorySnapshot, type ConsultativeMemoryInput } from "../consultative-sales-memory";

const baseState = {
  ...EMPTY_CONVERSATION_SALES_STATE,
  productIds: ["product-a"],
  lastValidProductIds: ["product-a"],
  intent: "product_inquiry",
};

function input(companyId = "tenant-a"): ConsultativeMemoryInput {
  return {
    tenant: {
      companyId,
      conversationId: `conversation-${companyId}`,
      leadId: `lead-${companyId}`,
      scopeType: "whatsapp_conversation",
    },
    channel: "whatsapp",
    salesState: baseState,
    history: [
      {
        id: "m1",
        role: "agent",
        text: "Separei o modelo A para você. O que achou?",
        at: "2026-10-20T10:00:00.000Z",
        sourceMetadata: { catalog_product_ids: ["product-a"] },
      },
      {
        id: "m2",
        role: "lead",
        text: "Gostei, mas achei caro.",
        at: "2026-10-20T10:01:00.000Z",
        productIds: ["product-a"],
      },
    ],
    products: [
      {
        productId: "product-a",
        status: "preferred",
        source: "lead",
        observedAt: "2026-10-20T10:01:00.000Z",
        companyId,
      },
    ],
    media: [
      {
        productId: "product-a",
        messageId: "image-message-1",
        mediaPath: `${companyId}/product-a.jpg`,
        status: "confirmed",
        observedAt: "2026-10-20T10:00:30.000Z",
        companyId,
      },
    ],
    quotes: [
      {
        quoteId: "quote-a",
        version: "v1",
        status: "sent",
        total: 22900,
        sentAt: "2026-10-20T10:02:00.000Z",
        validUntil: "2026-11-20",
        source: "system",
        companyId,
      },
    ],
    objections: [
      {
        type: "preco",
        status: "open",
        source: "lead",
        observedAt: "2026-10-20T10:01:00.000Z",
        companyId,
      },
    ],
    preferences: [
      {
        key: "formato",
        value: "retangular",
        status: "active",
        source: "lead",
        observedAt: "2026-10-20T10:00:00.000Z",
      },
    ],
    commitments: [
      {
        id: "commitment-a",
        owner: "company",
        action: "confirmar prazo de instalação",
        dueAt: "2026-10-21T12:00:00.000Z",
        status: "open",
        source: "human",
      },
    ],
    followups: [
      {
        id: "followup-a",
        rule: "quote_no_reply",
        status: "planned",
        scheduledAt: "2026-10-21T10:00:00.000Z",
        signal: "orçamento enviado sem retorno",
        companyId,
      },
    ],
    stage: "objection",
    asOf: "2026-10-20T10:05:00.000Z",
  };
}

describe("consultative sales memory adapter", () => {
  it("consolida continuidade sem alterar o estado de vendas existente", () => {
    const snapshot = buildConsultativeMemorySnapshot(input());

    expect(snapshot.tenant).toMatchObject({ companyId: "tenant-a", conversationId: "conversation-tenant-a" });
    expect(snapshot.channel).toBe("whatsapp");
    expect(snapshot.state.salesState).toEqual(baseState);
    expect(snapshot.state.stage).toBe("objection");
    expect(snapshot.state.products).toEqual([
      expect.objectContaining({ productId: "product-a", status: "preferred" }),
    ]);
    expect(snapshot.state.media[0]).toMatchObject({ status: "confirmed", productId: "product-a" });
    expect(snapshot.state.quotes[0]).toMatchObject({ quoteId: "quote-a", status: "sent", total: 22900 });
    expect(snapshot.state.objections[0]).toMatchObject({ type: "preco", status: "open" });
    expect(snapshot.state.commitments[0]).toMatchObject({ status: "open" });
    expect(snapshot.state.nextAction).toMatchObject({ kind: "schedule_followup", status: "planned" });
    expect(snapshot.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "product_presented", productId: "product-a", status: "executed" }),
      expect.objectContaining({ kind: "product_media", productId: "product-a", status: "confirmed" }),
      expect.objectContaining({ kind: "quote", quoteId: "quote-a", version: "v1", status: "confirmed" }),
      expect.objectContaining({ kind: "followup", followupId: "followup-a", status: "requested" }),
    ]));
    expect(snapshot.actionReceipts.every((receipt) => receipt.companyId === "tenant-a")).toBe(true);
    expect(snapshot.state.lastQuestion).toBe("O que achou?");
    expect(snapshot.lastClientMessage?.text).toContain("caro");
    expect(snapshot.sourceCounts).toEqual({ history: 2, products: 1, media: 1, quotes: 1, objections: 1, followups: 1 });
  });

  it("normaliza histórico de WhatsApp e telefonia no mesmo contrato", () => {
    const phone = input("tenant-a");
    phone.channel = "phone";
    phone.history = [
      {
        role: "human",
        text: "Na ligação, o cliente preferiu o modelo A.",
        channel: "phone",
        productIds: ["product-a"],
      },
    ];
    phone.products = [];
    const snapshot = buildConsultativeMemorySnapshot(phone);

    expect(snapshot.channel).toBe("phone");
    expect(snapshot.history[0]).toMatchObject({ role: "human", channel: "phone", productIds: ["product-a"] });
    expect(snapshot.state.products[0]).toMatchObject({ productId: "product-a", status: "presented", source: "human" });
  });

  it("rejeita qualquer fonte explicitamente pertencente a outro tenant", () => {
    const foreign = input("tenant-a");
    foreign.media = [{
      productId: "product-b",
      messageId: "foreign-image",
      mediaPath: "tenant-b/product-b.jpg",
      status: "confirmed",
      observedAt: "2026-10-20T10:00:00.000Z",
      companyId: "tenant-b",
    }];

    expect(() => buildConsultativeMemorySnapshot(foreign)).toThrow("consultative_memory_tenant_mismatch");
  });

  it("deduplica reprocessamento e preserva versões distintas do orçamento", () => {
    const replay = input("tenant-a");
    replay.history = [
      ...replay.history,
      {
        id: "m1",
        role: "agent",
        text: "Separei o modelo A para você. O que achou?",
        at: "2026-10-20T10:00:00.000Z",
        externalId: "external-message-1",
        sourceMetadata: { catalog_product_ids: ["product-a"] },
      },
    ];
    replay.quotes = [
      ...(replay.quotes ?? []),
      {
        quoteId: "quote-a",
        version: "v2",
        total: 23900,
        status: "sent",
        sentAt: "2026-10-20T10:03:00.000Z",
        validUntil: "2026-11-20",
        source: "system",
        companyId: "tenant-a",
      },
    ];

    const snapshot = buildConsultativeMemorySnapshot(replay);
    const productArtifacts = snapshot.artifacts.filter((artifact) => artifact.kind === "product_presented");
    const quoteArtifacts = snapshot.artifacts.filter((artifact) => artifact.kind === "quote");
    expect(productArtifacts).toHaveLength(1);
    expect(quoteArtifacts.map((artifact) => artifact.version).sort()).toEqual(["v1", "v2"]);
    expect(new Set(snapshot.actionReceipts.map((receipt) => receipt.idempotencyKey)).size)
      .toBe(snapshot.actionReceipts.length);
  });

  it("lê eventos de execução/confirmação, preserva canal e registra falha", () => {
    const withEvents = input("tenant-a");
    withEvents.events = [
      {
        eventId: "event-requested",
        actionId: "action-followup-1",
        companyId: "tenant-a",
        conversationId: "conversation-tenant-a",
        leadId: "lead-tenant-a",
        kind: "schedule_followup",
        phase: "requested",
        channel: "phone",
        occurredAt: "2026-10-20T11:00:00.000Z",
        actor: "ai",
      },
      {
        eventId: "event-executed",
        actionId: "action-followup-1",
        companyId: "tenant-a",
        conversationId: "conversation-tenant-a",
        leadId: "lead-tenant-a",
        kind: "schedule_followup",
        phase: "executed",
        channel: "phone",
        occurredAt: "2026-10-20T11:00:01.000Z",
        actor: "system",
      },
      {
        eventId: "event-failed",
        actionId: "action-media-1",
        companyId: "tenant-a",
        conversationId: "conversation-tenant-a",
        leadId: "lead-tenant-a",
        kind: "send_product_images",
        phase: "failed",
        channel: "whatsapp",
        occurredAt: "2026-10-20T11:00:02.000Z",
        actor: "provider",
        failureReason: "timeout",
      },
    ];

    const snapshot = buildConsultativeMemorySnapshot(withEvents);
    expect(snapshot.actionReceipts).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId: "action-followup-1", status: "executed", channel: "phone" }),
      expect.objectContaining({ actionId: "action-media-1", status: "failed", failureReason: "timeout" }),
    ]));
  });

  it("não inventa confirmação, preferência ou envio ausente", () => {
    const sparse = input("tenant-a");
    sparse.history = [{ role: "lead", text: "Quero conhecer opções.", at: null }];
    sparse.media = [];
    sparse.quotes = [];
    sparse.objections = [];
    sparse.preferences = [];
    sparse.followups = [];

    const snapshot = buildConsultativeMemorySnapshot(sparse);
    expect(snapshot.state.media).toEqual([]);
    expect(snapshot.state.quotes).toEqual([]);
    expect(snapshot.state.preferences).toEqual([]);
    expect(snapshot.state.objections).toEqual([]);
    expect(snapshot.state.nextAction).toBeNull();
    expect(snapshot.lastAgentMessage).toBeNull();
  });
});
