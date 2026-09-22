// Classificação de falhas do AI Gateway para o endpoint do Coach.
//
// Motivação (SPRINT 5 · FASE 5.2.2): a rota `/api/coach/suggest` colapsava
// QUALQUER resposta não-ok do provedor em `502 Falha na IA: <corpo bruto>`.
// Isso escondia a causa real (no ambiente de validação era
// `403 credit_limit_reached`) e ainda ecoava o corpo do provedor para o
// cliente. Aqui a classificação vira uma função pura, testável e sem I/O.

export type CoachErrorCode =
  | "rate_limited"
  | "provider_unauthorized"
  | "provider_invalid_response"
  | "missing_tool_call"
  | "invalid_tool_arguments"
  | "provider_unavailable"
  | "provider_timeout";

export interface CoachErrorContract {
  /** Status HTTP devolvido ao frontend. */
  status: number;
  /** Código estável para consumidores automatizados. */
  code: CoachErrorCode;
  /** Mensagem amigável em pt-BR — nunca contém corpo bruto do provedor. */
  error: string;
  /** Se o frontend deve oferecer "tentar novamente". */
  retryable: boolean;
}

export interface CoachOutput {
  situation: string;
  next_action: string;
  suggestion_text: string;
  reasoning: string;
  objection_type?: "price" | "timing" | "spouse" | "researching" | "discount" | "other" | "none" | null;
  urgency: "low" | "medium" | "high" | "critical";
  risk_score: number;
}

export interface CoachOutputMetadata {
  has_choices: boolean;
  choices_count: number;
  has_message: boolean;
  has_tool_calls: boolean;
  tool_calls_count: number;
  tool_call_type: string | null;
  function_name: string | null;
  has_function: boolean;
  has_arguments: boolean;
  arguments_type: string | null;
  arguments_length: number | null;
  reason?: "missing_tool_call" | "invalid_tool_arguments" | "invalid_contract";
}

