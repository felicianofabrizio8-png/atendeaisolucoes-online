// ============================================================================
// @deprecated — arquivo mantido como fachada de retrocompatibilidade.
// A implementação canônica vive em `src/lib/followup/`.
// Toda nova consumidora deve importar de `@/lib/followup`.
// Este arquivo NÃO deve receber novo código.
// Consolidado na Fase A do Plano Diretor da Arquitetura 2.0.
// ============================================================================

export {
  getFollowupSettings,
  runFollowupTickForCompany,
  runFollowupTickAll,
  reconcileResponses,
  findCandidates,
} from "@/lib/followup";

export type {
  FollowupRule,
  FollowupSettings,
  TickResult,
  Candidate,
} from "@/lib/followup";
