import type {
  CommercialConversationState,
  CommercialMediaMemory,
  CommercialObjectionMemory,
  CommercialPreference,
  CommercialProductMemory,
  CommercialQuoteMemory,
  CommercialCommitment,
  CommercialArtifact,
  ActionReceipt,
  CommercialChannel,
  CommercialEvent,
  CommercialActionKind,
  CommercialActionStatus,
  ConsultativeStage,
  MemorySource,
  TenantContext,
} from "./consultative-sales-contracts";
import type { ConversationSalesState } from "./conversation-sales-state";

export type ConsultativeChannel = CommercialChannel;

export interface MemoryHistoryMessage {
  id?: string | null;
  role: "lead" | "agent" | "system" | "human";
  text: string;
  at?: string | null;
  productIds?: readonly string[];
  externalId?: string | null;
  companyId?: string | null;
  channel?: ConsultativeChannel;
  sourceMetadata?: Readonly<Record<string, unknown>>;
  idempotencyKey?: string | null;
}

export interface MemoryProductRecord {
  productId: string;
  status: CommercialProductMemory["status"];
  observedAt?: string | null;
  source?: MemorySource;
  companyId?: string | null;
}

export interface MemoryMediaRecord extends CommercialMediaMemory {
  companyId?: string | null;
  channel?: ConsultativeChannel;
  externalIds?: readonly string[];
  idempotencyKey?: string | null;
}

export interface MemoryQuoteRecord extends CommercialQuoteMemory {
  companyId?: string | null;
  channel?: ConsultativeChannel;
  externalIds?: readonly string[];
  idempotencyKey?: string | null;
}

export interface MemoryObjectionRecord {
  type: string;
  status?: CommercialObjectionMemory["status"];
  authorizedResponseRef?: string | null;
  source?: MemorySource;
  observedAt?: string | null;
  companyId?: string | null;
}

export interface MemoryFollowupRecord {
  id: string;
  rule: string;
  status: "planned" | "sent" | "skipped" | "failed";
  scheduledAt?: string | null;
  sentAt?: string | null;
  responseAt?: string | null;
  signal?: string | null;
  companyId?: string | null;
  channel?: ConsultativeChannel;
  externalIds?: readonly string[];
  idempotencyKey?: string | null;
}

