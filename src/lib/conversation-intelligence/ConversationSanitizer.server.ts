// Conversation Sanitizer — remove PII de textos ANTES de qualquer análise.
// Não persiste texto sanitizado. Apenas devolve string mascarada em memória.

const PATTERNS: { name: string; re: RegExp; mask: string }[] = [
  // E-mail
  { name: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, mask: "[EMAIL]" },
  // URLs (com token/params)
  { name: "url", re: /\bhttps?:\/\/[^\s]+/gi, mask: "[URL]" },
  // CPF 000.000.000-00 ou 00000000000
  { name: "cpf", re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, mask: "[CPF]" },
  // CNPJ 00.000.000/0000-00
  { name: "cnpj", re: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, mask: "[CNPJ]" },
  // CEP 00000-000
  { name: "cep", re: /\b\d{5}-?\d{3}\b/g, mask: "[CEP]" },
  // Telefones BR (+55 11 99999-9999 e variantes; 10-13 dígitos)
  {
    name: "phone",
    re: /(?:\+?55\s?)?\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}/g,
    mask: "[PHONE]",
  },
  // Sequência longa de dígitos (protocolos, IDs externos)
  { name: "long_number", re: /\b\d{7,}\b/g, mask: "[NUM]" },
  // Handles/menções
  { name: "handle", re: /(?:^|\s)@[A-Za-z0-9_.]{3,}/g, mask: " [HANDLE]" },
];

// Heurística leve para nomes próprios após saudações
const NAME_AFTER_GREETING =
  /\b(meu nome é|me chamo|sou (?:o|a)|aqui é (?:o|a))\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){0,3})/g;

export interface SanitizeResult {
  text: string;
  masks: Record<string, number>;
  pii_suspected: boolean;
}

export function sanitizeText(input: string | null | undefined): SanitizeResult {
  const masks: Record<string, number> = {};
  if (!input) return { text: "", masks, pii_suspected: false };
  let out = input;

  for (const { name, re, mask } of PATTERNS) {
    let count = 0;
    out = out.replace(re, () => {
      count++;
      return mask;
    });
    if (count > 0) masks[name] = count;
  }

  out = out.replace(NAME_AFTER_GREETING, (_m, prefix: string) => {
    masks["name"] = (masks["name"] ?? 0) + 1;
    return `${prefix} [NAME]`;
  });

  // Heurística residual: qualquer sequência de 7+ dígitos remanescente
  // ou @user remanescente indica falha da sanitização.
  const residualDigits = /\b\d{7,}\b/.test(out);
  const residualHandle = /@[A-Za-z0-9_.]{3,}/.test(out);

  return {
    text: out,
    masks,
    pii_suspected: residualDigits || residualHandle,
  };
}

/** Sanitiza um lote e retorna textos + flag agregada. */
export function sanitizeMessages(
  messages: { id: string; role: string; text: string | null; at: string }[]
): { sanitized: { id: string; role: string; text: string; at: string }[]; pii_suspected: boolean } {
  let suspected = false;
  const sanitized = messages.map((m) => {
    const s = sanitizeText(m.text ?? "");
    if (s.pii_suspected) suspected = true;
    return { id: m.id, role: m.role, text: s.text, at: m.at };
  });
  return { sanitized, pii_suspected: suspected };
}
