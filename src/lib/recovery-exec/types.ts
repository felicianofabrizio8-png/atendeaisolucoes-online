// ============================================================================
// EXECUÇÃO ASSISTIDA DA RECUPERAÇÃO — Contratos (SPRINT 6 · FASE 6.3)
//
// Esta fase NÃO altera a Fase 6.1 (motor determinístico) nem a Fase 6.2
// (assistente de IA). Ela adiciona a camada de EXECUÇÃO: uma tentativa
// persistida, com máquina de estados explícita, confirmação humana
// obrigatória e vínculo com a mensagem realmente enviada.
//
// Princípio inviolável: a IA sugere, o humano confirma. Nenhum módulo daqui
// dispara envio sem uma ação explícita do usuário.
// ============================================================================

/** Estados possíveis de uma tentativa de recuperação. */
export type RecoveryAttemptStatus =
  | "draft"
  | "awaiting_confirmation"
  | "confirmed"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "replied"
  | "recovered"
  | "cancelled"
  | "failed"
  | "expired"
  | "not_recovered";

/** Situação da resposta do cliente após a tentativa. */
export type RecoveryResponseStatus = "no_reply" | "replied";

/** Desfecho marcado manualmente pelo vendedor. */
export type RecoveryOutcome = "recovered" | "not_recovered" | "cancelled";

/** Eventos auditáveis do fluxo — nomes fechados, sem texto livre. */
export type RecoveryEventType =
  | "recovery_workflow_opened"
  | "recovery_plan_loaded"
  | "recovery_plan_regenerated"
  | "recovery_message_selected"
  | "recovery_message_edited"
  | "recovery_template_selected"
  | "recovery_confirmation_opened"
  | "recovery_cancelled"
  | "recovery_send_confirmed"
  | "recovery_send_started"
  | "recovery_send_succeeded"
  | "recovery_send_failed"
  | "recovery_retry_started"
  | "recovery_message_delivered"
  | "recovery_message_read"
  | "recovery_delivery_failed"
  | "recovery_reply_detected"
  | "recovery_marked_recovered"
  | "recovery_marked_not_recovered";

/** Linha de `recovery_attempts` já normalizada para a UI. */
export interface RecoveryAttempt {
  id: string;
  conversationId: string;
  leadId: string;
  status: RecoveryAttemptStatus;
  score: number | null;
  chance: number | null;
  tier: string | null;
  strategyFingerprint: string | null;
  messageStyle: string | null;
  messageText: string | null;
  templateId: string | null;
  templateName: string | null;
  templateVariables: Record<string, string>;
  windowState: string | null;
  initiatedBy: string | null;
  initiatedAt: string;
  confirmedAt: string | null;
  sentAt: string | null;
  messageId: string | null;
  deliveryStatus: string | null;
  responseStatus: RecoveryResponseStatus | null;
  repliedAt: string | null;
  outcome: RecoveryOutcome | null;
  outcomeAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  sendAttempts: number;
  source: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

/** Evento de auditoria/timeline já normalizado. */
export interface RecoveryAttemptEvent {
  id: string;
  attemptId: string | null;
  conversationId: string | null;
  eventType: RecoveryEventType;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Estados nos quais a tentativa ainda está sendo trabalhada. */
export const ACTIVE_STATUSES: RecoveryAttemptStatus[] = [
  "draft",
  "awaiting_confirmation",
  "confirmed",
  "sending",
];

/** Estados que significam "mensagem já saiu". */
export const DISPATCHED_STATUSES: RecoveryAttemptStatus[] = [
  "sent",
  "delivered",
  "read",
  "replied",
  "recovered",
  "not_recovered",
];

/** Limite defensivo do texto enviado numa recuperação. */
export const MAX_RECOVERY_MESSAGE_CHARS = 900;
