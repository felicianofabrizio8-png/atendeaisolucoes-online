// Sanitização de payloads antes de persistir em environment_simulations.
// Função PURA: sem I/O, sem imports de runtime. Testável isoladamente.
//
// Regras (item 10 do plano aprovado):
// - remove: access_token, authorization, api_key, apikey, secret, password, token
// - mascara: phone/to/recipient/wa_id/from → "+55***4321"
// - mascara: email → "a***@dominio.com"
// - trunca:  name/contact_name/display_name → 3 chars + "***"
// - trunca:  text/body/caption/message → 20 chars + "…(N chars)"
// - limpa: URLs com query params sensíveis
// - substitui base64 grande (>200 chars) por marcador
// - remove Authorization em headers aninhados

const DROP_KEYS = new Set([
  "access_token",
  "authorization",
  "api_key",
  "apikey",
  "secret",
  "password",
  "token",
  "bearer",
  "cookie",
  "set-cookie",
]);

const PHONE_KEYS = new Set([
  "phone",
  "to",
  "recipient_id",
  "wa_id",
  "from",
  "recipient",
  "phone_number",
  "display_phone_number",
]);

const EMAIL_KEYS = new Set(["email", "email_address", "user_email"]);

const NAME_KEYS = new Set([
  "name",
  "contact_name",
  "display_name",
  "full_name",
  "customer_name",
  "lead_name",
]);

const TEXT_KEYS = new Set([
  "text",
  "body",
  "caption",
  "message",
  "content",
  "reply_text",
]);

const SENSITIVE_URL_PARAMS = [
  "sig",
  "signature",
  "access_token",
  "token",
  "apikey",
  "api_key",
];

// Aceita 8-15 dígitos (com ou sem +). Mostra apenas os 4 últimos.
export function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  const last4 = digits.slice(-4);
  return `+***${last4}`;
}

export function maskEmail(raw: string): string {
  const at = raw.indexOf("@");
  if (at <= 0) return "***";
  const localFirst = raw[0] ?? "";
  const domain = raw.slice(at + 1);
  return `${localFirst}***@${domain}`;
}

export function maskName(raw: string): string {
  if (!raw) return "***";
  const head = raw.slice(0, 3);
  return `${head}***`;
}

export function truncateText(raw: string, keep = 20): string {
  if (raw.length <= keep) return raw;
  return `${raw.slice(0, keep)}…(${raw.length} chars)`;
}

export function sanitizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const p of SENSITIVE_URL_PARAMS) u.searchParams.delete(p);
    // Também remove qualquer param que contenha "token" ou "sig" no nome.
    const toDelete: string[] = [];
    u.searchParams.forEach((_v, k) => {
      const lk = k.toLowerCase();
      if (lk.includes("token") || lk.includes("sig") || lk.startsWith("x-amz-")) {
        toDelete.push(k);
      }
    });
    for (const k of toDelete) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return "<invalid-url>";
  }
}

function looksLikeBase64(v: string): boolean {
  return v.length > 200 && /^[A-Za-z0-9+/=]+$/.test(v);
}

function looksLikeDataUrl(v: string): boolean {
  return v.startsWith("data:") && v.length > 200;
}

function looksLikeJwt(v: string): boolean {
  return /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v);
}

function sanitizeString(key: string, value: string): string {
  const lk = key.toLowerCase();
  if (DROP_KEYS.has(lk)) return "<redacted>";
  if (lk.includes("token") || lk.includes("secret") || lk.includes("password")) {
    return "<redacted>";
  }
  if (PHONE_KEYS.has(lk)) return maskPhone(value);
  if (EMAIL_KEYS.has(lk)) return maskEmail(value);
  if (NAME_KEYS.has(lk)) return maskName(value);
  if (TEXT_KEYS.has(lk)) return truncateText(value);
  if (lk === "url" || lk === "target_url" || lk === "endpoint") {
    return sanitizeUrl(value);
  }
  if (looksLikeJwt(value)) return "<redacted-jwt>";
  if (looksLikeDataUrl(value)) return `<binary:data-url:len=${value.length}>`;
  if (looksLikeBase64(value)) return `<binary:base64:len=${value.length}>`;
  // Defesa final: se o valor tem forma de bearer, redigir.
  if (/^Bearer\s+/i.test(value)) return "<redacted-bearer>";
  return value;
}

/**
 * Sanitiza recursivamente. Aceita qualquer JSON. Nunca lança.
 * Sempre devolve um plain object (para persistir em JSONB).
 */
export function sanitizePayload(input: unknown): Record<string, unknown> {
  const seen = new WeakSet<object>();
  const walk = (key: string, val: unknown): unknown => {
    if (val === null || val === undefined) return val;
    if (typeof val === "string") return sanitizeString(key, val);
    if (typeof val === "number" || typeof val === "boolean") return val;
    if (typeof val === "bigint") return val.toString();
    if (typeof val === "function" || typeof val === "symbol") return "<unsupported>";
    if (val instanceof Date) return val.toISOString();
    if (val instanceof ArrayBuffer) return `<binary:arraybuffer:bytes=${val.byteLength}>`;
    if (ArrayBuffer.isView(val)) {
      const view = val as ArrayBufferView;
      return `<binary:view:bytes=${view.byteLength}>`;
    }
    if (Array.isArray(val)) return val.map((v, i) => walk(String(i), v));
    if (typeof val === "object") {
      const o = val as Record<string, unknown>;
      if (seen.has(o)) return "<circular>";
      seen.add(o);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) {
        const lk = k.toLowerCase();
        if (DROP_KEYS.has(lk)) {
          out[k] = "<redacted>";
          continue;
        }
        out[k] = walk(k, v);
      }
      return out;
    }
    return "<unsupported>";
  };

  const walked = walk("__root__", input);
  if (walked && typeof walked === "object" && !Array.isArray(walked)) {
    return walked as Record<string, unknown>;
  }
  return { value: walked as unknown };
}

/** Utilitário para escanear um objeto e afirmar que nada sensível vazou (usado nos testes). */
export function findSensitiveLeaks(obj: unknown): string[] {
  const leaks: string[] = [];
  const walk = (path: string, val: unknown) => {
    if (typeof val === "string") {
      // Telefone completo (8+ dígitos contíguos)
      if (/\b\d{8,15}\b/.test(val) && !val.startsWith("+***")) {
        leaks.push(`${path}: phone-like "${val}"`);
      }
      // Email não-mascarado
      if (/[A-Za-z0-9._%+-]{2,}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(val)) {
        leaks.push(`${path}: email-like "${val}"`);
      }
      // JWT
      if (/ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(val)) {
        leaks.push(`${path}: jwt-like`);
      }
      // Bearer
      if (/Bearer\s+[A-Za-z0-9_.-]+/.test(val)) {
        leaks.push(`${path}: bearer-like`);
      }
    } else if (val && typeof val === "object") {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        walk(`${path}.${k}`, v);
      }
    }
  };
  walk("$", obj);
  return leaks;
}
