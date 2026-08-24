import type { ConversationRaw } from "@/lib/conversation-intelligence/ConversationIntelligenceTypes";
import type { SimilarCandidate } from "./similarity";
import type { CoachLearningDraft } from "./schema";

export const HISTORICAL_SCAN_LIMIT = 30;
export const HISTORICAL_MAX_PAGES = 5;
export const HISTORICAL_ANALYSIS_LIMIT = 25;
export const HISTORICAL_CANDIDATE_LIMIT = 3;
export const HISTORICAL_PROMPT_VERSION = "coach-history-v1@2026-08-24";

const SPECIFIC_FACT_PATTERNS = [
  /(?:r\$|reais?|centavos?|pre[cç]o|valor|desconto|parcel(?:a|amento))/iu,
  /\b\d+(?:[.,]\d+)?\s*(?:mm|cm|m|km|g|kg|ml|l|w|v|gb|tb|polegadas?)\b/iu,
  /\b(?:modelo|sku|c[oó]digo|refer[eê]ncia|produto|item)\b/iu,
  /\b(?:prazo|dias? [uú]teis|entrega|previs[aã]o|data)\b/iu,
  /\b(?:estoque|dispon[ií]vel|disponibilidade|indispon[ií]vel|pronta entrega)\b/iu,
  /\b(?:cliente|comprador|empresa)\s+(?:disse|tem|possui|precisa|quer|solicitou|informou)\b/iu,
  /\b\d{2,}\b/u,
] as const;

export function hasHistoricalSpecificFacts(draft: CoachLearningDraft): boolean {
  if (
    draft.product_ref ||
    draft.category === "pricing" ||
    draft.category === "product_positioning"
  ) {
    return true;
  }
  const content = [
    draft.title,
    draft.description,
    draft.rule_structured,
    draft.positive_example,
    draft.negative_example,
  ]
    .filter(Boolean)
    .join(" ");
  return SPECIFIC_FACT_PATTERNS.some((pattern) => pattern.test(content));
}

