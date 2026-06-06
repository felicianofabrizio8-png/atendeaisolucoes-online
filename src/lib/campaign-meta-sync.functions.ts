// Sincroniza o status real (Graph API) dos objetos Meta Ads de uma campanha
// e atualiza colunas locais `meta_delivery_status` + `meta_publish_error`.
// Sem alterar `status` da campanha local (esse é um estado do app).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ campaignId: z.string().uuid() });
const GRAPH = "https://graph.facebook.com/v21.0";

type StatusResp = {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
};

async function getStatus(id: string, token: string): Promise<StatusResp | { error: string }> {
  try {
    const r = await fetch(
      `${GRAPH}/${id}?fields=id,name,status,effective_status&access_token=${encodeURIComponent(token)}`,
    );
    const j = (await r.json()) as StatusResp & { error?: { message?: string } };
    if (j.error) return { error: j.error.message ?? "graph_error" };
    return j;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "network_error" };
  }
}

export type CampaignMetaLiveStatus = {
  ok: boolean;
  synced_at: string;
  campaign: StatusResp | { error: string } | null;
  adset: StatusResp | { error: string } | null;
  ad: StatusResp | { error: string } | null;
  delivery: "active_on_meta" | "paused_on_meta" | "archived_on_meta" | "review_on_meta" | "issues_on_meta" | "unknown";
  error?: string;
};

