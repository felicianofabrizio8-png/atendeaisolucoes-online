export type TrainingReviewStatus = "approved" | "rejected" | "corrected";

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

export function extractSessionTrainingCorrections(messages: SessionTrainingMessage[]) {
  let lastLeadQuestion: string | null = null;
  const corrections: Array<{ question: string; correction: string }> = [];

  for (const message of messages) {
    if (message.role === "lead") {
      lastLeadQuestion = message.content.trim() || null;
      continue;
    }
    const correction = message.correction_text?.trim();
    if (message.review_status === "corrected" && correction && lastLeadQuestion) {
      corrections.push({ question: lastLeadQuestion, correction });
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
