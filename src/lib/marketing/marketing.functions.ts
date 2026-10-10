// Server functions for the Marketing AI module (Phase 1).
// - Todas as operações validam a empresa do usuário autenticado via
//   `requireSupabaseAuth`; nunca confiamos em company_id vindo do frontend.
// - Toda mídia/promoção/conteúdo referenciada é validada contra a empresa
//   autenticada (protege multi-tenant).
// - Agendamento exige `status = 'approved'` — bloqueio adicional server-side
//   além do RLS.

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { missingMediaMessage, publishableMediaSource } from "./publishable-media";
import { CAROUSEL_PUBLISH_DISABLED_MESSAGE, isCarouselPublishEnabled } from "@/lib/marketing-publisher/carousel-flag";

type SB = SupabaseClient<Database>;

// ---------- Helpers ----------
interface Ctx {
  companyId: string;
  userId: string;
  supabase: SB;
}

async function loadCompany(ctx: {
  supabase: unknown;
  userId: string;
}): Promise<Ctx> {
  const sb = ctx.supabase as SB;
  const { data: prof, error } = await sb
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!prof?.company_id) throw new Error("Usuário sem empresa.");
  return { companyId: prof.company_id, userId: ctx.userId, supabase: sb };
}

async function assertMediaBelongs(sb: SB, companyId: string, ids: string[]) {
  if (!ids.length) return;
  const { data, error } = await sb
    .from("marketing_media")
    .select("id")
    .in("id", ids)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
  const found = new Set((data ?? []).map((r) => r.id));
  for (const id of ids) {
    if (!found.has(id)) throw new Error(`Mídia ${id} não pertence à empresa.`);
  }
}

async function assertPromotionBelongs(sb: SB, companyId: string, id: string | null) {
  if (!id) return;
  const { data, error } = await sb
    .from("marketing_promotions")
    .select("id")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Promoção não pertence à empresa.");
}

async function assertProductBelongs(sb: SB, companyId: string, id: string | null) {
  if (!id) return;
  const { data, error } = await sb
    .from("products")
    .select("id")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Produto não pertence à empresa.");
}

// ============================================================================
// MEDIA
// ============================================================================

const RegisterMediaSchema = z.object({
  storage_path: z.string().trim().min(1).max(500),
  media_type: z.enum(["image", "video"]),
  mime_type: z.string().trim().max(120).optional().nullable(),
  size_bytes: z.number().int().nonnegative().optional().nullable(),
  width: z.number().int().nonnegative().optional().nullable(),
  height: z.number().int().nonnegative().optional().nullable(),
  duration_seconds: z.number().nonnegative().optional().nullable(),
  title: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
});

export const registerMarketingMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RegisterMediaSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { companyId, userId, supabase } = await loadCompany(context);
    // O storage_path DEVE começar pelo company_id (mesma política do bucket).
    const prefix = `${companyId}/`;
    if (!data.storage_path.startsWith(prefix)) {
      throw new Error("storage_path fora do escopo da empresa.");
    }
    const { data: row, error } = await supabase
      .from("marketing_media")
      .insert({
        company_id: companyId,
        storage_path: data.storage_path,
        media_type: data.media_type,
        mime_type: data.mime_type ?? null,
        size_bytes: data.size_bytes ?? null,
        width: data.width ?? null,
        height: data.height ?? null,
        duration_seconds: data.duration_seconds ?? null,
        title: data.title ?? null,
        description: data.description ?? null,
        tags: data.tags ?? [],
        created_by: userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

const ListMarketingMediaSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

export const listMarketingMedia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListMarketingMediaSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { companyId, supabase } = await loadCompany(context);
    const limit = data.limit ?? 500;
    const offset = data.offset ?? 0;
    const { data: rows, error } = await supabase
      .from("marketing_media")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return { media: rows ?? [] };
  });

/**
 * Caminho no storage de mídias específicas do acervo (para abrir a prévia de
 * uma campanha). Só devolve mídias da empresa autenticada e não removidas.
 */
export const getMarketingMediaPaths = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(16) }).parse(input))
  .handler(async ({ data, context }) => {
    const { companyId, supabase } = await loadCompany(context);
    const { data: rows, error } = await supabase
      .from("marketing_media")
      .select("id, storage_path")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return { paths: Object.fromEntries((rows ?? []).map((r) => [r.id, r.storage_path])) as Record<string, string> };
  });

const UpdateMediaSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  active: z.boolean().optional(),
});

export const updateMarketingMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateMediaSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { companyId, supabase } = await loadCompany(context);
    const patch: Database["public"]["Tables"]["marketing_media"]["Update"] = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.tags !== undefined) patch.tags = data.tags;
    if (data.active !== undefined) patch.active = data.active;
    const { data: row, error } = await supabase
      .from("marketing_media")
      .update(patch)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const softDeleteMarketingMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { companyId, supabase } = await loadCompany(context);
    const { error } = await supabase
      .from("marketing_media")
      .update({ active: false, deleted_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================================
// PROMOTIONS
// ============================================================================

const PromotionSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  price_original: z.number().nonnegative().optional().nullable(),
  price_promo: z.number().nonnegative().optional().nullable(),
  discount_percent: z.number().min(0).max(100).optional().nullable(),
  starts_at: z.string().datetime().optional().nullable(),
  ends_at: z.string().datetime().optional().nullable(),
  whatsapp_cta_text: z.string().trim().max(500).optional().nullable(),
  whatsapp_destination: z.string().trim().max(500).optional().nullable(),
  product_id: z.string().uuid().optional().nullable(),
  cover_media_id: z.string().uuid().optional().nullable(),
  status: z.enum(["draft", "active", "paused", "ended"]).optional(),
});

export const upsertMarketingPromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PromotionSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { companyId, userId, supabase } = await loadCompany(context);
    await assertProductBelongs(supabase, companyId, data.product_id ?? null);
    if (data.cover_media_id) {
      await assertMediaBelongs(supabase, companyId, [data.cover_media_id]);
    }
    const payload = {
      company_id: companyId,
      title: data.title,
      description: data.description ?? null,
      price_original: data.price_original ?? null,
      price_promo: data.price_promo ?? null,
      discount_percent: data.discount_percent ?? null,
      starts_at: data.starts_at ?? null,
      ends_at: data.ends_at ?? null,
      whatsapp_cta_text: data.whatsapp_cta_text ?? null,
      whatsapp_destination: data.whatsapp_destination ?? null,
      product_id: data.product_id ?? null,
      cover_media_id: data.cover_media_id ?? null,
      status: data.status ?? "draft",
    };

    if (data.id) {
      const { data: row, error } = await supabase
        .from("marketing_promotions")
        .update(payload)
        .eq("id", data.id)
        .eq("company_id", companyId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await supabase
      .from("marketing_promotions")
      .insert({ ...payload, created_by: userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listMarketingPromotions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { companyId, supabase } = await loadCompany(context);
    const { data, error } = await supabase
      .from("marketing_promotions")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { promotions: data ?? [] };
  });

export const deleteMarketingPromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { companyId, supabase } = await loadCompany(context);
    const { error } = await supabase
      .from("marketing_promotions")
      .delete()
      .eq("id", data.id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================================
// CONTENTS
// ============================================================================

const ContentUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().max(200).optional().nullable(),
  body: z.string().trim().max(5000).optional(),
  hashtags: z.array(z.string().trim().max(60)).max(30).optional(),
  cta_text: z.string().trim().max(500).optional().nullable(),
  cta_destination: z.string().trim().max(500).optional().nullable(),
});

export const updateMarketingContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ContentUpdateSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { companyId, supabase } = await loadCompany(context);
    const patch: Database["public"]["Tables"]["marketing_contents"]["Update"] = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.body !== undefined) patch.body = data.body;
    if (data.hashtags !== undefined) patch.hashtags = data.hashtags;
    if (data.cta_text !== undefined) patch.cta_text = data.cta_text;
    if (data.cta_destination !== undefined) patch.cta_destination = data.cta_destination;
    const { data: row, error } = await supabase
      .from("marketing_contents")
      .update(patch)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listMarketingContents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { companyId, supabase } = await loadCompany(context);
    const { data, error } = await supabase
      .from("marketing_contents")
      .select("*")
      .eq("company_id", companyId)

      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return { contents: data ?? [] };
  });


