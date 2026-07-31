// ============================================================================
// Cooldown e estado da fila após uma tentativa (Fase 6.3).
//
// Regra CENTRALIZADA: depois de uma recuperação enviada, o lead sai da fila
// ativa por 24h e aparece em "Aguardando resposta". Isso evita a segunda
// tentativa acidental que queima a confiança do cliente.
// ============================================================================

import { DAY_MS } from "@/lib/recovery";
import type { RecoveryAttempt } from "./types";
import { isActiveStatus, isDispatchedStatus } from "./states";

export const RECOVERY_COOLDOWN_MS = DAY_MS;

export type QueueAttemptState =
  | "none" // nunca tentado (ou cooldown vencido)
  | "in_progress" // workflow aberto/confirmado, ainda não enviado
  | "waiting_reply" // enviado, dentro do cooldown, sem resposta
  | "replied" // cliente respondeu após a tentativa
  | "failed" // último envio falhou — permite retry
  | "closed"; // desfecho manual registrado

export interface QueueAttemptView {
  state: QueueAttemptState;
  attempt: RecoveryAttempt | null;
  /** ms desde o envio; 0 quando não houve envio. */
  sinceSentMs: number;
  /** Enquanto true, a fila não deve sugerir nova tentativa. */
  inCooldown: boolean;
}

/** Deriva o estado de fila a partir da tentativa mais recente da conversa. */
export function queueAttemptView(
  attempt: RecoveryAttempt | null | undefined,
  now: number,
  cooldownMs: number = RECOVERY_COOLDOWN_MS,
): QueueAttemptView {
  if (!attempt) return { state: "none", attempt: null, sinceSentMs: 0, inCooldown: false };

  const sentMs = attempt.sentAt ? new Date(attempt.sentAt).getTime() : NaN;
  const sinceSentMs = Number.isFinite(sentMs) ? Math.max(0, now - sentMs) : 0;

  if (isActiveStatus(attempt.status)) {
    return { state: "in_progress", attempt, sinceSentMs, inCooldown: true };
  }
  if (attempt.status === "failed") {
    return { state: "failed", attempt, sinceSentMs, inCooldown: false };
  }
  if (attempt.outcome === "recovered" || attempt.outcome === "not_recovered") {
    return { state: "closed", attempt, sinceSentMs, inCooldown: false };
  }
  if (attempt.status === "replied" || attempt.responseStatus === "replied") {
    return { state: "replied", attempt, sinceSentMs, inCooldown: false };
  }
  if (isDispatchedStatus(attempt.status)) {
    const inCooldown = sinceSentMs < cooldownMs;
    return { state: inCooldown ? "waiting_reply" : "none", attempt, sinceSentMs, inCooldown };
  }
  return { state: "none", attempt, sinceSentMs, inCooldown: false };
}

/** Uma nova tentativa só pode ser iniciada fora do cooldown e sem ativa aberta. */
export function canStartNewAttempt(view: QueueAttemptView): boolean {
  return !view.inCooldown && view.state !== "in_progress";
}
