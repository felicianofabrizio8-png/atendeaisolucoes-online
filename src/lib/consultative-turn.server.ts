// Integração da memória consultiva com o turno da vendedora: orientação da resposta
// (opt-in por empresa), observação em sombra e escopo de execução. Nada aqui envia
// mensagem, altera conversa ou cria ação comercial.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AgentContextBase, AgentDecision, AgentSettings } from "./sales-agent-core";
import type { ConversationSalesState } from "./conversation-sales-state";
import type { ConversationSalesStateScope } from "./conversation-sales-state.server";
import type { ExecutionScope } from "./execution-scope";
import {
  DEFAULT_CONSULTATIVE_SHADOW_PROFILE,
  isConsultativeShadowEnabled,
  runConsultativeShadowSafely,
  type ConsultativeShadowFeatureSettings,
} from "./consultative-sales-shadow-runtime";
import type { AgentCapabilityProfile, TenantContext } from "./consultative-sales-contracts";
import type { ConsultativeMemoryInput } from "./consultative-sales-memory";
import {
  buildEnabledConsultativeResponseGuidance,
  isConsultativeSalesEnabled,
  type ConsultativeResponseFeatureSettings,
} from "./consultative-sales-response";

type TurnHistory = Array<{ role: "lead" | "agent" | "system"; text: string; productIds?: string[] }>;
type TurnLogger = (
  companyId: string,
  conversationId: string | null,
  leadId: string | null,
  eventType: string,
  payload: Record<string, unknown>,
) => Promise<void>;

/** Treino nunca produz próxima ação executável. */
export function enforceExecutionScopeDecision(
  decision: AgentDecision,
  scope: ExecutionScope | undefined,
): AgentDecision {
  if (!scope || scope.kind !== "training_session") return decision;
  return { ...decision, next_action: undefined };
}

export async function loadConsultativeQuotes(
  companyId: string,
  conversationId: string,
  leadId: string,
): Promise<ConsultativeMemoryInput["quotes"]> {
  try {
    const { data } = await supabaseAdmin
      .from("quotes")
      .select("id, company_id, conversation_id, lead_id, total, status, sent, sent_at, valid_until, created_at, updated_at")
      .eq("company_id", companyId)
      .eq("conversation_id", conversationId)
      .eq("lead_id", leadId)
      .order("updated_at", { ascending: false });
    if (!Array.isArray(data)) return [];
    return data.flatMap((row) => {
      const quote = row as {
        id?: unknown;
        company_id?: unknown;
        total?: unknown;
        status?: unknown;
        sent?: unknown;
        sent_at?: unknown;
        valid_until?: unknown;
        created_at?: unknown;
        updated_at?: unknown;
      };
      if (quote.company_id !== companyId || quote.sent !== true) return [];
      const status = quote.status === "visualizado"
        ? "viewed" as const
        : quote.status === "aceito"
          ? "accepted" as const
          : quote.status === "recusado"
            ? "rejected" as const
            : quote.status === "expirado"
              ? "expired" as const
              : "sent" as const;
      const quoteId = typeof quote.id === "string" ? quote.id : null;
      if (!quoteId) return [];
      const createdAt = typeof quote.created_at === "string" ? quote.created_at : new Date().toISOString();
      const version = typeof quote.updated_at === "string" ? quote.updated_at : createdAt;
      return [{
        quoteId,
        version,
        status,
        total: typeof quote.total === "number" ? quote.total : null,
        sentAt: typeof quote.sent_at === "string" ? quote.sent_at : createdAt,
        validUntil: typeof quote.valid_until === "string" ? quote.valid_until : null,
        source: "system" as const,
        companyId,
        channel: "whatsapp" as const,
      }];
    });
  } catch {
    return [];
  }
}

