// ============================================================================
// Recovery Context — o único pacote de dados que a IA enxerga.
//
// Ele é montado a partir da avaliação da Fase 6.1 (que NÃO é recalculada nem
// alterada aqui) mais um resumo seguro do histórico. Nada de histórico
// completo, nada de PII, nada de campos livres do banco sem mascaração.
// ============================================================================

import { STATE_LABEL, TIER_LABEL, formatSpan, type RecoveryWindow } from "@/lib/recovery";
import { buildSafeSummary, lastSpeakerOf } from "./summary";
import { sanitizeForPrompt } from "./redact";
import type { RecoveryContext, RecoveryContextInput } from "./types";

/** Frase curta sobre a janela — usada no prompt e na UI. */
export function windowLabel(w: RecoveryWindow): string {
  switch (w.state) {
    case "not_applicable":
      return "Canal sem janela de 24h.";
    case "open":
      return `Janela aberta, restam ${formatSpan(w.remainingMs)} — mensagem livre permitida.`;
    case "closing_soon":
      return `Janela fechando em ${formatSpan(w.remainingMs)} — mensagem livre ainda permitida.`;
    case "never_opened":
      return "O cliente nunca escreveu — só é possível iniciar com template aprovado.";
    default:
      return `Janela fechada há ${formatSpan(w.sinceClosedMs)} — só template aprovado reabre a conversa.`;
  }
}

export function buildRecoveryContext(input: RecoveryContextInput): RecoveryContext {
  const { assessment: a, messages, templates } = input;

  const approved = templates
    .filter((t) => (t.status ?? "").toLowerCase() === "approved")
    .map((t) => t.name);

  const requiresTemplate = a.window.requiresTemplate && a.channel === "whatsapp";
  // O template obrigatório é SEMPRE um nome real já validado pela Fase 6.1.
  const requiredTemplate =
    requiresTemplate && a.action.suggestedTemplate && approved.includes(a.action.suggestedTemplate)
      ? a.action.suggestedTemplate
      : requiresTemplate
        ? (approved[0] ?? null)
        : null;

  return {
    conversationId: a.conversationId,
    leadId: a.leadId,
    leadName: sanitizeForPrompt(a.leadName || "Cliente", 60) || "Cliente",
    product: a.product ? sanitizeForPrompt(a.product, 80) : null,
    source: input.source ? sanitizeForPrompt(input.source, 40) : null,
    leadStatus: a.leadStatus,
    state: a.state,
    stateLabel: STATE_LABEL[a.state] ?? a.state,
    channel: a.channel,

    score: a.score,
    tier: TIER_LABEL[a.tier] ?? a.tier,
    chancePercent: a.chancePercent,

    stalledHours: Math.round(a.stalledHours),
    stalledLabel: formatSpan(a.stalledHours * 3_600_000),
    lastInteractionAt: a.lastInteractionAt,
    lastSpeaker: lastSpeakerOf(messages),

    tags: (input.tags ?? []).slice(0, 8).map((t) => sanitizeForPrompt(t, 24)).filter(Boolean),
    estimatedValue: a.estimatedValue,

    window: {
      state: a.window.state,
      label: windowLabel(a.window),
      requiresTemplate,
    },
    requiredTemplate,
    availableTemplates: approved.slice(0, 20),

    summary: buildSafeSummary(messages),
    factors: a.factors.filter((f) => f.label).map((f) => f.label).slice(0, 12),
    engineAction: {
      kind: a.action.kind,
      label: a.action.label,
      reason: a.action.reason,
    },
  };
}
