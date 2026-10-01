// ============================================================================
// Perguntas institucionais (pagamento, instalação, entrega/frete, visita,
// itens inclusos) respondidas pelas POLÍTICAS CADASTRADAS da empresa.
//
// Multiempresa/multissegmento: nenhum texto de política é fixo aqui — só os
// tópicos genéricos e os campos que cada empresa preenche. Sem política
// cadastrada para o tópico, nada muda (continua indo para humano).
//
// Fora de escopo (sempre humano): desconto/negociação, fechamento, análise
// financeira/crédito/CPF, garantia/reclamação.
// ============================================================================

import type { SalesAgentGrounding } from "./sales-agent-core";

export type InstitutionalTopic = "payment" | "installation" | "delivery" | "visit" | "included";

export interface InstitutionalPolicy {
  topic: InstitutionalTopic;
  label: string;
  text: string;
}

type CommercialRules = SalesAgentGrounding["commercialRules"];

const TOPIC_PATTERNS: Record<InstitutionalTopic, RegExp> = {
  payment:
    /\b(?:parcel\w*|pagamento|pagar|pago|pix|cart[aã]o|boleto|[aà]\s+vista|formas?\s+de\s+pag\w*|entrada)\b/i,
  installation: /\binstal\w*/i,
  delivery: /\b(?:frete|entreg\w*|envi[ao]\w*|chega\w*|prazo\s+de\s+entrega|transporte|carga)\b/i,
  visit: /\bvisita\w*/i,
  included: /\b(?:inclu[ií]\w*|inclus[oa]s?|acompanha\w*|vem\s+com)\b/i,
};

const TOPIC_LABELS: Record<InstitutionalTopic, string> = {
  payment: "Pagamento",
  installation: "Instalação",
  delivery: "Entrega",
  visit: "Visita",
  included: "Itens inclusos",
};

// Pedidos que continuam exigindo humano mesmo com política cadastrada.
// ("barato"/"menor preço" não entram: comparar preços cadastrados não é
// negociação — quem distingue é o LLM, ver compare_catalog_prices.)
const HUMAN_ONLY_PATTERN =
  /\b(?:desconto|descont\w*|abatimento|negoci\w*|faz\s+por|faria\s+por|abaix\w*|fechar|fecho|finaliz\w*|contrato|cpf|cr[eé]dito|an[aá]lise\s+(?:financeira|de\s+cr[eé]dito)|financiament\w*|garanti\w*|reclama\w*|defeit\w*|quebr\w*|problema)\b/i;

function normalize(text: string): string {
  return text.normalize("NFC");
}

export function detectInstitutionalTopics(text: string): InstitutionalTopic[] {
  const value = normalize(text);
  return (Object.keys(TOPIC_PATTERNS) as InstitutionalTopic[]).filter((topic) =>
    TOPIC_PATTERNS[topic].test(value),
  );
}

export function isHumanOnlyRequest(text: string): boolean {
  return HUMAN_ONLY_PATTERN.test(normalize(text));
}

function policyTextsFor(topic: InstitutionalTopic, rules: CommercialRules): string[] {
  const clean = (value: string | null | undefined) => value?.trim() || null;
  switch (topic) {
    case "payment":
      return [
        clean(rules.paymentPolicy) ?? clean(rules.paymentMethods),
        clean(rules.commercialTerms),
      ].filter((value): value is string => Boolean(value));
    case "installation":
      return [clean(rules.installationPolicy)].filter((value): value is string => Boolean(value));
    case "delivery":
      return [clean(rules.shippingPolicy), clean(rules.nextLoadForecast)].filter(
        (value): value is string => Boolean(value),
      );
    case "visit":
      return [clean(rules.visitPolicy)].filter((value): value is string => Boolean(value));
    case "included":
      return [clean(rules.includedItemsPolicy)].filter((value): value is string => Boolean(value));
  }
}

/**
 * Políticas cadastradas que respondem à pergunta. `null` quando a pergunta
 * não é institucional, pede algo que exige humano ou algum tópico perguntado
 * não tem política cadastrada (não responder pela metade).
 */
export function resolveInstitutionalPolicies(
  text: string,
  rules: CommercialRules | null | undefined,
): InstitutionalPolicy[] | null {
  if (!rules || !text.trim() || isHumanOnlyRequest(text)) return null;
  const topics = detectInstitutionalTopics(text);
  if (topics.length === 0) return null;
  const policies: InstitutionalPolicy[] = [];
  for (const topic of topics) {
    const texts = policyTextsFor(topic, rules);
    if (texts.length === 0) return null;
    policies.push({ topic, label: TOPIC_LABELS[topic], text: texts.join(" ") });
  }
  return policies;
}

export const INSTITUTIONAL_TOPICS: readonly InstitutionalTopic[] = [
  "payment",
  "installation",
  "delivery",
  "visit",
  "included",
];

/**
 * Políticas cadastradas para tópicos já identificados (ex.: pelo LLM).
 * `null` se algum tópico pedido não tiver política — não responder pela metade.
 */
export function resolvePoliciesForTopics(
  topics: readonly string[],
  rules: CommercialRules | null | undefined,
): InstitutionalPolicy[] | null {
  if (!rules) return topics.length === 0 ? [] : null;
  const unique = [...new Set(topics)].filter((topic): topic is InstitutionalTopic =>
    (INSTITUTIONAL_TOPICS as readonly string[]).includes(topic),
  );
  const policies: InstitutionalPolicy[] = [];
  for (const topic of unique) {
    const texts = policyTextsFor(topic, rules);
    if (texts.length === 0) return null;
    policies.push({ topic, label: TOPIC_LABELS[topic], text: texts.join(" ") });
  }
  return policies;
}

const POLICY_REPLY_MAX_CHARS = 500;

/** Resposta determinística: o texto da política, sem nenhum fato novo. */
export function buildInstitutionalPolicyReply(policies: readonly InstitutionalPolicy[]): string {
  return policies
    .map(({ label, text }) => {
      const body =
        text.length <= POLICY_REPLY_MAX_CHARS
          ? text
          : `${text.slice(0, POLICY_REPLY_MAX_CHARS - 1).trimEnd()}…`;
      return `${label}: ${body}`;
    })
    .join("\n");
}

function numericTokens(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/g)]
    .map((match) => match[0].replace(/\./g, "").replace(",", "."))
    .map((value) => String(Number(value)))
    .filter((value) => value !== "NaN");
}

/**
 * Todo número dito na resposta (parcelas, %, prazos, valores) precisa existir
 * nas políticas cadastradas ou nos fatos permitidos (ex.: preços do catálogo).
 */
export function replyNumbersAreGrounded(
  message: string,
  policies: readonly InstitutionalPolicy[],
  allowedFacts: readonly string[] = [],
): boolean {
  const allowed = new Set(
    numericTokens([...policies.map((p) => p.text), ...allowedFacts].join(" ")),
  );
  return numericTokens(message).every((value) => allowed.has(value));
}
