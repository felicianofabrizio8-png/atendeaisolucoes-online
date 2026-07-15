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
import { postGraph } from "@/lib/outbound/MetaOutbound.server";
import { isSimulation, isRealDelivery, isFailure } from "@/lib/outbound/MetaOutboundContract";
import { assertOutbound } from "@/lib/environment/EnvironmentGuard.server";

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

// -------------------------------------------------------------------------
// Fronteira MetaOutbound (Fase B.6.2): TODAS as escritas para Graph passam
// aqui. Preserva a forma de retorno do graphFetch legado (drop-in), mas em
// staging (kill switch ON + tenant staging) o postGraph curto-circuita
// devolvendo simulation — nenhum fetch real acontece.
//
// GETs somente-leitura permanecem no graphFetch original (por diretriz).
// -------------------------------------------------------------------------
type GraphWriteOk<T> = { ok: true; data: T; status: number; rawText: string; responseHeaders: Record<string, string> };
type GraphWriteFail = { ok: false; status: number; body: GraphErrorBody; message: string; rawText: string; responseHeaders: Record<string, string> };
type GraphWriteResult<T> = GraphWriteOk<T> | GraphWriteFail;

async function graphWrite<T>(
  args: {
    companyId: string;
    userId: string;
    action: string;
    url: string;
    method?: "POST" | "DELETE" | "PUT" | "PATCH";
    headers?: Record<string, string>;
    body?: BodyInit;
    logicalPayload?: unknown;
  },
): Promise<GraphWriteResult<T>> {
  const r = await postGraph<T>({
    companyId: args.companyId,
    userId: args.userId,
    action: args.action,
    url: args.url,
    method: args.method ?? "POST",
    headers: args.headers,
    body: args.body,
    logicalPayload: args.logicalPayload,
  });

  if (isSimulation(r)) {
    // Defesa: o pipeline sempre executa o probe upfront; se um write cair
    // em simulation aqui, é um bug de guard. Trata como falha suave, sem
    // fabricar IDs, para que a etapa seja registrada como "não executada".
    return {
      ok: false,
      status: 0,
      body: { error: { message: "simulated_after_probe_pass" } },
      message: "simulated_after_probe_pass",
      rawText: "",
      responseHeaders: {},
    };
  }
  if (isRealDelivery(r)) {
    const rawText = typeof r.raw === "string" ? r.raw : JSON.stringify(r.raw ?? null);
    return {
      ok: true,
      data: r.raw as T,
      status: r.status,
      rawText,
      responseHeaders: {},
    };
  }
  // isFailure
  if (isFailure(r)) {
    const body = (r.parsedBody ?? {}) as GraphErrorBody;
    return {
      ok: false,
      status: r.status ?? 0,
      body,
      message: r.error,
      rawText: r.rawBody ?? "",
      responseHeaders: {},
    };
  }
  // Inalcançável — exhaustive.
  return {
    ok: false,
    status: 0,
    body: {},
    message: "unknown_outbound_state",
    rawText: "",
    responseHeaders: {},
  };
}

const GRAPH = "https://graph.facebook.com/v21.0";

async function graphFetch<T>(
  url: string,
  init: RequestInit,
): Promise<
  | { ok: true; data: T; status: number; rawText: string; responseHeaders: Record<string, string> }
  | { ok: false; status: number; body: GraphErrorBody; message: string; rawText: string; responseHeaders: Record<string, string> }
