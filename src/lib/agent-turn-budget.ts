// ============================================================================
// Orçamento de um turno do agente, descendo do prazo do tick.
//
// O tick tem um prazo total (AGENT_TICK_BUDGET_MS, preso aos ~30 s do
// waitUntil). Cada etapa recebe só o que sobra dele, reservando a margem das
// etapas seguintes: Vendedora externa → fallback LLM interno → envio. Assim
// nenhum limite fixo estoura o tick, e a Vendedora nunca roda além do ponto em
// que o Atende Aí desiste dela. Os orçamentos são calculados contra o prazo
// menos uma margem de segurança: o pior caso planejado termina antes do
// turn_deadline do tick.
// ============================================================================

/** Folga entre o fim planejado do turno e o prazo do tick. */
export const TURN_SAFETY_MARGIN_MS = 1_000;

/** Teto da chamada à Vendedora externa (o env só pode reduzi-lo). */
export const EXTERNAL_SALES_AGENT_MAX_MS = 30_000;
/** Abaixo disso a Vendedora não tem tempo útil para uma chamada ao LLM: nem chama. */
export const EXTERNAL_SALES_AGENT_MIN_MS = 6_000;
/** Reservado ao fallback interno quando a Vendedora falha. */
export const TURN_FALLBACK_RESERVE_MS = 5_000;
/** Reservado ao trabalho depois da decisão: persistência, auditoria e envio pelo WhatsApp. */
export const TURN_SEND_RESERVE_MS = 3_500;
/** Teto histórico da chamada do fallback LLM interno. */
export const INTERNAL_LLM_TIMEOUT_MS = 20_000;
/** Abaixo disso o fallback LLM não é chamado: segue o caminho seguro de falha do provedor. */
export const INTERNAL_LLM_MIN_MS = 3_000;

/**
 * Tempo para a Vendedora externa: o que resta do tick (menos a margem) menos as
 * reservas do fallback e do pós-decisão, limitado ao teto. Sem prazo de tick: undefined (usa a config).
 */
export function externalSalesAgentBudgetMs(deadlineAt: number | undefined, now: number = Date.now()): number | undefined {
  if (deadlineAt === undefined) return undefined;
  const available = deadlineAt - TURN_SAFETY_MARGIN_MS - now - TURN_FALLBACK_RESERVE_MS - TURN_SEND_RESERVE_MS;
  return Math.max(0, Math.min(EXTERNAL_SALES_AGENT_MAX_MS, available));
}

/**
 * Timeout do fallback LLM interno: o que resta do tick (menos a margem) menos o
 * pós-decisão, limitado ao teto histórico. null = sem tempo útil (não chamar o provedor).
 */
export function internalLlmTimeoutMs(deadlineAt: number | undefined, now: number = Date.now()): number | null {
  if (deadlineAt === undefined) return INTERNAL_LLM_TIMEOUT_MS;
  const available = Math.min(INTERNAL_LLM_TIMEOUT_MS, deadlineAt - TURN_SAFETY_MARGIN_MS - now - TURN_SEND_RESERVE_MS);
  return available >= INTERNAL_LLM_MIN_MS ? available : null;
}
