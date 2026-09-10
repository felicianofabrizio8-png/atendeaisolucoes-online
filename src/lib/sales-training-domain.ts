export type TrainingReviewStatus = "approved" | "rejected" | "corrected";
import type { ConversationSalesState } from "./conversation-sales-state";

export interface SessionTrainingMessage {
  role: "lead" | "agent";
  content: string;
  decision?: {
    suggested_products?: unknown;
    product_image_ids?: unknown;
    simulated_product_images?: Array<{ product_id?: unknown }>;
  } | null;
  review_status?: TrainingReviewStatus | null;
  correction_text?: string | null;
  correction_domain?: string | null;
  correction_intent?: string | null;
  correction_conflict_key?: string | null;
}

export function getTrainingMessageProductIds(
  decision: SessionTrainingMessage["decision"],
): string[] {
  const ids = [
    ...(Array.isArray(decision?.suggested_products) ? decision.suggested_products : []),
    ...(Array.isArray(decision?.product_image_ids) ? decision.product_image_ids : []),
    ...(decision?.simulated_product_images ?? []).map((image) => image.product_id),
  ].filter((id): id is string => typeof id === "string");
  return [...new Set(ids)];
}

/**
 * Apenas respostas não reprovadas podem servir como contexto positivo.
 * Correções permanecem disponíveis exclusivamente via sessionCorrections.
 */
export function isTrainingMessageUsableInHistory(message: SessionTrainingMessage): boolean {
  return message.role !== "agent" ||
    message.review_status == null ||
    message.review_status === "approved";
}

export function buildTrainingHistory(messages: SessionTrainingMessage[]) {
  return messages
    .filter(isTrainingMessageUsableInHistory)
    .map((message) => {
      const productIds =
        message.role === "agent" ? getTrainingMessageProductIds(message.decision) : [];
      return {
        role: message.role,
        text: message.content,
        ...(productIds.length > 0 ? { productIds } : {}),
      };
    });
}

export function getApprovedTrainingProductIds(messages: SessionTrainingMessage[]): string[] {
  return [...new Set(
    messages
      .filter((message) => message.role === "agent" && message.review_status === "approved")
      .flatMap((message) => getTrainingMessageProductIds(message.decision)),
  )];
}

export function rebuildTrainingStateFromValidMessages(
  previous: ConversationSalesState,
  messages: SessionTrainingMessage[],
): ConversationSalesState {
  const approvedProductIds = getApprovedTrainingProductIds(messages);
  return {
    ...previous,
    productIds: approvedProductIds,
    lastValidProductIds: approvedProductIds,
  };
}

export function extractSessionTrainingCorrections(messages: SessionTrainingMessage[]) {
  let lastLeadQuestion: string | null = null;
  const corrections: Array<{
    question: string;
    correction: string;
    domain?: string | null;
    intent?: string | null;
    conflictKey?: string | null;
  }> = [];

  for (const message of messages) {
    if (message.role === "lead") {
      lastLeadQuestion = message.content.trim() || null;
      continue;
    }
    const correction = message.correction_text?.trim();
    if (message.review_status === "corrected" && correction && lastLeadQuestion) {
      corrections.push({
        question: lastLeadQuestion,
        correction,
        ...(message.correction_domain ? { domain: message.correction_domain } : {}),
        ...(message.correction_intent ? { intent: message.correction_intent } : {}),
        ...(message.correction_conflict_key ? { conflictKey: message.correction_conflict_key } : {}),
      });
    }
  }

  return corrections;
}

export function getTrainingLearningDiagnostics(learningIdsUsed?: string[] | null) {
  const learningIds = learningIdsUsed ?? [];
  return {
    learningIds,
    count: learningIds.length,
  };
}

export function normalizeTrainingReview(input: {
  status: TrainingReviewStatus;
  correctionText?: string | null;
}) {
  const correctionText = input.correctionText?.trim() || null;
  if (input.status === "corrected" && !correctionText) throw new Error("correction_required");
  return {
    status: input.status,
    correctionText: input.status === "corrected" ? correctionText : null,
  };
}
