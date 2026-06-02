// Meta Ads sync infrastructure (prep only — no live sync yet).
// Provides typed helpers used by the Campaigns module to read pending Meta
// state, surface delivery info on KPIs/timeline, and standardize the error
// taxonomy that will be written to `error_log` once sync goes live.

import { supabase } from "@/integrations/supabase/client";
import type { Campaign, MetaSyncStatus } from "./campaigns";
import { META_SYNC_LABELS } from "./campaigns";

export type MetaErrorKind =
  | "token_expired"
  | "campaign_rejected"
  | "sync_error"
  | "rate_limit"
  | "permission_denied"
  | "unknown";

export interface CampaignMetaStatus {
  connected: boolean;
  syncStatus: MetaSyncStatus;
  label: string;
  metaCampaignId: string | null;
  metaAdsetId: string | null;
  metaAdId: string | null;
  deliveryStatus: string | null;
  lastSyncAt: string | null;
  publishError: string | null;
  /** True while no real Meta data has ever been pulled. */
  awaitingFirstSync: boolean;
}

/**
 * getCampaignMetaStatus
 * Single source of truth for "what does the Meta side say about this campaign?"
 * Used by KPIs, delivery banner and timeline. Pure (no IO) — reads from the
 * Campaign row already loaded by the page.
 */
export function getCampaignMetaStatus(c: Campaign): CampaignMetaStatus {
  const connected = Boolean(c.meta_campaign_id);
  const syncStatus = (c.meta_sync_status ?? "pending") as MetaSyncStatus;
  return {
    connected,
    syncStatus,
    label: META_SYNC_LABELS[syncStatus] ?? META_SYNC_LABELS.pending,
    metaCampaignId: c.meta_campaign_id,
    metaAdsetId: c.meta_adset_id,
    metaAdId: c.meta_ad_id,
    deliveryStatus: c.meta_delivery_status,
    lastSyncAt: c.meta_last_sync_at,
    publishError: c.meta_publish_error,
    awaitingFirstSync: !connected || !c.meta_last_sync_at,
  };
}

export interface CampaignMetricsRow {
  id: string;
  campaign_id: string;
  company_id: string;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  spent: number;
  messages: number;
  leads: number;
  metric_date: string | null;
  created_at: string;
}

/**
 * Reads the most recent metrics snapshot for a campaign. Returns null while
 * Meta sync isn't active. Safe to call from any component (RLS scoped).
 */
export async function getLatestCampaignMetrics(
  campaignId: string,
): Promise<CampaignMetricsRow | null> {
  const { data, error } = await supabase
    .from("campaign_metrics" as never)
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as CampaignMetricsRow | null) ?? null;
}

/**
 * Classifies a raw Meta error string/code into our internal taxonomy.
 * Will be used by the future sync worker before writing to `error_log`.
 */
export function classifyMetaError(input: {
  code?: number | string | null;
  message?: string | null;
}): MetaErrorKind {
  const code = String(input.code ?? "").toLowerCase();
  const msg = String(input.message ?? "").toLowerCase();
  if (code === "190" || msg.includes("token") || msg.includes("expired")) return "token_expired";
  if (msg.includes("reject") || msg.includes("disapprov")) return "campaign_rejected";
  if (code === "4" || code === "17" || msg.includes("rate limit") || msg.includes("too many"))
    return "rate_limit";
  if (code === "10" || code === "200" || msg.includes("permission") || msg.includes("forbidden"))
    return "permission_denied";
  if (msg.includes("sync") || msg.includes("network") || msg.includes("timeout"))
    return "sync_error";
  return "unknown";
}

/**
 * Logs a Meta-related issue to the shared `error_log` table.
 * Best-effort; never throws so the calling sync worker can keep going.
 */
export async function logMetaError(params: {
  companyId: string;
  campaignId?: string | null;
  kind: MetaErrorKind;
  message: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    const payload = {
      company_id: params.companyId,
      source: "meta_sync",
      severity:
        params.kind === "token_expired" || params.kind === "permission_denied"
          ? "warn"
          : "error",
      message: `[${params.kind}] ${params.message}`,
      context: {
        kind: params.kind,
        campaign_id: params.campaignId ?? null,
        ...(params.context ?? {}),
      },
    };
    // error_log writes go through service_role in production; cast keeps the
    // helper usable from any caller without coupling to generated types.
    await supabase.from("error_log" as never).insert(payload as never);
  } catch {
    // swallow — error logging must never break the caller.
  }
}
