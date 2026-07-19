// MetaPublisher — traduz publicação em chamadas Graph via postGraph (MetaOutbound).
// NUNCA usa `fetch` direto para graph.facebook.com.
// Suporta: IG Feed/Reels/Stories (image e video) e FB Feed/Stories (image/link).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { postGraph } from "@/lib/outbound/MetaOutbound.server";
import { isFailure, isSimulation } from "@/lib/outbound/MetaOutboundContract";
import type { PublicationChannel, PublicationFormat } from "./types";

const GRAPH = "https://graph.facebook.com/v25.0";

export interface PublishInput {
  companyId: string;
  contentId: string;
  channel: PublicationChannel;
  format: PublicationFormat;
}

export interface PublishOutcome {
  success: boolean;
  simulated: boolean;
  platformPostId: string | null;
  platformResponse: unknown;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
}

interface ContentPayload {
  companyId: string;
  contentId: string;
  body: string;
  hashtags: string[];
  cta_destination: string | null;
  media_ids: string[];
  product_id: string | null;
  product_media_refs: Array<{ product_id: string; image_path: string }>;
  campaign_role: "feed" | "story" | null;
  feed_video_id: string | null;
  story_video_id: string | null;
}

interface ResolvedMedia {
  url: string;
  type: "image" | "video";
}

export class MetaPublisher {
  async publish(input: PublishInput): Promise<PublishOutcome> {
    try {
      const content = await this.loadContent(input.contentId, input.companyId);
      if (!content) {
        return this.fail("content_not_found", "Conteúdo não encontrado.", false);
      }

      const media = await this.resolvePrimaryMedia(content, input.format);
      const caption = this.buildCaption(content);

      if (input.channel === "instagram") {
        return await this.publishInstagram(input, content, media, caption);
      }
      return await this.publishFacebook(input, content, media, caption);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown_error";
      return this.fail("internal_error", msg, false);
    }
  }

  // ==========================================================================
  // Instagram
  // ==========================================================================

