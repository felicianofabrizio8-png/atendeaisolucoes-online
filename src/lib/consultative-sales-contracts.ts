import type { AgentSettings, SalesAgentGroundingSource } from "./sales-agent-core";
import type {
  ConversationSalesScopeType,
  ConversationSalesState,
} from "./conversation-sales-state";
import type { SalesAgentMode } from "./sales-agent-mode";

/** Capacidades de ação que podem ser habilitadas individualmente por tenant. */
export type CommercialActionKind =
  | "present_catalog"
  | "send_product_images"
  | "create_quote_draft"
  | "send_quote"
  | "schedule_followup"
  | "request_human_handoff";

export type CommercialActionStatus =
  | "requested"
  | "executed"
  | "confirmed"
  | "failed";

export type CommercialChannel = "whatsapp" | "phone" | "other";

export type CommercialArtifactKind =
  | "product_presented"
  | "product_media"
  | "quote"
  | "followup";

export type ConsultativeStage =
  | "discovery"
  | "presentation"
  | "reaction"
  | "objection"
  | "proposal"
  | "decision"
  | "handoff"
  | "followup"
  | "closed";

export type MemorySource = "lead" | "agent" | "human" | "system" | "provider";

export interface AgentCapabilityProfile {
  version: number;
  autonomyLevel: "assistido" | "grounded_reply" | "media_autonomous" | "quote_assisted" | "followup_autonomous";
  salesAgentMode: SalesAgentMode | null;
  consultativeSales: {
    enabled: boolean;
    maxQualificationQuestionsPerTurn: number;
    askReactionAfterPresentation: boolean;
    avoidRepeatedQuestions: boolean;
  };
  actions: Readonly<Partial<Record<CommercialActionKind, boolean>>>;
  authorizedObjectionTypes: readonly string[];
  allowedKnowledgeDomains?: readonly string[];
}

/** Contexto mínimo obrigatório para qualquer leitura ou ação consultiva. */
export interface TenantContext {
  companyId: string;
  conversationId: string;
  leadId: string;
  scopeType: ConversationSalesScopeType;
  settings: AgentSettings;
  capabilityProfile: AgentCapabilityProfile;
  catalogScope: { companyId: string; activeOnly: true };
  groundingSources: readonly SalesAgentGroundingSource[];
  timezone: string;
}

export interface CommercialPreference {
  key: string;
  value: string;
  status: "active" | "rejected" | "unknown";
  source: MemorySource;
  observedAt: string;
}

export interface CommercialProductMemory {
  productId: string;
  status: "considered" | "presented" | "preferred" | "rejected";
  source: MemorySource;
  observedAt: string;
}

export interface CommercialMediaMemory {
  productId: string;
  messageId: string | null;
  mediaPath: string;
  status: "requested" | "executed" | "confirmed" | "failed";
  observedAt: string;
}

export interface CommercialQuoteMemory {
  quoteId: string;
  version: string;
  status: "draft" | "sent" | "viewed" | "accepted" | "rejected" | "expired";
  total: number | null;
  sentAt: string | null;
  validUntil: string | null;
  source: MemorySource;
}

export interface CommercialObjectionMemory {
  type: string;
  status: "open" | "addressed" | "resolved" | "reopened";
  authorizedResponseRef: string | null;
  source: MemorySource;
  observedAt: string;
}

export interface CommercialCommitment {
  id: string;
  owner: "customer" | "company" | "human_agent";
  action: string;
  dueAt: string | null;
  status: "open" | "completed" | "cancelled";
  source: MemorySource;
}

export interface CommercialNextAction {
  kind: CommercialActionKind;
  owner: "ai" | "human" | "customer";
  dueAt: string | null;
  reason: string;
  status: "planned" | "blocked" | "completed";
}

/** Estado consultivo aditivo; o campo salesState preserva a memória existente. */
export interface CommercialConversationState {
  salesState: ConversationSalesState;
  stage: ConsultativeStage;
  preferences: readonly CommercialPreference[];
  products: readonly CommercialProductMemory[];
  media: readonly CommercialMediaMemory[];
  quotes: readonly CommercialQuoteMemory[];
  objections: readonly CommercialObjectionMemory[];
  commitments: readonly CommercialCommitment[];
  nextAction: CommercialNextAction | null;
  lastQuestion: string | null;
  updatedAt: string;
}

