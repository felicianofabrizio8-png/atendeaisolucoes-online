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

      const media = await this.resolvePrimaryMedia(content);
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
    const containerPayload = new URLSearchParams();
    containerPayload.set("caption", caption);
    if (input.format === "story") containerPayload.set("media_type", "STORIES");
    else if (input.format === "reel") containerPayload.set("media_type", "REELS");

    if (media.type === "image") {
      containerPayload.set("image_url", media.url);
    } else {
      // Video: exige media_type (VIDEO/REELS/STORIES) e video_url
      if (input.format === "feed") containerPayload.set("media_type", "VIDEO");
      containerPayload.set("video_url", media.url);
    }
    containerPayload.set("access_token", pageAccessToken);

    const createRes = await postGraph<{ id?: string }>({
      companyId: input.companyId,
      action: `marketing_publisher.instagram.${input.format}.container`,
      url: `${GRAPH}/${encodeURIComponent(igUserId)}/media`,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: containerPayload.toString(),
      logicalPayload: { format: input.format, media_type: media.type },
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
      return this.fail(
        `container_error_${createRes.status ?? "network"}`,
        createRes.error,
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
      .select("id, company_id, body, hashtags, cta_destination, media_ids, product_id, status")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!r.data) return null;
    if (r.data.status !== "approved") return null;
    return {
      companyId: r.data.company_id,
      contentId: r.data.id,
      body: r.data.body ?? "",
      hashtags: Array.isArray(r.data.hashtags) ? r.data.hashtags : [],
      cta_destination: r.data.cta_destination ?? null,
      media_ids: Array.isArray(r.data.media_ids) ? r.data.media_ids : [],
      product_id: r.data.product_id ?? null,
    };
  }

  private async resolvePrimaryMedia(content: ContentPayload): Promise<ResolvedMedia | null> {
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => any;
      storage: { from: (b: string) => any };
    };

    // 1) Preferir marketing_media da lista.
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
        if (url) return { url, type: m.media_type };
      }
    }

    // 2) Fallback: primeira imagem do produto.
    if (content.product_id) {
      const r = await admin
        .from("products")
        .select("images")
        .eq("id", content.product_id)
        .maybeSingle();
      const imgs = (r.data?.images ?? []) as string[];
      if (imgs.length > 0) {
        const first = imgs[0];
        const clean = first.replace(/^\/+/, "");
        const signed = await admin.storage
          .from("product-images")
          .createSignedUrl(clean, 60 * 60);
        const url = signed?.data?.signedUrl as string | undefined;
        if (url) return { url, type: "image" };
      }
    }
    return null;
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
    const primary = await this.loadPrimaryIntegration(companyId, "facebook");
    if (!primary.ok) return primary;
    const meta = primary.row.account_metadata;
    const pageId =
      (typeof meta.fb_page_id === "string" ? meta.fb_page_id : null) ??
      primary.row.external_account_id;
    if (!pageId) {
      return {
        ok: false,
        code: "fb_page_missing",
        message: "Integração principal do Facebook sem page_id.",
      };
    }
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const p = await admin
      .from("meta_pages")
      .select("page_id, page_access_token, active")
      .eq("company_id", companyId)
      .eq("page_id", pageId)
      .eq("active", true)
      .maybeSingle();
    const row = p.data as { page_id: string; page_access_token: string } | null;
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
