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

/** Timeout aplicado à chamada do provedor, em ms. */
export const COACH_PROVIDER_TIMEOUT_MS = 45_000;