export interface CommercialEventBase {
  eventId: string;
  actionId: string;
  companyId: string;
  conversationId: string;
  leadId: string;
  channel: CommercialChannel;
  kind: CommercialActionKind;
  phase: CommercialActionStatus;
  occurredAt: string;
  actor: "ai" | "human" | "provider" | "system";
  groundingSources: readonly SalesAgentGroundingSource[];
  artifactId?: string | null;
  externalId?: string | null;
  failureReason?: string | null;
}

export type CommercialEvent = CommercialEventBase & {
  /** Dados objetivos adicionais, nunca substitutos de uma confirmação externa. */
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
};

export interface ActionReceipt {
  actionId: string;
  companyId: string;
  conversationId: string;
  leadId: string;
  channel: CommercialChannel;
  kind: CommercialActionKind;
  status: CommercialActionStatus;
  idempotencyKey: string;
  requestedAt: string;
  executedAt: string | null;
  confirmedAt: string | null;
  externalId: string | null;
  artifactId: string | null;
  failureReason: string | null;
}

export function createActionReceipt(input: Pick<
  ActionReceipt,
  "actionId" | "companyId" | "conversationId" | "leadId" | "kind" | "idempotencyKey"
> & { requestedAt?: string }): ActionReceipt {
  return {
    ...input,
    channel: "other",
    status: "requested",
    requestedAt: input.requestedAt ?? new Date().toISOString(),
    executedAt: null,
    confirmedAt: null,
    externalId: null,
    artifactId: null,
    failureReason: null,
  };
}

export interface CommercialArtifact {
  artifactId: string;
  kind: CommercialArtifactKind;
  status: CommercialActionStatus;
  companyId: string;
  conversationId: string;
  leadId: string;
  channel: CommercialChannel;
  productId: string | null;
  quoteId: string | null;
  followupId: string | null;
  messageId: string | null;
  version: string | null;
  externalIds: readonly string[];
  idempotencyKey: string;
  occurredAt: string;
  source: "message" | "quote" | "followup" | "event";
  evidenceId: string | null;
  failureReason: string | null;
}

const STATUS_RANK: Record<CommercialActionStatus, number> = {
  requested: 0,
  executed: 1,
  confirmed: 2,
  failed: 2,
};

/** Aplica somente eventos do mesmo tenant/conversa e nunca regride um receipt. */
export function applyCommercialEvent(
  receipt: ActionReceipt,
  event: CommercialEvent,
): ActionReceipt {
  if (
    event.companyId !== receipt.companyId ||
    event.conversationId !== receipt.conversationId ||
    event.leadId !== receipt.leadId ||
    event.actionId !== receipt.actionId ||
    event.kind !== receipt.kind
  ) {
    throw new Error("commercial_event_scope_mismatch");
  }
  if (STATUS_RANK[event.phase] < STATUS_RANK[receipt.status]) return receipt;
  if (event.phase === "confirmed" && !event.externalId && !event.artifactId) {
    throw new Error("commercial_confirmation_reference_required");
  }
  if (event.phase === "failed") {
    return {
      ...receipt,
      status: "failed",
      failureReason: event.failureReason ?? "commercial_action_failed",
    };
  }
  return {
    ...receipt,
    status: event.phase,
    executedAt: event.phase === "executed" || event.phase === "confirmed"
      ? receipt.executedAt ?? event.occurredAt
      : receipt.executedAt,
    confirmedAt: event.phase === "confirmed" ? event.occurredAt : receipt.confirmedAt,
    externalId: event.externalId ?? receipt.externalId,
    artifactId: event.artifactId ?? receipt.artifactId,
  };
}

export function assertTenantContextScope(
  context: TenantContext,
  event: Pick<CommercialEvent, "companyId" | "conversationId" | "leadId">,
): void {
  if (
    context.companyId !== event.companyId ||
    context.conversationId !== event.conversationId ||
    context.leadId !== event.leadId
  ) {
    throw new Error("tenant_context_scope_mismatch");
  }
}
