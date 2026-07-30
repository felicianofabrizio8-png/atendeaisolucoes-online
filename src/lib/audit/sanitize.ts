// ============================================================================
// Sanitizador compartilhado de logs — Sprint 1 · Item 4.
//
// Extraído do padrão já validado em `HttpAudit.server.ts` e generalizado para
// uso tanto no servidor quanto no navegador.
//
// Objetivo: preservar a capacidade de diagnóstico (status, código, tipo de
// operação, identificadores não sensíveis) sem jamais expor:
//   access tokens, JWT, códigos OAuth, telefone, e-mail, UUID desnecessário,
//   URLs com token, payloads completos da Meta, conteúdo de mensagens e
//   dados brutos de integrações.
//
// Regra de uso: NUNCA passe um objeto bruto de resposta/exceção para
// console.*. Passe pelo `sanitizeForLog` ou monte uma allowlist com `pick`.
// ============================================================================

const MAX_STRING = 500;

/** Chaves cujo valor nunca pode ser logado, mesmo truncado. */
const SECRET_KEYS = new Set(
  [
    "access_token",
    "accesstoken",
    "token",
    "auth_token",
    "authtoken",
    "id_token",
    "refresh_token",
    "client_secret",
    "clientsecret",
    "app_secret",
    "appsecret",
    "secret",
    "password",
    "passwd",
    "apikey",
    "api_key",
    "authorization",
    "code",
    "verify_token",
    "signature",
    "x-hub-signature",
    "x-hub-signature-256",
    "session",
    "cookie",
  ].map((k) => k.toLowerCase()),
);

/** Chaves cujo conteúdo é PII/mensagem — registramos apenas presença/tamanho. */
const PII_KEYS = new Set(
  [
    "phone",
    "phone_number",
    "telefone",
    "whatsapp",
    "email",
    "e_mail",
    "display_phone_number",
    "body",
    "text",
    "message",
    "caption",
    "content",
    "payload",
    "raw",
    "raw_body",
  ].map((k) => k.toLowerCase()),
);

/**
 * Mascara padrões sensíveis dentro de uma string livre (mensagens de erro,
 * URLs, stack traces). Mesma base de regex do HttpAudit.
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/eyJ[a-zA-Z0-9._-]{10,}/g, "[jwt]")
    .replace(/\bEA[A-Za-z0-9]{20,}\b/g, "[meta_token]")
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9._-]+/g, "[sb_key]")
    .replace(
      /([?&](?:access_token|token|code|client_secret|apikey|api_key)=)[^&\s"']+/gi,
      "$1[redacted]",
    )
    .replace(/(bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1[redacted]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d{2,3}[\s-]?\(?\d{2,3}\)?[\s-]?\d{3,5}[\s-]?\d{3,5}/g, "[phone]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[uuid]")
    .slice(0, MAX_STRING);
}

/** Descreve um valor sensível sem revelá-lo. */
function describeSecret(v: unknown): string {
  if (v === null || v === undefined) return "[absent]";
  if (typeof v === "string") return v ? `[redacted:${v.length}]` : "[empty]";
  return "[redacted]";
}

/**
 * Sanitiza recursivamente qualquer valor para log. Objetos grandes são
 * truncados; segredos são removidos; PII é reduzida a metadados.
 */
export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[depth_limit]";

  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (value instanceof Error) {
    // Nunca registrar o objeto bruto de exceção (stack pode conter segredos).
    return { name: value.name, message: sanitizeString(value.message) };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((v) => sanitizeForLog(v, depth + 1));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 30);
    for (const [k, v] of entries) {
      const key = k.toLowerCase();
      if (SECRET_KEYS.has(key)) {
        out[k] = describeSecret(v);
      } else if (PII_KEYS.has(key)) {
        out[k] = typeof v === "string" ? `[pii:${v.length}]` : v ? "[pii]" : v;
      } else {
        out[k] = sanitizeForLog(v, depth + 1);
      }
    }
    return out;
  }

  return "[unloggable]";
}

/**
 * Allowlist explícita: preferível no servidor. Registra somente as chaves
 * pedidas, ainda passando cada valor pelo sanitizador.
 */
export function pick<T extends object, K extends keyof T>(
  obj: T | null | undefined,
  keys: readonly K[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!obj) return out;
  for (const k of keys) {
    if (k in obj) out[String(k)] = sanitizeForLog((obj as Record<string, unknown>)[String(k)]);
  }
  return out;
}

/**
 * Normaliza uma exceção desconhecida para uma mensagem segura e curta.
 * Substitui o antipadrão `console.error("...", e)`.
 */
export function safeErrorMessage(e: unknown): string {
  if (e instanceof Error) return sanitizeString(e.message);
  if (typeof e === "string") return sanitizeString(e);
  return "unknown_error";
}

/**
 * Resumo seguro de uma resposta HTTP de integração: mantém o que serve para
 * diagnóstico e descarta o corpo bruto.
 */
export function summarizeHttp(status: number, payload: unknown): Record<string, unknown> {
  const err =
    payload && typeof payload === "object"
      ? (payload as { error?: { code?: unknown; type?: unknown; message?: unknown } }).error
      : undefined;
  return {
    status,
    ok: status >= 200 && status < 300,
    error_code: err?.code ?? null,
    error_type: err?.type ?? null,
    error_message: err?.message ? sanitizeString(String(err.message)) : null,
  };
}