function visibilityColumnError(error: { code?: string; message?: string } | null | undefined): Error | null {
  if (error?.code === "42703" || error?.message?.includes("hidden_from_publish")) {
    return new Error("A coluna de visibilidade do Marketing IA ainda não existe. Aplique a migração de publish visibility antes de usar esta função.");
  }
  return null;
}

async function assertMarketingAdmin(ctx: { supabase: SB; userId: string }, companyId: string) {
  const sb = ctx.supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null; error: { message?: string } | null }>;
  };
  const { data: isAdmin, error } = await sb.rpc("has_role", {
    _user_id: ctx.userId,
    _company_id: companyId,
    _role: "admin",
  });
  if (error) throw new Error(`Falha ao validar a permissão de administrador: ${error.message ?? "erro desconhecido"}`);
  if (!isAdmin) throw new Error("Apenas administradores da empresa podem ocultar publicações antigas.");
}

export const listMarketingPublishContents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { companyId, supabase } = await loadCompany(context);
    const { data, error } = await supabase
      .from("marketing_contents")
      .select("*")
      .eq("company_id", companyId)
      .eq("hidden_from_publish", false)
      .order("created_at", { ascending: false })
      .limit(500);
    const missingColumn = visibilityColumnError(error);
    if (missingColumn) throw missingColumn;
    if (error) throw new Error(error.message);
    return { contents: data ?? [] };
  });

const CleanupSchema = z.object({
  statuses: z.array(z.enum(["draft", "pending", "approved", "rejected", "archived"])).min(1).max(5),
  before: z.string().datetime(),
  ids: z.array(z.string().uuid()).max(500).optional(),
});

const CLEANUP_BATCH = 500;
const ACTIVE_SCHEDULE_STATUSES = ["planned", "queued", "publishing"];

type CleanupCandidate = {
  id: string;
  status: string;
  created_at: string;
  campaign_id: string | null;
  hidden_from_publish: boolean;
};

type CleanupPreview = {
  eligibleCount: number;
  protectedCount: number;
  protectedByReason: { schedule: number; publication: number; alreadyHidden: number };
  activeScheduleCount: number;
  linkedCampaignCount: number;
  campaignStatusCounts: Record<string, number>;
  campaignQueryError: string | null;
  ignoredStatusCount: number;
  scannedCount: number;
  truncated: boolean;
  ids: string[];
};

