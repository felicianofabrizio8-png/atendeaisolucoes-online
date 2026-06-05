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

    // Escopo do Beta: canal suportado (whatsapp/messenger/instagram) + Leads
    // + imagem única + orçamento diário. Requisitos específicos por canal
    // (número WA, página FB, ig_business_account_id) são checados mais abaixo
    // antes da criação do creative, com mensagens dedicadas.
    const supportedChannels = ["whatsapp", "messenger", "instagram"] as const;
    if (!supportedChannels.includes(campaign.objective as (typeof supportedChannels)[number])) {
      return { ok: false as const, error: "scope_objective", message: `Canal '${campaign.objective}' não suportado. Use WhatsApp, Messenger ou Instagram.` };
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



    // Resultado do pré-check de acessibilidade da mídia enviada à Meta.
    // Populado quando o pipeline cair no fallback "picture URL" (último recurso),
    // ou quando algum probe explícito for executado. Exibido no painel.
    type MediaCheck = {
      url: string;
      status: number | null;
      contentType: string | null;
      ok: boolean;
      method: "HEAD" | "GET" | "none";
      error?: string;
      source: "public" | "signed";
    };
    let mediaCheck: MediaCheck | null = null;

    // HEAD primeiro (mais barato). Se o storage não responder a HEAD, tenta GET
    // de 1 byte via Range para validar status + content-type sem baixar o arquivo.
    async function probePublicUrl(url: string, source: "public" | "signed"): Promise<MediaCheck> {
      try {
        const h = await fetch(url, { method: "HEAD" });
        const ct = h.headers.get("content-type");
        if (h.ok && ct && /^image\//i.test(ct)) {
          return { url, status: h.status, contentType: ct, ok: true, method: "HEAD", source };
        }
        const g = await fetch(url, { method: "GET", headers: { Range: "bytes=0-1" } });
        const ct2 = g.headers.get("content-type");
        const okGet = (g.ok || g.status === 206) && !!ct2 && /^image\//i.test(ct2);
        return {
          url, status: g.status, contentType: ct2,
          ok: okGet, method: "GET", source,
          error: okGet ? undefined : `status=${g.status} content-type=${ct2 ?? "—"}`,
        };
      } catch (e) {
        return {
          url, status: null, contentType: null, ok: false, method: "HEAD", source,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }

    async function fail(stage: string, message: string, raw?: unknown, extra?: Record<string, unknown>) {
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
        extra: extra ?? null,
        mediaCheck,
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
            media_check: mediaCheck,
            ...(extra ?? {}),
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
        mediaCheck,
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
    console.log("[publishCampaign] media ready (raw)", { source: imgSource, size: imgSize, contentType: imgContentType });

    // Normaliza a imagem ANTES do upload para Meta:
    // - converte para JPG RGB
    // - resize para caber em 1080x1080 (feed) preservando aspect ratio
    //   (1080x1920 se a campanha for marcada como story/reel)
    // - qualidade 85, peso < 4MB (re-encoda menor se necessário)
    // - filename ASCII simples
    // Isso evita rejeições da Meta por formato/cor/tamanho.
    try {
      const placementHint = String(
        (campaign as { placement?: string }).placement ??
        (campaign as { format?: string }).format ?? "",
      );
      const isStory = /story|reel|vertical/i.test(placementHint);
      const maxW = 1080;
      const maxH = isStory ? 1920 : 1080;
      const { Jimp } = await import("jimp");
      const rawBytes = new Uint8Array(await imgBlob.arrayBuffer());
      const sig = Array.from(rawBytes.slice(0, 4)).join(",");
      console.log("[publishCampaign] image input", {
        inputType: "Blob", mime: imgContentType, size: imgSize,
        bufferLength: rawBytes.byteLength, signature: sig, source: imgSource,
      });
      // Jimp.read trata string como URL/path. Para bytes brutos é obrigatório
      // usar Jimp.fromBuffer com um Buffer real (não Uint8Array).
      const buf = Buffer.from(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
      const img = await Jimp.fromBuffer(buf);
      const w0 = img.bitmap.width;
      const h0 = img.bitmap.height;
      const scale = Math.min(1, maxW / w0, maxH / h0);
      const tw = Math.max(1, Math.round(w0 * scale));
      const th = Math.max(1, Math.round(h0 * scale));
      if (scale < 1) {
        img.resize({ w: tw, h: th });
      }
      // Flatten alpha onto white to ensure RGB JPEG output
      let quality = 85;
      let outBuf = await img.getBuffer("image/jpeg", { quality });
      while (outBuf.byteLength > 4 * 1024 * 1024 && quality > 50) {
        quality -= 10;
        outBuf = await img.getBuffer("image/jpeg", { quality });
      }
      imgBlob = new Blob([new Uint8Array(outBuf).buffer as ArrayBuffer], { type: "image/jpeg" });
      imgSize = imgBlob.size;
      imgContentType = "image/jpeg";
      console.log("[publishCampaign] media normalized", {
        from: { w: w0, h: h0 }, to: { w: tw, h: th },
        quality, size: imgSize,
        target: isStory ? "story_1080x1920" : "feed_1080x1080",
      });
      if (!imgSize) {
        return fail("upload_media", "Falha ao normalizar a imagem (saída vazia).");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[publishCampaign] image normalize failed", { msg });
      return fail("upload_media", `Não foi possível processar a imagem (${msg}). Reenvie em JPG/PNG.`);
    }


    // Upload por bytes via multipart/form-data (filename ASCII simples)
    try {
      const fd = new FormData();
      fd.append("access_token", accessToken);
      fd.append("source", imgBlob, `campaign_${campaignId}.jpg`);
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
      // destination_type por canal — define onde a conversa acontece
      const channelDestination =
        campaign.objective === "whatsapp" ? "WHATSAPP"
        : campaign.objective === "messenger" ? "MESSENGER"
        : "INSTAGRAM_DIRECT";
      const adsetPayload = {
        name: `${campaign.name} — adset`,
        campaign_id: metaCampaignId,
        daily_budget: dailyBudgetCents,
        billing_event: "IMPRESSIONS",
        optimization_goal: "CONVERSATIONS",
        destination_type: channelDestination,
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


    // Step D: cria creative. Tenta primeiro um payload "completo" (com headline
    // e message) e, se a Meta recusar (typicamente code=100 / subcode=1487390
    // por incompatibilidade de imagem / placements), faz fallback automático
    // para o creative mínimo (somente link + CTA, feed only).
    const camp = campaign!;
    const channel = camp.objective as "whatsapp" | "messenger" | "instagram";

    // Mapeia o texto de CTA (PT-BR) para o enum aceito pela Meta, conforme o canal.
    // A Meta valida CTA enum × destination_type — texto livre nunca é aceito.
    function mapCtaToMetaEnum(raw: string | null | undefined, ch: typeof channel): string {
      const t = (raw ?? "").trim().toLowerCase();
      // Aliases comuns que indicam "abrir conversa" — caem no enum do canal.
      const messageAliases = [
        "solicitar orçamento", "solicitar orcamento",
        "enviar mensagem", "fale conosco", "falar", "mensagem", "conversar",
        "tirar dúvidas", "tirar duvidas", "chamar", "whatsapp", "messenger", "instagram",
      ];
      const looksLikeMessage = !t || messageAliases.some((a) => t.includes(a));
      if (ch === "whatsapp") return "WHATSAPP_MESSAGE";
      if (ch === "messenger") return looksLikeMessage ? "MESSAGE_PAGE" : "MESSAGE_PAGE";
      // instagram
      return looksLikeMessage ? "INSTAGRAM_MESSAGE" : "INSTAGRAM_MESSAGE";
    }

    const ctaEnum = mapCtaToMetaEnum(camp.cta, channel);

    // Busca instagram_actor_id (necessário p/ creative IG) a partir da integração Meta.
    const igActorId = String((meta["ig_business_account_id"] ?? "") as string);

    console.log("[publishCampaign] cta_mapping", {
      raw_cta: camp.cta ?? null,
      mapped_enum: ctaEnum,
      objective: camp.objective,
      goal: camp.goal,
      channel,
      page_id: pageId,
      ig_actor_id: igActorId || null,
      wa_phone: waPhone || null,
    });

    // Validações duras por canal — Meta rejeita o creative sem esses dados.
    if (!imageHash) {
      return fail(
        "create_creative",
        "image_hash ausente — o upload da imagem em /adimages falhou e a Meta não aceita criativo sem hash.",
        null,
        { page_id: pageId, channel },
      );
    }
    if (channel === "whatsapp" && !waPhone) {
      return fail(
        "create_creative",
        "Número de WhatsApp da página não encontrado — vincule um WhatsApp Business no Gerenciador da Meta antes de publicar.",
        null,
        { page_id: pageId, image_hash: imageHash },
      );
    }
    if (channel === "instagram" && !igActorId) {
      return fail(
        "create_creative",
        "Instagram Business não vinculado — conecte um Instagram à sua Página Facebook antes de publicar.",
        null,
        { page_id: pageId, image_hash: imageHash },
      );
    }
    if (channel === "messenger" && !pageId) {
      return fail(
        "create_creative",
        "Página Facebook não selecionada — Messenger exige uma Página vinculada.",
        null,
        { image_hash: imageHash },
      );
    }

    // Meta aceita wa.me OU api.whatsapp.com/send. Usamos o formato oficial recomendado.
    const waLink = waPhone ? `https://api.whatsapp.com/send?phone=${waPhone}` : "";
    const messengerLink = `https://m.me/${pageId}`;
    const igLink = `https://ig.me/m/${igActorId}`;
    const destLink = channel === "whatsapp" ? waLink : channel === "messenger" ? messengerLink : igLink;
    const fallbackMessage = (camp.primary_text ?? camp.headline ?? camp.name ?? "Olá! Posso te ajudar?").trim() || "Olá! Posso te ajudar?";

    // CTA value: APENAS app_destination + link. Campos extras (ex.: whatsapp_number)
    // fazem a Meta rejeitar com code=100 subcode=1487390 (erro genérico de creative).
    function buildCtaValue(): Record<string, unknown> {
      if (channel === "whatsapp") {
        return { app_destination: "WHATSAPP", link: waLink };
      }
      if (channel === "messenger") {
        return { app_destination: "MESSENGER", link: messengerLink };
      }
      return { app_destination: "INSTAGRAM_DIRECT", link: igLink };
    }

    type CreativeMode = "advanced" | "simple" | "picture";

    // Gera (sob demanda) uma URL acessível externamente para a Meta baixar a
    // imagem no fallback "picture". Sempre prefere signed URL (1 dia) porque o
    // bucket pode estar privado — a URL pública crua retornaria 400/404.
    let pictureUrlForMeta: string | null = null;
    async function getPictureUrlForMeta(): Promise<string | null> {
      if (pictureUrlForMeta) return pictureUrlForMeta;
      const raw = camp.media_url ?? "";
      if (!raw) return null;
      const parsed = parseSupabaseStoragePath(raw);
      if (parsed) {
        const { data: signed, error: signErr } = await adminClient.supabaseAdmin
          .storage.from(parsed.bucket).createSignedUrl(parsed.path, 60 * 60 * 24);
        if (!signErr && signed?.signedUrl) {
          pictureUrlForMeta = signed.signedUrl;
          return pictureUrlForMeta;
        }
        console.warn("[publishCampaign] createSignedUrl failed — usando URL crua", { signErr });
      }
      pictureUrlForMeta = raw;
      return pictureUrlForMeta;
    }

    function buildLinkData(mode: CreativeMode, pictureUrl: string | null): Record<string, unknown> {
      const ld: Record<string, unknown> = {
        message: fallbackMessage,
        link: destLink,
        call_to_action: { type: ctaEnum, value: buildCtaValue() },
      };
      if (mode === "picture" && pictureUrl) {
        ld.picture = pictureUrl;
      } else {
        ld.image_hash = imageHash;
      }
      if (mode === "advanced") {
        ld.name = camp.headline ?? camp.name;
      }
      return ld;
    }

    function buildCreativePayload(mode: CreativeMode, pictureUrl: string | null) {
      const oss: Record<string, unknown> = {
        page_id: pageId,
        link_data: buildLinkData(mode, pictureUrl),
      };
      if (channel === "instagram" && igActorId) {
        oss.instagram_actor_id = igActorId;
      }
      const suffix = mode === "advanced" ? "" : mode === "simple" ? " (fallback)" : " (picture)";
      return {
        name: `${camp.name} — creative${suffix}`,
        object_story_spec: oss,
      };
    }


    async function tryCreateCreative(mode: CreativeMode) {
      const pictureUrl = mode === "picture" ? await getPictureUrlForMeta() : null;
      const payload = buildCreativePayload(mode, pictureUrl);
      const linkData = (payload.object_story_spec as { link_data: Record<string, unknown> }).link_data;
      console.log("[publishCampaign] create_creative attempt", {
        mode,
        pageId,
        instagram_actor_id: igActorId || null,
        image_hash: linkData.image_hash ?? null,
        picture: linkData.picture ?? null,
        call_to_action: linkData.call_to_action,
        link_data: linkData,
        object_story_spec: payload.object_story_spec,
        waLink,
        payload,
      });
      const res = await graphFetch<{ id: string }>(
        `${GRAPH}/${actId}/adcreatives?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      return { res, payload };
    }

    function resBody(r: { ok: boolean; body?: unknown }) {
      return r.ok ? null : (r as { body: unknown }).body;
    }

    let creativeId: string;
    const attempts: Array<{ mode: CreativeMode; payload: unknown; response: unknown }> = [];

    const advanced = await tryCreateCreative("advanced");
    attempts.push({ mode: "advanced", payload: advanced.payload, response: resBody(advanced.res) });

    if (advanced.res.ok) {
      creativeId = advanced.res.data.id;
      console.log("[publishCampaign] create_creative ok", { creativeId, mode: "advanced" });
    } else {
      console.warn("[publishCampaign] advanced fail — tentando simple", {
        status: advanced.res.status, message: advanced.res.message,
      });
      const simple = await tryCreateCreative("simple");
      attempts.push({ mode: "simple", payload: simple.payload, response: resBody(simple.res) });

      if (simple.res.ok) {
        creativeId = simple.res.data.id;
        console.log("[publishCampaign] create_creative ok", { creativeId, mode: "simple" });
      } else if (camp.media_url) {
        console.warn("[publishCampaign] simple fail — preparando fallback picture URL", {
          status: simple.res.status, message: simple.res.message,
        });
        // Pré-check: garante que a URL que será enviada à Meta é realmente
        // pública e devolve um content-type de imagem. Sem isso, a Meta
        // responde "Não foi possível baixar sua imagem".
        const picUrl = await getPictureUrlForMeta();
        if (!picUrl) {
          return fail("create_creative", "Mídia indisponível para fallback (URL ausente).", null, { attempts });
        }
        mediaCheck = await probePublicUrl(picUrl, picUrl === camp.media_url ? "public" : "signed");
        console.log("[publishCampaign] picture pre-check", mediaCheck);
        if (!mediaCheck.ok) {
          return fail(
            "create_creative",
            `A imagem do criativo não está acessível externamente (HTTP ${mediaCheck.status ?? "—"}, ${mediaCheck.contentType ?? "sem content-type"}). A Meta não conseguiria baixá-la. Reenvie a imagem na campanha.`,
            null,
            { attempts, page_id: pageId, image_hash: imageHash ?? null, channel },
          );
        }
        const pic = await tryCreateCreative("picture");
        attempts.push({ mode: "picture", payload: pic.payload, response: resBody(pic.res) });

        if (!pic.res.ok) {
          console.error("[publishCampaign] all creative modes failed", { attempts, mediaCheck });
          return fail(
            "create_creative",
            formatGraphError(pic.res.body, pic.res.message),
            pic.res.body,
            {
              attempts,
              page_id: pageId,
              image_hash: imageHash ?? null,
              wa_link: waLink,
              channel,
              cta_enum: ctaEnum,
            },
          );
        }
        creativeId = pic.res.data.id;
        console.log("[publishCampaign] create_creative ok", { creativeId, mode: "picture" });
      } else {
        console.error("[publishCampaign] create_creative fallback fail (sem media_url)", { attempts });
        return fail(
          "create_creative",
          formatGraphError(simple.res.body, simple.res.message),
          simple.res.body,
          {
            attempts,
            page_id: pageId,
            image_hash: imageHash ?? null,
            wa_link: waLink,
            channel,
            cta_enum: ctaEnum,
          },
        );
      }
    }


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

    // Step F: confirma que o ad existe na Meta antes de marcar como publicada.
    const verifyRes = await graphFetch<{ id: string; status?: string }>(
      `${GRAPH}/${metaAdId}?fields=id,status,effective_status&access_token=${encodeURIComponent(accessToken)}`,
      { method: "GET" },
    );
    if (!verifyRes.ok || !verifyRes.data?.id) {
      console.error("[publishCampaign] verify_ad fail", {
        metaAdId, status: verifyRes.ok ? 200 : verifyRes.status,
        body: verifyRes.ok ? verifyRes.data : verifyRes.body,
      });
      return fail(
        "verify_ad",
        verifyRes.ok ? "Meta não confirmou o ad criado." : formatGraphError(verifyRes.body, verifyRes.message),
        verifyRes.ok ? verifyRes.data : verifyRes.body,
      );
    }
    console.log("[publishCampaign] verify_ad ok", { metaAdId, verified: verifyRes.data });


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