export type CoachOutputParseResult =
  | { ok: true; output: CoachOutput; metadata: CoachOutputMetadata }
  | {
      ok: false;
      code: "missing_tool_call" | "invalid_tool_arguments";
      metadata: CoachOutputMetadata;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCoachOutput(value: unknown): value is CoachOutput {
  if (!isRecord(value)) return false;

  const validUrgencies = new Set(["low", "medium", "high", "critical"]);
  const validObjectionTypes = new Set([
    "price",
    "timing",
    "spouse",
    "researching",
    "discount",
    "other",
    "none",
  ]);

  return (
    typeof value.situation === "string" &&
    typeof value.next_action === "string" &&
    typeof value.suggestion_text === "string" &&
    typeof value.reasoning === "string" &&
    typeof value.urgency === "string" &&
    validUrgencies.has(value.urgency) &&
    typeof value.risk_score === "number" &&
    Number.isInteger(value.risk_score) &&
    value.risk_score >= 0 &&
    value.risk_score <= 100 &&
    (value.objection_type === undefined ||
      value.objection_type === null ||
      (typeof value.objection_type === "string" && validObjectionTypes.has(value.objection_type)))
  );
}

/**
 * Extrai e valida a tool call sem lançar exceção nem devolver conteúdo do
 * modelo no diagnóstico. O resultado contém apenas metadados seguros.
 */
export function parseCoachProviderOutput(payload: unknown): CoachOutputParseResult {
  const choices = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices : [];
  const message =
    isRecord(choices[0]) && isRecord(choices[0].message) ? choices[0].message : null;
  const toolCalls = message && Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCall = isRecord(toolCalls[0]) ? toolCalls[0] : null;
  const fn = toolCall && isRecord(toolCall.function) ? toolCall.function : null;
  const argumentsValue = fn?.arguments;

  const metadata: CoachOutputMetadata = {
    has_choices: choices.length > 0,
    choices_count: choices.length,
    has_message: message !== null,
    has_tool_calls: toolCalls.length > 0,
    tool_calls_count: toolCalls.length,
    tool_call_type: typeof toolCall?.type === "string" ? toolCall.type : null,
    function_name: typeof fn?.name === "string" ? fn.name : null,
    has_function: fn !== null,
    has_arguments: typeof argumentsValue === "string" && argumentsValue.length > 0,
    arguments_type: argumentsValue === undefined ? null : typeof argumentsValue,
    arguments_length: typeof argumentsValue === "string" ? argumentsValue.length : null,
  };

  if (!toolCall) {
    return {
      ok: false,
      code: "missing_tool_call",
      metadata: { ...metadata, reason: "missing_tool_call" },
    };
  }

  if (!fn || typeof argumentsValue !== "string" || argumentsValue.length === 0) {
    return {
      ok: false,
      code: "invalid_tool_arguments",
      metadata: { ...metadata, reason: "invalid_tool_arguments" },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsValue);
  } catch {
    return {
      ok: false,
      code: "invalid_tool_arguments",
      metadata: { ...metadata, reason: "invalid_tool_arguments" },
    };
  }

  if (!isCoachOutput(parsed)) {
    return {
      ok: false,
      code: "invalid_tool_arguments",
      metadata: { ...metadata, reason: "invalid_contract" },
    };
  }

  return { ok: true, output: parsed, metadata };
}

/**
 * Trecho sanitizado do corpo do provedor, apenas para log do servidor.
 * Remove chaves/tokens óbvios e limita o tamanho. Nunca vai para a resposta.
 */
export function sanitizeProviderBody(body: string, max = 300): string {
  return body
    .replace(/(sk-|Bearer\s+)[A-Za-z0-9._-]+/g, "$1[REDACTED]")
    .replace(/"(api_?key|authorization|token)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED]"')
    .slice(0, max);
}

/**
 * Traduz `status` HTTP + corpo do provedor no contrato de erro do Coach.
 *
 * Regras:
 *  · 429                        → 429 rate_limited (retentável)
 *  · 401/402/403                → 503 provider_unauthorized (configuração)
 *  · 408/504                    → 504 provider_timeout
 *  · 5xx                        → 503 provider_unavailable (retentável)
 *  · demais 4xx                 → 502 provider_invalid_response
 */
export function classifyGatewayFailure(status: number, _body = ""): CoachErrorContract {
  if (status === 429) {
    return {
      status: 429,
      code: "rate_limited",
      error: "Limite de uso da IA atingido. Tente novamente em alguns minutos.",
      retryable: true,
    };
  }

  if (status === 401 || status === 402 || status === 403) {
    return {
      status: 503,
      code: "provider_unauthorized",
      error: "O serviço de IA recusou a credencial do sistema. Avise o administrador.",
      retryable: false,
    };
  }

  if (status === 408 || status === 504) {
    return {
      status: 504,
      code: "provider_timeout",
      error: "A IA demorou demais para responder. Tente novamente.",
      retryable: true,
    };
  }

  if (status >= 500) {
    return {
      status: 503,
      code: "provider_unavailable",
      error: "O serviço de IA está temporariamente indisponível. Tente novamente em instantes.",
      retryable: true,
    };
  }

  return {
    status: 502,
    code: "provider_invalid_response",
    error: "A IA devolveu uma resposta inválida. Tente novamente.",
    retryable: true,
  };
}

/** Timeout local (a requisição foi abortada antes de qualquer resposta). */
export const COACH_TIMEOUT_CONTRACT: CoachErrorContract = {
  status: 504,
  code: "provider_timeout",
  error: "A IA demorou demais para responder. Tente novamente.",
  retryable: true,
};

/** Resposta chegou, mas sem tool call ou com JSON inválido. */
export const COACH_INVALID_OUTPUT_CONTRACT: CoachErrorContract = {
  status: 502,
  code: "provider_invalid_response",
  error: "A IA devolveu uma resposta inválida. Tente novamente.",
  retryable: true,
};

export function createCoachInvalidOutputContract(
  code: "missing_tool_call" | "invalid_tool_arguments",
): CoachErrorContract {
  return { ...COACH_INVALID_OUTPUT_CONTRACT, code };
}

/** Timeout aplicado à chamada do provedor, em ms. */
export const COACH_PROVIDER_TIMEOUT_MS = 45_000;
