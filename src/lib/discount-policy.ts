// Política de desconto da empresa, definida só pelo lojista em company_settings.
// A IA nunca cria desconto: sem política, não oferece nenhum e segue vendendo pelo
// valor cadastrado; com descontos autorizados, cita somente os cadastrados; com
// aprovação humana, pedido de desconto vai para a equipe.

export type DiscountPolicyMode = "none" | "authorized" | "approval_required";

export interface DiscountRule {
  /** Percentual máximo autorizado (0 < percent ≤ 100). */
  percent: number;
  /** Quando vale, nas palavras do lojista ("pagamento à vista no Pix"). */
  condition: string;
}

export interface DiscountPolicy {
  mode: DiscountPolicyMode;
  rules: DiscountRule[];
}

export const NO_DISCOUNT_POLICY: DiscountPolicy = { mode: "none", rules: [] };

export const DISCOUNT_RULES_MAX = 10;
const CONDITION_MAX_CHARS = 160;

/** Linhas cruas de company_settings; qualquer valor inválido vira "sem desconto". */
export function parseDiscountPolicy(settings: {
  ai_discount_mode?: unknown;
  ai_discount_rules?: unknown;
} | null | undefined): DiscountPolicy {
  const mode = settings?.ai_discount_mode;
  if (mode === "approval_required") return { mode, rules: [] };
  if (mode !== "authorized") return NO_DISCOUNT_POLICY;
  const rules = Array.isArray(settings?.ai_discount_rules)
    ? settings.ai_discount_rules.flatMap((raw): DiscountRule[] => {
        if (!raw || typeof raw !== "object") return [];
        const row = raw as { percent?: unknown; condition?: unknown };
        const percent = typeof row.percent === "number" ? row.percent : Number(row.percent);
        const condition = typeof row.condition === "string" ? row.condition.trim().slice(0, CONDITION_MAX_CHARS) : "";
        if (!Number.isFinite(percent) || percent <= 0 || percent > 100 || !condition) return [];
        return [{ percent: Math.round(percent * 100) / 100, condition }];
      }).slice(0, DISCOUNT_RULES_MAX)
    : [];
  // "Autorizado" sem nenhuma regra válida não autoriza nada.
  return rules.length > 0 ? { mode, rules } : NO_DISCOUNT_POLICY;
}

function comparable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%,.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DISCOUNT_REQUEST_PATTERN = /\b(?:desconto|descontos|abatimento|negoci\w*|faz(?:er)?\s+(?:um\s+)?(?:preco|valor)\s+melhor|melhora\w*\s+(?:o\s+)?(?:preco|valor)|baixa\w*\s+(?:o\s+)?(?:preco|valor))\b/;

/** O cliente pediu desconto/negociação de preço. */
export function isDiscountRequest(text: string): boolean {
  return DISCOUNT_REQUEST_PATTERN.test(comparable(text));
}

const DISCOUNT_WORD = /\b(?:desconto|descontos|abatimento|off)\b/;
const PERCENT = /(\d+(?:[.,]\d+)?)\s?%/g;
// Recusa de desconto: permitida em qualquer modo ("não trabalhamos com desconto").
// A negação precisa reger o desconto; "não tem problema, dou desconto" não é recusa.
const DENIAL = new RegExp(
  [
    String.raw`\b(?:sem|nenhum|nenhuma)\s+(?:nenhum\s+|qualquer\s+)?(?:desconto|descontos|abatimento)\b`,
    String.raw`\bnao\s+(?:trabalhamos|trabalha|oferecemos|oferece|temos|tem|ha|damos|da|fazemos|faz|consigo|conseguimos|consegue|posso|podemos|pode|e\s+possivel|existe)\s+(?:com\s+|dar\s+|oferecer\s+|fazer\s+|aplicar\s+|conceder\s+)?(?:nenhum\s+|um\s+|uma\s+|qualquer\s+|o\s+|os\s+)?(?:desconto|descontos|abatimento)\b`,
    String.raw`\b(?:desconto|descontos|abatimento)\s+(?:nao|infelizmente\s+nao)\s+(?:e|sao|esta|estao|e\s+possivel|existe|temos|trabalhamos|oferecemos)\b`,
  ].join("|"),
);