  private async publishInstagram(
    input: PublishInput,
    content: ContentPayload,
    media: ResolvedMedia | null,
    caption: string,
  ): Promise<PublishOutcome> {
    if (!media) {
      return this.fail("no_media", "Instagram exige ao menos uma mídia.", false);
    }
    const pageCtx = await this.loadInstagramContext(input.companyId);
    if (!pageCtx.ok) {
      return this.fail(pageCtx.code, pageCtx.message, false);
    }

    const { igUserId, pageAccessToken } = pageCtx;

    // 1) Criar container.
    // IMPORTANTE (Meta Graph API v18+): publicação de VÍDEO no Feed do Instagram
    // via /media exige `media_type=REELS` + `share_to_feed=true`. O antigo
    // `media_type=VIDEO` foi descontinuado e passou a retornar HTTP 400
    // "Invalid parameter" (container_error_400). REELS + share_to_feed=true
    // publica o vídeo tanto na aba Reels quanto no Feed principal.
    // Ref.: https://developers.facebook.com/docs/instagram-platform/content-publishing
    const containerPayload = new URLSearchParams();
    containerPayload.set("caption", caption);
    if (input.format === "story") {
      containerPayload.set("media_type", "STORIES");
    } else if (input.format === "reel") {
      containerPayload.set("media_type", "REELS");
    }

    if (media.type === "image") {
      containerPayload.set("image_url", media.url);
    } else {
      // Vídeo: `media_type` obrigatório. `feed` → REELS + share_to_feed=true.
      if (input.format === "feed") {
        containerPayload.set("media_type", "REELS");
        containerPayload.set("share_to_feed", "true");
      }
      // reel e story já foram setados acima; garantir consistência p/ reel.
      if (input.format === "reel" && !containerPayload.has("media_type")) {
        containerPayload.set("media_type", "REELS");
      }
      containerPayload.set("video_url", media.url);
    }
    containerPayload.set("access_token", pageAccessToken);

    const mediaUrlSummary = summarizeMediaUrl(media.url);
    const createRes = await postGraph<{ id?: string }>({
      companyId: input.companyId,
      action: `marketing_publisher.instagram.${input.format}.container`,
      url: `${GRAPH}/${encodeURIComponent(igUserId)}/media`,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: containerPayload.toString(),
      logicalPayload: {
        format: input.format,
        media_type: containerPayload.get("media_type"),
        media_kind: media.type,
        share_to_feed: containerPayload.get("share_to_feed"),
        media_host: mediaUrlSummary.host,
        media_path: mediaUrlSummary.path,
      },
      agentId: "marketing-publisher",
    });
    if (isSimulation(createRes)) {
      return {
        success: true,
        simulated: true,
        platformPostId: null,
        platformResponse: { simulated: true, would: createRes.would },
      };
    }
    if (isFailure(createRes)) {
      const meta = extractMetaError(createRes);
      logMetaFailure({
        stage: "container_create",
        channel: "instagram",
        format: input.format,
        endpoint: `/${igUserId}/media`,
        httpStatus: createRes.status,
        mediaKind: media.type,
        mediaHost: mediaUrlSummary.host,
        mediaPath: mediaUrlSummary.path,
        payloadFields: fieldsPresent(containerPayload),
        meta,
      });
      return this.fail(
        `container_error_${createRes.status ?? "network"}`,
        formatFailureMessage(createRes.error, meta),
        createRes.retryable,
      );
    }

    const containerId = createRes.raw?.id ?? null;
    if (!containerId) {
      return this.fail("no_container_id", "Meta não retornou creation_id.", false);
    }

    // 2) Se vídeo, aguardar container ficar FINISHED (poll curto).
    if (media.type === "video") {
      const ready = await this.pollContainerReady(containerId, pageAccessToken, input.companyId);
      if (!ready.ok) {
        return this.fail(ready.errorCode, ready.errorMessage, ready.retryable);
      }
    }

    // 3) Publicar.
    const pubBody = new URLSearchParams();
    pubBody.set("creation_id", containerId);
    pubBody.set("access_token", pageAccessToken);
    const publishRes = await postGraph<{ id?: string }>({
      companyId: input.companyId,
      action: `marketing_publisher.instagram.${input.format}.publish`,
      url: `${GRAPH}/${encodeURIComponent(igUserId)}/media_publish`,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: pubBody.toString(),
      logicalPayload: { creation_id: containerId },
      agentId: "marketing-publisher",
      extractExternalId: (json) => {
        const j = json as { id?: string } | null;
        return j?.id ?? null;
      },
    });
    if (isSimulation(publishRes)) {
      return {
        success: true,
        simulated: true,
        platformPostId: null,
        platformResponse: { simulated: true, would: publishRes.would },
      };
    }
    if (isFailure(publishRes)) {
      return this.fail(
        `publish_error_${publishRes.status ?? "network"}`,
        publishRes.error,
        publishRes.retryable,
      );
    }
    return {
      success: true,
      simulated: false,
      platformPostId: publishRes.externalId,
      platformResponse: sanitize(publishRes.raw),
    };
  }

  private async pollContainerReady(
    containerId: string,
    token: string,
    companyId: string,
  ): Promise<{ ok: true } | { ok: false; errorCode: string; errorMessage: string; retryable: boolean }> {
    const attempts = 6;
    const delayMs = 4000;
    for (let i = 0; i < attempts; i += 1) {
      const r = await postGraph<{ status_code?: string; status?: string }>({
        companyId,
        action: "marketing_publisher.instagram.container_status",
        url: `${GRAPH}/${encodeURIComponent(containerId)}?fields=status_code&access_token=${encodeURIComponent(token)}`,
        method: "GET",
        agentId: "marketing-publisher",
      });
      if (isSimulation(r)) return { ok: true };
      if (isFailure(r)) {
        return {
          ok: false,
          errorCode: `container_status_${r.status ?? "network"}`,
          errorMessage: r.error,
          retryable: r.retryable,
        };
      }
      const code = r.raw?.status_code;
      if (code === "FINISHED") return { ok: true };
      if (code === "ERROR" || code === "EXPIRED") {
        return {
          ok: false,
          errorCode: "container_processing_failed",
          errorMessage: `Meta retornou status ${code}.`,
          retryable: false,
        };
      }
      await new Promise((res) => setTimeout(res, delayMs));
    }
    return {
      ok: false,
      errorCode: "container_not_ready",
      errorMessage: "Container ainda em processamento após timeout curto.",
      retryable: true,
    };
  }

  // ==========================================================================
  // Facebook
  // ==========================================================================

