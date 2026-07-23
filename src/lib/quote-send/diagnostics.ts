// Diagnóstico controlado do envio de orçamento.
// - qsCode(attemptId): referência curta e amigável exibida ao usuário.
// - qsDebug(event, data): só imprime quando VITE_QUOTE_SEND_DIAGNOSTICS === "true".
// - qsError(event, data): sempre imprime (para investigação em produção).

const FLAG_ENV = "VITE_QUOTE_SEND_DIAGNOSTICS";

function readFlagOnce(): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    if (env && env[FLAG_ENV] === "true") return true;
  } catch {
    /* SSR/Deno */
  }
  if (typeof globalThis !== "undefined") {
    const g = globalThis as { __QUOTE_SEND_DIAGNOSTICS__?: boolean };
    if (g.__QUOTE_SEND_DIAGNOSTICS__ === true) return true;
  }
  return false;
}

let cached: boolean | null = null;
export function isDiagnosticsEnabled(): boolean {
  if (cached === null) cached = readFlagOnce();
  return cached;
}

/** Test helper: reseta o cache da flag para permitir toggling em testes. */
export function __resetDiagnosticsCacheForTest() {
  cached = null;
}

/**
 * Gera um código curto e amigável a partir do attemptId.
 * `qs_mrxo471o_776c5e77` -> `QS-776C5E77`
 */
export function qsCode(attemptId: string | undefined | null): string {
  if (!attemptId) return "QS-UNKNOWN";
  const parts = attemptId.split("_");
  const tail = parts[parts.length - 1] || attemptId;
  const clean = tail.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();
  return `QS-${clean || "UNKNOWN"}`;
}

export function qsDebug(event: string, data?: Record<string, unknown>) {
  if (!isDiagnosticsEnabled()) return;
  if (data) console.log(event, data);
  else console.log(event);
}

export function qsError(event: string, data?: Record<string, unknown>) {
  if (data) console.error(event, data);
  else console.error(event);
}