function sentences(message: string): string[] {
  return message
    .split(/(?<=[!?;\n])|(?<=\.)(?!\d)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function conditionTokens(condition: string): string[] {
  const stop = new Set(["para", "pelo", "pela", "com", "sem", "por", "uma", "das", "dos", "nas", "nos", "que", "acima", "ate"]);
  return comparable(condition)
    .split(" ")
    .filter((token) => token.length >= 3 && !/\d/.test(token) && !stop.has(token));
}

export type DiscountCheck =
  | { ok: true }
  | { ok: false; reason: "discount_not_authorized" | "discount_above_policy" | "discount_condition_mismatch" };

/**
 * Toda menção afirmativa de desconto na resposta precisa corresponder a uma regra
 * cadastrada: mesmo percentual e a condição dela citada na frase. Recusar desconto
 * é sempre permitido. Percentuais fora de frases de desconto não são avaliados aqui.
 */
export function checkReplyDiscounts(message: string, policy: DiscountPolicy): DiscountCheck {
  for (const sentence of sentences(message)) {
    const normalized = comparable(sentence);
    if (!DISCOUNT_WORD.test(normalized)) continue;
    const percents = [...normalized.matchAll(PERCENT)].map((match) => Number(match[1].replace(",", ".")));
    if (DENIAL.test(normalized) && percents.length === 0) continue;
    // Pergunta ao cliente sem oferta ("prefere à vista?") não chega aqui: precisa da palavra desconto.
    if (policy.mode !== "authorized") return { ok: false, reason: "discount_not_authorized" };
    if (percents.length === 0) {
      // "Temos desconto no Pix": vale só se a frase cita a condição de uma regra.
      const matches = policy.rules.some((rule) => conditionTokens(rule.condition).some((token) => normalized.includes(token)));
      if (!matches) return { ok: false, reason: "discount_condition_mismatch" };
      continue;
    }
    for (const percent of percents) {
      const rule = policy.rules.find((candidate) => Math.abs(candidate.percent - percent) < 0.001);
      if (!rule) {
        return {
          ok: false,
          reason: policy.rules.some((candidate) => percent > candidate.percent)
            ? "discount_above_policy"
            : "discount_not_authorized",
        };
      }
      const tokens = conditionTokens(rule.condition);
      if (tokens.length > 0 && !tokens.some((token) => normalized.includes(token))) {
        return { ok: false, reason: "discount_condition_mismatch" };
      }
    }
  }
  return { ok: true };
}

/** Percentuais que a política autoriza (a trava de percentuais os aceita). */
export function authorizedDiscountPercents(policy: DiscountPolicy): string[] {
  return policy.mode === "authorized" ? policy.rules.map((rule) => `${rule.percent}%`) : [];
}

function formatPercent(value: number): string {
  return `${String(value).replace(".", ",")}%`;
}

/** Seção do prompt: a única fonte de desconto que a IA pode usar. */
export function discountPolicyPromptSection(policy: DiscountPolicy): string {
  if (policy.mode === "authorized") {
    const lines = policy.rules.map((rule) => `- ${formatPercent(rule.percent)} — ${rule.condition}`).join("\n");
    return `POLÍTICA DE DESCONTO (definida pelo lojista; única fonte de desconto):
Descontos autorizados — cite somente estes, com o percentual e a condição exatamente como estão:
${lines}
Nunca ofereça percentual maior, outro desconto, desconto combinado, preço negociado ou condição especial. Se o cliente pedir mais do que isso, mantenha o valor e a condição cadastrados e reforce o valor do produto; só peça humano se o cliente insistir em negociar algo fora da política.`;
  }
  if (policy.mode === "approval_required") {
    return `POLÍTICA DE DESCONTO (definida pelo lojista): todo desconto depende de aprovação da equipe. Não ofereça nem prometa desconto; se o cliente pedir desconto, use request_human_handoff.`;
  }
  return `POLÍTICA DE DESCONTO (definida pelo lojista): a empresa não oferece desconto. Não ofereça, prometa nem insinue desconto, abatimento ou preço menor. Se o cliente pedir, responda com cordialidade que o valor é o cadastrado e continue a venda: reforce os benefícios cadastrados do produto e as formas de pagamento cadastradas. Pedido de desconto, sozinho, não é motivo para chamar humano.`;
}