> {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { responseHeaders[k] = v; });
    const body = text ? (JSON.parse(text) as T & GraphErrorBody) : ({} as T & GraphErrorBody);
    if (!res.ok) {
      const msg = (body as GraphErrorBody).error?.message ?? `HTTP ${res.status}`;
      return { ok: false, status: res.status, body, message: msg, rawText: text, responseHeaders };
    }
    return { ok: true, data: body, status: res.status, rawText: text, responseHeaders };
  } catch (e) {
    const message = e instanceof Error ? e.message : "network_error";
    return { ok: false, status: 0, body: {}, message, rawText: "", responseHeaders: {} };
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
    const { data: isAdmin } = await sb.rpc("has_role", { _user_id: userId, _company_id: companyId, _role: "admin" });
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

    // 3.1) Pré-check de tipo do token: Marketing API exige USER ou SYSTEM_USER.
    // PAGE tokens são silenciosamente rejeitados pelo Graph com erros genéricos
    // (#100 / 1487390) em /act_*/adcreatives. Aborta cedo com mensagem clara.
    try {
      const tokEnc = encodeURIComponent(accessToken);
      const appToken = process.env.META_APP_ID && process.env.META_APP_SECRET
        ? `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`
        : accessToken;
      const dbgRes = await fetch(
        `${GRAPH}/debug_token?input_token=${tokEnc}&access_token=${encodeURIComponent(appToken)}`,
      );
      const dbgJson = (await dbgRes.json().catch(() => null)) as
        | { data?: { type?: string; is_valid?: boolean; scopes?: string[]; app_id?: string } }
        | null;
      const tokenType = dbgJson?.data?.type ?? null;
      const tokenScopes = dbgJson?.data?.scopes ?? [];
      const isValid = dbgJson?.data?.is_valid ?? false;
      console.log("[publishCampaign] token_type_check", {
        campaignId,
        integration_id: integ.id,
        token_type: tokenType,
        is_valid: isValid,
        has_ads_management: tokenScopes.includes("ads_management"),
        has_ads_read: tokenScopes.includes("ads_read"),
        has_business_management: tokenScopes.includes("business_management"),
      });
      if (!isValid) {
        return {
          ok: false as const,
          error: "token_invalid",
          message:
            "O token Meta está inválido ou expirado. Reconecte a Meta Ads em Configurações.",
        };
      }
      if (tokenType !== "USER" && tokenType !== "SYSTEM_USER") {
        return {
          ok: false as const,
          error: "token_type_invalid",
          message:
            "Reconecte a Meta Ads. O token atual é de Página e não pode criar anúncios.",
          token_type: tokenType,
        };
      }
      const required = ["ads_management", "ads_read", "business_management"];
      const missing = required.filter((s) => !tokenScopes.includes(s));
      if (missing.length > 0) {
        return {
          ok: false as const,
          error: "token_scopes_missing",
          message: `Reconecte a Meta Ads concedendo as permissões: ${missing.join(", ")}.`,
          missing_scopes: missing,
        };
      }

      const [meRes, adAccountsRes] = await Promise.all([
        fetch(`${GRAPH}/me?fields=id,name&access_token=${tokEnc}`),
        fetch(`${GRAPH}/me/adaccounts?fields=id,account_id,name&limit=25&access_token=${tokEnc}`),
      ]);
      const meJson = (await meRes.json().catch(() => null)) as { id?: string; name?: string; error?: { message?: string } } | null;
      const adAccountsJson = (await adAccountsRes.json().catch(() => null)) as { data?: unknown[]; error?: { message?: string } } | null;
      const adAccountsCount = Array.isArray(adAccountsJson?.data) ? adAccountsJson.data.length : 0;
      console.log("[publishCampaign] marketing_api_user_check", {
        campaignId,
        integration_id: integ.id,
        me_status: meRes.status,
        me: meJson ? { id: meJson.id ?? null, name: meJson.name ?? null, error: meJson.error ?? null } : null,
        adaccounts_status: adAccountsRes.status,
        adaccounts_count: adAccountsCount,
        adaccounts_error: adAccountsJson?.error ?? null,
      });
      if (!meRes.ok || meJson?.error || !meJson?.id) {
        return {
          ok: false as const,
          error: "token_me_failed",
          message: "Reconecte a Meta Ads. O token atual não retornou um usuário válido em /me.",
        };
      }
      if (!adAccountsRes.ok || adAccountsJson?.error || adAccountsCount === 0) {
        return {
          ok: false as const,
          error: "token_adaccounts_failed",
          message: "Reconecte a Meta Ads. O token USER atual não retornou contas em /me/adaccounts.",
        };
      }
    } catch (e) {
      console.warn("[publishCampaign] token_type_check_exception", {
        campaignId,
        e: e instanceof Error ? e.message : String(e),
      });
      return {
        ok: false as const,
        error: "token_validation_failed",
        message: "Não foi possível validar o token Meta antes da publicação. Reconecte a Meta Ads e tente novamente.",
      };
    }


    // ------------------------------------------------------------------
    // Guard probe (Fase B.6.2): decisão de ambiente ANTES da primeira
    // mutação (DB ou Graph). Em staging, curto-circuita a publicação
    // inteira com uma única entrada em environment_simulations descrevendo
    // as etapas que teriam sido executadas. Não persiste status=publishing,
    // não sobe imagem, não cria campaign/adset/creative/ad, não fabrica IDs,
    // não marca active_on_meta, não grava meta_publish_error.
    // ------------------------------------------------------------------
    const publishProbe = await assertOutbound({
      companyId,
      userId,
      action: "meta.campaign.publish",
      targetUrl: `${GRAPH}/${actId}/campaigns`,
      method: "POST",
      payload: {
        campaign_id: campaignId,
        campaign_name: campaign.name,
        objective: campaign.objective,
        goal: campaign.goal,
        daily_budget_cents: Math.round(Number(campaign.daily_budget) * 100),
        ad_account_id: actId,
        page_id: pageId,
        resume: isResume,
        steps_planned: [
          "upload_media/adimages",
          isResume && resumeMetaCampaignId ? "reuse_campaign" : "create_campaign",
          isResume && resumeMetaAdsetId ? "reuse_adset" : "create_adset",
          "create_creative",
          "create_ad",
          "activate_campaign",
          "activate_adset",
          "activate_ad",
        ],
      },
    });
    if (!publishProbe.proceed) {
      console.log("[publishCampaign] simulated (staging) — nenhuma escrita executada", {
        campaignId,
        environment: publishProbe.environment,
        simulationId: publishProbe.simulationId,
        reason: publishProbe.reason,
      });
      return {
        ok: true as const,
        simulated: true,
        externalRequestSent: false,
        environment: publishProbe.environment,
        simulationId: publishProbe.simulationId,
        steps_skipped: [
          "status=publishing",
          "upload_media/adimages",
          "create_campaign",
          "create_adset",
          "create_creative",
          "create_ad",
          "activate_objects",
          "persist_meta_ids",
          "mark_active_on_meta",
        ],
      };
    }

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

    type MetaObjectKind = "campaign" | "adset" | "ad";
    type MetaStatusResp = { id: string; status?: string; effective_status?: string };
    type StatusSnapshot = {
      object: MetaObjectKind;
      id: string;
      status?: string;
      effective_status?: string;
      error?: string;
    };

    async function fetchObjectStatus(object: MetaObjectKind, id: string): Promise<StatusSnapshot> {
      const res = await graphFetch<MetaStatusResp>(
        `${GRAPH}/${id}?fields=id,status,effective_status&access_token=${encodeURIComponent(accessToken)}`,
        { method: "GET" },
      );
      if (!res.ok) {
        return { object, id, error: formatGraphError(res.body, res.message) };
      }
      return {
        object,
        id,
        status: res.data.status,
        effective_status: res.data.effective_status,
      };
    }

    async function recordMetaStatusLog(
      phase: "after_creation" | "after_activation",
      snapshots: StatusSnapshot[],
      extra?: Record<string, unknown>,
    ) {
      const campaignStatus = snapshots.find((s) => s.object === "campaign");
      const adsetStatus = snapshots.find((s) => s.object === "adset");
      const adStatus = snapshots.find((s) => s.object === "ad");
      console.log("[publishCampaign] meta_status_log", {
        campaignId,
        phase,
        campaign_id: campaignStatus?.id ?? null,
        campaign_status: campaignStatus?.status ?? null,
        campaign_effective_status: campaignStatus?.effective_status ?? null,
        adset_id: adsetStatus?.id ?? null,
        adset_status: adsetStatus?.status ?? null,
        adset_effective_status: adsetStatus?.effective_status ?? null,
        ad_id: adStatus?.id ?? null,
        ad_status: adStatus?.status ?? null,
        ad_effective_status: adStatus?.effective_status ?? null,
        statuses: snapshots,
        ...(extra ?? {}),
      });
      try {
        await adminClient.supabaseAdmin.from("error_log").insert({
          company_id: companyId,
          user_id: userId,
          source: "meta",
          severity: "info",
          message: `[publish:${phase}] ` + snapshots
            .map((s) => `${s.object}=${s.status ?? "?"}/${s.effective_status ?? "?"}`)
            .join(" "),
          context: {
            campaign_id: campaignId,
            phase,
            meta_campaign_id: campaignStatus?.id ?? null,
            campaign_status: campaignStatus?.status ?? null,
            campaign_effective_status: campaignStatus?.effective_status ?? null,
            meta_adset_id: adsetStatus?.id ?? null,
            adset_status: adsetStatus?.status ?? null,
            adset_effective_status: adsetStatus?.effective_status ?? null,
            meta_ad_id: adStatus?.id ?? null,
            ad_status: adStatus?.status ?? null,
            ad_effective_status: adStatus?.effective_status ?? null,
            statuses: snapshots,
            ...(extra ?? {}),
          } as never,
        });
      } catch (e) {
        console.warn("[publishCampaign] meta_status_log insert failed", e);
      }
    }

    const pageCheck = await graphFetch<{ id: string; name?: string }>(
      `${GRAPH}/${encodeURIComponent(pageId)}?fields=id,name&access_token=${encodeURIComponent(accessToken)}`,
      { method: "GET" },
    );
    console.log("[publishCampaign] page_id_check", {
      ok: pageCheck.ok,
      page_id: pageId,
      page_name: pageCheck.ok ? pageCheck.data.name ?? null : null,
      error: pageCheck.ok ? null : formatGraphError(pageCheck.body, pageCheck.message),
    });
    if (!pageCheck.ok || pageCheck.data.id !== pageId) {
      return fail(
        "preflight_page",
        pageCheck.ok
          ? `Página Meta divergente: esperado ${pageId}, recebido ${pageCheck.data.id}.`
          : formatGraphError(pageCheck.body, pageCheck.message),
        pageCheck.ok ? pageCheck.data : pageCheck.body,
        { page_id: pageId },
      );
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


    // Upload por bytes via multipart/form-data (filename ASCII simples).
    // ATENÇÃO: o FormData é passado bit-a-bit ao fetch; nenhum Content-Type
    // manual, boundary gerado pelo runtime, stream não é lido duas vezes.
    // Em staging (guard ON), o graphWrite curto-circuita e nunca lê imgBlob.
    try {
      const fd = new FormData();
      fd.append("access_token", accessToken);
      fd.append("source", imgBlob, `campaign_${campaignId}.jpg`);
      const upRes = await graphWrite<{ images?: Record<string, { hash: string }> }>({
        companyId,
        userId,
        action: "meta.campaign.upload_adimages",
        url: `${GRAPH}/${actId}/adimages`,
        method: "POST",
        body: fd,
        // logicalPayload sanitizado: NUNCA envia o Blob para o SimulationLogger.
        logicalPayload: {
          endpoint: `${GRAPH}/${actId}/adimages`,
          filename: `campaign_${campaignId}.jpg`,
          content_type: imgContentType,
          size_bytes: imgSize,
          campaign_id: campaignId,
        },
      });
      if (!upRes.ok) {
        const errCode = (upRes.body as GraphErrorBody).error?.code;
        const isCapability =
          errCode === 3 || errCode === 10 || errCode === 200 || errCode === 294 ||
          /capability|permission|not have/i.test((upRes.body as GraphErrorBody).error?.message ?? "");
        console.warn("[publishCampaign] upload_media (bytes) fail", {
          status: upRes.status, body: upRes.body, size: imgSize, contentType: imgContentType,
          willFallbackToPictureUrl: isCapability,
        });
        if (!isCapability) {
          return fail(
            "upload_media",
            formatGraphError(upRes.body, `HTTP ${upRes.status}`),
            upRes.body,
          );
        }
        // Capability bloqueada: fallback para picture URL no creative.
      } else {
        const images = upRes.data.images ?? {};
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


    // Pré-check de acessibilidade externa via SIGNED URL (24h).
    // - Bucket product-images é privado: jamais usar URL /object/public/ na Meta.
    // - Gera signed URL e faz HEAD/GET. Se falhar e não tivermos image_hash, aborta
    //   antes de create_creative com mensagem clara.
    // - Pré-aquece `pictureUrlForMeta` para reutilização no fallback "picture".
    // - Loga campos obrigatórios em error_log (severity=info quando ok).
    const parsedForCheck = parseSupabaseStoragePath(campaign.media_url ?? "");
    const metaUploadStatus: "success" | "skipped_capability" =
      imageHash ? "success" : "skipped_capability";
    if (parsedForCheck) {
      const { data: signed, error: signErr } = await adminClient.supabaseAdmin
        .storage.from(parsedForCheck.bucket).createSignedUrl(parsedForCheck.path, 60 * 60 * 24);
      if (signErr || !signed?.signedUrl) {
        console.warn("[publishCampaign] createSignedUrl failed", { signErr });
      } else {
        // (signed URL será regenerado dentro de getPictureUrlForMeta se o fallback "picture" for usado)
        mediaCheck = await probePublicUrl(signed.signedUrl, "signed");
        const safeUrl = signed.signedUrl.split("?")[0] + "?token=***";
        console.log("[publishCampaign] image_access_check", {
          campaign_id: campaignId,
          stage: "image_access_check",
          image_path: parsedForCheck.path,
          storage_bucket: parsedForCheck.bucket,
          image_access_check_status: mediaCheck.status,
          method: mediaCheck.method,
          content_type: mediaCheck.contentType,
          ok: mediaCheck.ok,
          signed_url_preview: safeUrl,
          meta_upload_status: metaUploadStatus,
          image_hash: imageHash,
        });
        try {
          await adminClient.supabaseAdmin.from("error_log").insert({
            company_id: companyId,
            user_id: userId,
            source: "meta",
            severity: mediaCheck.ok ? "info" : "warning",
            message: `[publish:image_access_check] status=${mediaCheck.status ?? "—"} ok=${mediaCheck.ok}`,
            context: {
              campaign_id: campaignId,
              stage: "image_access_check",
              image_path: parsedForCheck.path,
              storage_bucket: parsedForCheck.bucket,
              image_access_check_status: mediaCheck.status,
              meta_upload_status: metaUploadStatus,
              image_hash: imageHash,
              content_type: mediaCheck.contentType,
              method: mediaCheck.method,
              signed_url_preview: safeUrl,
            } as never,
          });
        } catch (e) {
          console.warn("[publishCampaign] image_access_check log failed", e);
        }
        if (!imageHash && !mediaCheck.ok) {
          return fail(
            "image_access_check",
            `Imagem inacessível para a Meta (HTTP ${mediaCheck.status ?? "—"}, ${mediaCheck.contentType ?? "sem content-type"}) e upload por bytes não disponível. Reenvie a imagem na campanha.`,
            null,
            {
              image_path: parsedForCheck.path,
              storage_bucket: parsedForCheck.bucket,
              image_access_check_status: mediaCheck.status,
              meta_upload_status: metaUploadStatus,
              image_hash: imageHash,
            },
          );
        }
      }
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
        status: "ACTIVE",
        special_ad_categories: [] as string[],
        buying_type: "AUCTION",
        is_adset_budget_sharing_enabled: false,
      };
      console.log("[publishCampaign] create_campaign payload", {
        campaignId, actId, endpoint: `${GRAPH}/${actId}/campaigns`, payload: campaignPayload,
      });
      const campRes = await graphWrite<{ id: string }>({
        companyId,
        userId,
        action: "meta.campaign.create_campaign",
        url: `${GRAPH}/${actId}/campaigns?access_token=${encodeURIComponent(accessToken)}`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campaignPayload),
        logicalPayload: { endpoint: `${GRAPH}/${actId}/campaigns`, payload: campaignPayload },
      });
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


    // Busca telefone WhatsApp da empresa (para o link do CTA) e o phone_number_id
    // conectado — usado para validar que o anúncio aponta para o WABA correto.
    let waPhone = "";
    let waPhoneNumberId = "";
    let waWabaId = "";
    let waDisplayPhone = "";
    let waVerifiedName = "";
    let waPhoneVerified = false;
    let waIntegrationId: string | null = null;
    let waPhoneCheckError: { message: string; body: unknown; status: number } | null = null;
    let waWabaListError: { message: string; body: unknown; status: number } | null = null;
    try {
      const { data: waInteg } = await adminClient.supabaseAdmin
        .from("integrations")
        .select("id, account_metadata, external_account_id, access_token")
        .eq("company_id", companyId)
        .eq("channel", "whatsapp")
        .eq("active", true)
        .maybeSingle();
      waIntegrationId = (waInteg as { id?: string } | null)?.id ?? null;
      const md = (waInteg?.account_metadata ?? {}) as Record<string, unknown>;
      waPhone = String(md["phone_number"] ?? md["display_phone_number"] ?? "").replace(/\D/g, "");
      waPhoneNumberId = String(waInteg?.external_account_id ?? md["phone_number_id"] ?? "");
      waWabaId = String(md["waba_id"] ?? "");
      const waToken = String((waInteg as { access_token?: string | null } | null)?.access_token ?? "");

      console.log("[publishCampaign] whatsapp integration loaded (raw)", {
        integration_id: waIntegrationId,
        phone_number_id_saved: waPhoneNumberId || null,
        waba_id_saved: waWabaId || null,
        phone_saved: waPhone || null,
        has_token: Boolean(waToken),
      });

      type PhoneInfo = {
        id: string;
        display_phone_number?: string;
        verified_name?: string;
        whatsapp_business_account?: { id?: string; name?: string };
      };

      async function checkPhoneId(pid: string) {
        return graphFetch<PhoneInfo>(
          `${GRAPH}/${encodeURIComponent(pid)}?fields=id,display_phone_number,verified_name,whatsapp_business_account{id,name}&access_token=${encodeURIComponent(waToken)}`,
          { method: "GET" },
        );
      }

      function applyPhoneInfo(info: PhoneInfo) {
        waPhoneNumberId = info.id;
        waDisplayPhone = info.display_phone_number ?? "";
        waVerifiedName = info.verified_name ?? "";
        if (info.whatsapp_business_account?.id) waWabaId = info.whatsapp_business_account.id;
        if (info.display_phone_number) {
          waPhone = info.display_phone_number.replace(/\D/g, "");
        }
        waPhoneVerified = true;
      }

      if (waPhoneNumberId && waToken) {
        const phoneCheck = await checkPhoneId(waPhoneNumberId);
        console.log("[publishCampaign] whatsapp_phone_number_check", {
          ok: phoneCheck.ok,
          status: phoneCheck.ok ? 200 : phoneCheck.status,
          whatsapp_phone_number_id: waPhoneNumberId,
          display_phone_number: phoneCheck.ok ? phoneCheck.data.display_phone_number ?? null : null,
          verified_name: phoneCheck.ok ? phoneCheck.data.verified_name ?? null : null,
          waba_id: phoneCheck.ok ? phoneCheck.data.whatsapp_business_account?.id ?? null : waWabaId || null,
          error: phoneCheck.ok ? null : formatGraphError(phoneCheck.body, phoneCheck.message),
          raw_body: phoneCheck.ok ? null : phoneCheck.body,
        });
        if (phoneCheck.ok && phoneCheck.data.id === waPhoneNumberId && phoneCheck.data.display_phone_number) {
          applyPhoneInfo(phoneCheck.data);
        } else if (!phoneCheck.ok) {
          waPhoneCheckError = {
            message: formatGraphError(phoneCheck.body, phoneCheck.message),
            body: phoneCheck.body,
            status: phoneCheck.status,
          };
        }
      }

      // Fallback: o phone_number_id salvo está inválido/antigo. Buscar números
      // ativos da WABA conectada e adotar o primeiro verificado.
      if (!waPhoneVerified && waToken && waWabaId) {
        console.warn("[publishCampaign] phone_number_id inválido — buscando ativos da WABA", {
          waba_id: waWabaId,
          stale_phone_number_id: waPhoneNumberId || null,
        });
        const list = await graphFetch<{ data?: PhoneInfo[] }>(
          `${GRAPH}/${encodeURIComponent(waWabaId)}/phone_numbers?fields=id,display_phone_number,verified_name&access_token=${encodeURIComponent(waToken)}`,
          { method: "GET" },
        );
        console.log("[publishCampaign] whatsapp WABA phone_numbers", {
          ok: list.ok,
          status: list.ok ? 200 : list.status,
          count: list.ok ? list.data.data?.length ?? 0 : 0,
          numbers: list.ok ? list.data.data ?? [] : null,
          error: list.ok ? null : formatGraphError(list.body, list.message),
          raw_body: list.ok ? null : list.body,
        });
        if (!list.ok) {
          waWabaListError = {
            message: formatGraphError(list.body, list.message),
            body: list.body,
            status: list.status,
          };
        }
        const active = list.ok ? (list.data.data ?? []).find((p) => p?.id && p?.display_phone_number) : null;
        if (active) {
          const oldPid = waPhoneNumberId;
          applyPhoneInfo(active);
          // Atualiza o banco com o phone_number_id ativo
          if (waIntegrationId && waPhoneNumberId !== oldPid) {
            const newMd = {
              ...md,
              phone_number_id: waPhoneNumberId,
              phone_number: waDisplayPhone || waPhone,
              display_phone_number: waDisplayPhone,
              waba_id: waWabaId,
              verified_name: waVerifiedName,
            };
            await adminClient.supabaseAdmin
              .from("integrations")
              .update({
                external_account_id: waPhoneNumberId,
                account_metadata: newMd,
              } as never)
              .eq("id", waIntegrationId);
            console.log("[publishCampaign] integrations updated with active phone_number_id", {
              integration_id: waIntegrationId,
              old_phone_number_id: oldPid || null,
              new_phone_number_id: waPhoneNumberId,
            });
          }
        }
      }

      console.log("[publishCampaign] whatsapp phone resolved", {
        verified: waPhoneVerified,
        phone_number_id: waPhoneNumberId || null,
        business_account_id: waWabaId || null,
        display_phone_number: waDisplayPhone || waPhone || null,
        verified_name: waVerifiedName || null,
      });
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
      const promotedObject: Record<string, unknown> = { page_id: pageId };
      if (campaign.objective === "whatsapp" && waPhoneNumberId) {
        promotedObject.whats_app_business_phone_number_id = waPhoneNumberId;
        promotedObject.whatsapp_phone_number = waPhone;
      }
      const adsetPayload = {
        name: `${campaign.name} — adset`,
        campaign_id: metaCampaignId,
        daily_budget: dailyBudgetCents,
        billing_event: "IMPRESSIONS",
        optimization_goal: "CONVERSATIONS",
        destination_type: channelDestination,
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        status: "ACTIVE",
        targeting,
        promoted_object: promotedObject,
      };
      console.log("[publishCampaign] adset targeting", targeting);
      console.log("[publishCampaign] create_adset payload", adsetPayload);

      const adsetRes = await graphWrite<{ id: string }>({
        companyId,
        userId,
        action: "meta.campaign.create_adset",
        url: `${GRAPH}/${actId}/adsets?access_token=${encodeURIComponent(accessToken)}`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adsetPayload),
        logicalPayload: { endpoint: `${GRAPH}/${actId}/adsets`, payload: adsetPayload },
      });
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
        { page_id: pageId, whatsapp_phone_number_id: waPhoneNumberId || null, image_hash: imageHash },
      );
    }
    if (channel === "whatsapp" && !waPhoneNumberId) {
      return fail(
        "create_creative",
        "whatsapp_phone_number_id ausente — reconecte o WhatsApp Business antes de publicar anúncios Click to WhatsApp.",
        null,
        { page_id: pageId, whatsapp_number: waPhone, image_hash: imageHash },
      );
    }
    if (channel === "whatsapp" && !waPhoneVerified) {
      const rawMetaError =
        waPhoneCheckError?.message ||
        waWabaListError?.message ||
        "sem resposta da Graph API";
      return fail(
        "create_creative",
        `Meta rejeitou o whatsapp_phone_number_id (${waPhoneNumberId}). Erro original da Graph API: ${rawMetaError}. Verifique no Meta Business Suite → Configurações → WhatsApp → Contas conectadas se o número está vinculado à Página correta.`,
        waPhoneCheckError?.body ?? waWabaListError?.body ?? null,
        {
          page_id: pageId,
          whatsapp_phone_number_id: waPhoneNumberId,
          waba_id: waWabaId || null,
          image_hash: imageHash,
          phone_check_error: waPhoneCheckError,
          waba_list_error: waWabaListError,
        },
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

    // Captura completa de cada tentativa: payload integral enviado para
    // /act_xxx/adcreatives + resposta integral (status, body, headers, raw text).
    // Usado para diagnosticar erros como code=100/subcode=1487390 onde a Meta
    // não diz qual campo do creative está inválido.
    type CreativeAttempt = {
      mode: CreativeMode;
      endpoint: string;
      request_payload: unknown;
      object_story_spec: unknown;
      link_data: unknown;
      call_to_action: unknown;
      page_id: string;
      instagram_actor_id: string | null;
      whatsapp_number: string | null;
      destination_type: string | null;
      promoted_object: unknown;
      response_status: number;
      response_body: unknown;
      response_headers: Record<string, string>;
      response_raw: string;
      ok: boolean;
    };
    const attempts: CreativeAttempt[] = [];

    function recordAttempt(
      mode: CreativeMode,
      payload: { name: string; object_story_spec: Record<string, unknown> },
      res:
        | { ok: true; data: { id: string }; status: number; rawText: string; responseHeaders: Record<string, string> }
        | { ok: false; status: number; body: GraphErrorBody; message: string; rawText: string; responseHeaders: Record<string, string> },
    ) {
      const oss = payload.object_story_spec as Record<string, unknown>;
      const ld = (oss.link_data ?? null) as Record<string, unknown> | null;
      const entry: CreativeAttempt = {
        mode,
        endpoint: `${GRAPH}/${actId}/adcreatives`,
        request_payload: payload,
        object_story_spec: oss,
        link_data: ld,
        call_to_action: ld?.call_to_action ?? null,
        page_id: pageId,
        instagram_actor_id: igActorId || null,
        whatsapp_number: waPhone || null,
        destination_type: (payload as { destination_type?: string }).destination_type ?? null,
        promoted_object: (payload as { promoted_object?: unknown }).promoted_object ?? null,
        response_status: res.status,
        response_body: res.ok ? res.data : res.body,
        response_headers: res.responseHeaders,
        response_raw: res.rawText,
        ok: res.ok,
      };
      attempts.push(entry);
      console.log("[publishCampaign] create_creative attempt result", entry);
      return entry;
    }

    let creativeId: string;

    const advanced = await tryCreateCreative("advanced");
    recordAttempt("advanced", advanced.payload, advanced.res);

    if (advanced.res.ok) {
      creativeId = advanced.res.data.id;
      console.log("[publishCampaign] create_creative ok", { creativeId, mode: "advanced" });
    } else {
      console.warn("[publishCampaign] advanced fail — tentando simple", {
        status: advanced.res.status, message: advanced.res.message,
      });
      const simple = await tryCreateCreative("simple");
      recordAttempt("simple", simple.payload, simple.res);

      if (simple.res.ok) {
        creativeId = simple.res.data.id;
        console.log("[publishCampaign] create_creative ok", { creativeId, mode: "simple" });
      } else if (camp.media_url) {
        console.warn("[publishCampaign] simple fail — preparando fallback picture URL", {
          status: simple.res.status, message: simple.res.message,
        });
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
        recordAttempt("picture", pic.payload, pic.res);

        if (!pic.res.ok) {
          console.error("[publishCampaign] all creative modes failed", { attempts, mediaCheck });
          return fail(
            "create_creative",
            formatGraphError(pic.res.body, pic.res.message),
            pic.res.body,
            {
              attempts,
              last_attempt: attempts[attempts.length - 1],
              page_id: pageId,
              instagram_actor_id: igActorId || null,
              whatsapp_number: waPhone || null,
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
            last_attempt: attempts[attempts.length - 1],
            page_id: pageId,
            instagram_actor_id: igActorId || null,
            whatsapp_number: waPhone || null,
            image_hash: imageHash ?? null,
            wa_link: waLink,
            channel,
            cta_enum: ctaEnum,
          },
        );
      }
    }


    const creativeCheck = await graphFetch<{
      id: string;
      object_story_spec?: { page_id?: string; link_data?: unknown };
      effective_object_story_id?: string;
    }>(
      `${GRAPH}/${encodeURIComponent(creativeId)}?fields=id,object_story_spec,effective_object_story_id&access_token=${encodeURIComponent(accessToken)}`,
      { method: "GET" },
    );
    console.log("[publishCampaign] creative_check", {
      ok: creativeCheck.ok,
      creative_id: creativeId,
      page_id: creativeCheck.ok ? creativeCheck.data.object_story_spec?.page_id ?? null : null,
      effective_object_story_id: creativeCheck.ok ? creativeCheck.data.effective_object_story_id ?? null : null,
      error: creativeCheck.ok ? null : formatGraphError(creativeCheck.body, creativeCheck.message),
    });
    if (!creativeCheck.ok || creativeCheck.data.id !== creativeId) {
      return fail(
        "verify_creative",
        creativeCheck.ok ? "Meta não confirmou o creative criado." : formatGraphError(creativeCheck.body, creativeCheck.message),
        creativeCheck.ok ? creativeCheck.data : creativeCheck.body,
        { creative_id: creativeId, page_id: pageId, whatsapp_phone_number_id: channel === "whatsapp" ? waPhoneNumberId : null },
      );
    }


    // Step E: cria ad.
    const adPayload = {
      name: `${campaign.name} — ad`,
      adset_id: metaAdsetId,
      creative: { creative_id: creativeId },
      status: "ACTIVE",
    };
    console.log("[publishCampaign] create_ad — IDs WhatsApp ativos", {
      channel,
      whatsapp_phone_number_id: channel === "whatsapp" ? waPhoneNumberId : null,
      business_account_id: channel === "whatsapp" ? waWabaId : null,
      display_phone_number: channel === "whatsapp" ? (waDisplayPhone || waPhone) : null,
      verified_name: channel === "whatsapp" ? waVerifiedName : null,
      phone_verified: waPhoneVerified,
      page_id: pageId,
      creative_id: creativeId,
    });
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
      console.error("[publishCampaign] create_ad fail — resposta bruta da Meta", {
        endpoint: `${GRAPH}/${actId}/ads`,
        request_payload: adPayload,
        whatsapp_phone_number_id: channel === "whatsapp" ? waPhoneNumberId : null,
        page_id: pageId,
        instagram_actor_id: igActorId || null,
        creative_id: creativeId,
        adset_id: metaAdsetId,
        response_status: adRes.status,
        response_message: adRes.message,
        response_body: adRes.body,
        response_raw: (adRes as { rawText?: string }).rawText ?? null,
      });
      return fail("create_ad", formatGraphError(adRes.body, adRes.message), adRes.body, {
        endpoint: `${GRAPH}/${actId}/ads`,
        request_payload: adPayload,
        response_status: adRes.status,
        response_body: adRes.body,
        response_raw: (adRes as { rawText?: string }).rawText ?? null,
      });
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

    const creationStatusLog = await Promise.all([
      fetchObjectStatus("campaign", metaCampaignId),
      fetchObjectStatus("adset", metaAdsetId),
      fetchObjectStatus("ad", metaAdId),
    ]);
    await recordMetaStatusLog("after_creation", creationStatusLog, {
      creative_id: creativeId,
      page_id: pageId,
      whatsapp_phone_number_id: channel === "whatsapp" ? waPhoneNumberId : null,
      whatsapp_number: channel === "whatsapp" ? waPhone : null,
    });

    // Step G: ATIVAÇÃO FINAL — Meta cria tudo em PAUSED por padrão.
    // Sem este passo a campanha nunca entra em análise/entrega.
    const activationLog: Array<{
      object: "campaign" | "adset" | "ad";
      id: string;
      status_before: string;
      effective_status_before?: string;
      activate_ok: boolean;
      activate_error?: string;
      status_after?: string;
      effective_status_after?: string;
    }> = [];

    async function activateObject(
      object: "campaign" | "adset" | "ad",
      id: string,
      before: StatusSnapshot | undefined,
    ) {
      const form = new URLSearchParams();
      form.set("status", "ACTIVE");
      form.set("access_token", accessToken);
      const actRes = await graphFetch<{ success?: boolean }>(`${GRAPH}/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      const getRes = await graphFetch<MetaStatusResp>(
        `${GRAPH}/${id}?fields=id,status,effective_status&access_token=${encodeURIComponent(accessToken)}`,
        { method: "GET" },
      );
      const entry = {
        object,
        id,
        status_before: before?.status ?? "unknown",
        effective_status_before: before?.effective_status,
        activate_ok: actRes.ok,
        activate_error: actRes.ok ? undefined : formatGraphError(actRes.body, actRes.message),
        status_after: getRes.ok ? getRes.data.status : undefined,
        effective_status_after: getRes.ok ? getRes.data.effective_status : undefined,
      };
      activationLog.push(entry);
      console.log("[publishCampaign] activate", entry);
      return entry;
    }

    const beforeByObject = Object.fromEntries(creationStatusLog.map((s) => [s.object, s])) as Partial<Record<MetaObjectKind, StatusSnapshot>>;
    const campAct = await activateObject("campaign", metaCampaignId, beforeByObject.campaign);
    const adsetAct = await activateObject("adset", metaAdsetId, beforeByObject.adset);
    const adAct = await activateObject("ad", metaAdId, beforeByObject.ad);

    await recordMetaStatusLog(
      "after_activation",
      activationLog.map((a) => ({
        object: a.object,
        id: a.id,
        status: a.status_after,
        effective_status: a.effective_status_after,
        error: a.activate_error,
      })),
      {
        creative_id: creativeId,
        activationLog,
      },
    );

    const adOk = adAct.status_after === "ACTIVE" && adAct.effective_status_after === "ACTIVE";
    const allActive =
      campAct.status_after === "ACTIVE" && campAct.effective_status_after === "ACTIVE" &&
      adsetAct.status_after === "ACTIVE" && adsetAct.effective_status_after === "ACTIVE" &&
      adOk;

    // 5) Persiste IDs sempre (não perdê-los entre tentativas).
    await supabase
      .from("campaigns")
      .update({
        meta_campaign_id: metaCampaignId,
        meta_adset_id: metaAdsetId,
        meta_ad_id: metaAdId,
        meta_last_sync_at: new Date().toISOString(),
      } as never)
      .eq("id", campaignId);

    if (!allActive) {
      // Algum objeto continua PAUSED — não marcar como publicada.
      const activationErrors = activationLog
        .filter((a) => a.activate_error || a.status_after === "PAUSED")
        .map((a) => `${a.object}: ${a.activate_error ?? `status=${a.status_after}/${a.effective_status_after ?? "?"}`}`)
        .join(" | ");
      return fail(
        "activate_objects",
        `Meta não ativou a campanha: ` +
          `campaign=${campAct.status_after ?? "?"}, ` +
          `adset=${adsetAct.status_after ?? "?"}, ` +
          `ad=${adAct.status_after ?? "?"}` +
          ` (effective: campaign=${campAct.effective_status_after ?? "?"}, adset=${adsetAct.effective_status_after ?? "?"}, ad=${adAct.effective_status_after ?? "?"}).` +
          (activationErrors ? ` Meta: ${activationErrors}` : ""),
        { activationLog },
        { activationLog },
      );
    }

    const { error: saveErr } = await supabase
      .from("campaigns")
      .update({
        status: "active",
        meta_sync_status: "active",
        meta_delivery_status: "active_on_meta",
        meta_publish_error: null,
      } as never)
      .eq("id", campaignId);
    if (saveErr) {
      console.error("[publishCampaign] save final status failed", { campaignId, error: saveErr });
    } else {
      console.log("[publishCampaign] success — all ACTIVE", {
        campaignId, metaCampaignId, metaAdsetId, creativeId, metaAdId, activationLog,
      });
    }



    return {
      ok: true as const,
      ids: { campaign: metaCampaignId, adset: metaAdsetId, creative: creativeId, ad: metaAdId },
      mediaCheck,
    };
  });
