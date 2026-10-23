import type { AgentDecision, AgentSettings } from "./sales-agent-core";
import type { AgentCapabilityProfile, TenantContext } from "./consultative-sales-contracts";
import {
  buildConsultativeMemorySnapshot,
  type ConsultativeMemoryInput,
} from "./consultative-sales-memory";
import {
  buildConsultativeShadowSuggestion,
  type ConsultativeShadowSuggestion,
} from "./consultative-sales-shadow";
import { DEFAULT_CONSULTATIVE_SHADOW_PROFILE } from "./consultative-sales-shadow-runtime";

export interface ConsultativeResponseFeatureSettings {
  consultative_sales_enabled?: boolean | null;
  consultative_capability_profile?: AgentCapabilityProfile | null;
}

export interface ConsultativeResponseGuidance {
  stage: ConsultativeShadowSuggestion["stage"];
  objective: ConsultativeShadowSuggestion["responseSuggestion"]["objective"];
  advancementQuestion: string | null;
  handoffRecommended: boolean;
  instruction: string;
}

interface QuestionSegment {
  start: number;
  end: number;
  canonical: string;
}

const QUESTION_STOP_WORDS = new Set([
  "a", "as", "o", "os", "um", "uma", "uns", "umas",
  "de", "do", "da", "dos", "das", "e", "é", "para", "por",
  "voce", "ja", "me", "te", "se",
]);

function canonicalQuestion(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !QUESTION_STOP_WORDS.has(token))
    .join(" ")
    .trim();
}

function findQuestionSegments(message: string): QuestionSegment[] {
  const result: QuestionSegment[] = [];
  for (let index = 0; index < message.length; index += 1) {
    if (message[index] !== "?") continue;
    const before = message.slice(0, index);
    const boundary = Math.max(
      before.lastIndexOf("."),
      before.lastIndexOf("!"),
      before.lastIndexOf("?"),
      before.lastIndexOf("\n"),
    );
    let start = boundary + 1;
    while (start < index && /\s/.test(message[start] ?? "")) start += 1;
    const text = message.slice(start, index + 1);
    result.push({ start, end: index + 1, canonical: canonicalQuestion(text) });
  }
  return result.filter((segment) => segment.canonical.length > 0);
}

function removeDuplicateQuestions(message: string, segments: readonly QuestionSegment[]): string {
  const first = segments[0];
  if (!first) return message;
  let output = message;
  for (let index = segments.length - 1; index >= 1; index -= 1) {
    const segment = segments[index];
    if (segment.canonical !== first.canonical) return message;
    output = `${output.slice(0, segment.start)}${output.slice(segment.end)}`;
  }
  return output.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}

export function enforceConsultativeQuestionLimit(
  decision: AgentDecision,
  guidance: ConsultativeResponseGuidance | null,
): AgentDecision {
  if (!guidance || decision.kind !== "reply" || !decision.message) return decision;
  const segments = findQuestionSegments(decision.message);
  const questionCount = segments.length;
  if (questionCount <= 1) return decision;
  const deduplicated = removeDuplicateQuestions(decision.message, segments);
  if ((deduplicated.match(/\?/g) ?? []).length <= 1) {
    return { ...decision, message: deduplicated };
  }
  return {
    kind: "handoff",
    reason: "consultative_multiple_questions",
    grounding_sources: decision.grounding_sources ?? [],
    learning_ids_used: decision.learning_ids_used ?? [],
    fallback_reason: "consultative_question_limit",
  };
}

export function isConsultativeSalesEnabled(
  settings: Pick<ConsultativeResponseFeatureSettings, "consultative_sales_enabled">,
): boolean {
  return settings.consultative_sales_enabled === true;
}

export function buildEnabledConsultativeResponseGuidance(
  settings: ConsultativeResponseFeatureSettings,
  tenant: Pick<TenantContext, "companyId" | "conversationId" | "leadId" | "scopeType">,
  memory: ConsultativeMemoryInput,
): ConsultativeResponseGuidance | null {
  if (!isConsultativeSalesEnabled(settings)) return null;
  return buildConsultativeResponseGuidanceSafely(
    tenant,
    memory,
    settings.consultative_capability_profile,
  );
}

function guidanceFromSuggestion(
  suggestion: ConsultativeShadowSuggestion,
): ConsultativeResponseGuidance {
  return {
    stage: suggestion.stage,
    objective: suggestion.responseSuggestion.objective,
    advancementQuestion: suggestion.advancementQuestion,
    handoffRecommended: suggestion.kind === "handoff_recommended",
    instruction: suggestion.responseSuggestion.text,
  };
}

/**
 * Converte a memória já carregada em orientação para o prompt.
 * Não executa ações, não persiste estado e não inventa evidências comerciais.
 */
export function buildConsultativeResponseGuidance(
  tenant: Pick<TenantContext, "companyId" | "conversationId" | "leadId" | "scopeType">,
  memory: ConsultativeMemoryInput,
  profile: AgentCapabilityProfile | null | undefined,
): ConsultativeResponseGuidance | null {
  const snapshot = buildConsultativeMemorySnapshot(memory);
  const suggestion = buildConsultativeShadowSuggestion(
    tenant,
    snapshot,
    profile ?? DEFAULT_CONSULTATIVE_SHADOW_PROFILE,
  );
  return guidanceFromSuggestion(suggestion);
}

export function buildConsultativeResponseGuidanceSafely(
  tenant: Pick<TenantContext, "companyId" | "conversationId" | "leadId" | "scopeType">,
  memory: ConsultativeMemoryInput,
  profile: AgentCapabilityProfile | null | undefined,
): ConsultativeResponseGuidance | null {
  try {
    return buildConsultativeResponseGuidance(tenant, memory, profile);
  } catch {
    return null;
  }
}

export function consultativeResponseSettings(
  settings: AgentSettings & ConsultativeResponseFeatureSettings,
): ConsultativeResponseFeatureSettings {
  return {
    consultative_sales_enabled: settings.consultative_sales_enabled,
    consultative_capability_profile: settings.consultative_capability_profile,
  };
}
