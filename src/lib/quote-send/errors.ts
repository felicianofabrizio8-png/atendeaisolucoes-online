// Normalização de erros e mensagens amigáveis do envio de orçamento via WhatsApp.
// FASE A — Instrumentação. Não altera regras de negócio.

export type QuoteSendStep =
  | "click"
  | "prepare"
  | "session"
  | "invoke"
  | "function_response"
  | "mark_sent"
  | "unknown";

export type QuoteSendErrorCode =
  | "unauthorized"
  | "session_expired"
  | "company_not_found"
  | "whatsapp_not_connected"
  | "invalid_phone"
  | "invalid_payload"
  | "text_too_long"
  | "media_url_invalid"
  | "media_not_accessible"
  | "media_sign_failed"
  | "graph_api_rejected"
  | "graph_rate_limited"
  | "outside_24h_window"
  | "message_persistence_failed"
  | "conversation_creation_failed"
  | "lead_creation_failed"
  | "lead_not_found"
  | "network_error"
  | "mark_sent_failed"
  | "internal_error"
  | "unknown";

export interface NormalizedQuoteSendError {
  code: QuoteSendErrorCode;
  message: string;
  step: QuoteSendStep;
  status: number | null;
  retryable: boolean;
  technicalDetails: Record<string, unknown>;
}

const FRIENDLY_BY_CODE: Record<QuoteSendErrorCode, string> = {
  unauthorized: "Não foi possível autenticar sua sessão.",
  session_expired: "Sua sessão expirou. Faça login novamente.",
  company_not_found: "Empresa não encontrada para este usuário.",
  whatsapp_not_connected: "O WhatsApp da empresa não está conectado.",
  invalid_phone: "Número de telefone inválido.",
  invalid_payload: "Dados do envio inválidos.",
  text_too_long: "O texto ultrapassa o limite permitido pelo WhatsApp.",
  media_url_invalid: "Uma das imagens do orçamento tem endereço inválido.",
  media_not_accessible: "Uma das imagens do orçamento não pôde ser acessada.",
  media_sign_failed: "Falha ao preparar imagem para envio.",
  graph_api_rejected: "O WhatsApp recusou o envio da mensagem.",
  graph_rate_limited: "Limite de envios do WhatsApp atingido. Tente novamente em instantes.",
  outside_24h_window:
    "Cliente fora da janela de 24h do WhatsApp. Use um template aprovado.",
  message_persistence_failed: "Envio concluído, mas não foi possível registrar a mensagem.",
  conversation_creation_failed: "Não foi possível abrir a conversa.",
  lead_creation_failed: "Não foi possível criar o contato.",
  lead_not_found: "Contato não encontrado.",
  network_error: "Falha de rede ao contatar o servidor.",
  mark_sent_failed: "Não foi possível marcar o orçamento como enviado.",
  internal_error: "Erro interno inesperado no envio.",
  unknown: "Falha ao enviar pelo WhatsApp.",
};

const RETRYABLE_CODES = new Set<QuoteSendErrorCode>([
  "network_error",
  "graph_rate_limited",
  "internal_error",
  "mark_sent_failed",
  "message_persistence_failed",
]);

interface RawFunctionErrorLike {
  name?: string;
  message?: string;
  status?: number;
  context?: unknown;
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function extractCodeFromMessage(msg: string): QuoteSendErrorCode {
  const m = msg.toLowerCase();
  if (m.includes("unauthorized") || m.includes("invalid session")) return "unauthorized";
  if (m.includes("whatsapp") && m.includes("não conectado")) return "whatsapp_not_connected";
  if (m.includes("telefone inválido") || m.includes("telefone sem")) return "invalid_phone";
  if (m.includes("janela de 24")) return "outside_24h_window";
  if (m.includes("imagem inacessível")) return "media_not_accessible";
  if (m.includes("preparar a imagem") || m.includes("sign failed")) return "media_sign_failed";
  if (m.includes("validar a imagem")) return "media_url_invalid";
  if (m.includes("lead não encontrado")) return "lead_not_found";
  if (m.includes("falha ao criar contato")) return "lead_creation_failed";
  if (m.includes("falha ao criar conversa")) return "conversation_creation_failed";
  if (m.includes("falha ao salvar")) return "message_persistence_failed";
  if (m.includes("profile without company")) return "company_not_found";
  if (m.includes("too long")) return "text_too_long";
  if (m.includes("required")) return "invalid_payload";
  if (m.includes("whatsapp api") || m.includes("whatsapp imagem")) return "graph_api_rejected";
  return "unknown";
}

export function normalizeQuoteSendError(
  error: unknown,
  step: QuoteSendStep,
  extra?: Record<string, unknown>,
): NormalizedQuoteSendError {
  const details: Record<string, unknown> = { ...(extra ?? {}) };
  let code: QuoteSendErrorCode = "unknown";
  let message = "";
  let status: number | null = null;

  if (isObj(error)) {
    const err = error as RawFunctionErrorLike & Record<string, unknown>;
    if (typeof err.name === "string") details.name = err.name;
    if (typeof err.status === "number") status = err.status;
    if (typeof err.message === "string") message = err.message;
    // Payload sanitizado retornado pela edge function (quando o invoke encapsulou)
    const ctx = err.context;
    if (isObj(ctx)) {
      const ctxCode = (ctx as Record<string, unknown>).code;
      if (typeof ctxCode === "string") code = ctxCode as QuoteSendErrorCode;
      const ctxStatus = (ctx as Record<string, unknown>).status;
      if (typeof ctxStatus === "number") status = ctxStatus;
    }
    // Se o próprio payload já veio com code
    const rawCode = (err as Record<string, unknown>).code;
    if (typeof rawCode === "string") code = rawCode as QuoteSendErrorCode;
  } else if (typeof error === "string") {
    message = error;
  }

  if (code === "unknown" && message) {
    code = extractCodeFromMessage(message);
  }
  if (status === 401 && code === "unknown") code = "unauthorized";
  if (status === 429) code = "graph_rate_limited";

  return {
    code,
    message: FRIENDLY_BY_CODE[code] ?? FRIENDLY_BY_CODE.unknown,
    step,
    status,
    retryable: RETRYABLE_CODES.has(code),
    technicalDetails: {
      ...details,
      rawMessage: message.slice(0, 300),
    },
  };
}

export function friendlyQuoteSendMessage(code: QuoteSendErrorCode): string {
  return FRIENDLY_BY_CODE[code] ?? FRIENDLY_BY_CODE.unknown;
}

export function maskPhone(phone: string | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return digits.length <= 4 ? "****" : `****${digits.slice(-4)}`;
}

export function maskId(id: string | undefined): string {
  if (!id) return "";
  return id.length <= 8 ? "***" : `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function newQuoteSendAttemptId(): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `qs_${Date.now().toString(36)}_${rnd.slice(0, 8)}`;
}
