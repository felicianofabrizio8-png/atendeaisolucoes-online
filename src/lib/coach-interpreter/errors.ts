// ============================================================================
// FASE 3.1a — Contrato estruturado de erros do Coach Interpreter.
//
// Client-safe. Nenhum import server-only.
//
// Objetivos:
//  1. Padronizar o "shape" que UI e testes consomem quando uma server function
//     falha: sempre { code, message, disabled, killed, notFound, unauthorized }.
//  2. Evitar `String(err)` / `err.toString()` na UI (fugas de stack).
//  3. Traduzir códigos estáveis (COACH_INTERPRETER_DISABLED, cross_tenant, ...)
//     em mensagens amigáveis em pt-BR.
//
// A regra é: o servidor lança Error cujo `.message` é um código estável
// (ex.: "COACH_INTERPRETER_DISABLED", "cross_tenant", "internal"). A UI passa
// esse erro por `getSafeInterpreterError` e usa o objeto retornado.
// ============================================================================

/** Códigos estáveis expostos ao cliente. Nunca inclui detalhes de banco. */
export const COACH_INTERPRETER_ERROR_CODES = [
  "COACH_INTERPRETER_DISABLED",
  "COACH_INTERPRETER_KILLED",
  "unauthorized",
  "cross_tenant",
  "no_company",
  "not_found",
  "duplicate_request",
  "input_invalid",
  "internal",
] as const;

export type CoachInterpreterErrorCode = (typeof COACH_INTERPRETER_ERROR_CODES)[number];

export interface SafeInterpreterError {
  /** Código estável — sempre um item do catálogo, com fallback "internal". */
  code: CoachInterpreterErrorCode;
  /** Mensagem amigável em pt-BR, segura para renderizar em qualquer lugar. */
  message: string;
  /** true quando a feature flag da empresa está desligada. */
  disabled: boolean;
  /** true quando o kill-switch global está ativo. */
  killed: boolean;
  /** true quando o backend respondeu 404/not_found. */
  notFound: boolean;
  /** true para 401/403 (não autenticado ou fora do tenant). */
  unauthorized: boolean;
}

const FRIENDLY_MESSAGES: Record<CoachInterpreterErrorCode, string> = {
  COACH_INTERPRETER_DISABLED: "Feature flag desligada para esta empresa.",
  COACH_INTERPRETER_KILLED: "Kill-switch ativo (COACH_INTERPRETER_KILLSWITCH=true).",
  unauthorized: "Sessão inválida ou sem permissão para esta operação.",
  cross_tenant: "Operação bloqueada: recurso pertence a outra empresa.",
  no_company: "Usuário sem empresa vinculada.",
  not_found: "Registro não encontrado.",
  duplicate_request: "Requisição duplicada — já em processamento.",
  input_invalid: "Entrada inválida para o Coach Interpreter.",
  internal: "Erro interno ao contatar o Coach Interpreter.",
};

/**
 * Extrai a string bruta de qualquer valor lançável sem chamar .toString()
 * (que pode expor pilha ou objetos complexos).
 */
function extractRawMessage(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message ?? "";
  if (typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

/**
 * Normaliza um erro qualquer para o contrato SafeInterpreterError.
 * NUNCA joga o `err` bruto em templates. Use apenas os campos retornados.
 */
export function getSafeInterpreterError(err: unknown): SafeInterpreterError {
  const raw = extractRawMessage(err);

  // Match por código estável (case-sensitive; codes são convenção do servidor).
  const matched: CoachInterpreterErrorCode | null = (() => {
    for (const code of COACH_INTERPRETER_ERROR_CODES) {
      if (raw === code || raw.includes(code)) return code;
    }
    return null;
  })();

  const code: CoachInterpreterErrorCode = matched ?? "internal";
  return {
    code,
    message: FRIENDLY_MESSAGES[code],
    disabled: code === "COACH_INTERPRETER_DISABLED",
    killed: code === "COACH_INTERPRETER_KILLED",
    notFound: code === "not_found",
    unauthorized: code === "unauthorized" || code === "cross_tenant" || code === "no_company",
  };
}

/**
 * Helper para o servidor: aceita qualquer erro capturado e devolve um Error
 * cuja `.message` é um dos códigos estáveis. Mantém InterpreterError com o
 * código original; para o restante, colapsa em "internal" (sem stack ou
 * mensagem bruta do Postgres).
 */
export function toSafeInterpreterErrorMessage(err: unknown): CoachInterpreterErrorCode {
  const raw = extractRawMessage(err);
  for (const code of COACH_INTERPRETER_ERROR_CODES) {
    if (raw === code) return code;
  }
  // Códigos legados também aceitos (o servidor usa alguns literais curtos).
  if (raw === "not_found") return "not_found";
  if (raw === "cross_tenant") return "cross_tenant";
  if (raw === "no_company") return "no_company";
  return "internal";
}