async function findMarketingCleanupCandidates(sb: SB, companyId: string, input: z.infer<typeof CleanupSchema>): Promise<CleanupPreview> {
  // Só entram na varredura os conteúdos ainda visíveis nos status escolhidos: assim cada confirmação avança para os próximos 500 em vez de reler os já ocultos.
  const { data, error } = await sb.from("marketing_contents").select("id,status,created_at,campaign_id,hidden_from_publish").eq("company_id", companyId).lt("created_at", input.before).in("status", input.statuses).eq("hidden_from_publish", false).order("created_at", { ascending: true }).limit(CLEANUP_BATCH);
  const missingColumn = visibilityColumnError(error);
  if (missingColumn) throw missingColumn;
  if (error) throw new Error(`marketing_contents preview failed: ${error.message}`);
  const rows = (data ?? []) as CleanupCandidate[];
  const countContents = () => sb.from("marketing_contents").select("id", { count: "exact", head: true }).eq("company_id", companyId).lt("created_at", input.before);
  const { count: alreadyHiddenCount, error: hiddenCountError } = await countContents().in("status", input.statuses).eq("hidden_from_publish", true);
  if (hiddenCountError) throw new Error(`marketing_contents preview failed: ${hiddenCountError.message}`);
  const { count: ignoredStatusCount, error: ignoredCountError } = await countContents().not("status", "in", `(${input.statuses.join(",")})`);
  if (ignoredCountError) throw new Error(`marketing_contents preview failed: ${ignoredCountError.message}`);
  const { data: scheduled, error: scheduleError } = await sb.from("marketing_schedule").select("content_id,status").eq("company_id", companyId);
  if (scheduleError) throw new Error(`marketing_schedule preview failed: ${scheduleError.message}`);
  const scheduledIds = new Set((scheduled ?? []).map((row) => row.content_id as string));
  const activeScheduleIds = new Set((scheduled ?? []).filter((row) => ACTIVE_SCHEDULE_STATUSES.includes(String(row.status))).map((row) => row.content_id as string));
  const { data: publications, error: publicationError } = await sb.from("marketing_publications").select("content_id").eq("company_id", companyId);
  if (publicationError) throw new Error(`marketing_publications preview failed: ${publicationError.message}`);
  const publicationIds = new Set((publications ?? []).map((row) => row.content_id as string));
  const campaignIds = Array.from(new Set(rows.map((row) => row.campaign_id).filter((id): id is string => Boolean(id))));
  const { data: campaigns, error: campaignsError } = campaignIds.length ? await sb.from("campaigns").select("id,status").eq("company_id", companyId).in("id", campaignIds) : { data: [], error: null };
  const campaignStatusCounts = (campaigns ?? []).reduce<Record<string, number>>((acc, row) => { const status = String(row.status ?? "unknown"); acc[status] = (acc[status] ?? 0) + 1; return acc; }, {});
  const selected = rows.filter((row) => input.statuses.includes(row.status as z.infer<typeof CleanupSchema>["statuses"][number]));
  const protectedBySchedule = selected.filter((row) => !row.hidden_from_publish && scheduledIds.has(row.id));
  const protectedByPublication = selected.filter((row) => !row.hidden_from_publish && !scheduledIds.has(row.id) && publicationIds.has(row.id));
  // hidden_from_publish altera somente a visibilidade no Marketing IA (Início e Publicar). Agenda, histórico e campanhas permanecem intactos, então esses vínculos são informativos e não bloqueiam a ocultação.
  const eligibleRows = selected.filter((row) => !row.hidden_from_publish && (!input.ids || input.ids.includes(row.id)));
  return {
    eligibleCount: eligibleRows.length,
    protectedCount: alreadyHiddenCount ?? 0,
    protectedByReason: { schedule: protectedBySchedule.length, publication: protectedByPublication.length, alreadyHidden: alreadyHiddenCount ?? 0 },
    // Agendamentos ainda ativos continuam sendo publicados pelo worker mesmo com o conteúdo oculto.
    activeScheduleCount: eligibleRows.filter((row) => activeScheduleIds.has(row.id)).length,
    linkedCampaignCount: selected.filter((row) => Boolean(row.campaign_id)).length,
    campaignStatusCounts,
    campaignQueryError: campaignsError?.message ?? null,
    ignoredStatusCount: ignoredStatusCount ?? 0,
    scannedCount: rows.length + (alreadyHiddenCount ?? 0) + (ignoredStatusCount ?? 0),
    truncated: rows.length === CLEANUP_BATCH,
    ids: eligibleRows.map((row) => row.id),
  };
}
export const previewMarketingCleanup = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).inputValidator((i: unknown) => CleanupSchema.omit({ ids: true }).parse(i)).handler(async ({ data, context }) => {
  const { companyId, supabase } = await loadCompany(context);
  await assertMarketingAdmin({ supabase, userId: context.userId }, companyId);
  return { ...(await findMarketingCleanupCandidates(supabase, companyId, data)), company_id: companyId };
});
export const archiveMarketingCleanup = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((i: unknown) => CleanupSchema.parse(i)).handler(async ({ data, context }) => {
  const { companyId, supabase } = await loadCompany(context);
  await assertMarketingAdmin({ supabase, userId: context.userId }, companyId);
  const preview = await findMarketingCleanupCandidates(supabase, companyId, data);
  if (!preview.ids.length) return { archived: 0, hidden: 0, company_id: companyId };
  const { data: hidden, error } = await supabase.from("marketing_contents").update({ hidden_from_publish: true }).eq("company_id", companyId).in("id", preview.ids).in("status", data.statuses).select("id");
  const missingColumn = visibilityColumnError(error);
  if (missingColumn) throw missingColumn;
  if (error) throw new Error(error.message);
  return { archived: hidden?.length ?? 0, hidden: hidden?.length ?? 0, company_id: companyId };
});
const SetStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["draft", "pending", "approved", "rejected", "archived"]),
  rejection_reason: z.string().trim().max(500).optional().nullable(),
});