export const syncCampaignStatusFromMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data, context }): Promise<CampaignMetaLiveStatus> => {
    const { supabase, userId } = context;
    const { campaignId } = data;

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    const companyId = (profile as { company_id?: string } | null)?.company_id ?? null;
    if (!companyId) {
      return {
        ok: false,
        synced_at: new Date().toISOString(),
        campaign: null,
        adset: null,
        ad: null,
        delivery: "unknown",
        error: "no_company",
      };
    }

    const { data: c } = await supabase
      .from("campaigns")
      .select("id, meta_campaign_id, meta_adset_id, meta_ad_id")
      .eq("id", campaignId)
      .maybeSingle();
    const camp = c as
      | { meta_campaign_id: string | null; meta_adset_id: string | null; meta_ad_id: string | null }
      | null;
    if (!camp?.meta_campaign_id) {
      return {
        ok: false,
        synced_at: new Date().toISOString(),
        campaign: null,
        adset: null,
        ad: null,
        delivery: "unknown",
        error: "campaign_not_published",
      };
    }

    const adminClient = await import("@/integrations/supabase/client.server");
    const { data: integ } = await adminClient.supabaseAdmin
      .from("integrations")
      .select("access_token, account_metadata")
      .eq("company_id", companyId)
      .in("channel", ["instagram", "facebook"])
      .eq("active", true)
      .maybeSingle();
    const integration = integ as
      | { access_token: string | null; account_metadata: Record<string, unknown> | null }
      | null;
    const token = integration?.access_token;
    if (!token) {
      return {
        ok: false,
        synced_at: new Date().toISOString(),
        campaign: null,
        adset: null,
        ad: null,
        delivery: "unknown",
        error: "no_meta_token",
      };
    }

    const [campR, adsetR, adR] = await Promise.all([
      getStatus(camp.meta_campaign_id, token),
      camp.meta_adset_id ? getStatus(camp.meta_adset_id, token) : Promise.resolve(null),
      camp.meta_ad_id ? getStatus(camp.meta_ad_id, token) : Promise.resolve(null),
    ]);

    const allHaveStatus =
      campR && !("error" in campR) &&
      adsetR && !("error" in adsetR) &&
      adR && !("error" in adR);

    let delivery: CampaignMetaLiveStatus["delivery"] = "unknown";
    let publishErr: string | null = null;
    if (allHaveStatus) {
      const cs = (campR as StatusResp).status;
      const as_ = (adsetR as StatusResp).status;
      const ads = (adR as StatusResp).status;
      const ce = (campR as StatusResp).effective_status;
      const ae = (adsetR as StatusResp).effective_status;
      const adEff = (adR as StatusResp).effective_status;
      const statuses = [cs, as_, ads, ce, ae, adEff].filter(Boolean);
      const archived = statuses.includes("ARCHIVED");
      const review = statuses.some((s) => s === "PENDING_REVIEW" || s === "IN_PROCESS");
      const issues = statuses.some((s) => s === "WITH_ISSUES" || s === "DISAPPROVED" || s === "REJECTED");
      if (archived) {
        delivery = "archived_on_meta";
      } else if (issues) {
        delivery = "issues_on_meta";
        publishErr =
          `Meta retornou problema de entrega: campaign=${cs}/${ce ?? "?"}, adset=${as_}/${ae ?? "?"}, ad=${ads}/${adEff ?? "?"}`;
      } else if (review) {
        delivery = "review_on_meta";
        publishErr =
          `Meta ainda está revisando/processando: campaign=${cs}/${ce ?? "?"}, adset=${as_}/${ae ?? "?"}, ad=${ads}/${adEff ?? "?"}`;
      } else if (cs === "ACTIVE" && ce === "ACTIVE" && as_ === "ACTIVE" && ae === "ACTIVE" && ads === "ACTIVE" && adEff === "ACTIVE") {
        delivery = "active_on_meta";
      } else {
        delivery = "paused_on_meta";
        publishErr =
          `Meta retornou status não-ativo: campaign=${cs}/${ce ?? "?"}, adset=${as_}/${ae ?? "?"}, ad=${ads}/${adEff ?? "?"}`;
      }
    }

    const syncedAt = new Date().toISOString();
    const metaSyncStatus =
      delivery === "active_on_meta" ? "active" :
      delivery === "archived_on_meta" ? "archived" :
      delivery === "issues_on_meta" ? "rejected" :
      delivery === "paused_on_meta" ? "paused" :
      "failed";
    await supabase
      .from("campaigns")
      .update({
        meta_sync_status: metaSyncStatus,
        meta_delivery_status: delivery === "unknown" ? null : delivery,
        meta_last_sync_at: syncedAt,
        meta_publish_error: publishErr,
      } as never)
      .eq("id", campaignId);

    await adminClient.supabaseAdmin.from("error_log").insert({
      company_id: companyId,
      user_id: userId,
      source: "meta",
      severity: delivery === "active_on_meta" ? "info" : "warning",
      message: `[sync:meta_status] campaign=${campR && !("error" in campR) ? `${campR.status ?? "?"}/${campR.effective_status ?? "?"}` : "error"} adset=${adsetR && !("error" in adsetR) ? `${adsetR.status ?? "?"}/${adsetR.effective_status ?? "?"}` : "error"} ad=${adR && !("error" in adR) ? `${adR.status ?? "?"}/${adR.effective_status ?? "?"}` : "error"}`,
      context: {
        campaign_id: campaignId,
        phase: "sync_live_status",
        meta_campaign_id: camp.meta_campaign_id,
        campaign_status: campR && !("error" in campR) ? campR.status ?? null : null,
        campaign_effective_status: campR && !("error" in campR) ? campR.effective_status ?? null : null,
        meta_adset_id: camp.meta_adset_id,
        adset_status: adsetR && !("error" in adsetR) ? adsetR.status ?? null : null,
        adset_effective_status: adsetR && !("error" in adsetR) ? adsetR.effective_status ?? null : null,
        meta_ad_id: camp.meta_ad_id,
        ad_status: adR && !("error" in adR) ? adR.status ?? null : null,
        ad_effective_status: adR && !("error" in adR) ? adR.effective_status ?? null : null,
        delivery,
      } as never,
    });

    return {
      ok: true,
      synced_at: syncedAt,
      campaign: campR,
      adset: adsetR,
      ad: adR,
      delivery,
    };
  });
