// Ponto de entrada do Recovery Engine.
//
// `assessRecovery` é a única função que a camada de dados precisa chamar:
// recebe o snapshot de um lead e devolve a avaliação completa (estado,
// janela, score, chance, explicação e ação sugerida).
//
// Determinística e sem I/O — todo teste do motor roda em milissegundos.

import { classifyRecoveryState, stalledHoursOf } from "./classify";
import { computeRecoveryScore } from "./score";
import { estimateRecoveryChance } from "./chance";
import { suggestAction, type ApprovedTemplate } from "./action";
import { computeRecoveryWindow } from "./window";
import { HOUR_MS, type RecoveryAssessment, type RecoverySnapshot } from "./types";

export * from "./types";
export { classifyRecoveryState, STATE_LABEL, isTerminalState, stalledDays } from "./classify";
export { computeRecoveryScore, scoreToTier, TIER_LABEL } from "./score";
export { estimateRecoveryChance } from "./chance";
export { suggestAction, suggestTemplate, ACTION_LABEL, type ApprovedTemplate } from "./action";
export { computeRecoveryWindow, formatSpan, WINDOW_MS, CLOSING_SOON_MS } from "./window";
export { buildRecoveryQueue, compareRecovery } from "./queue";
export { buildDashboardCards, type RecoveryDashboardCards } from "./dashboard";

/**
 * Impressão digital dos sinais que alimentam o score.
 *
 * Serve ao processamento incremental: se o fingerprint não mudou desde a
 * última avaliação persistida, o recálculo pode ser descartado. Inclui a hora
 * corrente truncada porque o tempo parado é, ele próprio, um sinal.
 */
export function recoveryFingerprint(snap: RecoverySnapshot, now: number): string {
  return [
    snap.conversationId,
    snap.lastMessageAt ?? "-",
    snap.lastInboundAt ?? "-",
    snap.messageCount,
    snap.leadStatus,
    snap.temperature ?? "-",
    snap.estimatedValue ?? 0,
    snap.quote?.sentAt ?? "-",
    snap.quote?.viewedAt ?? "-",
    snap.visit?.scheduledAt ?? "-",
    snap.lastFollowUpAt ?? "-",
    snap.coachUrgency ?? "-",
    // Granularidade horária: abaixo disso o score não muda de faixa.
    Math.floor(now / HOUR_MS),
  ].join("|");
}

export function assessRecovery(
  snap: RecoverySnapshot,
  now: number,
  templates: ApprovedTemplate[] = [],
): RecoveryAssessment {
  const state = classifyRecoveryState(snap, now);
  const window = computeRecoveryWindow(snap.channel, snap.lastInboundAt, now);
  const stalledHours = stalledHoursOf(snap, now);
  const { score, tier, factors, explanation } = computeRecoveryScore(snap, now);
  const chance = estimateRecoveryChance(snap, state, now);
  const action = suggestAction(
    snap,
    state,
    window,
    stalledHours,
    score,
    chance.percent,
    templates,
  );

  return {
    conversationId: snap.conversationId,
    leadId: snap.leadId,
    leadName: snap.leadName,
    product: snap.product,
    channel: snap.channel,
    leadStatus: snap.leadStatus,
    assignedTo: snap.assignedTo,
    assignedToName: snap.assignedToName,
    estimatedValue: snap.estimatedValue,
    state,
    window,
    score,
    tier,
    chancePercent: chance.percent,
    factors: [
      ...factors,
      // A chance também é explicável: seus drivers entram como fatores de
      // peso zero, visíveis na UI sem contaminar o score.
      ...chance.drivers.map((d) => ({ key: "chance", label: `Chance: ${d}`, points: 0 })),
    ],
    explanation,
    action,
    stalledHours,
    lastInteractionAt: snap.lastMessageAt ?? snap.lastInboundAt ?? snap.lastOutboundAt,
    fingerprint: recoveryFingerprint(snap, now),
  };
}
