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

    // Modo retomada: se já temos campaign_id/adset_id na Meta e falta o ad,
    // reutiliza-os e tenta apenas as etapas restantes (creative + ad).
    const resumeMetaCampaignId = (campaign as { meta_campaign_id?: string | null }).meta_campaign_id ?? null;
    const resumeMetaAdsetId = (campaign as { meta_adset_id?: string | null }).meta_adset_id ?? null;
    const resumeMetaAdId = (campaign as { meta_ad_id?: string | null }).meta_ad_id ?? null;
    const isResume = Boolean(resumeMetaCampaignId && resumeMetaAdsetId && !resumeMetaAdId);
    console.log("[publishCampaign] mode", {
      campaignId, isResume,
      have: { campaign: resumeMetaCampaignId, adset: resumeMetaAdsetId, ad: resumeMetaAdId },
    });


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
      const rawBody = (raw && typeof raw === "object" ? raw : {}) as GraphErrorBody;
      const err = rawBody.error ?? {};
      const tags = [
        err.code !== undefined ? `code=${err.code}` : null,
        err.error_subcode !== undefined ? `subcode=${err.error_subcode}` : null,
        err.fbtrace_id ? `fbtrace=${err.fbtrace_id}` : null,
      ].filter(Boolean).join(" ");
      console.error(`[publishCampaign] FAIL stage=${stage}`, {
        campaignId, message, error_code: err.code ?? null,
        error_subcode: err.error_subcode ?? null,
        fbtrace_id: err.fbtrace_id ?? null,
        raw: raw ?? null,
      });
      await supabase
        .from("campaigns")
        .update({
          status: "draft",
          meta_sync_status: "failed",
          meta_publish_error: `${stage}: ${message}${tags ? " · " + tags : ""}`.slice(0, 500),
        } as never)
        .eq("id", campaignId);
      try {
        await adminClient.supabaseAdmin.from("error_log").insert({
          company_id: companyId,
          user_id: userId,
          source: "meta",
          severity: "error",
          message: `[publish:${stage}] ${message}`.slice(0, 1900),
          context: {
            campaign_id: campaignId, stage,
            error_code: err.code ?? null,
            error_subcode: err.error_subcode ?? null,
            fbtrace_id: err.fbtrace_id ?? null,
            raw: raw ?? null,
          } as never,
        });
      } catch (e) {
        console.warn("[publishCampaign] error_log insert failed", e);
      }
      return {
        ok: false as const, error: "publish_failed", stage, message,
        error_code: err.code ?? null,
        error_subcode: err.error_subcode ?? null,
        fbtrace_id: err.fbtrace_id ?? null,
      };
    }


    // Step A: baixa a imagem do Supabase no backend e faz upload por BYTES
    // para /act_<id>/adimages. Isso evita o erro #3858258 (Meta crawler não
    // consegue baixar a URL pública). Usa o `image_hash` retornado no creative.
    console.log("[publishCampaign] upload_media start", {
      campaignId, actId, mediaUrl: campaign.media_url,
      endpoint: `${GRAPH}/${actId}/adimages`,
    });

    let imageHash: string | null = null;
    let imgBlob: Blob | null = null;
    let imgContentType = "";
    let imgSize = 0;
    let imgSource: "public_url" | "admin_download" = "public_url";

    // Helper: extrai { bucket, path } de URLs Supabase Storage públicas/assinadas
    function parseSupabaseStoragePath(url: string): { bucket: string; path: string } | null {
      try {
        const u = new URL(url);
        const m = u.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
        if (!m) return null;
        return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2].split("?")[0]) };
      } catch {
        return null;
      }
    }

    // Tenta primeiro a URL pública; se falhar (bucket privado, 400/404), faz
    // fallback baixando direto pelo admin client a partir do storage_path.
    try {
      const imgRes = await fetch(campaign.media_url, { method: "GET" });
      imgContentType = imgRes.headers.get("content-type") ?? "";
      console.log("[publishCampaign] media fetch (public)", {
        url: campaign.media_url, status: imgRes.status,
        contentType: imgContentType, contentLength: imgRes.headers.get("content-length"),
      });
      if (imgRes.ok && /^image\//i.test(imgContentType)) {
        imgBlob = await imgRes.blob();
        imgSize = imgBlob.size;
      }
    } catch (e) {
      console.warn("[publishCampaign] public fetch failed", { msg: e instanceof Error ? e.message : String(e) });
    }

    if (!imgBlob || !imgSize) {
      const parsed = parseSupabaseStoragePath(campaign.media_url);
      console.log("[publishCampaign] fallback admin download", { parsed });
      if (!parsed) {
        return fail(
          "upload_media",
          "Imagem não está acessível publicamente. Reenvie a imagem na campanha.",
        );
      }
      const { data: dl, error: dlErr } = await adminClient.supabaseAdmin
        .storage.from(parsed.bucket).download(parsed.path);
      if (dlErr || !dl) {
        console.error("[publishCampaign] admin download failed", { parsed, error: dlErr });
        return fail(
          "upload_media",
          `Imagem não encontrada no storage (${parsed.path}). Reenvie a imagem na campanha.`,
        );
      }
      imgBlob = dl;
      imgSize = dl.size;
      imgContentType = dl.type || imgContentType || "image/jpeg";
      imgSource = "admin_download";
      console.log("[publishCampaign] admin download ok", {
        bucket: parsed.bucket, path: parsed.path, size: imgSize, contentType: imgContentType,
      });
    }

    if (!/^image\/(jpeg|jpg|png|webp)/i.test(imgContentType)) {
      return fail(
        "upload_media",
        `Tipo de imagem inválido (${imgContentType || "desconhecido"}). Use JPG ou PNG.`,
      );
    }
    console.log("[publishCampaign] media ready", { source: imgSource, size: imgSize, contentType: imgContentType });


    // Upload por bytes via multipart/form-data
    try {
      const ext = /png/i.test(imgContentType) ? "png" : /webp/i.test(imgContentType) ? "webp" : "jpg";
      const fd = new FormData();
      fd.append("access_token", accessToken);
      fd.append("source", imgBlob, `campaign_${campaignId}.${ext}`);
      const upRes = await fetch(`${GRAPH}/${actId}/adimages`, { method: "POST", body: fd });
      const upText = await upRes.text();
      const upBody = upText ? (JSON.parse(upText) as { images?: Record<string, { hash: string }> } & GraphErrorBody) : {};
      if (!upRes.ok) {
        const errCode = (upBody as GraphErrorBody).error?.code;
        const isCapability =
          errCode === 3 || errCode === 10 || errCode === 200 || errCode === 294 ||
          /capability|permission|not have/i.test((upBody as GraphErrorBody).error?.message ?? "");
        console.warn("[publishCampaign] upload_media (bytes) fail", {
          status: upRes.status, body: upBody, size: imgSize, contentType: imgContentType,
          willFallbackToPictureUrl: isCapability,
        });
        if (!isCapability) {
          return fail(
            "upload_media",
            formatGraphError(upBody as GraphErrorBody, `HTTP ${upRes.status}`),
            upBody,
          );
        }
        // Capability bloqueada: fallback para picture URL no creative.
      } else {
        const images = (upBody as { images?: Record<string, { hash: string }> }).images ?? {};
        imageHash = Object.values(images)[0]?.hash ?? null;
        console.log("[publishCampaign] upload_media (bytes) ok", {
          imageHash, size: imgSize, contentType: imgContentType, usedUploadByBytes: true,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "network_error";
      console.error("[publishCampaign] upload_media (bytes) error", { msg });
      return fail("upload_media", `Falha ao enviar bytes para a Meta (${msg}).`);
    }


    // Step B: cria campaign (OUTCOME_LEADS). Em modo retomada, reutiliza o
    // meta_campaign_id já gravado.
    let metaCampaignId: string;
    if (isResume && resumeMetaCampaignId) {
      metaCampaignId = resumeMetaCampaignId;
      console.log("[publishCampaign] create_campaign skipped (resume)", { metaCampaignId });
    } else {
      const campaignPayload = {
        name: campaign.name,
        objective: "OUTCOME_LEADS",
        status: "PAUSED",
        special_ad_categories: [] as string[],
        buying_type: "AUCTION",
        is_adset_budget_sharing_enabled: false,
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
      metaCampaignId = campRes.data.id;
      console.log("[publishCampaign] create_campaign ok", { metaCampaignId });
      // Persiste imediatamente para permitir retomada se etapas seguintes falharem.
      await supabase
        .from("campaigns")
        .update({ meta_campaign_id: metaCampaignId } as never)
        .eq("id", campaignId);
    }


    // Busca telefone WhatsApp da empresa (para o link wa.me do CTA).
    let waPhone = "";
    try {
      const { data: waInteg } = await adminClient.supabaseAdmin
        .from("integrations")
        .select("account_metadata, external_account_id")
        .eq("company_id", companyId)
        .eq("channel", "whatsapp")
        .eq("active", true)
        .maybeSingle();
      const md = (waInteg?.account_metadata ?? {}) as Record<string, unknown>;
      waPhone = String(md["phone_number"] ?? md["display_phone_number"] ?? "").replace(/\D/g, "");
      console.log("[publishCampaign] whatsapp phone lookup", { found: Boolean(waPhone), waPhone });
    } catch (e) {
      console.warn("[publishCampaign] whatsapp phone lookup failed", e);
    }

    // Step C: cria adset (Click to WhatsApp). Em modo retomada, reutiliza.
    let metaAdsetId: string;
    if (isResume && resumeMetaAdsetId) {
      metaAdsetId = resumeMetaAdsetId;
      console.log("[publishCampaign] create_adset skipped (resume)", { metaAdsetId });
    } else {
      const dailyBudgetCents = Math.round(Number(campaign.daily_budget) * 100);

      // Resolve cidade via Meta Targeting Search (geo_locations.cities exige `key`).
      let geoLocations: Record<string, unknown> = { countries: ["BR"] };
      if (campaign.city) {
        const searchUrl =
          `${GRAPH}/search?type=adgeolocation` +
          `&q=${encodeURIComponent(campaign.city)}` +
          `&location_types=${encodeURIComponent(JSON.stringify(["city"]))}` +
          `&country_code=BR&limit=5` +
          `&access_token=${encodeURIComponent(accessToken)}`;
        const geoRes = await graphFetch<{ data: Array<{ key: string; name: string; country_code?: string }> }>(
          searchUrl,
          { method: "GET" },
        );
        const results = geoRes.ok ? geoRes.data?.data ?? [] : [];
        const match =
          results.find((r) => (r.country_code ?? "").toUpperCase() === "BR") ?? results[0];
        console.log("[publishCampaign] geo search", {
          city: campaign.city,
          results: results.map((r) => ({ key: r.key, name: r.name, cc: r.country_code })),
          chosen: match?.key ?? null,
        });
        if (match?.key) {
          geoLocations = {
            cities: [
              { key: match.key, radius: campaign.radius_km ?? 25, distance_unit: "kilometer" },
            ],
          };
        }
      }

      const targeting = { geo_locations: geoLocations };
      const adsetPayload = {
        name: `${campaign.name} — adset`,
        campaign_id: metaCampaignId,
        daily_budget: dailyBudgetCents,
        billing_event: "IMPRESSIONS",
        optimization_goal: "CONVERSATIONS",
        destination_type: "WHATSAPP",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        status: "PAUSED",
        targeting,
        promoted_object: { page_id: pageId },
      };
      console.log("[publishCampaign] adset targeting", targeting);
      console.log("[publishCampaign] create_adset payload", adsetPayload);

      const adsetRes = await graphFetch<{ id: string }>(
        `${GRAPH}/${actId}/adsets?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(adsetPayload),
        },
      );
      if (!adsetRes.ok) {
        console.error("[publishCampaign] create_adset fail", {
          status: adsetRes.status, message: adsetRes.message, body: adsetRes.body,
        });
        // NÃO faz rollback da campaign — mantemos para permitir retomada.
        return fail("create_adset", formatGraphError(adsetRes.body, adsetRes.message), adsetRes.body);
      }
      metaAdsetId = adsetRes.data.id;
      console.log("[publishCampaign] create_adset ok", { metaAdsetId });
      await supabase
        .from("campaigns")
        .update({ meta_adset_id: metaAdsetId } as never)
        .eq("id", campaignId);
    }


    // Step D: cria creative. Usa image_hash (upload do usuário) se possível;
    // caso contrário, passa `picture` com a URL pública direto (fallback).
    // O link do CTA WHATSAPP_MESSAGE precisa de um wa.me válido com o número
    // da página/empresa — sem isso a Meta retorna 400 em /adcreatives.
    const waLink = waPhone ? `https://wa.me/${waPhone}` : `https://www.facebook.com/${pageId}`;
    const linkData: Record<string, unknown> = {
      message: campaign.primary_text ?? "",
      name: campaign.headline ?? campaign.name,
      link: waLink,
      call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP", link: waLink } },
    };
    if (imageHash) linkData.image_hash = imageHash;
    else if (campaign.media_url) linkData.picture = campaign.media_url;
    const creativePayload = {
      name: `${campaign.name} — creative`,
      object_story_spec: { page_id: pageId, link_data: linkData },
    };
    console.log("[publishCampaign] create_creative", {
      pageId, usingImageHash: Boolean(imageHash), usingPictureUrl: !imageHash && Boolean(campaign.media_url),
      waLink, payload: creativePayload,
    });
    const creativeRes = await graphFetch<{ id: string }>(
      `${GRAPH}/${actId}/adcreatives?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creativePayload),
      },
    );
    if (!creativeRes.ok) {
      console.error("[publishCampaign] create_creative fail", {
        status: creativeRes.status, message: creativeRes.message, body: creativeRes.body,
      });
      return fail("create_creative", formatGraphError(creativeRes.body, creativeRes.message), creativeRes.body);
    }
    const creativeId = creativeRes.data.id;
    console.log("[publishCampaign] create_creative ok", { creativeId });

    // Step E: cria ad.
    const adPayload = {
      name: `${campaign.name} — ad`,
      adset_id: metaAdsetId,
      creative: { creative_id: creativeId },
      status: "PAUSED",
    };
    console.log("[publishCampaign] create_ad", { payload: adPayload });
    const adRes = await graphFetch<{ id: string }>(
      `${GRAPH}/${actId}/ads?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adPayload),
      },
    );
    if (!adRes.ok) {
      console.error("[publishCampaign] create_ad fail", {
        status: adRes.status, message: adRes.message, body: adRes.body,
      });
      return fail("create_ad", formatGraphError(adRes.body, adRes.message), adRes.body);
    }
    const metaAdId = adRes.data.id;
    console.log("[publishCampaign] create_ad ok", { metaAdId });

    // 5) Sucesso — grava IDs e marca ativa (Meta criou tudo em PAUSED por segurança;
    // o usuário ativa pelo Gerenciador da Meta na primeira rodada do Beta).
    const { error: saveErr } = await supabase
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
    if (saveErr) {
      console.error("[publishCampaign] save ids failed", { campaignId, error: saveErr });
    } else {
      console.log("[publishCampaign] success — saved ids", {
        campaignId, metaCampaignId, metaAdsetId, creativeId, metaAdId,
      });
    }

    return {
      ok: true as const,
      ids: { campaign: metaCampaignId, adset: metaAdsetId, creative: creativeId, ad: metaAdId },
    };
  });
