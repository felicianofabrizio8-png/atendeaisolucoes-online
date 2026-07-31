// ============================================================================
// Máquina de estados da tentativa de recuperação (Fase 6.3).
//
// Função PURA e exaustiva: toda transição precisa estar declarada aqui. O
// servidor consulta `canTransition` antes de qualquer escrita, de modo que
// regressões impossíveis (sent → draft) ou duplicidades (sending duas vezes)
// falhem no domínio, não no banco.
// ============================================================================

import type { RecoveryAttemptStatus } from "./types";

/** Grafo de transições permitidas. Ausência = transição proibida. */
const TRANSITIONS: Record<RecoveryAttemptStatus, RecoveryAttemptStatus[]> = {
  draft: ["awaiting_confirmation", "cancelled", "expired"],
  awaiting_confirmation: ["draft", "confirmed", "cancelled", "expired"],
  // `confirmed` é o ponto de não-retorno humano: só o envio ou o cancelamento
  // saem daqui. Nunca volta para edição sem passar por cancelamento.
  confirmed: ["sending", "cancelled", "expired"],
  // `sending` nunca aceita outro `sending`: é o lock lógico contra duplo clique.
  sending: ["sent", "failed"],
  sent: ["delivered", "read", "replied", "recovered", "not_recovered"],
  delivered: ["read", "replied", "recovered", "not_recovered"],
  read: ["replied", "recovered", "not_recovered"],
  replied: ["recovered", "not_recovered"],
  // Retry explícito: failed volta a `confirmed` (e só então a `sending`).
  failed: ["confirmed", "cancelled"],
  recovered: [],
  not_recovered: [],
  cancelled: [],
  expired: [],
};

export function canTransition(
  from: RecoveryAttemptStatus,
  to: RecoveryAttemptStatus,
): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(
  from: RecoveryAttemptStatus,
  to: RecoveryAttemptStatus,
): { ok: true } | { ok: false; reason: string } {
  if (canTransition(from, to)) return { ok: true };
  return { ok: false, reason: `transição inválida: ${from} → ${to}` };
}

/** Estado final: nenhuma transição sai dele. */
export function isTerminalStatus(status: RecoveryAttemptStatus): boolean {
  return (TRANSITIONS[status] ?? []).length === 0;
}

/** A tentativa ainda está sendo preparada/enviada pelo vendedor. */
export function isActiveStatus(status: RecoveryAttemptStatus): boolean {
  return (
    status === "draft" ||
    status === "awaiting_confirmation" ||
    status === "confirmed" ||
    status === "sending"
  );
}

/** A mensagem já saiu — usada para bloquear nova tentativa acidental. */
export function isDispatchedStatus(status: RecoveryAttemptStatus): boolean {
  return (
    status === "sent" ||
    status === "delivered" ||
    status === "read" ||
    status === "replied" ||
    status === "recovered" ||
    status === "not_recovered"
  );
}

export const STATUS_LABEL: Record<RecoveryAttemptStatus, string> = {
  draft: "Rascunho",
  awaiting_confirmation: "Aguardando confirmação",
  confirmed: "Confirmada",
  sending: "Enviando",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  replied: "Respondeu",
  recovered: "Recuperado",
  cancelled: "Cancelada",
  failed: "Falhou",
  expired: "Expirada",
  not_recovered: "Não recuperado",
};
