import type {
  AgentCapabilityProfile,
  CommercialActionKind,
  CommercialArtifact,
  CommercialNextAction,
  ConsultativeStage,
  TenantContext,
} from "./consultative-sales-contracts";
import type {
  ConsultativeMemorySnapshot,
  MemoryHistoryMessage,
} from "./consultative-sales-memory";

export type ShadowSuggestionKind = "continue" | "clarify" | "handoff_recommended" | "no_action";

export interface ShadowQuestionMemory {
  text: string;
  askedAt: string | null;
  answered: boolean;
  answerAt: string | null;
}

export interface ShadowPresentation {
  kind: "product" | "media" | "quote";
  artifactId: string;
  productId: string | null;
  quoteId: string | null;
  version: string | null;
  confirmed: boolean;
  occurredAt: string;
}

export interface ConsultativeShadowSuggestion {
  enabled: boolean;
  kind: ShadowSuggestionKind;
  companyId: string;
  conversationId: string;
  channel: ConsultativeMemorySnapshot["channel"];
  stage: ConsultativeStage;
  preferences: ConsultativeMemorySnapshot["state"]["preferences"];
  answeredQuestions: readonly ShadowQuestionMemory[];
  openObjections: ConsultativeMemorySnapshot["state"]["objections"];
  lastPresentation: ShadowPresentation | null;
  responseSuggestion: {
    objective: "acknowledge_context" | "resume_presentation" | "address_objection" | "continue_discovery" | "wait";
    groundingArtifactIds: readonly string[];
    text: string;
  };
  advancementQuestion: string | null;
  nextAction: CommercialNextAction | null;
  nextActionAllowed: boolean;
  blockedReason: string | null;
}

function assertTenantScope(
  tenant: Pick<TenantContext, "companyId" | "conversationId" | "leadId">,
  snapshot: ConsultativeMemorySnapshot,
): void {
  if (
    tenant.companyId !== snapshot.tenant.companyId ||
    tenant.conversationId !== snapshot.tenant.conversationId ||
    tenant.leadId !== snapshot.tenant.leadId
  ) {
    throw new Error("consultative_shadow_tenant_mismatch");
  }
  for (const artifact of snapshot.artifacts) {
    if (
      artifact.companyId !== tenant.companyId ||
      artifact.conversationId !== tenant.conversationId ||
      artifact.leadId !== tenant.leadId
    ) {
      throw new Error("consultative_shadow_artifact_scope_mismatch");
    }
  }
}

function splitQuestions(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+/g) ?? [])
    .filter((part) => part.includes("?"))
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizedQuestion(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function questionMemory(history: readonly MemoryHistoryMessage[]): ShadowQuestionMemory[] {
  const result: ShadowQuestionMemory[] = [];
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index];
    if (message.role !== "agent" && message.role !== "human") continue;
    for (const text of splitQuestions(message.text)) {
      const answer = history.slice(index + 1).find((candidate) => candidate.role === "lead");
      result.push({
        text,
        askedAt: message.at ?? null,
        answered: Boolean(answer),
        answerAt: answer?.at ?? null,
      });
    }
  }
  return result;
}

function lastConfirmedPresentation(
  artifacts: readonly CommercialArtifact[],
): ShadowPresentation | null {
  const presentation = artifacts
    .filter((artifact) => artifact.status === "confirmed" && (
      artifact.kind === "product_presented" || artifact.kind === "product_media" || artifact.kind === "quote"
    ))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  if (!presentation) return null;
  return {
    kind: presentation.kind === "quote" ? "quote" : presentation.kind === "product_media" ? "media" : "product",
    artifactId: presentation.artifactId,
    productId: presentation.productId,
    quoteId: presentation.quoteId,
    version: presentation.version,
    confirmed: true,
    occurredAt: presentation.occurredAt,
  };
}

function resolveStage(snapshot: ConsultativeMemorySnapshot): ConsultativeStage {
  if (snapshot.state.stage !== "discovery") return snapshot.state.stage;
  if (snapshot.state.objections.some((objection) => objection.status === "open" || objection.status === "reopened")) {
    return "objection";
  }
  if (snapshot.artifacts.some((artifact) => artifact.kind === "quote" && artifact.status === "confirmed")) {
    return "proposal";
  }
  if (snapshot.artifacts.some((artifact) =>
    (artifact.kind === "product_presented" || artifact.kind === "product_media") && artifact.status === "confirmed")) {
    return "reaction";
  }
  if (snapshot.state.nextAction?.kind === "schedule_followup") return "followup";
  return "discovery";
}

function actionAllowed(
  profile: AgentCapabilityProfile,
  action: CommercialActionKind | null,
): boolean {
  return action === null || profile.actions[action] !== false;
}