/** Orientação consultiva da resposta; `null` quando a empresa não ligou a opção. */
export async function buildTurnConsultativeGuidance(params: {
  ctx: AgentContextBase;
  history: TurnHistory;
  salesState: ConversationSalesState | null;
  stateScope: ConversationSalesStateScope | null;
  leadId?: string;
  objections?: readonly string[] | null;
}): Promise<ReturnType<typeof buildEnabledConsultativeResponseGuidance>> {
  const settings = params.ctx.settings as AgentSettings & ConsultativeResponseFeatureSettings;
  if (!isConsultativeSalesEnabled(settings) || !params.stateScope || !params.leadId) return null;
  const capabilityProfile = settings.consultative_capability_profile ?? DEFAULT_CONSULTATIVE_SHADOW_PROFILE;
  const tenant: TenantContext = {
    companyId: params.ctx.settings.company_id,
    conversationId: params.stateScope.scopeId,
    leadId: params.leadId,
    scopeType: params.stateScope.scopeType,
    settings: params.ctx.settings,
    capabilityProfile,
    catalogScope: { companyId: params.ctx.settings.company_id, activeOnly: true },
    groundingSources: [],
    timezone: "UTC",
  };
  const memory: ConsultativeMemoryInput = {
    tenant: {
      companyId: tenant.companyId,
      conversationId: tenant.conversationId,
      leadId: tenant.leadId,
      scopeType: tenant.scopeType,
    },
    channel: tenant.scopeType === "whatsapp_conversation" ? "whatsapp" : "other",
    history: params.history,
    salesState: params.salesState,
    quotes: await loadConsultativeQuotes(params.ctx.settings.company_id, params.stateScope.scopeId, params.leadId),
    objections: (params.objections ?? []).map((type) => ({
      type,
      status: "open" as const,
      source: "system" as const,
      observedAt: new Date().toISOString(),
      companyId: tenant.companyId,
    })),
    asOf: new Date().toISOString(),
  };
  return buildEnabledConsultativeResponseGuidance(settings, tenant, memory);
}

/** Observação em sombra (opt-in): não participa da decisão nem do envio. */
export async function observeConsultativeShadow(params: {
  ctx: AgentContextBase;
  history: TurnHistory;
  salesState: ConversationSalesState | null;
  salesStateScope: ConversationSalesStateScope | null;
  leadId?: string;
  log: TurnLogger;
}): Promise<void> {
  const settings = params.ctx.settings as AgentSettings & ConsultativeShadowFeatureSettings;
  if (!isConsultativeShadowEnabled(settings) || !params.salesStateScope || !params.leadId) return;
  const capabilityProfile: AgentCapabilityProfile =
    settings.consultative_capability_profile ?? DEFAULT_CONSULTATIVE_SHADOW_PROFILE;
  const tenant: TenantContext = {
    companyId: params.ctx.settings.company_id,
    conversationId: params.salesStateScope.scopeId,
    leadId: params.leadId,
    scopeType: params.salesStateScope.scopeType,
    settings: params.ctx.settings,
    capabilityProfile,
    catalogScope: { companyId: params.ctx.settings.company_id, activeOnly: true },
    groundingSources: [],
    timezone: settings.timezone ?? "UTC",
  };
  const memory: ConsultativeMemoryInput = {
    tenant: {
      companyId: tenant.companyId,
      conversationId: tenant.conversationId,
      leadId: tenant.leadId,
      scopeType: tenant.scopeType,
    },
    channel: tenant.scopeType === "whatsapp_conversation" ? "whatsapp" : "other",
    history: params.history,
    salesState: params.salesState,
    asOf: new Date().toISOString(),
  };
  await runConsultativeShadowSafely({
    settings,
    tenant,
    memory,
    audit: async (metrics) => {
      await params.log(tenant.companyId, tenant.conversationId, tenant.leadId, "ai_flow_step", {
        consultative_shadow: {
          result: metrics.result,
          stage: metrics.stage,
          suggestion_kind: metrics.suggestionKind,
          question_generated: metrics.questionGenerated,
          next_action_present: metrics.nextActionPresent,
          artifact_counts: metrics.artifactCounts,
          source_counts: metrics.sourceCounts,
          divergence_codes: metrics.divergenceCodes.slice(0, 12),
          latency_ms: metrics.latencyMs,
          ...(metrics.errorCode ? { error_code: metrics.errorCode } : {}),
        },
      });
    },
  });
}
