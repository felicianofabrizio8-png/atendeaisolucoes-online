// ============================================================================
// BLOCO 1 — Contrato de erros do módulo "Ensinar IA" (Coach Learnings).
// Client-safe. Nunca importa nada server-only.
//
// Regras:
//  - UI JAMAIS renderiza `String(err)` ou `.toString()`. Consome apenas
//    `SafeLearningError` retornado por `getSafeLearningError`.
//  - Códigos estáveis são casados por igualdade ou substring do `.message`.
//  - Detalhes técnicos são registrados apenas em `console.error`; a mensagem
//    exibida ao usuário vem exclusivamente de `FRIENDLY_MESSAGES`.
// ============================================================================

export const COACH_LEARNING_ERROR_CODES = [
  "network",
  "unauthorized",
  "no_company",
  "duplicate",
  "not_found",
  "input_invalid",
  "invalid_source_conversation",
  "extract_failed",
  "save_failed",
  "server_error",
  "internal",
] as const;

export type CoachLearningErrorCode = (typeof COACH_LEARNING_ERROR_CODES)[number];

export interface SafeLearningError {
  code: CoachLearningErrorCode;
  /** Mensagem curta e amigável (pt-BR). Segura para renderizar. */
  message: string;
  /** Sugestão de próximo passo (pt-BR). */
  hint?: string;
  /** true → é seguro oferecer botão "Tentar novamente". */
  retryable: boolean;
}

const FRIENDLY: Record<CoachLearningErrorCode, { message: string; hint?: string; retryable: boolean }> = {
  network: {
    message: "Não foi possível salvar o aprendizado.",
    hint: "Verifique sua conexão e tente novamente.",
    retryable: true,
  },
  unauthorized: {
    message: "Você não tem permissão para salvar este aprendizado.",
    hint: "Entre novamente ou peça a um administrador.",
    retryable: false,
  },
  no_company: {
    message: "Sua conta não está vinculada a uma empresa.",
    hint: "Peça a um administrador para associar seu usuário.",
    retryable: false,
  },
  duplicate: {
    message: "Este aprendizado já existe.",
    hint: "Abra o aprendizado existente para atualizá-lo.",
    retryable: false,
  },
  not_found: {
    message: "Aprendizado não encontrado.",
    retryable: false,
  },
  input_invalid: {
    message: "Alguns campos do aprendizado estão incompletos ou inválidos.",
    hint: "Revise os campos destacados antes de salvar.",
    retryable: false,
  },
  extract_failed: {
    message: "A IA não conseguiu estruturar o aprendizado.",
    hint: "Explique com mais detalhes: quando aplicar, o que fazer e o que evitar.",
    retryable: true,
  },
  save_failed: {
    message: "Não foi possível salvar o aprendizado.",
    hint: "Tente novamente em instantes.",
    retryable: true,
  },
  server_error: {
    message: "Erro interno do servidor.",
    hint: "Tente novamente em instantes.",
    retryable: true,
  },
  internal: {
    message: "Ocorreu um erro inesperado.",
    hint: "Tente novamente.",
    retryable: true,
  },
};

function rawMessage(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message ?? "";
  if (typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

/** Normaliza qualquer erro em SafeLearningError. Nunca vaza stack. */
export function getSafeLearningError(err: unknown): SafeLearningError {
  const raw = rawMessage(err).toLowerCase();

  const match = ((): CoachLearningErrorCode => {
    // Postgres / PostgREST codes.
    if (raw.includes("23505") || raw.includes("duplicate key")) return "duplicate";
    if (raw.includes("42501") || raw.includes("pgrst301") || raw.includes("permission denied") || raw.includes("row-level security")) return "unauthorized";
    if (raw.includes("no_company")) return "no_company";
    if (raw.includes("not_found") || raw.includes("pgrst116")) return "not_found";
    if (raw.includes("failed to fetch") || raw.includes("network") || raw.includes("networkerror") || raw.includes("load failed")) return "network";
    if (raw.includes("teach_mode_schema_invalid") || raw.includes("input_invalid") || raw.includes("zoderror") || raw.includes("invalid_type")) return "input_invalid";
    if (raw.includes("extract_failed")) return "extract_failed";
    if (raw.includes("save_failed") || raw.includes("coach_learnings_")) return "save_failed";
    if (raw.includes("500") || raw.includes("internal server error")) return "server_error";
    // Exact catálogo.
    for (const code of COACH_LEARNING_ERROR_CODES) {
      if (raw === code) return code;
    }
    return "internal";
  })();

  return { code: match, ...FRIENDLY[match] };
}

// ---------------------------------------------------------------------------
// Validação de rascunho por campo — feedback inline.
// ---------------------------------------------------------------------------
export interface DraftValidationErrors {
  title?: string;
  description?: string;
  rule_structured?: string;
  category?: string;
  priority?: string;
}

export function validateLearningDraft(input: {
  title: string;
  description: string;
  rule_structured: string;
  category: string;
  priority: number;
  allowedCategories: readonly string[];
}): DraftValidationErrors {
  const errors: DraftValidationErrors = {};
  const title = input.title.trim();
  if (title.length < 3) errors.title = "Informe um título com ao menos 3 caracteres.";
  else if (title.length > 120) errors.title = "O título deve ter no máximo 120 caracteres.";

  const description = input.description.trim();
  if (description.length < 3) errors.description = "Descreva quando e como aplicar este aprendizado.";
  else if (description.length > 2000) errors.description = "A descrição deve ter no máximo 2000 caracteres.";

  const rule = input.rule_structured.trim();
  if (rule.length < 3) errors.rule_structured = "Descreva a regra que a IA deve seguir.";
  else if (rule.length > 2000) errors.rule_structured = "A regra deve ter no máximo 2000 caracteres.";

  if (!input.allowedCategories.includes(input.category)) {
    errors.category = "Selecione uma categoria válida.";
  }

  if (!Number.isFinite(input.priority) || input.priority < 0 || input.priority > 100) {
    errors.priority = "A prioridade deve estar entre 0 e 100.";
  }

  return errors;
}

export function hasValidationErrors(errors: DraftValidationErrors): boolean {
  return Object.values(errors).some((v) => typeof v === "string" && v.length > 0);
}
