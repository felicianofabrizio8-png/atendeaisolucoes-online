// ============================================================================
// Contrato de erros do módulo "Ensinar IA" (Coach Learnings).
// Client-safe. Nunca importa nada server-only.
//
// Regras:
//  - UI JAMAIS renderiza `String(err)` ou `.toString()`. Consome apenas
//    `SafeLearningError` retornado por `getSafeLearningError`.
//  - Códigos estáveis são casados por igualdade OU substring do `.message`.
//  - Aceita também respostas estáveis do server: `{ok:false, code, message?, field?, retryable?}`.
//  - Detalhes técnicos são registrados apenas server-side; a mensagem
//    exibida ao usuário vem exclusivamente de `FRIENDLY`.
// ============================================================================

export const COACH_LEARNING_ERROR_CODES = [
  // rede / infra
  "network",
  "timeout",
  // permissão
  "unauthorized",
  "permission_denied",
  // domínio (RAISE da RPC)
  "no_company",
  "coach_learning_no_company",
  "coach_learning_invalid_title",
  "coach_learning_invalid_rule",
  "coach_learning_invalid_origin",
  "learning_duplicate_conflict",
  "duplicate",
  "invalid_source_conversation",
  "not_found",
  "input_invalid",
  "extract_failed",
  // constraints Postgres
  "foreign_key_violation",
  "check_violation",
  "unique_violation",
  // genéricos
  "save_failed",
  "server_error",
  "internal",
] as const;

export type CoachLearningErrorCode = (typeof COACH_LEARNING_ERROR_CODES)[number];

/** Campo do rascunho relacionado ao erro — usado para destaque visual. */
export type CoachLearningErrorField =
  | "title"
  | "description"
  | "rule_structured"
  | "category"
  | "priority"
  | "origin"
  | null;

export interface SafeLearningError {
  code: CoachLearningErrorCode;
  /** Mensagem curta e amigável (pt-BR). Segura para renderizar. */
  message: string;
  /** Sugestão de próximo passo (pt-BR). */
  hint?: string;
  /** Campo do rascunho relacionado, quando aplicável. */
  field?: CoachLearningErrorField;
  /** true → é seguro oferecer botão "Tentar novamente". */
  retryable: boolean;
}

type FriendlyEntry = {
  message: string;
  hint?: string;
  field?: CoachLearningErrorField;
  retryable: boolean;
};

