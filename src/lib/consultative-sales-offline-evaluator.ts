import { detectHandoffNeeded, interpretSalesAgentTurn } from "./ai-agent.server";
import { detectObjections } from "./ai-qualifier.server";
import type { AgentCapabilityProfile } from "./consultative-sales-contracts";
import {
  buildConsultativeMemorySnapshot,
  type ConsultativeMemoryInput,
  type ConsultativeMemorySnapshot,
} from "./consultative-sales-memory";
import { buildConsultativeShadowSuggestion, type ConsultativeShadowSuggestion } from "./consultative-sales-shadow";

export interface OfflineScenario {
  id: string;
  sector: string;
  description: string;
  input: ConsultativeMemoryInput;
  profile: AgentCapabilityProfile;
  expected: {
    shadowStage: ConsultativeShadowSuggestion["stage"];
    shadowQuestion: string | null;
    currentHandoff: boolean;
    isolation: "same_tenant";
  };
}

export interface CurrentSellerOfflineDecision {
  mode: "current-contract-proxy";
  kind: "reply" | "handoff";
  intent: string | null;
  productIdsFromHistory: readonly string[];
  detectedObjections: readonly string[];
  handoffReason: string | null;
  responseExample: string;
  continuity: "history_only";
  nextAction: null;
}

export interface OfflineDivergence {
  area: "continuity" | "artifacts" | "question_repetition" | "next_action" | "handoff" | "isolation";
  severity: "info" | "warning" | "critical";
  description: string;
}

export interface OfflineScenarioResult {
  scenario: Pick<OfflineScenario, "id" | "sector" | "description">;
  current: CurrentSellerOfflineDecision;
  shadow: ConsultativeShadowSuggestion;
  snapshot: Pick<ConsultativeMemorySnapshot, "sourceCounts" | "channel">;
  divergences: readonly OfflineDivergence[];
  passed: boolean;
}

export interface OfflineEvaluationReport {
  generatedAt: string;
  mode: "offline";
  realDelivery: false;
  scenarios: readonly OfflineScenarioResult[];
  totals: {
    scenarios: number;
    passed: number;
    divergences: number;
    critical: number;
    warnings: number;
  };
}

function currentContractProxy(input: ConsultativeMemoryInput): CurrentSellerOfflineDecision {
  const history = input.history.map((message) => ({
    role: message.role === "human" ? "agent" as const : message.role,
    text: message.text,
    productIds: [...(message.productIds ?? [])],
  }));
  const interpretation = interpretSalesAgentTurn(history);
  const lastLeadText = [...history].reverse().find((message) => message.role === "lead")?.text ?? "";
  const handoff = detectHandoffNeeded(lastLeadText);
  const objections = detectObjections(lastLeadText);
  return {
    mode: "current-contract-proxy",
    kind: handoff.needed ? "handoff" : "reply",
    intent: interpretation.intent,
    productIdsFromHistory: interpretation.references.productIds,
    detectedObjections: objections,
    handoffReason: handoff.reason ?? null,
    responseExample: handoff.needed
      ? "Transferir para atendimento humano conforme o gatilho atual."
      : "Responder conforme o prompt/LLM atual; não há próxima ação estruturada neste proxy offline.",
    continuity: "history_only",
    nextAction: null,
  };
}

function compare(
  scenario: OfflineScenario,
  current: CurrentSellerOfflineDecision,
  shadow: ConsultativeShadowSuggestion,
  snapshot: ConsultativeMemorySnapshot,
): OfflineDivergence[] {
  const divergences: OfflineDivergence[] = [];
  const confirmedArtifacts = snapshot.artifacts.filter((artifact) => artifact.status === "confirmed");
  if (confirmedArtifacts.length > 0 && !shadow.lastPresentation) {
    divergences.push({
      area: "artifacts",
      severity: "critical",
      description: "O snapshot contém artefato confirmado, mas o motor shadow não identificou a apresentação.",
    });
  }
  if (confirmedArtifacts.length > 0 && current.nextAction === null && shadow.nextAction !== null) {
    divergences.push({
      area: "next_action",
      severity: "warning",
      description: "O contrato atual não expõe próxima ação estruturada; o shadow preserva a ação existente no snapshot.",
    });
  }
  if (shadow.advancementQuestion && current.kind === "reply") {
    divergences.push({
      area: "continuity",
      severity: "warning",
      description: "O shadow transforma a apresentação confirmada em pergunta de avanço; o proxy atual só indica resposta genérica.",
    });
  }
  if (scenario.expected.currentHandoff !== (current.kind === "handoff")) {
    divergences.push({
      area: "handoff",
      severity: "warning",
      description: "O comportamento de handoff observado diverge do critério esperado do cenário.",
    });
  }
  const openQuestions = shadow.answeredQuestions.filter((question) => !question.answered);
  if (shadow.advancementQuestion && openQuestions.some((question) =>
    question.text.toLowerCase() === shadow.advancementQuestion?.toLowerCase())) {
    divergences.push({
      area: "question_repetition",
      severity: "critical",
      description: "O shadow sugeriu uma pergunta já pendente.",
    });
  }
  if (shadow.companyId !== scenario.input.tenant.companyId || snapshot.tenant.companyId !== scenario.input.tenant.companyId) {
    divergences.push({
      area: "isolation",
      severity: "critical",
      description: "O resultado não preservou o companyId do cenário.",
    });
  }
  return divergences;
}

