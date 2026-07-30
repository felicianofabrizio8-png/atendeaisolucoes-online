// ============================================================================
// Classificação de falhas da IA de marketing.
//
// Objetivo: nunca bloquear o usuário. Quando a IA está indisponível
// (401/403/429/5xx/timeout/rede), o app deve oferecer o Modo Manual em vez
// de exibir um erro genérico.
// ============================================================================

export type AiFailureKind =
  | "unauthorized" // 401
  | "forbidden" // 403 (inclui créditos bloqueados)
  | "no_credits" // 402
  | "rate_limited" // 429
  | "server_error" // 5xx
  | "timeout"
  | "network"
  | "unknown";

const PATTERNS: Array<{ kind: AiFailureKind; re: RegExp }> = [
  { kind: "unauthorized", re: /\b401\b|unauthorized|invalid[_ ]api[_ ]key/i },
  { kind: "no_credits", re: /\b402\b|payment required|credit(s)?[_ ]?(exhaust|deplet)/i },
  {
    kind: "forbidden",
    re: /\b403\b|forbidden|credit_hard_block|hard[_ ]block|sem cr[eé]ditos/i,
  },
  { kind: "rate_limited", re: /\b429\b|rate[_ ]?limit|too many requests/i },
  { kind: "timeout", re: /timeout|timed out|abort(ed)?|deadline/i },
  {
    kind: "network",
    re: /network|failed to fetch|fetch failed|econnreset|enotfound|socket hang up|dns/i,
  },
  { kind: "server_error", re: /\b5\d{2}\b|internal server error|bad gateway|unavailable/i },
];

function messageOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function classifyAiFailure(error: unknown): AiFailureKind {
  const msg = messageOf(error);
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") {
    if (status === 401) return "unauthorized";
    if (status === 402) return "no_credits";
    if (status === 403) return "forbidden";
    if (status === 429) return "rate_limited";
    if (status >= 500) return "server_error";
  }
  for (const p of PATTERNS) {
    if (p.re.test(msg)) return p.kind;
  }
  return "unknown";
}

/**
 * A IA está indisponível? Retorna `true` para todas as falhas conhecidas de
 * disponibilidade — e também para `unknown`, porque o usuário nunca deve
 * ficar preso: sempre oferecemos o caminho manual.
 */
export function isAiUnavailable(error: unknown): boolean {
  return classifyAiFailure(error) !== ("never" as AiFailureKind);
}

export function aiFailureMessage(kind: AiFailureKind): string {
  switch (kind) {
    case "unauthorized":
      return "A IA não está autorizada no momento.";
    case "forbidden":
    case "no_credits":
      return "A IA está indisponível (créditos esgotados ou bloqueados).";
    case "rate_limited":
      return "A IA atingiu o limite de uso temporariamente.";
    case "server_error":
      return "A IA está instável no momento.";
    case "timeout":
      return "A IA demorou demais para responder.";
    case "network":
      return "Não foi possível falar com a IA (problema de conexão).";
    default:
      return "A IA está indisponível no momento.";
  }
}