  private async publishFacebook(
    input: PublishInput,
    content: ContentPayload,
    media: ResolvedMedia | null,
    caption: string,
  ): Promise<PublishOutcome> {
    const pageCtx = await this.loadFacebookContext(input.companyId);
    if (!pageCtx.ok) {
      return this.fail(pageCtx.code, pageCtx.message, false);
    }
    const { pageId, pageAccessToken } = pageCtx;

    // Story: exige mídia; publica via photo_stories (para foto). Vídeo em story
    // não suportado nesta fase — reportar erro amigável.
    if (input.format === "story") {
      if (!media) return this.fail("no_media", "Story exige mídia.", false);
      if (media.type !== "image") {
        return this.fail(
          "unsupported_story_media",
          "Stories do Facebook nesta fase aceitam apenas foto.",
          false,
        );
      }
      // 1) upload foto sem publicar
      const upBody = new URLSearchParams();
      upBody.set("url", media.url);
      upBody.set("published", "false");
      upBody.set("access_token", pageAccessToken);
      const up = await postGraph<{ id?: string }>({
        companyId: input.companyId,
        action: "marketing_publisher.facebook.story.upload",
        url: `${GRAPH}/${encodeURIComponent(pageId)}/photos`,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: upBody.toString(),
        agentId: "marketing-publisher",
      });
      if (isSimulation(up)) {
        return { success: true, simulated: true, platformPostId: null, platformResponse: { simulated: true } };
      }
      if (isFailure(up)) {
        return this.fail(`upload_${up.status ?? "network"}`, up.error, up.retryable);
      }
      const photoId = up.raw?.id;
      if (!photoId) return this.fail("no_photo_id", "Upload não retornou id.", false);
      const storyBody = new URLSearchParams();
      storyBody.set("photo_id", photoId);
      storyBody.set("access_token", pageAccessToken);
      const st = await postGraph<{ id?: string; post_id?: string }>({
        companyId: input.companyId,
        action: "marketing_publisher.facebook.story.publish",
        url: `${GRAPH}/${encodeURIComponent(pageId)}/photo_stories`,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: storyBody.toString(),
        agentId: "marketing-publisher",
        extractExternalId: (j) => {
          const x = j as { id?: string; post_id?: string } | null;
          return x?.post_id ?? x?.id ?? null;
        },
      });
      if (isSimulation(st)) {
        return { success: true, simulated: true, platformPostId: null, platformResponse: { simulated: true } };
      }
      if (isFailure(st)) return this.fail(`story_${st.status ?? "network"}`, st.error, st.retryable);
      return {
        success: true,
        simulated: false,
        platformPostId: st.externalId,
        platformResponse: sanitize(st.raw),
      };
    }

    // Reel do FB: nesta fase mapeia para publicação de vídeo comum.
    // Feed: se houver imagem → /photos com published=true e caption.
    //       se houver vídeo → /videos.
    //       se não houver mídia → /feed com message (texto simples).
    if (!media) {
      const body = new URLSearchParams();
      body.set("message", caption);
      body.set("access_token", pageAccessToken);
      const r = await postGraph<{ id?: string }>({
        companyId: input.companyId,
        action: "marketing_publisher.facebook.feed.text",
        url: `${GRAPH}/${encodeURIComponent(pageId)}/feed`,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        agentId: "marketing-publisher",
        extractExternalId: (j) => (j as { id?: string } | null)?.id ?? null,
      });
      if (isSimulation(r)) return { success: true, simulated: true, platformPostId: null, platformResponse: { simulated: true } };
      if (isFailure(r)) return this.fail(`feed_${r.status ?? "network"}`, r.error, r.retryable);
      return {
        success: true,
        simulated: false,
        platformPostId: r.externalId,
        platformResponse: sanitize(r.raw),
      };
    }

    if (media.type === "image") {
      const body = new URLSearchParams();
      body.set("url", media.url);
      body.set("caption", caption);
      body.set("access_token", pageAccessToken);
      const r = await postGraph<{ id?: string; post_id?: string }>({
        companyId: input.companyId,
        action: `marketing_publisher.facebook.${input.format}.photo`,
        url: `${GRAPH}/${encodeURIComponent(pageId)}/photos`,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        agentId: "marketing-publisher",
        extractExternalId: (j) => {
          const x = j as { post_id?: string; id?: string } | null;
          return x?.post_id ?? x?.id ?? null;
        },
      });
      if (isSimulation(r)) return { success: true, simulated: true, platformPostId: null, platformResponse: { simulated: true } };
      if (isFailure(r)) return this.fail(`photo_${r.status ?? "network"}`, r.error, r.retryable);
      return {
        success: true,
        simulated: false,
        platformPostId: r.externalId,
        platformResponse: sanitize(r.raw),
      };
    }

    // vídeo
    const body = new URLSearchParams();
    body.set("file_url", media.url);
    body.set("description", caption);
    body.set("access_token", pageAccessToken);
    const r = await postGraph<{ id?: string }>({
      companyId: input.companyId,
      action: `marketing_publisher.facebook.${input.format}.video`,
      url: `${GRAPH}/${encodeURIComponent(pageId)}/videos`,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      agentId: "marketing-publisher",
      extractExternalId: (j) => (j as { id?: string } | null)?.id ?? null,
    });
    if (isSimulation(r)) return { success: true, simulated: true, platformPostId: null, platformResponse: { simulated: true } };
    if (isFailure(r)) return this.fail(`video_${r.status ?? "network"}`, r.error, r.retryable);
    return {
      success: true,
      simulated: false,
      platformPostId: r.externalId,
      platformResponse: sanitize(r.raw),
    };
  }

