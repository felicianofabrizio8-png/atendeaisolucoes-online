export type FollowupBucket = "overdue" | "upcoming" | "none";

export type FollowupReason =
  | "quote_no_reply"
  | "visit_no_return"
  | "hot_lead_idle"
  | "lead_silent"
  | string;

export interface FollowupCycleView {
  cycleId: string;
  conversationId: string;
  reason: FollowupReason;
  state: "active" | "closed";
  attempts: number;
  maxAttempts: number;
  nextFollowupAt: string | null;
  scheduleSource: string;
  lastContactAt: string | null;
  failures: number;
  closeReason: string | null;
  closedAt: string | null;
  bucket: FollowupBucket;
}

export function bucketForFollowupCycle(
  state: "active" | "closed",
  nextFollowupAt: string | null,
  now = new Date(),
): FollowupBucket {
  if (state !== "active" || !nextFollowupAt) return "none";
  return Date.parse(nextFollowupAt) <= now.getTime() ? "overdue" : "upcoming";
}

export const FOLLOWUP_REASON_LABELS: Record<string, string> = {
  quote_no_reply: "Orçamento sem resposta",
  visit_no_return: "Visita sem retorno",
  hot_lead_idle: "Lead quente parado",
  lead_silent: "Cliente sem resposta",
};

export function followupReasonLabel(reason: string): string {
  return FOLLOWUP_REASON_LABELS[reason] ?? reason.replaceAll("_", " ");
}
