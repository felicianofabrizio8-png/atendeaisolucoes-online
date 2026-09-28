import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { bucketForFollowupCycle, type FollowupCycleView } from "./followup-view";

type FollowupCycleRow = {
  id: string;
  conversation_id: string;
  reason: string;
  state: "active" | "closed";
  attempts: number;
  max_attempts: number;
  next_followup_at: string | null;
  schedule_source: string;
  last_contact_at: string | null;
  failures: number;
  close_reason: string | null;
  closed_at: string | null;
};

export async function getAtendimentoFollowupReadModel(
  companyId: string,
  options: { conversationIds?: readonly string[]; now?: Date } = {},
): Promise<FollowupCycleView[]> {
  const conversationIds = options.conversationIds?.filter(Boolean) ?? [];
  let query = supabaseAdmin
    .from("followup_cycles")
    .select(
      "id, conversation_id, reason, state, attempts, max_attempts, next_followup_at, schedule_source, last_contact_at, failures, close_reason, closed_at",
    )
    .eq("company_id", companyId)
    .eq("state", "active");

  if (conversationIds.length > 0) {
    query = query.in("conversation_id", conversationIds);
  }

  const { data, error } = await query.order("next_followup_at", { ascending: true });
  if (error) throw new Error(error.message);

  const now = options.now ?? new Date();
  return ((data ?? []) as unknown as FollowupCycleRow[]).map((cycle) => ({
    cycleId: cycle.id,
    conversationId: cycle.conversation_id,
    reason: cycle.reason,
    state: cycle.state,
    attempts: cycle.attempts,
    maxAttempts: cycle.max_attempts,
    nextFollowupAt: cycle.next_followup_at,
    scheduleSource: cycle.schedule_source,
    lastContactAt: cycle.last_contact_at,
    failures: cycle.failures,
    closeReason: cycle.close_reason,
    closedAt: cycle.closed_at,
    bucket: bucketForFollowupCycle(cycle.state, cycle.next_followup_at, now),
  }));
}