  // ==========================================================================
  // Loaders (service_role)
  // ==========================================================================

  private async loadContent(id: string, companyId: string): Promise<ContentPayload | null> {
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const r = await admin
      .from("marketing_contents")
      .select(
        "id, company_id, body, hashtags, cta_destination, media_ids, product_id, status, ai_prompt, campaign_role, feed_video_id, story_video_id",
      )
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!r.data) return null;
    if (r.data.status !== "approved") return null;
    const prompt =
      r.data.ai_prompt && typeof r.data.ai_prompt === "object"
        ? (r.data.ai_prompt as { product_media_refs?: unknown })
        : null;
    const refsRaw = Array.isArray(prompt?.product_media_refs)
      ? (prompt!.product_media_refs as unknown[])
      : [];
    const product_media_refs = refsRaw
      .map((it) => {
        if (!it || typeof it !== "object") return null;
        const o = it as Record<string, unknown>;
        const pid = typeof o.product_id === "string" ? o.product_id : null;
        const path = typeof o.image_path === "string" ? o.image_path : null;
        if (!pid || !path) return null;
        return { product_id: pid, image_path: path };
      })
      .filter((v): v is { product_id: string; image_path: string } => v !== null);
    const role = r.data.campaign_role;
    return {
      companyId: r.data.company_id,
      contentId: r.data.id,
      body: r.data.body ?? "",
      hashtags: Array.isArray(r.data.hashtags) ? r.data.hashtags : [],
      cta_destination: r.data.cta_destination ?? null,
      media_ids: Array.isArray(r.data.media_ids) ? r.data.media_ids : [],
      product_id: r.data.product_id ?? null,
      product_media_refs,
      campaign_role: role === "feed" || role === "story" ? role : null,
      feed_video_id: r.data.feed_video_id ?? null,
      story_video_id: r.data.story_video_id ?? null,
    };
  }


  private async resolvePrimaryMedia(
    content: ContentPayload,
    format: PublicationFormat,
  ): Promise<ResolvedMedia | null> {
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => any;
      storage: { from: (b: string) => any };
    };

    // 0) Preferir vídeo renderizado da campanha, se existir para o formato-alvo.
    //    Feed -> feed_video_id (1080x1350). Story/Reel -> story_video_id (1080x1920).
    const targetVideoId =
      format === "feed" ? content.feed_video_id : content.story_video_id;
    if (targetVideoId) {
      const v = await admin
        .from("video_library")
        .select("id, company_id, file_path, is_active")
        .eq("id", targetVideoId)
        .eq("company_id", content.companyId)
        .maybeSingle();
      const vr = v.data as
        | { id: string; company_id: string; file_path: string; is_active: boolean }
        | undefined;
      if (vr && vr.is_active && typeof vr.file_path === "string") {
        // Guard multi-tenant: path deve começar com {companyId}/
        if (vr.file_path.startsWith(`${content.companyId}/`)) {
          const signed = await admin.storage
            .from("video-library")
            .createSignedUrl(vr.file_path, 60 * 60);
          const url = signed?.data?.signedUrl as string | undefined;
          if (url && (await this.isUrlAccessible(url, "video/mp4"))) {
            return { url, type: "video" };
          }
        }
      }
    }



    // 1) Preferir marketing_media da lista (biblioteca de marketing).
    if (content.media_ids.length > 0) {
      const r = await admin
        .from("marketing_media")
        .select("storage_path, media_type")
        .in("id", content.media_ids)
        .eq("company_id", content.companyId)
        .eq("active", true)
        .is("deleted_at", null)
        .limit(1);
      const m = r.data?.[0] as { storage_path: string; media_type: "image" | "video" } | undefined;
      if (m) {
        const signed = await admin.storage
          .from("marketing-media")
          .createSignedUrl(m.storage_path, 60 * 60);
        const url = signed?.data?.signedUrl as string | undefined;
          if (url && (await this.isUrlAccessible(url, m.media_type === "video" ? "video/" : undefined))) {
            return { url, type: m.media_type };
          }
      }
    }

    // 2) product_media_refs — imagens de produto reutilizadas sem duplicar arquivo.
    //    Não copiamos nada para marketing_media; assinamos direto no bucket
    //    product-images, respeitando o mesmo company_id.
    for (const ref of content.product_media_refs) {
      const prod = await admin
        .from("products")
        .select("id, company_id, images")
        .eq("id", ref.product_id)
        .eq("company_id", content.companyId)
        .maybeSingle();
      if (!prod.data) continue;
      const imgs = Array.isArray(prod.data.images) ? (prod.data.images as string[]) : [];
      // Aceita match por URL absoluta OU path relativo (retrocompatível com
      // conteúdos antigos, onde ai_prompt.image_path pode ser qualquer um dos dois).
      const refPath = extractProductImagePath(ref.image_path);
      const matched = imgs.some((img) => {
        const p = extractProductImagePath(img);
        return (p !== null && refPath !== null && p === refPath) || img === ref.image_path;
      });
      if (!matched) continue;
      if (!refPath) continue; // URL inválida / bucket errado / host inesperado
      const firstSegment = refPath.split("/")[0];
      if (firstSegment !== content.companyId) continue; // guard multi-tenant
      const signed = await admin.storage
        .from("product-images")
        .createSignedUrl(refPath, 60 * 60);
      const url = signed?.data?.signedUrl as string | undefined;
      if (url && (await this.isUrlAccessible(url))) return { url, type: "image" };
    }

    // 3) Fallback antigo: primeira imagem do produto vinculado ao conteúdo.
    if (content.product_id) {
      const r = await admin
        .from("products")
        .select("images")
        .eq("id", content.product_id)
        .eq("company_id", content.companyId)
        .maybeSingle();
      const imgs = (r.data?.images ?? []) as string[];
      if (imgs.length > 0) {
        const first = imgs[0];
        const clean = first.replace(/^\/+/, "");
        const signed = await admin.storage
          .from("product-images")
          .createSignedUrl(clean, 60 * 60);
        const url = signed?.data?.signedUrl as string | undefined;
        if (url && (await this.isUrlAccessible(url))) return { url, type: "image" };
      }
    }
    return null;
  }

  /**
   * Verifica se uma URL assinada está acessível antes de entregá-la à Meta.
   * A Meta baixa a URL do lado dela — se estiver quebrada, o erro só aparece
   * lá no fluxo de container, sem contexto claro. Um HEAD curto evita isso.
   */
  private async isUrlAccessible(url: string, expectedContentTypePrefix?: string): Promise<boolean> {
    try {
      const r = await fetch(url, { method: "HEAD" });
      if (r.ok) return this.matchesContentType(r.headers.get("content-type"), expectedContentTypePrefix);
      // Alguns provedores respondem 405 a HEAD; tentamos GET com Range.
      if (r.status === 405) {
        const g = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } });
        return (g.ok || g.status === 206) && this.matchesContentType(g.headers.get("content-type"), expectedContentTypePrefix);
      }
      return false;
    } catch {
      return false;
    }
  }

  private matchesContentType(actual: string | null, expectedPrefix?: string): boolean {
    if (!expectedPrefix) return true;
    return typeof actual === "string" && actual.toLowerCase().startsWith(expectedPrefix.toLowerCase());
  }

  private async loadPrimaryIntegration(
    companyId: string,
    channel: "instagram" | "facebook",
  ): Promise<
    | { ok: true; row: { id: string; external_account_id: string | null; account_metadata: Record<string, unknown>; token_expires_at: string | null } }
    | { ok: false; code: string; message: string }
  > {
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const r = await admin
      .from("integrations")
      .select("id, external_account_id, account_metadata, token_expires_at, active")
      .eq("company_id", companyId)
      .eq("channel", channel)
      .eq("active", true)
      .eq("is_primary_publisher", true);
    const rows = (r.data ?? []) as Array<{
      id: string;
      external_account_id: string | null;
      account_metadata: Record<string, unknown> | null;
      token_expires_at: string | null;
      active: boolean;
    }>;
    if (rows.length === 0) {
      return {
        ok: false,
        code: "no_primary_integration",
        message: `Nenhuma integração ${channel} marcada como principal (is_primary_publisher). Marque exatamente uma antes de publicar.`,
      };
    }
    if (rows.length > 1) {
      return {
        ok: false,
        code: "multiple_primary_integrations",
        message: `Existem ${rows.length} integrações ${channel} marcadas como principais. Mantenha apenas uma.`,
      };
    }
    const row = rows[0];
    if (row.token_expires_at) {
      const exp = new Date(row.token_expires_at).getTime();
      if (Number.isFinite(exp) && exp < Date.now()) {
        return {
          ok: false,
          code: "token_expired",
          message: "Token da integração principal expirou. Reconecte a conta Meta.",
        };
      }
    }
    return {
      ok: true,
      row: {
        id: row.id,
        external_account_id: row.external_account_id,
        account_metadata: row.account_metadata ?? {},
        token_expires_at: row.token_expires_at,
      },
    };
  }

  private async loadInstagramContext(
    companyId: string,
  ): Promise<
    | { ok: true; igUserId: string; pageAccessToken: string; pageId: string }
    | { ok: false; code: string; message: string }
  > {
    const primary = await this.loadPrimaryIntegration(companyId, "instagram");
    if (!primary.ok) return primary;
    const meta = primary.row.account_metadata;
    const igUserId = typeof meta.ig_business_account_id === "string" ? meta.ig_business_account_id : null;
    const fbPageId = typeof meta.fb_page_id === "string" ? meta.fb_page_id : null;
    if (!igUserId) {
      return {
        ok: false,
        code: "ig_business_missing",
        message: "Integração principal do Instagram não tem ig_business_account_id resolvido.",
      };
    }
    if (!fbPageId) {
      return {
        ok: false,
        code: "fb_page_missing",
        message: "Integração principal do Instagram não tem Página do Facebook vinculada (fb_page_id).",
      };
    }
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const p = await admin
      .from("meta_pages")
      .select("page_id, page_access_token, ig_business_account_id, active, updated_at")
      .eq("company_id", companyId)
      .eq("page_id", fbPageId)
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1);
    const row = (p.data?.[0] ?? null) as
      | { page_id: string; page_access_token: string; ig_business_account_id: string | null }
      | null;
    if (!row) {
      return {
        ok: false,
        code: "meta_page_not_found",
        message: `Página Meta ativa (page_id=${fbPageId}) não encontrada em meta_pages.`,
      };
    }
    if (!row.page_access_token) {
      return { ok: false, code: "page_access_token_missing", message: "Página sem page_access_token." };
    }
    if (row.ig_business_account_id && row.ig_business_account_id !== igUserId) {
      return {
        ok: false,
        code: "ig_mismatch",
        message: "ig_business_account_id da integração principal difere do registrado em meta_pages.",
      };
    }
    return { ok: true, igUserId, pageAccessToken: row.page_access_token, pageId: row.page_id };
  }

  private async loadFacebookContext(
    companyId: string,
  ): Promise<
    | { ok: true; pageId: string; pageAccessToken: string }
    | { ok: false; code: string; message: string }
  > {
    // 1) Preferir integração principal channel='facebook' quando existir.
    const primary = await this.loadPrimaryIntegration(companyId, "facebook");
    let pageId: string | null = null;
    if (primary.ok) {
      const meta = primary.row.account_metadata;
      pageId =
        (typeof meta.fb_page_id === "string" ? meta.fb_page_id : null) ??
        primary.row.external_account_id;
    } else if (primary.code === "no_primary_integration") {
      // 2) Fallback controlado: integração principal do Instagram desde que
      //    contenha fb_page_id válido; loadPrimaryIntegration já valida
      //    is_primary_publisher=true, active=true, company_id e expiração.
      const igPrimary = await this.loadPrimaryIntegration(companyId, "instagram");
      if (!igPrimary.ok) {
        return {
          ok: false,
          code: "no_primary_integration",
          message:
            "Nenhuma integração Facebook principal encontrada e fallback via Instagram indisponível.",
        };
      }
      const meta = igPrimary.row.account_metadata;
      pageId = typeof meta.fb_page_id === "string" ? meta.fb_page_id : null;
    } else {
      // multiple_primary_integrations, token_expired etc. — propagar erro.
      return primary;
    }
    if (!pageId) {
      return {
        ok: false,
        code: "fb_page_missing",
        message:
          "Integração principal (Facebook, ou Instagram usado como fallback) sem fb_page_id.",
      };
    }
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const p = await admin
      .from("meta_pages")
      .select("page_id, page_access_token, active, updated_at")
      .eq("company_id", companyId)
      .eq("page_id", pageId)
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1);
    const row = (p.data?.[0] ?? null) as { page_id: string; page_access_token: string } | null;
    if (!row) {
      return {
        ok: false,
        code: "meta_page_not_found",
        message: `Página Meta ativa (page_id=${pageId}) não encontrada em meta_pages.`,
      };
    }
    if (!row.page_access_token) {
      return { ok: false, code: "page_access_token_missing", message: "Página sem page_access_token." };
    }
    return { ok: true, pageId: row.page_id, pageAccessToken: row.page_access_token };
  }

  private buildCaption(content: ContentPayload): string {
    const parts = [content.body?.trim() ?? ""].filter(Boolean);
    if (content.hashtags.length > 0) {
      parts.push(content.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "));
    }
    if (content.cta_destination) {
      parts.push(content.cta_destination);
    }
    return parts.join("\n\n").slice(0, 2200);
  }

  private fail(code: string, message: string, retryable = false): PublishOutcome {
    return {
      success: false,
      simulated: false,
      platformPostId: null,
      platformResponse: null,
      errorCode: code,
      errorMessage: message.slice(0, 500),
      retryable,
    };
  }
}

