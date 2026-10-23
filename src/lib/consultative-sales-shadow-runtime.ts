import type { AgentSettings } from "./sales-agent-core";
import type {
  AgentCapabilityProfile,
  TenantContext,
} from "./consultative-sales-contracts";
import {
  buildConsultativeMemorySnapshot,
  type ConsultativeMemoryInput,
  type ConsultativeMemorySnapshot,
} from "./consultative-sales-memory";
import {
  buildConsultativeShadowSuggestion,
  type ConsultativeShadowSuggestion,
} from "./consultative-sales-shadow";

export interface ConsultativeShadowFeatureSettings {
  consultative_shadow_enabled?: boolean | null;
  consultative_capability_profile?: AgentCapabilityProfile | null;
  timezone?: string | null;
}

export interface ConsultativeShadowAuditMetrics {
  result: "executed" | "failed";
  companyId: string;
  conversationId: string | null;
  stage: ConsultativeShadowSuggestion["stage"] | null;
  suggestionKind: ConsultativeShadowSuggestion["kind"] | null;
  questionGenerated: boolean;
  nextActionPresent: boolean;
  artifactCounts: Readonly<Record<string, number>>;
  sourceCounts: ConsultativeMemorySnapshot["sourceCounts"] | null;
  divergenceCodes: readonly string[];
  latencyMs: number;
  errorCode?: string;
}

export interface ConsultativeShadowRuntimeInput {
  settings: AgentSettings & ConsultativeShadowFeatureSettings;
  tenant: TenantContext;
  memory: ConsultativeMemoryInput;
  audit: (metrics: ConsultativeShadowAuditMetrics) => Promise<void> | void;
}

export interface ConsultativeShadowRuntimeResult {
  enabled: boolean;
  executed: boolean;
  snapshot?: ConsultativeMemorySnapshot;
  suggestion?: ConsultativeShadowSuggestion;
  errorCode?: string;
}

export const DEFAULT_CONSULTATIVE_SHADOW_PROFILE: AgentCapabilityProfile = {
  version: 1,
  autonomyLevel: "assistido",
  salesAgentMode: null,
  consultativeSales: {
    enabled: true,
    maxQualificationQuestionsPerTurn: 1,
    askReactionAfterPresentation: true,
    avoidRepeatedQuestions: true,
  },
  actions: {},
  authorizedObjectionTypes: [],
};

export function isConsultativeShadowEnabled(
  settings: Pick<ConsultativeShadowFeatureSettings, "consultative_shadow_enabled">,
): boolean {
  return settings.consultative_shadow_enabled === true;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && /^[a-zA-Z0-9_.:-]{1,80}$/.test(error.message)) return error.message;
  return "shadow_runtime_failure";
}

function artifactCounts(snapshot: ConsultativeMemorySnapshot): Record<string, number> {
  return snapshot.artifacts.reduce<Record<string, number>>((counts, artifact) => {
    const key = `${artifact.kind}.${artifact.status}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function divergenceCodes(suggestion: ConsultativeShadowSuggestion): string[] {
  const codes: string[] = [];
  if (suggestion.blockedReason) codes.push(suggestion.blockedReason);
  if (suggestion.advancementQuestion) codes.push("advancement_question_generated");
  if (suggestion.lastPresentation) codes.push(`presentation_${suggestion.lastPresentation.kind}`);
  return codes;
}

function auditFailureMetrics(
  input: ConsultativeShadowRuntimeInput,
  errorCode: string,
  latencyMs: number,
): ConsultativeShadowAuditMetrics {
  return {
    result: "failed",
    companyId: input.tenant.companyId,
    conversationId: input.tenant.conversationId,
    stage: null,
    suggestionKind: null,
    questionGenerated: false,
    nextActionPresent: false,
    artifactCounts: {},
    sourceCounts: null,
    divergenceCodes: ["shadow_failure"],
    latencyMs,
    errorCode,
  };
}

/** Executa somente a observação shadow; qualquer falha é isolada do atendimento. */
export async function runConsultativeShadowSafely(
  input: ConsultativeShadowRuntimeInput,
): Promise<ConsultativeShadowRuntimeResult> {
  if (!isConsultativeShadowEnabled(input.settings)) {
    return { enabled: false, executed: false };
  }
  const startedAt = Date.now();
  try {
    const snapshot = buildConsultativeMemorySnapshot(input.memory);
    const suggestion = buildConsultativeShadowSuggestion(input.tenant, snapshot, input.settings.consultative_capability_profile ?? DEFAULT_CONSULTATIVE_SHADOW_PROFILE);
    await input.audit({
      result: "executed",
      companyId: input.tenant.companyId,
      conversationId: input.tenant.conversationId,
      stage: suggestion.stage,
      suggestionKind: suggestion.kind,
      questionGenerated: Boolean(suggestion.advancementQuestion),
      nextActionPresent: Boolean(suggestion.nextAction),
      artifactCounts: artifactCounts(snapshot),
      sourceCounts: snapshot.sourceCounts,
      divergenceCodes: divergenceCodes(suggestion),
      latencyMs: Date.now() - startedAt,
    });
    return { enabled: true, executed: true, snapshot, suggestion };
  } catch (error) {
    const errorCode = safeErrorCode(error);
    try {
      await input.audit(auditFailureMetrics(input, errorCode, Date.now() - startedAt));
    } catch {
      // Auditor shadow nunca pode propagar falha para o atendimento.
    }
    return { enabled: true, executed: false, errorCode };
  }
}
