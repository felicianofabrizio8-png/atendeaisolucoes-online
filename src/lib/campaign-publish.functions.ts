// Pipeline de publicação Meta Ads — Beta controlado.
// Gates: admin + meta_campaigns_beta=true + canal WhatsApp + objetivo leads
// + mídia única (imagem) + orçamento diário + integração Meta conectada com
// ad_account_id em account_metadata.
//
// Cada etapa atualiza o status (publishing → active|failed) e grava IDs Meta.
// Erros são classificados e gravados em error_log (best-effort).
//
// Importante: este pipeline NÃO altera inbox, WhatsApp, IA, RLS ou campanhas
// existentes — apenas a campanha alvo é mutada.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PublishInput = z.object({ campaignId: z.string().uuid() });

type GraphErrorBody = {
  error?: {
    message?: string;
    code?: number;
    type?: string;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
};

function formatGraphError(body: GraphErrorBody, fallback: string): string {
  const e = body.error ?? {};
  const parts = [e.message ?? fallback];
  if (e.code !== undefined) parts.push(`code=${e.code}`);
  if (e.error_subcode !== undefined) parts.push(`subcode=${e.error_subcode}`);
  if (e.fbtrace_id) parts.push(`fbtrace=${e.fbtrace_id}`);
  if (e.error_user_msg) parts.push(`user_msg=${e.error_user_msg}`);
  return parts.join(" ");
}

const GRAPH = "https://graph.facebook.com/v21.0";

async function graphFetch<T>(
  url: string,
  init: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; body: GraphErrorBody; message: string }> {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    const body = text ? (JSON.parse(text) as T & GraphErrorBody) : ({} as T & GraphErrorBody);
    if (!res.ok) {
      const msg = (body as GraphErrorBody).error?.message ?? `HTTP ${res.status}`;
      return { ok: false, status: res.status, body, message: msg };
    }
    return { ok: true, data: body };
  } catch (e) {
    const message = e instanceof Error ? e.message : "network_error";
    return { ok: false, status: 0, body: {}, message };
  }
}

