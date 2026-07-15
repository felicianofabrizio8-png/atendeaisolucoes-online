// ============================================================================
// followup/index.ts
// Barrel oficial do módulo Follow-up (Arquitetura 2.0 — Fase A).
//
// TODO consumidor novo deve importar deste arquivo:
//   import { runFollowupTickForCompany, getFollowupSettings } from "@/lib/followup";
//
// Os arquivos legados `ai-followup.server.ts` e `ai-followup-v2.server.ts`
// permanecem apenas como fachadas de retrocompatibilidade e re-exportam
// destes módulos. Não adicione lógica neles.
// ============================================================================

// --- Configuração
export { getFollowupSettings, getFollowupV2Settings } from "./settings";

// --- Execução
export {
  runFollowupTickForCompany,
  runFollowupTickAll,
} from "./tick";
export { reconcileResponses } from "./reconcile";
export { runReactivation } from "./reactivation";
export { runManualFollowup, type ManualFollowupInput } from "./manual";

// --- Detecção
export { findCandidates } from "./candidates";

// --- Segurança e gates
export { canSendFollowupNow } from "./gates";

// --- Métricas e leitura
export { getWhatsappIntegrationStatus } from "./integration";
export {
  computeLeadScoreFromDb,
  getLeadTemperatureSummary,
} from "./scoring";
// @deprecated — use `computeLeadScoreFromDb`. Alias mantido temporariamente
// para preservar a fachada legada `ai-followup-v2.server.ts` e evitar colisão
// com `computeLeadScore` (síncrono, puro) de `@/lib/ai-qualifier.server`.
export { computeLeadScoreFromDb as computeLeadScore } from "./scoring";
export { getAdvancedAnalytics } from "./analytics";

// --- Utilidades puras
export { humanizeTemplate, jitterDelayMs } from "./humanizer";

// --- Tipos públicos
export type {
  FollowupRule,
  FollowupSettings,
  Candidate,
  TickResult,
  LeadTemperature,
  WhatsappIntegrationStatus,
  FollowupV2Settings,
  SendGateResult,
  LeadScoreResult,
  AdvancedAnalytics,
  ReactivationResult,
  ManualFollowupResult,
} from "./types";