function alreadyAskedSameQuestion(
  questions: readonly ShadowQuestionMemory[],
  candidate: string,
): boolean {
  const normalized = normalizedQuestion(candidate);
  return questions.some((question) => normalizedQuestion(question.text) === normalized);
}

function buildAdvancementQuestion(
  presentation: ShadowPresentation | null,
  profile: AgentCapabilityProfile,
  questions: readonly ShadowQuestionMemory[],
): string | null {
  if (!profile.consultativeSales.askReactionAfterPresentation || !presentation) return null;
  const candidate = presentation.kind === "quote"
    ? "O que você achou do orçamento enviado?"
    : "O que você achou dos modelos que enviei?";
  if (profile.consultativeSales.avoidRepeatedQuestions && alreadyAskedSameQuestion(questions, candidate)) return null;
  return candidate;
}

function buildResponseSuggestion(
  snapshot: ConsultativeMemorySnapshot,
  presentation: ShadowPresentation | null,
  openObjection: boolean,
): ConsultativeShadowSuggestion["responseSuggestion"] {
  if (openObjection) {
    return {
      objective: "address_objection",
      groundingArtifactIds: presentation ? [presentation.artifactId] : [],
      text: "Reconhecer a objeção aberta e usar somente uma resposta autorizada pelo tenant.",
    };
  }
  if (presentation) {
    return {
      objective: "resume_presentation",
      groundingArtifactIds: [presentation.artifactId],
      text: presentation.kind === "quote"
        ? "Retomar o orçamento confirmado, sem alterar valor, validade ou condições."
        : "Retomar os produtos/mídias confirmados, sem afirmar disponibilidade não registrada.",
    };
  }
  if (snapshot.lastClientMessage) {
    return {
      objective: "continue_discovery",
      groundingArtifactIds: [],
      text: "Continuar a descoberta usando apenas fatos já registrados e sem repetir perguntas respondidas.",
    };
  }
  return {
    objective: "wait",
    groundingArtifactIds: [],
    text: "Aguardar uma nova mensagem antes de sugerir continuidade.",
  };
}

/**
 * Decide somente uma recomendação consultiva. Não envia mensagens, não altera
 * estado e não cria preço, disponibilidade, orçamento ou confirmação.
 */
export function buildConsultativeShadowSuggestion(
  tenant: Pick<TenantContext, "companyId" | "conversationId" | "leadId">,
  snapshot: ConsultativeMemorySnapshot,
  profile: AgentCapabilityProfile,
): ConsultativeShadowSuggestion {
  assertTenantScope(tenant, snapshot);
  const questions = questionMemory(snapshot.history);
  const stage = resolveStage(snapshot);
  const presentation = lastConfirmedPresentation(snapshot.artifacts);
  const openObjection = snapshot.state.objections.some((objection) =>
    (objection.status === "open" || objection.status === "reopened") &&
    profile.authorizedObjectionTypes.includes(objection.type),
  );
  const unsupportedObjection = snapshot.state.objections.some((objection) =>
    (objection.status === "open" || objection.status === "reopened") &&
    !profile.authorizedObjectionTypes.includes(objection.type),
  );
  const nextAction = snapshot.state.nextAction;
  const nextActionAllowed = actionAllowed(profile, nextAction?.kind ?? null);
  const advancementQuestion = profile.consultativeSales.enabled && !unsupportedObjection
    ? buildAdvancementQuestion(presentation, profile, questions)
    : null;
  const responseSuggestion = buildResponseSuggestion(snapshot, presentation, openObjection);

  if (!profile.consultativeSales.enabled) {
    return {
      enabled: false,
      kind: "no_action",
      companyId: tenant.companyId,
      conversationId: tenant.conversationId,
      channel: snapshot.channel,
      stage,
      preferences: snapshot.state.preferences,
      answeredQuestions: questions,
      openObjections: snapshot.state.objections,
      lastPresentation: presentation,
      responseSuggestion: { objective: "wait", groundingArtifactIds: [], text: "Capacidade consultiva desabilitada para este tenant." },
      advancementQuestion: null,
      nextAction: null,
      nextActionAllowed: false,
      blockedReason: "consultative_sales_disabled",
    };
  }

  return {
    enabled: true,
    kind: unsupportedObjection ? "handoff_recommended" : presentation || snapshot.lastClientMessage ? "continue" : "clarify",
    companyId: tenant.companyId,
    conversationId: tenant.conversationId,
    channel: snapshot.channel,
    stage,
    preferences: snapshot.state.preferences,
    answeredQuestions: questions,
    openObjections: snapshot.state.objections,
    lastPresentation: presentation,
    responseSuggestion,
    advancementQuestion,
    nextAction: nextActionAllowed ? nextAction : null,
    nextActionAllowed,
    blockedReason: unsupportedObjection
      ? "objection_not_authorized_for_tenant"
      : !nextActionAllowed
        ? "next_action_not_allowed_for_tenant"
        : null,
  };
}
