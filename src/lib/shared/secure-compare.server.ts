// ============================================================================
// Primitiva compartilhada — comparação timing-safe de secrets
// (Sprint 7 — Fase 7.2).
//
// Implementação única e byte-idêntica às duas cópias anteriores em
// `runtime/HookSecurity.server.ts` e `render-engine/RenderApiAuth.server.ts`.
// A única diferença entre as cópias era o specifier do import
// (`crypto` vs `node:crypto`) — o mesmo módulo do runtime.
//
// Sufixo `.server` porque depende de `node:crypto` e `Buffer`: nunca deve
// entrar no bundle do cliente.
// ============================================================================

import { timingSafeEqual } from "node:crypto";

/**
 * Compara dois secrets em tempo constante.
 * Comportamento preservado: retorna `false` para valores vazios, para
 * comprimentos distintos e para qualquer exceção do runtime.
 */
export function safeEqualSecret(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