export const publishCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PublishInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { campaignId } = data;

    // 1) Carrega perfil e checa admin + flag beta da empresa.
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.company_id) return { ok: false as const, error: "no_company" };

    const companyId = profile.company_id;

    const { data: company } = await supabase
      .from("companies")
      .select("id, meta_campaigns_beta" as never)
      .eq("id", companyId)
      .maybeSingle();
    const betaEnabled = Boolean((company as unknown as { meta_campaigns_beta?: boolean } | null)?.meta_campaigns_beta);
    if (!betaEnabled) {
      return {
        ok: false as const,
        error: "beta_not_enabled",
        message: "Publicação Meta Ads ainda não está liberada para sua empresa. Entre em contato com o suporte.",
      };
    }

    // Checa papel admin via has_role.
    const sb = supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null; error: unknown }>;
    };
    const { data: isAdmin } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) {
      return { ok: false as const, error: "not_admin", message: "Apenas administradores podem publicar campanhas." };
    }

    // 2) Carrega campanha (RLS já garante company_id).
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .maybeSingle();
    if (!campaign) return { ok: false as const, error: "campaign_not_found" };

    // Escopo do Beta: WhatsApp + Leads + imagem única + orçamento diário.
    if (campaign.objective !== "whatsapp") {
      return { ok: false as const, error: "scope_objective", message: "No beta apenas campanhas WhatsApp podem ser publicadas." };
    }
    if (campaign.goal !== "leads") {
      return { ok: false as const, error: "scope_goal", message: "No beta apenas objetivo Leads é suportado." };
    }
    if (!campaign.media_url || campaign.media_type === "video") {
      return { ok: false as const, error: "scope_media", message: "No beta apenas imagem única é suportada." };
    }
    if (!campaign.daily_budget || Number(campaign.daily_budget) <= 0) {
      return { ok: false as const, error: "scope_budget", message: "Defina um orçamento diário maior que zero." };
    }
    if (campaign.status === "publishing") {
      return { ok: false as const, error: "already_publishing", message: "Já existe uma publicação em andamento." };
    }

    // 3) Busca integração Meta ativa via admin client — mesma rotina segura
    // usada pelo readiness/listMetaAdAccounts. A tabela `integrations` tem
    // SELECT revogado de authenticated (para proteger access_token), então
    // o client do usuário retorna 0 linhas mesmo com integrações válidas.
    const adminClient = await import("@/integrations/supabase/client.server");
    type Integ = {
      id: string;
      channel: string;
      access_token: string | null;
      account_metadata: Record<string, unknown> | null;
      external_account_id: string | null;
      active: boolean;
      display_name: string | null;
    };
    const { data: integrations, error: integError } = await adminClient.supabaseAdmin
      .from("integrations")
      .select("id, channel, access_token, account_metadata, external_account_id, active, display_name")
      .eq("company_id", companyId)
      .eq("active", true)
      .in("channel", ["instagram", "facebook"]);
    if (integError) {
      console.error("[publishCampaign] integrations query error", { campaignId, companyId, error: integError });
    }
    const list = ((integrations ?? []) as unknown as Integ[]).filter((i) => Boolean(i.access_token));
    const integ =
      list.find((i) => Boolean((i.account_metadata ?? {})["ad_account_id"])) ??
      list[0] ??
      null;
    console.log("[publishCampaign] integration lookup", {
      campaignId,
      companyId,
      totalFound: integrations?.length ?? 0,
      withToken: list.length,
      filter: { active: true, channels: ["instagram", "facebook"] },
      picked: integ?.id ?? null,
      pickedName: integ?.display_name ?? null,
    });
    if (!integ || !integ.access_token) {
      return { ok: false as const, error: "no_integration", message: "Conecte uma conta Meta antes de publicar." };
    }
    const meta = (integ.account_metadata ?? {}) as Record<string, unknown>;
    const adAccountId = String(meta["ad_account_id"] ?? "");
    const pageId = String(meta["fb_page_id"] ?? integ.external_account_id ?? "");
    if (!adAccountId) {
      return {
        ok: false as const,
        error: "no_ad_account",
        message: "Sua integração Meta não tem ad_account_id configurado. Vincule uma conta de anúncios para publicar.",
      };
    }
    if (!pageId) {
      return { ok: false as const, error: "no_page", message: "Vincule uma página Facebook à integração Meta." };
    }
    const accessToken = integ.access_token;
    const actId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

    // 4) Marca status=publishing.
    await supabase
      .from("campaigns")
      .update({
        status: "publishing",
        meta_sync_status: "syncing",
        meta_publish_error: null,
      } as never)
      .eq("id", campaignId);




    async function fail(stage: string, message: string, raw?: unknown) {
      await supabase
        .from("campaigns")
        .update({
          status: "draft",
          meta_sync_status: "failed",
          meta_publish_error: `${stage}: ${message}`.slice(0, 500),
        } as never)
        .eq("id", campaignId);
      try {
        await adminClient.supabaseAdmin.from("error_log").insert({
          company_id: companyId,
          user_id: userId,
          source: "meta",
          severity: "error",
          message: `[publish:${stage}] ${message}`.slice(0, 1900),
          context: { campaign_id: campaignId, raw: raw ?? null, stage } as never,
        });
      } catch {
        /* noop */
      }
      return { ok: false as const, error: "publish_failed", stage, message };
    }

    // Step A: tenta upload da imagem para a ad account (gera image_hash).
    // Se a Meta App não tiver capability `ads_management` aprovada, o
    // endpoint `/adimages` retorna erro (#3). Nesse caso seguimos sem hash e
    // usamos a URL pública direto no `picture` do creative (suportado).
    console.log("[publishCampaign] upload_media start", {
      campaignId, actId, mediaUrl: campaign.media_url,
      endpoint: `${GRAPH}/${actId}/adimages`,
    });
    let imageHash: string | null = null;
    const uploadRes = await graphFetch<{ images?: Record<string, { hash: string }> }>(
      `${GRAPH}/${actId}/adimages?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: campaign.media_url }),
      },
    );
    if (uploadRes.ok) {
      const images = uploadRes.data.images ?? {};
      imageHash = Object.values(images)[0]?.hash ?? null;
      console.log("[publishCampaign] upload_media ok", { imageHash, raw: uploadRes.data });
    } else {
      const errCode = (uploadRes.body as GraphErrorBody).error?.code;
      const isCapability =
        errCode === 3 || errCode === 10 || errCode === 200 || errCode === 294 ||
        /capability|permission|not have/i.test(uploadRes.message);
      console.warn("[publishCampaign] upload_media fail", {
        status: uploadRes.status, message: uploadRes.message, body: uploadRes.body,
        willFallbackToPictureUrl: isCapability,
      });
      if (!isCapability) {
        return fail(
          "upload_media",
          `Não foi possível enviar a imagem para a Meta (${uploadRes.message}). Verifique se a URL é pública.`,
          uploadRes.body,
        );
      }
      // Fallback: segue sem image_hash, usa picture URL no creative.
    }


    // Step B: cria campaign (OUTCOME_LEADS). Payload mínimo aceito pela Meta:
    // não enviar daily_budget/targeting/creative/page_id aqui — esses pertencem
    // a adset/ad/creative.
    const campaignPayload = {
      name: campaign.name,
      objective: "OUTCOME_LEADS",
      status: "PAUSED",
      special_ad_categories: [] as string[],
      buying_type: "AUCTION",
    };
    console.log("[publishCampaign] create_campaign payload", {
      campaignId, actId, endpoint: `${GRAPH}/${actId}/campaigns`, payload: campaignPayload,
    });
    const campRes = await graphFetch<{ id: string }>(
      `${GRAPH}/${actId}/campaigns?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campaignPayload),
      },
    );
    if (!campRes.ok) {
      console.error("[publishCampaign] create_campaign fail", {
        status: campRes.status, message: campRes.message, body: campRes.body,
      });
      return fail("create_campaign", formatGraphError(campRes.body, campRes.message), campRes.body);
    }
    const metaCampaignId = campRes.data.id;

    // Step C: cria adset (Click to WhatsApp).
    const dailyBudgetCents = Math.round(Number(campaign.daily_budget) * 100);
    const adsetRes = await graphFetch<{ id: string }>(
      `${GRAPH}/${actId}/adsets?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${campaign.name} — adset`,
          campaign_id: metaCampaignId,
          daily_budget: dailyBudgetCents,
          billing_event: "IMPRESSIONS",
          optimization_goal: "CONVERSATIONS",
          destination_type: "WHATSAPP",
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          status: "PAUSED",
          targeting: {
            geo_locations: campaign.city
              ? { custom_locations: [{ name: campaign.city, radius: campaign.radius_km ?? 25, distance_unit: "kilometer" }] }
              : { countries: ["BR"] },
          },
          promoted_object: { page_id: pageId },
        }),
      },
    );
    if (!adsetRes.ok) {
      // Tenta rollback da campaign criada (best-effort).
      void graphFetch(`${GRAPH}/${metaCampaignId}?access_token=${encodeURIComponent(accessToken)}`, { method: "DELETE" });
      return fail("create_adset", formatGraphError(adsetRes.body, adsetRes.message), adsetRes.body);
    }
    const metaAdsetId = adsetRes.data.id;

    // Step D: cria creative. Usa image_hash se conseguimos upload; caso
    // contrário, passa `picture` com a URL pública direto (fallback).
    const linkData: Record<string, unknown> = {
      message: campaign.primary_text ?? "",
      name: campaign.headline ?? campaign.name,
      link: `https://wa.me/`,
      call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } },
    };
    if (imageHash) linkData.image_hash = imageHash;
    else if (campaign.media_url) linkData.picture = campaign.media_url;
    console.log("[publishCampaign] create_creative", {
      pageId, usingImageHash: Boolean(imageHash), usingPictureUrl: !imageHash && Boolean(campaign.media_url),
    });
    const creativeRes = await graphFetch<{ id: string }>(
      `${GRAPH}/${actId}/adcreatives?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${campaign.name} — creative`,
          object_story_spec: { page_id: pageId, link_data: linkData },
        }),
      },
    );
    if (!creativeRes.ok) return fail("create_creative", formatGraphError(creativeRes.body, creativeRes.message), creativeRes.body);
    const creativeId = creativeRes.data.id;

    // Step E: cria ad.
    const adRes = await graphFetch<{ id: string }>(
      `${GRAPH}/${actId}/ads?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${campaign.name} — ad`,
          adset_id: metaAdsetId,
          creative: { creative_id: creativeId },
          status: "PAUSED",
        }),
      },
    );
    if (!adRes.ok) return fail("create_ad", formatGraphError(adRes.body, adRes.message), adRes.body);
    const metaAdId = adRes.data.id;

    // 5) Sucesso — grava IDs e marca ativa (Meta criou tudo em PAUSED por segurança;
    // o usuário ativa pelo Gerenciador da Meta na primeira rodada do Beta).
    await supabase
      .from("campaigns")
      .update({
        status: "active",
        meta_campaign_id: metaCampaignId,
        meta_adset_id: metaAdsetId,
        meta_ad_id: metaAdId,
        meta_sync_status: "active",
        meta_last_sync_at: new Date().toISOString(),
        meta_delivery_status: "paused_on_meta",
        meta_publish_error: null,
      } as never)
      .eq("id", campaignId);

    return {
      ok: true as const,
      ids: { campaign: metaCampaignId, adset: metaAdsetId, creative: creativeId, ad: metaAdId },
    };
  });
