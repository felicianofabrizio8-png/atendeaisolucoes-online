// ============================================================================
// @deprecated — arquivo mantido como fachada de retrocompatibilidade.
// A implementação canônica vive em `src/lib/followup/`.
// Toda nova consumidora deve importar de `@/lib/followup`.
// Este arquivo NÃO deve receber novo código.
// Consolidado na Fase A do Plano Diretor da Arquitetura 2.0.
// ============================================================================

export {
  getFollowupV2Settings,
  humanizeTemplate,
  jitterDelayMs,
  computeLeadScore,
  getLeadTemperatureSummary,
  getWhatsappIntegrationStatus,
  canSendFollowupNow,
  getAdvancedAnalytics,
  runReactivation,
} from "@/lib/followup";

export type {
  LeadTemperature,
  WhatsappIntegrationStatus,
  FollowupV2Settings,
  SendGateResult,
  LeadScoreResult,
  AdvancedAnalytics,
  ReactivationResult,
} from "@/lib/followup";