const FRIENDLY: Record<CoachLearningErrorCode, FriendlyEntry> = {
  network: {
    message: "Falha de conexão. Verifique a internet e tente novamente.",
    hint: "Verifique sua conexão e tente novamente.",
    retryable: true,
  },

  timeout: {
    message: "A operação demorou demais para responder.",
    hint: "Tente novamente em instantes.",
    retryable: true,
  },
  unauthorized: {
    message: "Você não tem permissão para salvar este aprendizado.",
    hint: "Entre novamente ou peça a um administrador.",
    retryable: false,
  },
  permission_denied: {
    message: "Você não tem permissão para salvar este aprendizado.",
    hint: "Entre novamente ou peça a um administrador.",
    retryable: false,
  },
  no_company: {
    message: "Sua conta não está vinculada a uma empresa.",
    hint: "Peça a um administrador para associar seu usuário.",
    retryable: false,
  },
  coach_learning_no_company: {
    message: "Sua conta não está vinculada a uma empresa.",
    hint: "Peça a um administrador para associar seu usuário.",
    retryable: false,
  },
  coach_learning_invalid_title: {
    message: "Revise o título do aprendizado.",
    hint: "Use um título curto e específico.",
    field: "title",
    retryable: false,
  },
  coach_learning_invalid_rule: {
    message: "A regra estruturada está incompleta ou inválida.",
    hint: "Descreva quando aplicar, o que fazer e o que evitar.",
    field: "rule_structured",
    retryable: false,
  },
  coach_learning_invalid_origin: {
    message: "Não foi possível identificar a origem deste aprendizado.",
    hint: "Reabra o Ensinar IA a partir de uma conversa ou sugestão.",
    field: "origin",
    retryable: false,
  },
  learning_duplicate_conflict: {
    message: "Já existe um aprendizado muito parecido.",
    hint: "Abra o existente para revisar ou atualizar.",
    field: "title",
    retryable: false,
  },
  duplicate: {
    message: "Este aprendizado já existe.",
    hint: "Abra o aprendizado existente para atualizá-lo.",
    field: "title",
    retryable: false,
  },
  invalid_source_conversation: {
    message: "A conversa de origem não foi encontrada ou não pertence à sua empresa.",
    hint: "O aprendizado será salvo sem vínculo. Tente novamente.",
    retryable: true,
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
  foreign_key_violation: {
    message: "Um dos vínculos deste aprendizado não é válido.",
    hint: "Recarregue a página e tente novamente.",
    retryable: true,
  },
  check_violation: {
    message: "Um dos campos está fora do formato esperado.",
    hint: "Revise categoria, prioridade e origem.",
    retryable: false,
  },
  unique_violation: {
    message: "Este aprendizado já existe.",
    hint: "Abra o aprendizado existente para atualizá-lo.",
    field: "title",
    retryable: false,
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
    message: "Ocorreu um erro inesperado ao salvar o aprendizado. O erro foi registrado para análise.",
    hint: "Tente novamente. Se persistir, contate o suporte.",
    retryable: true,
  },

};

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function rawMessage(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message ?? "";
  if (isRecord(err) && typeof err.message === "string") return err.message;
  return "";
}

function extractCodeField(err: unknown): string | null {
  if (!isRecord(err)) return null;
  const c = err.code;
  return typeof c === "string" && c.length > 0 ? c : null;
}

/** Casa código exato (case-sensitive) contra o catálogo. */
function matchExactCode(candidate: string | null): CoachLearningErrorCode | null {
  if (!candidate) return null;
  return (COACH_LEARNING_ERROR_CODES as readonly string[]).includes(candidate)
    ? (candidate as CoachLearningErrorCode)
    : null;
}

/** Casa por substring no `raw.toLowerCase()`. Fallback para erros técnicos. */
function matchBySubstring(raw: string): CoachLearningErrorCode | null {
  // Domínio explícito primeiro — não deixe uma substring genérica capturar.
  if (raw.includes("coach_learning_no_company")) return "coach_learning_no_company";
  if (raw.includes("coach_learning_invalid_title")) return "coach_learning_invalid_title";
  if (raw.includes("coach_learning_invalid_rule")) return "coach_learning_invalid_rule";
  if (raw.includes("coach_learning_invalid_origin")) return "coach_learning_invalid_origin";
  if (raw.includes("learning_duplicate_conflict")) return "learning_duplicate_conflict";
  if (raw.includes("no_company")) return "no_company";
  if (raw.includes("invalid_source_conversation") || raw.includes("coach_learnings_source_conversation_id_fkey")) {
    return "invalid_source_conversation";
  }
  // SQLSTATE.
  if (raw.includes("23505") || raw.includes("duplicate key")) return "duplicate";
  if (raw.includes("23503") || raw.includes("foreign key")) return "foreign_key_violation";
  if (raw.includes("23514") || raw.includes("check constraint")) return "check_violation";
  if (
    raw.includes("42501") ||
    raw.includes("pgrst301") ||
    raw.includes("permission denied") ||
    raw.includes("row-level security")
  ) {
    return "unauthorized";
  }

  if (raw.includes("not_found") || raw.includes("pgrst116")) return "not_found";
  if (
    raw.includes("failed to fetch") ||
    raw.includes("networkerror") ||
    raw.includes("load failed") ||
    raw === "network" ||
    raw.startsWith("network ") ||
    raw.includes(" network ")
  ) {
    return "network";
  }
  if (raw.includes("timeout") || raw.includes("timed out")) return "timeout";
  if (raw.includes("teach_mode_schema_invalid") || raw.includes("input_invalid") || raw.includes("zoderror") || raw.includes("invalid_type")) {
    return "input_invalid";
  }
  if (raw.includes("extract_failed")) return "extract_failed";
  if (raw.includes("500") || raw.includes("internal server error")) return "server_error";
  // Fallback final de compatibilidade — não usar como primeira escolha.
  if (raw === "save_failed") return "save_failed";
  if (raw.includes("coach_learnings_")) return "save_failed";
  return null;
}

/**
 * Normaliza qualquer erro (Error | string | PostgrestError | resposta serverFn)
 * em `SafeLearningError`. Aceita também `{ok:false, code, ...}` — a forma
 * estável retornada por `createCoachLearningFn`.
 */
export function getSafeLearningError(err: unknown): SafeLearningError {
  // Resposta estável do server: { ok:false, code, message?, field?, retryable? }
  if (isRecord(err) && err.ok === false && typeof err.code === "string") {
    const code = matchExactCode(err.code) ?? "internal";
    const base = FRIENDLY[code];
    const field =
      (err.field as CoachLearningErrorField | undefined) ?? base.field ?? null;
    const retryable = typeof err.retryable === "boolean" ? err.retryable : base.retryable;
    const message = typeof err.message === "string" && err.message.trim().length > 0 && sanitizedForUser(err.message)
      ? err.message
      : base.message;
    return { code, message, hint: base.hint, field, retryable };
  }

  // Casamento por code explícito primeiro (mais confiável).
  const codeField = extractCodeField(err);
  const exact = matchExactCode(codeField ?? null);
  if (exact) {
    const base = FRIENDLY[exact];
    return { code: exact, ...base };
  }

  // Se o `code` do PostgrestError é um SQLSTATE numérico (23505, 42501, ...),
  // ele não está no catálogo — trate-o via substring, concatenando ao raw.
  const rawOriginal = rawMessage(err);
  const withPgCode = codeField ? `${codeField} ${rawOriginal}` : rawOriginal;
  const raw = withPgCode.toLowerCase();

  const exactByMessage = matchExactCode(rawOriginal);
  if (exactByMessage) {
    const base = FRIENDLY[exactByMessage];
    return { code: exactByMessage, ...base };
  }



  const bySub = matchBySubstring(raw);
  const code: CoachLearningErrorCode = bySub ?? "internal";
  const base = FRIENDLY[code];
  return { code, ...base };
}

/**
 * Só permite mensagem vinda do servidor se claramente livre de artefatos
 * técnicos (JSON, stack trace, códigos crus). Caso contrário, ignora.
 */
function sanitizedForUser(msg: string): boolean {
  if (msg.length > 240) return false;
  if (/[{}\[\]]/.test(msg)) return false;
  if (/\bat\s+\w+\s*\(/.test(msg)) return false;
  if (/\b(pgrst|sqlstate|23\d{3}|42\d{3})\b/i.test(msg)) return false;
  if (msg.includes("coach_learnings_") || msg.startsWith("coach_learning_")) return false;
  return true;
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
