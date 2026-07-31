// ============================================================================
// Métricas operacionais das tentativas (Fase 6.3) — puro.
//
// Derivam SEMPRE de tentativas reais persistidas. Não se misturam com o score
// heurístico da Fase 6.1: aqui só existe o que o vendedor realmente fez.
// ============================================================================

import { DAY_MS } from "@/lib/recovery";
import type { RecoveryAttempt } from "./types";
import { isDispatchedStatus } from "./states";

export interface RecoveryAttemptMetrics {
  today: number;
  sent: number;
  failed: number;
  waitingReply: number;
  replied: number;
  recovered: number;
  notRecovered: number;
  /** % de tentativas enviadas que receberam resposta. */
  replyRate: number;
  /** % de tentativas enviadas marcadas manualmente como recuperadas. */
  recoveryRate: number;
}

export function buildAttemptMetrics(
  attempts: RecoveryAttempt[],
  now: number,
): RecoveryAttemptMetrics {
  let today = 0;
  let sent = 0;
  let failed = 0;
  let waitingReply = 0;
  let replied = 0;
  let recovered = 0;
  let notRecovered = 0;

  for (const a of attempts) {
    const created = new Date(a.createdAt).getTime();
    if (Number.isFinite(created) && now - created <= DAY_MS) today += 1;

    if (a.status === "failed") failed += 1;
    if (!isDispatchedStatus(a.status)) continue;

    sent += 1;
    const hasReply = a.status === "replied" || a.responseStatus === "replied";
    if (hasReply) replied += 1;
    if (a.outcome === "recovered") recovered += 1;
    else if (a.outcome === "not_recovered") notRecovered += 1;
    else if (!hasReply) waitingReply += 1;
  }

  const pct = (n: number) => (sent > 0 ? Math.round((n / sent) * 100) : 0);

  return {
    today,
    sent,
    failed,
    waitingReply,
    replied,
    recovered,
    notRecovered,
    replyRate: pct(replied),
    recoveryRate: pct(recovered),
  };
}