function canonicalTokens(draft: CoachLearningDraft): Set<string> {
  const stop = new Set(["para", "com", "uma", "que", "das", "dos", "por", "sem", "como"]);
  return new Set(
    `${draft.title} ${draft.rule_structured}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[a-z]{3,}/g)
      ?.filter((token) => !stop.has(token)) ?? [],
  );
}

export function areHistoricalDraftsSimilar(a: CoachLearningDraft, b: CoachLearningDraft): boolean {
  if (a.category !== b.category) return false;
  const left = canonicalTokens(a);
  const right = canonicalTokens(b);
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union > 0 && intersection / union >= 0.55;
}

export interface HistoricalCanonicalCandidate {
  draft: CoachLearningDraft;
  conversationIds: string[];
}

export function consolidateHistoricalCandidates(
  extracted: Array<{ draft: CoachLearningDraft; conversationId: string }>,
): HistoricalCanonicalCandidate[] {
  const canonical: HistoricalCanonicalCandidate[] = [];
  for (const item of extracted) {
    const match = canonical.find((candidate) =>
      areHistoricalDraftsSimilar(candidate.draft, item.draft),
    );
    if (match) {
      if (!match.conversationIds.includes(item.conversationId))
        match.conversationIds.push(item.conversationId);
      if (item.draft.confidence > match.draft.confidence) match.draft = item.draft;
    } else {
      canonical.push({ draft: item.draft, conversationIds: [item.conversationId] });
    }
  }
  return canonical;
}

export function redactHistoricalPii(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi, "[email]")
    .replace(/(?:https?:\/\/|www\.)\S+/gi, "[link]")
    .replace(/@[a-z0-9._-]{2,}/gi, "[usuario]")
    .replace(/\b(?:\d[.\s-]?){10,14}\b/g, "[documento]")
    .replace(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}/g, "[telefone]")
    .replace(/\b(meu nome (?:e|é)|sou o|sou a)\s+[\p{L}]+(?:\s+[\p{L}]+){0,3}/giu, "$1 [nome]")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function scoreHistoricalConversation(conversation: ConversationRaw): number {
  const leadMessages = conversation.messages.filter((message) => message.role === "lead").length;
  const agentMessages = conversation.messages.filter((message) => message.role === "agent").length;
  if (leadMessages < 2 || agentMessages < 1) return -1;

  let score = Math.min(conversation.messages.length, 20);
  if (conversation.lead_status === "fechado" && conversation.lead_closed_at) score += 100;
  if (conversation.fact_sale_detected) score += 90;
  if (conversation.lead_status === "perdido" && conversation.lead_lost_at) score += 70;
  if (conversation.fact_loss_detected) score += 65;
  if (conversation.fact_quote_detected) score += 25;
  if ((conversation.qualified_quote_count ?? 0) > 0) score += 30;
  else if (conversation.quote_count > 0) score += 10;
  score += Math.min(conversation.commercial_signal_count ?? 0, 5) * 5;
  if (conversation.lead_estimated_value && conversation.lead_estimated_value > 0) score += 5;
  return score;
}

export function isHistoricalConversationEligible(conversation: ConversationRaw): boolean {
  const hasClearOutcome =
    conversation.lead_status === "fechado" ||
    conversation.lead_status === "perdido" ||
    conversation.fact_sale_detected === true ||
    conversation.fact_loss_detected === true;
  const hasQuote =
    conversation.fact_quote_detected === true || (conversation.qualified_quote_count ?? 0) > 0;
  const hasEnoughCommercialSignals = (conversation.commercial_signal_count ?? 0) >= 2;
  return hasClearOutcome || hasQuote || hasEnoughCommercialSignals;
}

export function selectHistoricalConversations(
  conversations: ConversationRaw[],
  companyId: string,
  limit = HISTORICAL_ANALYSIS_LIMIT,
): ConversationRaw[] {
  return conversations
    .filter((conversation) => conversation.company_id === companyId)
    .filter(isHistoricalConversationEligible)
    .map((conversation) => ({ conversation, score: scoreHistoricalConversation(conversation) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(HISTORICAL_ANALYSIS_LIMIT, Math.max(1, limit)))
    .map((entry) => entry.conversation);
}

export function shouldSkipHistoricalDuplicate(candidates: SimilarCandidate[]): boolean {
  return candidates.some((candidate) =>
    ["exact", "highly_similar", "related"].includes(candidate.classification),
  );
}

export function buildRedactedHistoricalContext(conversation: ConversationRaw): string {
  const outcome =
    conversation.lead_status === "fechado"
      ? "venda fechada"
      : conversation.lead_status === "perdido"
        ? "perda clara"
        : conversation.quote_count > 0
          ? "orcamento enviado"
          : "resultado indefinido";
  const transcript = conversation.messages
    .filter((message) => message.role !== "system" && message.text?.trim())
    .slice(-24)
    .map(
      (message) =>
        `${message.role === "lead" ? "Cliente" : "Atendente"}: ${redactHistoricalPii(message.text ?? "")}`,
    )
    .join("\n");
  return redactHistoricalPii(
    `Analise esta conversa real com resultado ${outcome}. Extraia uma regra reutilizavel. ` +
      `Use uma resposta que contribuiu para o bom resultado como exemplo positivo; em perdas, ` +
      `use a resposta que prejudicou a conversa como exemplo negativo. Nao inclua nomes nem dados pessoais.\n${transcript}`,
  ).slice(0, 7000);
}

export function redactHistoricalDraft<
  T extends {
    title: string;
    description: string;
    rule_structured: string;
    positive_example?: string | null;
    negative_example?: string | null;
  },
>(draft: T): T {
  return {
    ...draft,
    title: redactHistoricalPii(draft.title),
    description: redactHistoricalPii(draft.description),
    rule_structured: redactHistoricalPii(draft.rule_structured),
    positive_example: draft.positive_example ? redactHistoricalPii(draft.positive_example) : null,
    negative_example: draft.negative_example ? redactHistoricalPii(draft.negative_example) : null,
  };
}
