// ============================================================================
// Idempotência do envio de recuperação (Fase 6.3).
//
// Uma tentativa gera NO MÁXIMO um envio efetivo. A chave é derivada do id da
// tentativa mais o número de despachos já iniciados: o primeiro envio usa
// `:1`, o retry explícito usa `:2`, e assim por diante. Duplo clique, refresh,
// segunda aba ou retry de rede reaproveitam exatamente a mesma chave, porque
// `sendAttempts` só avança quando o servidor aceita a transição
// `confirmed → sending` (que é única por definição da máquina de estados).
// ============================================================================

/** Chave estável para um despacho específico de uma tentativa. */
export function buildIdempotencyKey(attemptId: string, dispatch: number): string {
  const n = Number.isFinite(dispatch) && dispatch > 0 ? Math.floor(dispatch) : 1;
  return `rec:${attemptId}:${n}`;
}

/** Chave do próximo despacho, dado o número de despachos já iniciados. */
export function nextIdempotencyKey(attemptId: string, sendAttempts: number): string {
  return buildIdempotencyKey(attemptId, (sendAttempts ?? 0) + 1);
}

/** Chave provisória da tentativa recém-criada (antes de qualquer despacho). */
export function draftIdempotencyKey(conversationId: string, initiatedAtMs: number): string {
  return `draft:${conversationId}:${Math.floor(initiatedAtMs)}`;
}
