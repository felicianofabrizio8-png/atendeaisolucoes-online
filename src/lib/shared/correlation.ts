// ============================================================================
// Primitiva compartilhada — correlationId (Sprint 7 — Fase 7.2).
//
// Implementação única e byte-idêntica às três cópias anteriores em
// `runtime/HookSecurity.server.ts`, `render-engine/RenderApiAuth.server.ts`
// e `routes/api.runtime.autonomy.tsx`.
//
// Módulo puro e client-safe de propósito: é importado por route files que
// entram no grafo do cliente. Não importe nada server-only aqui.
// ============================================================================

/**
 * Identificador curto de correlação para logs estruturados.
 * Formato preservado: `<timestamp base36>-<8 chars aleatórios base36>`.
 */
export function correlationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