export function evaluateOfflineScenario(scenario: OfflineScenario): OfflineScenarioResult {
  const snapshot = buildConsultativeMemorySnapshot(scenario.input);
  const current = currentContractProxy(scenario.input);
  const shadow = buildConsultativeShadowSuggestion(scenario.input.tenant, snapshot, scenario.profile);
  const divergences = compare(scenario, current, shadow, snapshot);
  const expectedPassed = shadow.stage === scenario.expected.shadowStage &&
    shadow.advancementQuestion === scenario.expected.shadowQuestion &&
    current.kind === (scenario.expected.currentHandoff ? "handoff" : "reply") &&
    shadow.companyId === scenario.input.tenant.companyId;
  return {
    scenario: { id: scenario.id, sector: scenario.sector, description: scenario.description },
    current,
    shadow,
    snapshot: { sourceCounts: snapshot.sourceCounts, channel: snapshot.channel },
    divergences,
    passed: expectedPassed && !divergences.some((item) => item.severity === "critical"),
  };
}

export function evaluateOfflineScenarios(
  scenarios: readonly OfflineScenario[],
  generatedAt = "2026-10-20T12:00:00.000Z",
): OfflineEvaluationReport {
  const results = scenarios.map(evaluateOfflineScenario);
  const divergences = results.flatMap((result) => result.divergences);
  return {
    generatedAt,
    mode: "offline",
    realDelivery: false,
    scenarios: results,
    totals: {
      scenarios: results.length,
      passed: results.filter((result) => result.passed).length,
      divergences: divergences.length,
      critical: divergences.filter((item) => item.severity === "critical").length,
      warnings: divergences.filter((item) => item.severity === "warning").length,
    },
  };
}

export function renderOfflineEvaluationMarkdown(report: OfflineEvaluationReport): string {
  const rows = report.scenarios.map((result) => {
    const question = result.shadow.advancementQuestion ?? "—";
    const divergence = result.divergences.map((item) => `${item.severity}: ${item.description}`).join(" ") || "Nenhuma";
    return `| ${result.scenario.id} | ${result.scenario.sector} | ${result.shadow.stage} | ${question} | ${result.passed ? "PASS" : "REVISAR"} | ${divergence} |`;
  }).join("\n");
  return [
    "# Avaliação offline — vendedora atual versus ConsultativeSalesShadow",
    "",
    `- Execução: ${report.generatedAt}`,
    "- Modo: offline, sem entrega real",
    `- Cenários: ${report.totals.scenarios}`,
    `- Aprovados: ${report.totals.passed}`,
    `- Divergências: ${report.totals.divergences} (${report.totals.warnings} warnings, ${report.totals.critical} críticas)`,
    "",
    "## Comparativo",
    "",
    "| Cenário | Setor | Estágio shadow | Pergunta de avanço | Resultado | Divergências |",
    "|---|---|---|---|---|---|",
    rows,
    "",
    "## Critérios para ativação gradual",
    "",
    "1. Nenhuma divergência crítica de isolamento, confirmação ou repetição.",
    "2. Perguntas de opinião somente para artefatos confirmados.",
    "3. No máximo uma pergunta de avanço por turno.",
    "4. Próxima ação apenas quando registrada e permitida pelo AgentCapabilityProfile.",
    "5. Handoff preservado para objeções não autorizadas.",
    "6. Shadow rodando sem alterar resposta, envio, banco ou status da IA.",
    "7. Ativação inicial somente para tenants-piloto e em modo assistido, com comparação de conversão, repetição e handoff.",
  ].join("\n");
}
