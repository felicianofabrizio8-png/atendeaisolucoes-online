// ============================================================================
// followup/reconcile.ts
// Responsabilidade: varrer follow-ups enviados nos últimos 14 dias e marcar
// como "responded" (lead voltou a falar) ou "recovered" (virou venda depois).
// Chamado pelo cron logo após o tick principal.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function reconcileResponses(companyId: string): Promise<number> {
  const { data: pending } = await supabaseAdmin
    .from("follow_ups")
    .select("id, conversation_id, lead_id, sent_at")
    .eq("company_id", companyId)
    .eq("status", "sent")
    .gte("sent_at", new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString())
    .limit(500);
  let updated = 0;
  for (const f of pending ?? []) {
    const { data: reply } = await supabaseAdmin
      .from("messages")
      .select("id, at")
      .eq("conversation_id", f.conversation_id)
      .eq("role", "lead")
      .gt("at", f.sent_at)
      .order("at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!reply) continue;

    // Verifica se virou venda (lead ganho após o follow-up)
    let status: "responded" | "recovered" = "responded";
    if (f.lead_id) {
      const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("status, closed_at")
        .eq("id", f.lead_id)
        .maybeSingle();
      if (lead?.status === "fechado" && lead.closed_at && lead.closed_at > f.sent_at) {
        status = "recovered";
      }
    }
    await supabaseAdmin
      .from("follow_ups")
      .update({ status, responded_at: reply.at, response_outcome: status })
      .eq("id", f.id);
    await supabaseAdmin.from("ai_flow_events").insert({
      company_id: companyId,
      conversation_id: f.conversation_id,
      lead_id: f.lead_id,
      event_type: status === "recovered" ? "lead_recovered" : "followup_responded",
      payload: { followup_id: f.id },
    });
    updated++;
  }
  return updated;
}