export const setMarketingContentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SetStatusSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { companyId, userId, supabase } = await loadCompany(context);
    const patch: Database["public"]["Tables"]["marketing_contents"]["Update"] = { status: data.status };
    if (data.status === "approved") {
      patch.approved_by = userId;
      patch.approved_at = new Date().toISOString();
      patch.rejection_reason = null;
    } else if (data.status === "rejected") {
      patch.rejection_reason = data.rejection_reason ?? null;
      patch.approved_by = null;
      patch.approved_at = null;
    }
    const { data: row, error } = await supabase
      .from("marketing_contents")
      .update(patch)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ============================================================================
// FACEBOOK PUBLISH READINESS — verifica pages_manage_posts na integração principal
// ============================================================================

/**
 * Retorna o status de prontidão para publicar no Facebook via API Graph.
 * NÃO consulta a Meta; apenas lê o snapshot persistido em
 * `integrations.account_metadata.granted_scopes` (gravado no OAuth).
 *
 * FB publishing requer `pages_manage_posts` no token. Sem ela, /photos e /feed
 * respondem HTTP 403 `(#200) Permissions error`. A integração principal do
 * canal `facebook` é preferida; se ausente, tenta o fallback pela integração
 * principal do `instagram` (que pode carregar fb_page_id + escopos do usuário).
 */
type ReadinessRow = {
  channel: "facebook" | "instagram";
  granted_scopes: unknown;
  external_account_id: string | null;
  fb_page_id: string | null;
};

async function fetchReadinessRows(sb: SB): Promise<ReadinessRow[]> {
  const { data, error } = await sb.rpc("get_facebook_publish_readiness");
  if (error) throw new Error(error.message);
  return (data ?? []) as ReadinessRow[];
}

export const getFacebookPublishReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = await loadCompany(context);
    const list = await fetchReadinessRows(supabase);
    const fb = list.find((r) => r.channel === "facebook") ?? null;
    const ig = list.find((r) => r.channel === "instagram") ?? null;
    const source = fb ?? ig;
    if (!source) {
      return {
        ok: false as const,
        code: "no_primary_integration",
        message: "Nenhuma integração Meta principal marcada. Conecte uma página no Facebook/Instagram.",
        hasPagesManagePosts: false,
        integrationChannel: null,
        pageId: null,
      };
    }
    const scopes = Array.isArray(source.granted_scopes)
      ? (source.granted_scopes as unknown[]).filter((s): s is string => typeof s === "string")
      : [];
    const hasPagesManagePosts = scopes.includes("pages_manage_posts");
    const pageId = source.fb_page_id ?? source.external_account_id;
    if (!hasPagesManagePosts) {
      return {
        ok: false as const,
        code: "missing_pages_manage_posts",
        message:
          "Permissão para publicar no Facebook não concedida. Clique em Reconectar Meta e conceda 'pages_manage_posts'. Se a Meta não exibir a permissão, o App precisa de Advanced Access via App Review.",
        hasPagesManagePosts: false,
        integrationChannel: source.channel,
        pageId,
        grantedScopes: scopes,
      };
    }
    return {
      ok: true as const,
      code: "ready",
      message: "Publicação no Facebook liberada.",
      hasPagesManagePosts: true,
      integrationChannel: source.channel,
      pageId,
      grantedScopes: scopes,
    };
  });

// ============================================================================
// SCHEDULE — obrigatório: só conteúdo approved da MESMA empresa
// ============================================================================

const ScheduleSchema = z.object({
  content_id: z.string().uuid(),
  channel: z.enum(["instagram", "facebook", "whatsapp"]),
  scheduled_at: z.string().datetime(),
  notes: z.string().trim().max(500).optional().nullable(),
});

/**
 * Guarda multi-tenant server-side: exige aprovação, mídia (IG/FB feed/reel/story)
 * e — para Facebook — o escopo `pages_manage_posts` na integração principal.
 * Sem essa permissão a Meta responde 403 `(#200) Permissions error` no publish.
 */
