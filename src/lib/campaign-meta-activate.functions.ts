// Reativa uma campanha já criada na Meta: faz POST status=ACTIVE nos 3 IDs
// (campaign, adset, ad) usando os IDs já salvos no banco e devolve o status
// pós-ativação. O sync completo deve ser chamado em seguida pelo cliente.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ campaignId: z.string().uuid() });
const GRAPH = "https://graph.facebook.com/v21.0";

type StatusResp = { id: string; status?: string; effective_status?: string; error?: { message?: string } };

type ActivationEntry = {
  object: "campaign" | "adset" | "ad";
  id: string;
  activate_ok: boolean;
  activate_error?: string;
  status_after?: string;
  effective_status_after?: string;
};

async function activateOne(
  object: ActivationEntry["object"],
  id: string,
  token: string,
): Promise<ActivationEntry> {
  const form = new URLSearchParams();
  form.set("status", "ACTIVE");
  form.set("access_token", token);
  let activate_ok = false;
  let activate_error: string | undefined;
  try {
    const r = await fetch(`${GRAPH}/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const j = (await r.json().catch(() => ({}))) as StatusResp;
    activate_ok = r.ok && !j.error;
    if (!activate_ok) activate_error = j.error?.message ?? `HTTP ${r.status}`;
  } catch (e) {
    activate_error = e instanceof Error ? e.message : "network_error";
  }
  let status_after: string | undefined;
  let effective_status_after: string | undefined;
  try {
    const g = await fetch(
      `${GRAPH}/${id}?fields=id,status,effective_status&access_token=${encodeURIComponent(token)}`,
    );
    const gj = (await g.json().catch(() => ({}))) as StatusResp;
    status_after = gj.status;
    effective_status_after = gj.effective_status;
  } catch {
    /* ignore */
  }
  return { object, id, activate_ok, activate_error, status_after, effective_status_after };
}

export const activateCampaignOnMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { campaignId } = data;

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    const companyId = (profile as { company_id?: string } | null)?.company_id ?? null;
    if (!companyId) return { ok: false as const, error: "no_company" };

    const sb = supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }>;
    };
    const { data: isAdmin } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) {
      return { ok: false as const, error: "not_admin", message: "Apenas administradores podem ativar campanhas." };
    }

    const { data: c } = await supabase
      .from("campaigns")
      .select("id, meta_campaign_id, meta_adset_id, meta_ad_id")
      .eq("id", campaignId)
      .maybeSingle();
    const camp = c as
      | { meta_campaign_id: string | null; meta_adset_id: string | null; meta_ad_id: string | null }
      | null;
    if (!camp?.meta_campaign_id || !camp.meta_adset_id || !camp.meta_ad_id) {
      return {
        ok: false as const,
        error: "missing_meta_ids",
        message: "Campanha não tem os 3 IDs Meta salvos (campaign/adset/ad). Publique novamente.",
      };
    }

    const adminClient = await import("@/integrations/supabase/client.server");
    const { data: integrations } = await adminClient.supabaseAdmin
      .from("integrations")
      .select("access_token, account_metadata")
      .eq("company_id", companyId)
      .in("channel", ["instagram", "facebook"])
      .eq("active", true);
    const integration = ((integrations ?? []) as Array<{
      access_token: string | null;
      account_metadata: Record<string, unknown> | null;
    }>).find((i) => Boolean(i.access_token && i.account_metadata?.ad_account_id)) ??
      ((integrations ?? []) as Array<{ access_token: string | null; account_metadata: Record<string, unknown> | null }>).find((i) => Boolean(i.access_token)) ??
      null;
    const token = integration?.access_token;
    if (!token) {
      return { ok: false as const, error: "no_meta_token", message: "Sem token Meta ativo. Reconecte a Meta Ads." };
    }

    const results: ActivationEntry[] = [];
    results.push(await activateOne("campaign", camp.meta_campaign_id, token));
    results.push(await activateOne("adset", camp.meta_adset_id, token));
    results.push(await activateOne("ad", camp.meta_ad_id, token));

    const [campR, adsetR, adR] = results;
    const allActive =
      campR.status_after === "ACTIVE" && campR.effective_status_after === "ACTIVE" &&
      adsetR.status_after === "ACTIVE" && adsetR.effective_status_after === "ACTIVE" &&
      adR.status_after === "ACTIVE" && adR.effective_status_after === "ACTIVE";

    const errorMsg = allActive
      ? null
      : `Meta não ativou a campanha: campaign=${campR.status_after ?? "?"}, adset=${adsetR.status_after ?? "?"}, ad=${adR.status_after ?? "?"}` +
        ` (effective: campaign=${campR.effective_status_after ?? "?"}, adset=${adsetR.effective_status_after ?? "?"}, ad=${adR.effective_status_after ?? "?"})`;

    await supabase
      .from("campaigns")
      .update({
        meta_delivery_status: allActive ? "active_on_meta" : "paused_on_meta",
        meta_sync_status: allActive ? "active" : "paused",
        meta_last_sync_at: new Date().toISOString(),
        meta_publish_error: errorMsg,
        ...(allActive ? { status: "active" } : {}),
      } as never)
      .eq("id", campaignId);

    try {
      await adminClient.supabaseAdmin.from("error_log").insert({
        company_id: companyId,
        user_id: userId,
        source: "meta",
        severity: allActive ? "info" : "warning",
        message: `[activate:manual] ${results.map((r) => `${r.object}=${r.status_after ?? "?"}/${r.effective_status_after ?? "?"}`).join(" ")}`,
        context: { campaign_id: campaignId, phase: "manual_activate", results } as never,
      });
    } catch (e) {
      console.warn("[activateCampaignOnMeta] error_log insert failed", e);
    }

    return { ok: allActive, results, error: errorMsg };
  });
