// Sincroniza métricas reais (Meta Ads Insights) para uma campanha.
// Lê GET /{campaign_id}/insights?fields=...&date_preset=maximum, mapeia para
// colunas locais e grava snapshot em `campaign_metrics`.
//
// Para WhatsApp: usa actions[onsite_conversion.messaging_conversation_started_7d]
// (ou messaging_conversation_started_7d) como Mensagens/Leads.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ campaignId: z.string().uuid() });
const GRAPH = "https://graph.facebook.com/v21.0";

export type CampaignInsightsResult = {
  ok: boolean;
  synced_at: string;
  has_data: boolean;
  metrics: {
    impressions: number;
    reach: number;
    clicks: number;
    spend: number;
    ctr: number;
    cpc: number;
    cpm: number;
    messages: number;
    leads: number;
    cost_per_lead: number;
  } | null;
  error?: string;
};

type ActionItem = { action_type: string; value: string };
type InsightRow = {
  impressions?: string;
  reach?: string;
  clicks?: string;
  spend?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: ActionItem[];
};

function num(v: string | number | undefined | null): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function extractMessages(actions: ActionItem[] | undefined): number {
  if (!actions || !Array.isArray(actions)) return 0;
  // Prioriza tipos de conversa iniciada do WhatsApp/Messenger
  const candidates = [
    "onsite_conversion.messaging_conversation_started_7d",
    "messaging_conversation_started_7d",
    "onsite_conversion.messaging_first_reply",
    "onsite_conversion.total_messaging_connection",
  ];
  for (const t of candidates) {
    const hit = actions.find((a) => a.action_type === t);
    if (hit) return num(hit.value);
  }
  return 0;
}

export const syncCampaignInsightsFromMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data, context }): Promise<CampaignInsightsResult> => {
    const { supabase, userId } = context;
    const { campaignId } = data;
    const syncedAt = new Date().toISOString();

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    const companyId = (profile as { company_id?: string } | null)?.company_id ?? null;
    if (!companyId) {
      return { ok: false, synced_at: syncedAt, has_data: false, metrics: null, error: "no_company" };
    }

    const { data: c } = await supabase
      .from("campaigns")
      .select("id, meta_campaign_id, objective")
      .eq("id", campaignId)
      .maybeSingle();
    const camp = c as { meta_campaign_id: string | null; objective: string } | null;
    if (!camp?.meta_campaign_id) {
      return {
        ok: false,
        synced_at: syncedAt,
        has_data: false,
        metrics: null,
        error: "campaign_not_published",
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: integrations } = await supabaseAdmin
      .from("integrations")
      .select("access_token, account_metadata")
      .eq("company_id", companyId)
      .in("channel", ["instagram", "facebook"])
      .eq("active", true);
    const integration = ((integrations ?? []) as Array<{
      access_token: string | null;
      account_metadata: Record<string, unknown> | null;
    }>).find((i) => Boolean(i.access_token && i.account_metadata?.ad_account_id)) ??
      ((integrations ?? []) as Array<{ access_token: string | null }>).find((i) => Boolean(i.access_token)) ??
      null;
    const token = integration?.access_token;
    if (!token) {
      return { ok: false, synced_at: syncedAt, has_data: false, metrics: null, error: "no_meta_token" };
    }

    const fields = "impressions,reach,clicks,spend,ctr,cpc,cpm,actions";
    const url = `${GRAPH}/${camp.meta_campaign_id}/insights?fields=${fields}&date_preset=maximum&access_token=${encodeURIComponent(token)}`;
    let row: InsightRow | null = null;
    let graphError: string | null = null;
    try {
      const r = await fetch(url);
      const j = (await r.json()) as { data?: InsightRow[]; error?: { message?: string } };
      if (j.error) graphError = j.error.message ?? "graph_error";
      else row = (j.data && j.data[0]) ?? null;
    } catch (e) {
      graphError = e instanceof Error ? e.message : "network_error";
    }

    if (graphError) {
      return { ok: false, synced_at: syncedAt, has_data: false, metrics: null, error: graphError };
    }

    if (!row) {
      // Sem dados ainda — campanha publicada mas sem impressões
      await supabase
        .from("campaigns")
        .update({ meta_last_sync_at: syncedAt } as never)
        .eq("id", campaignId);
      return { ok: true, synced_at: syncedAt, has_data: false, metrics: null };
    }

    const impressions = num(row.impressions);
    const reach = num(row.reach);
    const clicks = num(row.clicks);
    const spend = num(row.spend);
    const ctr = num(row.ctr);
    const cpc = num(row.cpc);
    const cpm = num(row.cpm);
    const messages = extractMessages(row.actions);
    // Para WhatsApp: leads = conversas iniciadas; para outros canais, mantém igual
    const leads = messages;
    const costPerLead = leads > 0 ? spend / leads : 0;

    // Atualiza colunas locais usadas pelos cards já existentes
    await supabase
      .from("campaigns")
      .update({
        leads_count: leads,
        messages_count: messages,
        spent: spend,
        meta_last_sync_at: syncedAt,
      } as never)
      .eq("id", campaignId);

    // Snapshot histórico (best-effort via admin — tabela tem INSERT revogado para authenticated)
    try {
      await supabaseAdmin.from("campaign_metrics").insert({
        company_id: companyId,
        campaign_id: campaignId,
        source: "meta",
        impressions,
        reach,
        clicks,
        ctr,
        cpc,
        cpm,
        spent: spend,
        messages,
        leads,
        metric_date: new Date().toISOString().slice(0, 10),
        raw: row as never,
      } as never);
    } catch (e) {
      console.warn("[syncCampaignInsightsFromMeta] metrics insert failed", e);
    }

    return {
      ok: true,
      synced_at: syncedAt,
      has_data: impressions > 0 || clicks > 0 || spend > 0,
      metrics: {
        impressions,
        reach,
        clicks,
        spend,
        ctr,
        cpc,
        cpm,
        messages,
        leads,
        cost_per_lead: costPerLead,
      },
    };
  });
