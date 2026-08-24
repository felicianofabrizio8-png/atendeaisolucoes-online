export type TrainingReviewStatus = "approved" | "rejected" | "corrected";

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
