// ============================================================================
// Mascaração de dados sensíveis antes de qualquer chamada de IA ou log.
//
// Regra: o modelo não precisa de telefone, e-mail, token ou URL de rastreio
// para propor uma estratégia de recuperação. Tudo isso é substituído por
// marcadores estáveis, o que preserva a legibilidade sem vazar PII.
//
// Módulo puro: sem I/O, sem dependência de React/Supabase — 100% testável.
// ============================================================================

/** Telefones BR e internacionais, com ou sem máscara. */
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)?\d{4,5}[\s.-]?\d{4}\b/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Tokens/segredos óbvios: sk-..., Bearer ..., chaves longas base64-ish. */
const TOKEN_RE = /\b(?:sk-[A-Za-z0-9._-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9._-]{20,})/g;
const URL_RE = /https?:\/\/[^\s<>"')]+/g;
/** CPF/CNPJ formatados. */
const DOC_RE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;

/** Hosts cujo link é informativo para a estratégia e pode permanecer. */
const KEEP_HOSTS = ["wa.me", "api.whatsapp.com"];

function maskUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (KEEP_HOSTS.includes(host)) return `[link:${host}]`;
    return `[link:${host}]`;
  } catch {
    return "[link]";
  }
}

/**
 * Aplica todas as máscaras. A ordem importa: tokens e e-mails antes de
 * telefones, porque sequências numéricas dentro de tokens seriam capturadas
 * pelo padrão de telefone.
 */
export function redactSensitive(input: string): string {
  if (!input) return "";
  return input
    .replace(TOKEN_RE, "[token]")
    .replace(EMAIL_RE, "[email]")
    .replace(URL_RE, maskUrl)
    .replace(DOC_RE, "[documento]")
    .replace(PHONE_RE, "[telefone]");
}

/**
 * Neutraliza tentativas de prompt injection vindas do cliente.
 *
 * As mensagens do lead são DADOS, nunca instruções. Removemos delimitadores
 * de bloco, marcadores de papel e frases de sequestro conhecidas, e o prompt
 * ainda envolve o conteúdo em uma seção declarada como não-executável.
 */
export function neutralizeInjection(input: string): string {
  if (!input) return "";
  return input
    .replace(/```+/g, "'''")
    .replace(/<\/?(system|assistant|user|tool)[^>]*>/gi, "")
    .replace(/^\s*(system|assistant|user|tool)\s*:/gim, "")
    .replace(
      /\b(ignore|desconsidere|esqueça|disregard)\b[^.\n]{0,60}\b(instru\w+|prompt|regras?|rules?|anterior\w*|above|previous)\b/gi,
      "[conteúdo removido]",
    )
    .replace(/\b(you are now|a partir de agora voc[eê] [ée]|aja como|act as)\b/gi, "[conteúdo removido]");
}

/** Pipeline completo aplicado a texto do cliente/vendedor. */
export function sanitizeForPrompt(input: string, max: number): string {
  const clean = neutralizeInjection(redactSensitive(String(input ?? "")))
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Sanitização para LOG do servidor — nunca imprime conteúdo do cliente. */
export function sanitizeForLog(input: string, max = 200): string {
  return redactSensitive(String(input ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
