import type { ConversationRaw } from "@/lib/conversation-intelligence/ConversationIntelligenceTypes";
import type { SimilarCandidate } from "./similarity";

export const HISTORICAL_SCAN_LIMIT = 30;
export const HISTORICAL_ANALYSIS_LIMIT = 5;
export const HISTORICAL_CANDIDATE_LIMIT = 3;
export const HISTORICAL_PROMPT_VERSION = "coach-history-v1@2026-08-24";

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
  if (conversation.lead_status === "perdido" && conversation.lead_lost_at) score += 70;
  if (conversation.quote_count > 0) score += conversation.lead_status === "fechado" ? 30 : 10;
  if (conversation.lead_estimated_value && conversation.lead_estimated_value > 0) score += 5;
  return score;
}

export function selectHistoricalConversations(
  conversations: ConversationRaw[],
  companyId: string,
  limit = HISTORICAL_ANALYSIS_LIMIT,
): ConversationRaw[] {
  return conversations
    .filter((conversation) => conversation.company_id === companyId)
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
