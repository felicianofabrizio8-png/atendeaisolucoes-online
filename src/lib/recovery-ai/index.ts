// Ponto de entrada do Recovery AI Assistant (Sprint 6 · Fase 6.2).
// Consome a saída da Fase 6.1 sem alterá-la.

export * from "./types";
export { redactSensitive, neutralizeInjection, sanitizeForPrompt, sanitizeForLog } from "./redact";
export { buildSafeSummary, lastSpeakerOf } from "./summary";
export { buildRecoveryContext, windowLabel } from "./context";
export { buildSystemPrompt, buildUserPrompt, RECOVERY_PLAN_TOOL, RECOVERY_ASSIST_MODEL } from "./prompt";
export { parseRecoveryPlan, asHypothesis, type ParseResult } from "./parser";
export {
  RecoveryPlanCache,
  recoveryPlanCache,
  assistFingerprint,
  cacheKey,
  RECOVERY_CACHE_TTL_MS,
  type CachedPlan,
} from "./cache";
