// Coordenação entre follow-up automático, manual e campanhas em massa.
// Server-only: lê apenas registros da própria empresa e falha fechado.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type FollowupMode = "automatic" | "manual" | "bulk";

export type RecentContact = {
  mode: FollowupMode;
  at: string;
  sourceId: string;
};

/**
 * Impede que um mesmo lead receba contatos por motores diferentes dentro da
 * mesma janela. O registro mais recente é suficiente: os gates diários e o
 * opt-out continuam sendo aplicados pelos respectivos motores.
 */
export async function findRecentFollowupContact(input: {
  companyId: string;
  leadId: string;
  now?: Date;
  cooldownHours: number;
  excludeCycleId?: string | null;
}): Promise<RecentContact | null> {
  const now = input.now ?? new Date();
  const hours = Math.max(1, Math.min(input.cooldownHours, 168));
  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

  const [{ data: followups, error: followupError }, { data: campaigns, error: campaignError }] =
    await Promise.all([
      supabaseAdmin
        .from("follow_ups")
        .select("id,created_at,metadata,cycle_id")
        .eq("company_id", input.companyId)
        .eq("lead_id", input.leadId)
        .in("status", ["sent", "simulated"])
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("relationship_campaign_recipients")
        .select("id,sent_at")
        .eq("company_id", input.companyId)
        .eq("lead_id", input.leadId)
        .in("status", ["sent", "delivered", "replied", "converted"])
        .gte("sent_at", cutoff)
        .order("sent_at", { ascending: false })
        .limit(1),
    ]);

  if (followupError || campaignError)
    throw new Error("não foi possível verificar contatos recentes do lead");

  const followup = (followups ?? [])
    .filter((row) => !input.excludeCycleId || row.cycle_id !== input.excludeCycleId)
    .sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)))[0] as
    | { id: string; created_at: string; cycle_id?: string | null; metadata?: { manual?: boolean; reactivation?: boolean } }
    | undefined;
  const campaign = campaigns?.[0] as { id: string; sent_at: string } | undefined;
  const candidates: RecentContact[] = [];
  if (followup?.created_at) {
    candidates.push({
      mode: followup.metadata?.manual ? "manual" : "automatic",
      at: followup.created_at,
      sourceId: followup.id,
    });
  }
  if (campaign?.sent_at)
    candidates.push({ mode: "bulk", at: campaign.sent_at, sourceId: campaign.id });
  return candidates.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
}

export function recentContactReason(contact: RecentContact): string {
  return `contato recente do modo ${contact.mode} (${contact.at})`;
}