export interface MemoryCommercialEventRecord {
  eventId: string;
  actionId: string;
  companyId: string;
  conversationId: string;
  leadId: string;
  kind: CommercialActionKind;
  phase: CommercialActionStatus;
  channel: ConsultativeChannel;
  occurredAt: string;
  actor: CommercialEvent["actor"];
  artifactId?: string | null;
  externalId?: string | null;
  failureReason?: string | null;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ConsultativeMemoryInput {
  tenant: Pick<TenantContext, "companyId" | "conversationId" | "leadId" | "scopeType">;
  channel: ConsultativeChannel;
  history: readonly MemoryHistoryMessage[];
  salesState: ConversationSalesState | null;
  products?: readonly MemoryProductRecord[];
  media?: readonly MemoryMediaRecord[];
  quotes?: readonly MemoryQuoteRecord[];
  objections?: readonly MemoryObjectionRecord[];
  preferences?: readonly CommercialPreference[];
  commitments?: readonly CommercialCommitment[];
  followups?: readonly MemoryFollowupRecord[];
  events?: readonly MemoryCommercialEventRecord[];
  stage?: ConsultativeStage;
  asOf: string;
}

export interface ConsultativeMemorySnapshot {
  tenant: Pick<ConsultativeMemoryInput["tenant"], "companyId" | "conversationId" | "leadId" | "scopeType">;
  channel: ConsultativeChannel;
  state: CommercialConversationState;
  history: readonly MemoryHistoryMessage[];
  lastClientMessage: MemoryHistoryMessage | null;
  lastAgentMessage: MemoryHistoryMessage | null;
  pendingFollowups: readonly MemoryFollowupRecord[];
  artifacts: readonly CommercialArtifact[];
  actionReceipts: readonly ActionReceipt[];
  sourceCounts: {
    history: number;
    products: number;
    media: number;
    quotes: number;
    objections: number;
    followups: number;
  };
}

function assertTenantSource(
  companyId: string,
  sourceCompanyId: string | null | undefined,
): void {
  if (sourceCompanyId !== undefined && sourceCompanyId !== null && sourceCompanyId !== companyId) {
    throw new Error("consultative_memory_tenant_mismatch");
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function sourceForRole(role: MemoryHistoryMessage["role"]): MemorySource {
  if (role === "lead") return "lead";
  if (role === "human") return "human";
  if (role === "agent") return "agent";
  return "system";
}

function messageProductIds(message: MemoryHistoryMessage): string[] {
  const metadata = message.sourceMetadata;
  const metadataIds = Array.isArray(metadata?.catalog_product_ids)
    ? metadata.catalog_product_ids.filter((id): id is string => typeof id === "string")
    : typeof metadata?.product_id === "string"
      ? [metadata.product_id]
      : [];
  return uniqueStrings([...(message.productIds ?? []), ...metadataIds]);
}

function normalizeHistory(
  input: ConsultativeMemoryInput,
): MemoryHistoryMessage[] {
  return input.history.map((message) => {
    assertTenantSource(input.tenant.companyId, message.companyId);
    return {
      ...message,
      text: message.text.trim(),
      productIds: messageProductIds(message),
      channel: message.channel ?? input.channel,
    };
  });
}

function normalizeProducts(
  input: ConsultativeMemoryInput,
  history: readonly MemoryHistoryMessage[],
): CommercialProductMemory[] {
  const fromHistory = history.flatMap((message) =>
    messageProductIds(message).map((productId) => ({
      productId,
      status: message.role === "agent" || message.role === "human" ? "presented" as const : "considered" as const,
      source: sourceForRole(message.role),
      observedAt: message.at ?? input.asOf,
    })),
  );
  const explicit = (input.products ?? []).map((product) => {
    assertTenantSource(input.tenant.companyId, product.companyId);
    return {
      productId: product.productId,
      status: product.status,
      source: product.source ?? "system",
      observedAt: product.observedAt ?? input.asOf,
    };
  });
  const byProduct = new Map<string, CommercialProductMemory>();
  for (const product of [...fromHistory, ...explicit]) byProduct.set(product.productId, product);
  return [...byProduct.values()];
}

function normalizeMedia(
  input: ConsultativeMemoryInput,
): CommercialMediaMemory[] {
  return (input.media ?? []).map((media) => {
    assertTenantSource(input.tenant.companyId, media.companyId);
    return {
      productId: media.productId,
      messageId: media.messageId,
      mediaPath: media.mediaPath,
      status: media.status,
      observedAt: media.observedAt,
    };
  });
}

function normalizeQuotes(
  input: ConsultativeMemoryInput,
): CommercialQuoteMemory[] {
  return (input.quotes ?? []).map((quote) => {
    assertTenantSource(input.tenant.companyId, quote.companyId);
    return {
      quoteId: quote.quoteId,
      version: quote.version,
      status: quote.status,
      total: quote.total,
      sentAt: quote.sentAt,
      validUntil: quote.validUntil,
      source: quote.source,
    };
  });
}

function normalizeObjections(
  input: ConsultativeMemoryInput,
): CommercialObjectionMemory[] {
  return (input.objections ?? []).map((objection) => {
    assertTenantSource(input.tenant.companyId, objection.companyId);
    return {
      type: objection.type,
      status: objection.status ?? "open",
      authorizedResponseRef: objection.authorizedResponseRef ?? null,
      source: objection.source ?? "system",
      observedAt: objection.observedAt ?? input.asOf,
    };
  });
}

function normalizeFollowups(
  input: ConsultativeMemoryInput,
): MemoryFollowupRecord[] {
  return (input.followups ?? []).map((followup) => {
    assertTenantSource(input.tenant.companyId, followup.companyId);
    return { ...followup };
  });
}

function statusRank(status: CommercialActionStatus): number {
  return status === "requested" ? 0 : status === "executed" ? 1 : 2;
}

function quoteActionStatus(quote: CommercialQuoteMemory): CommercialActionStatus {
  return quote.status === "draft" ? "executed" : "confirmed";
}

function buildArtifact(
  input: ConsultativeMemoryInput,
  values: Omit<CommercialArtifact, "companyId" | "conversationId" | "leadId" | "channel"> & {
    channel?: ConsultativeChannel;
  },
): CommercialArtifact {
  return {
    ...values,
    companyId: input.tenant.companyId,
    conversationId: input.tenant.conversationId,
    leadId: input.tenant.leadId,
    channel: values.channel ?? input.channel,
  };
}

function buildArtifactLedger(
  input: ConsultativeMemoryInput,
  history: readonly MemoryHistoryMessage[],
  media: readonly CommercialMediaMemory[],
  quotes: readonly CommercialQuoteMemory[],
  followups: readonly MemoryFollowupRecord[],
): { artifacts: CommercialArtifact[]; actionReceipts: ActionReceipt[] } {
  const byKey = new Map<string, CommercialArtifact>();
  const add = (artifact: CommercialArtifact): void => {
    const current = byKey.get(artifact.idempotencyKey);
    if (!current || statusRank(artifact.status) >= statusRank(current.status)) {
      byKey.set(artifact.idempotencyKey, artifact);
    }
  };

  for (const item of media) {
    const source = input.media?.find((candidate) => candidate.productId === item.productId && candidate.mediaPath === item.mediaPath);
    const explicit = source as MemoryMediaRecord | undefined;
    const messageId = item.messageId;
    const idempotencyKey = explicit?.idempotencyKey ?? `product_media:${messageId ?? item.mediaPath}:${item.productId}`;
    add(buildArtifact(input, {
      artifactId: `media:${idempotencyKey}`,
      kind: "product_media",
      status: item.status,
      productId: item.productId,
      quoteId: null,
      followupId: null,
      messageId,
      version: null,
      externalIds: [...(explicit?.externalIds ?? [])],
      idempotencyKey,
      occurredAt: item.observedAt,
      source: "message",
      evidenceId: messageId,
      failureReason: item.status === "failed" ? "media_delivery_failed" : null,
      channel: explicit?.channel,
    }));
  }

  for (const message of history) {
    if (message.role !== "agent" && message.role !== "human") continue;
    const productIds = messageProductIds(message);
    const metadata = message.sourceMetadata ?? {};
    const isMedia = metadata.media_kind === "image" || metadata.type === "image" || metadata.product_id !== undefined;
    for (const productId of productIds) {
      const idempotencyKey = `message:${message.id ?? message.externalId ?? message.at ?? "unknown"}:${isMedia ? "media" : "product"}:${productId}`;
      if (isMedia && [...byKey.values()].some((artifact) => artifact.idempotencyKey === `product_media:${message.id ?? message.externalId ?? message.at ?? "unknown"}:${productId}`)) continue;
      add(buildArtifact(input, {
        artifactId: `${isMedia ? "media" : "product"}:${idempotencyKey}`,
        kind: isMedia ? "product_media" : "product_presented",
        status: message.externalId ? "confirmed" : "executed",
        productId,
        quoteId: null,
        followupId: null,
        messageId: message.id ?? null,
        version: null,
        externalIds: message.externalId ? [message.externalId] : [],
        idempotencyKey,
        occurredAt: message.at ?? input.asOf,
        source: "message",
        evidenceId: message.id ?? message.externalId ?? null,
        failureReason: null,
        channel: message.channel,
      }));
    }
  }

  for (const quote of quotes) {
    const source = input.quotes?.find((candidate) => candidate.quoteId === quote.quoteId && candidate.version === quote.version);
    const explicit = source as MemoryQuoteRecord | undefined;
    const idempotencyKey = explicit?.idempotencyKey ?? `quote:${quote.quoteId}:${quote.version}`;
    add(buildArtifact(input, {
      artifactId: `quote:${idempotencyKey}`,
      kind: "quote",
      status: quoteActionStatus(quote),
      productId: null,
      quoteId: quote.quoteId,
      followupId: null,
      messageId: null,
      version: quote.version,
      externalIds: [...(explicit?.externalIds ?? [])],
      idempotencyKey,
      occurredAt: quote.sentAt ?? input.asOf,
      source: "quote",
      evidenceId: quote.quoteId,
      failureReason: null,
      channel: explicit?.channel,
    }));
  }

  for (const followup of followups) {
    const idempotencyKey = followup.idempotencyKey ?? `followup:${followup.id}`;
    const status: CommercialActionStatus = followup.status === "planned"
      ? "requested"
      : followup.status === "failed" || followup.status === "skipped"
        ? "failed"
        : followup.externalIds?.length
          ? "confirmed"
          : "executed";
    add(buildArtifact(input, {
      artifactId: `followup:${idempotencyKey}`,
      kind: "followup",
      status,
      productId: null,
      quoteId: null,
      followupId: followup.id,
      messageId: null,
      version: null,
      externalIds: [...(followup.externalIds ?? [])],
      idempotencyKey,
      occurredAt: followup.sentAt ?? followup.scheduledAt ?? input.asOf,
      source: "followup",
      evidenceId: followup.id,
      failureReason: status === "failed" ? `followup_${followup.status}` : null,
      channel: followup.channel,
    }));
  }

  const receiptsByAction = new Map<string, ActionReceipt>();
  const events = [...(input.events ?? [])].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (const event of events) {
    assertTenantSource(input.tenant.companyId, event.companyId);
    if (event.conversationId !== input.tenant.conversationId || event.leadId !== input.tenant.leadId) {
      throw new Error("consultative_memory_scope_mismatch");
    }
    const existing = receiptsByAction.get(event.actionId) ?? {
      actionId: event.actionId,
      companyId: event.companyId,
      conversationId: event.conversationId,
      leadId: event.leadId,
      channel: event.channel,
      kind: event.kind,
      status: "requested" as const,
      idempotencyKey: `event:${event.actionId}`,
      requestedAt: event.occurredAt,
      executedAt: null,
      confirmedAt: null,
      externalId: null,
      artifactId: event.artifactId ?? null,
      failureReason: null,
    };
    const nextStatus = statusRank(event.phase) >= statusRank(existing.status) ? event.phase : existing.status;
    receiptsByAction.set(event.actionId, {
      ...existing,
      status: nextStatus,
      executedAt: event.phase === "executed" || event.phase === "confirmed" ? existing.executedAt ?? event.occurredAt : existing.executedAt,
      confirmedAt: event.phase === "confirmed" ? event.occurredAt : existing.confirmedAt,
      externalId: event.externalId ?? existing.externalId,
      artifactId: event.artifactId ?? existing.artifactId,
      failureReason: event.failureReason ?? existing.failureReason,
    });
  }
  const artifacts = [...byKey.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (const artifact of artifacts) {
    const actionId = `artifact:${artifact.artifactId}`;
    if (receiptsByAction.has(actionId)) continue;
    receiptsByAction.set(actionId, {
      actionId,
      companyId: artifact.companyId,
      conversationId: artifact.conversationId,
      leadId: artifact.leadId,
      channel: artifact.channel,
      kind: artifact.kind === "product_presented" ? "present_catalog" : artifact.kind === "product_media" ? "send_product_images" : artifact.kind === "quote" ? (artifact.status === "executed" ? "create_quote_draft" : "send_quote") : "schedule_followup",
      status: artifact.status,
      idempotencyKey: artifact.idempotencyKey,
      requestedAt: artifact.occurredAt,
      executedAt: artifact.status === "executed" || artifact.status === "confirmed" ? artifact.occurredAt : null,
      confirmedAt: artifact.status === "confirmed" ? artifact.occurredAt : null,
      externalId: artifact.externalIds[0] ?? null,
      artifactId: artifact.artifactId,
      failureReason: artifact.failureReason,
    });
  }
  return { artifacts, actionReceipts: [...receiptsByAction.values()] };
}

function lastByRole(
  history: readonly MemoryHistoryMessage[],
  roles: readonly MemoryHistoryMessage["role"][],
): MemoryHistoryMessage | null {
  return [...history].reverse().find((message) => roles.includes(message.role)) ?? null;
}

function lastQuestion(history: readonly MemoryHistoryMessage[]): string | null {
  const message = lastByRole(history, ["agent", "human"]);
  if (!message) return null;
  const questions = (message.text.match(/[^.!?]+[.!?]+/g) ?? [])
    .filter((part) => part.includes("?"));
  return questions.at(-1)?.trim() ?? null;
}

function pendingFollowups(followups: readonly MemoryFollowupRecord[]): MemoryFollowupRecord[] {
  return followups.filter((followup) => followup.status === "planned");
}

function nextActionFromFollowups(
  followups: readonly MemoryFollowupRecord[],
): CommercialConversationState["nextAction"] {
  const next = pendingFollowups(followups)[0];
  if (!next) return null;
  return {
    kind: "schedule_followup",
    owner: "ai",
    dueAt: next.scheduledAt ?? null,
    reason: next.signal ?? next.rule,
    status: "planned",
  };
}

/**
 * Adapta evidências já carregadas para memória consultiva comum a canais.
 * Não faz I/O, não toma decisão de resposta e não executa ações.
 */
export function buildConsultativeMemorySnapshot(
  input: ConsultativeMemoryInput,
): ConsultativeMemorySnapshot {
  if (input.tenant.companyId !== input.tenant.companyId.trim() || !input.tenant.companyId) {
    throw new Error("consultative_memory_company_id_required");
  }
  if (input.tenant.scopeType !== "whatsapp_conversation" && input.tenant.scopeType !== "training_session") {
    throw new Error("consultative_memory_scope_type_invalid");
  }
  const history = normalizeHistory(input);
  const products = normalizeProducts(input, history);
  const media = normalizeMedia(input);
  const quotes = normalizeQuotes(input);
  const objections = normalizeObjections(input);
  const followups = normalizeFollowups(input);
  const ledger = buildArtifactLedger(input, history, media, quotes, followups);
  const state: CommercialConversationState = {
    salesState: input.salesState ?? {
      productIds: [],
      attributes: {},
      intent: null,
      lastValidProductIds: [],
      lastCatalogQuery: null,
    },
    stage: input.stage ?? "discovery",
    preferences: [...(input.preferences ?? [])],
    products,
    media,
    quotes,
    objections,
    commitments: [...(input.commitments ?? [])],
    nextAction: nextActionFromFollowups(followups),
    lastQuestion: lastQuestion(history),
    updatedAt: input.asOf,
  };
  return {
    tenant: input.tenant,
    channel: input.channel,
    state,
    history,
    lastClientMessage: lastByRole(history, ["lead"]),
    lastAgentMessage: lastByRole(history, ["agent", "human"]),
    pendingFollowups: pendingFollowups(followups),
    artifacts: ledger.artifacts,
    actionReceipts: ledger.actionReceipts,
    sourceCounts: {
      history: history.length,
      products: products.length,
      media: media.length,
      quotes: quotes.length,
      objections: objections.length,
      followups: followups.length,
    },
  };
}
