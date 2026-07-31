// Barrel público da execução assistida da recuperação (Fase 6.3).
// Somente módulos PUROS — nada que importe Supabase entra aqui.

export * from "./types";
export {
  canTransition,
  assertTransition,
  isActiveStatus,
  isDispatchedStatus,
  isTerminalStatus,
  STATUS_LABEL,
} from "./states";
export {
  buildIdempotencyKey,
  nextIdempotencyKey,
  draftIdempotencyKey,
} from "./idempotency";
export {
  validateTemplateSelection,
  previewTemplateBody,
  extractPlaceholders,
  type TemplateCandidate,
  type TemplateValidation,
} from "./template";
export {
  RECOVERY_COOLDOWN_MS,
  queueAttemptView,
  canStartNewAttempt,
  type QueueAttemptState,
  type QueueAttemptView,
} from "./cooldown";
export { buildAttemptMetrics, type RecoveryAttemptMetrics } from "./metrics";
export { buildTimeline, describeEvent, type TimelineEntry } from "./timeline";
export { maskRecipient } from "./mask";