// Remove qualquer coisa que possa conter token da resposta Meta antes de persistir.
function sanitize(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const clone: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const k of Object.keys(clone)) {
    if (/token|secret/i.test(k)) delete clone[k];
  }
  return clone;
}

/**
 * Normaliza `image_path` de product_media_refs para um path relativo ao bucket
 * `product-images`. Aceita:
 *   - path relativo: "company_id/arquivo.jpg" (com ou sem barras iniciais);
 *   - URL absoluta pública: "https://<project>.supabase.co/storage/v1/object/public/product-images/company_id/arquivo.jpg";
 *   - URL absoluta assinada: ".../storage/v1/object/sign/product-images/...".
 *
 * Retorna null quando:
 *   - URL de outro bucket;
 *   - host inesperado (não é *.supabase.co / *.supabase.in);
 *   - não é possível extrair um path válido.
 *
 * Nunca retorna a URL absoluta — createSignedUrl exige path relativo.
 */
export function extractProductImagePath(input: string): string | null {
  if (typeof input !== "string" || input.trim() === "") return null;
  const trimmed = input.trim();

  if (!/^https?:\/\//i.test(trimmed)) {
    // Path relativo. Remove barras iniciais e valida que não escapa do bucket.
    const clean = trimmed.replace(/^\/+/, "");
    if (clean === "" || clean.includes("..")) return null;
    try {
      return decodeURIComponent(clean);
    } catch {
      return clean;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  // Aceita hosts Supabase Storage conhecidos.
  if (!/\.supabase\.(co|in)$/i.test(parsed.hostname)) return null;

  const marker = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/product-images\//;
  const match = parsed.pathname.match(marker);
  if (!match) return null;

  const rest = parsed.pathname.slice(match.index! + match[0].length);
  if (!rest || rest.includes("..")) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}