export const scheduleMarketingContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ScheduleSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { companyId, userId, supabase } = await loadCompany(context);
    const { data: content, error: cErr } = await supabase
      .from("marketing_contents")
      .select("id, company_id, status, media_ids, ai_prompt, campaign_id, format, product_id, feed_video_id, story_video_id")
      .eq("id", data.content_id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!content || content.company_id !== companyId) {
      throw new Error("Conteúdo não pertence à empresa.");
    }
    if (content.status !== "approved") {
      throw new Error(
        "Apenas conteúdos aprovados podem ser agendados. Aprove antes de programar.",
      );
    }
    // Carrossel: a publicação automática fica desligada até ser liberada
    // (sem isto o agendamento seria aceito e falharia na hora de publicar).
    if (content.format === "carousel" && !isCarouselPublishEnabled()) {
      throw new Error(CAROUSEL_PUBLISH_DISABLED_MESSAGE);
    }
    // IG/FB feed/reel/story exigem mídia publicável — pela mesma regra do
    // publicador: vídeo renderizado da campanha, acervo, fotos de produto.
    if (data.channel === "instagram" || data.channel === "facebook") {
      if (!publishableMediaSource(content)) {
        throw new Error(missingMediaMessage(content, data.channel === "instagram" ? "Instagram" : "Facebook"));
      }
    }
    // Guard: publicar no Facebook exige `pages_manage_posts` no token da
    // integração principal. Validamos aqui (leitura do snapshot persistido),
    // sem chamar a Meta.
    if (data.channel === "facebook") {
      const readiness = await assertFacebookPublishAllowed(supabase);
      if (!readiness.ok) {
        throw new Error(readiness.message);
      }
    }
    const { data: row, error } = await supabase
      .from("marketing_schedule")
      .insert({
        company_id: companyId,
        content_id: data.content_id,
        channel: data.channel,
        scheduled_at: data.scheduled_at,
        notes: data.notes ?? null,
        created_by: userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/**
 * Helper puro (server-side) que lê a integração principal e decide se o
 * canal Facebook está apto a publicar. Exportado para permitir testes.
 */
export async function assertFacebookPublishAllowed(
  sb: SB,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  let list: ReadinessRow[];
  try {
    list = await fetchReadinessRows(sb);
  } catch (e) {
    return { ok: false, code: "query_error", message: (e as Error).message };
  }
  const source =
    list.find((r) => r.channel === "facebook") ??
    list.find((r) => r.channel === "instagram");
  if (!source) {
    return {
      ok: false,
      code: "no_primary_integration",
      message: "Nenhuma integração Meta principal marcada. Conecte a página do Facebook antes de agendar.",
    };
  }
  const scopes = Array.isArray(source.granted_scopes)
    ? (source.granted_scopes as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  if (!scopes.includes("pages_manage_posts")) {
    return {
      ok: false,
      code: "missing_pages_manage_posts",
      message:
        "Permissão para publicar no Facebook não concedida (pages_manage_posts ausente). Vá em Marketing → Reconectar Meta e conceda a permissão. Se ela não aparecer, o App precisa de Advanced Access via App Review da Meta.",
    };
  }
  return { ok: true };
}



export const listMarketingSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { companyId, supabase } = await loadCompany(context);
    const { data, error } = await supabase
      .from("marketing_schedule")
      .select("*")
      .eq("company_id", companyId)
      .order("scheduled_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return { schedule: data ?? [] };
  });

/** Agenda do Marketing IA: só agendamentos cujo conteúdo não foi ocultado. */
export const listMarketingPublishSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { companyId, supabase } = await loadCompany(context);
    const { data, error } = await supabase
      .from("marketing_schedule")
      .select("*, marketing_contents!inner(hidden_from_publish)")
      .eq("company_id", companyId)
      .eq("marketing_contents.hidden_from_publish", false)
      .order("scheduled_at", { ascending: true })
      .limit(500);
    const missingColumn = visibilityColumnError(error);
    if (missingColumn) throw missingColumn;
    if (error) throw new Error(error.message);
    return { schedule: (data ?? []).map(({ marketing_contents: _content, ...row }) => row) };
  });

export const cancelMarketingSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { companyId, supabase } = await loadCompany(context);
    const { error } = await supabase
      .from("marketing_schedule")
      .update({ status: "cancelled" })
      .eq("id", data.id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Utilitário exposto p/ testes de guarda multi-tenant.
export const __marketing_internal_assertMediaBelongs = assertMediaBelongs;
