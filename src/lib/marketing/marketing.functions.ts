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

export const listMarketingMedia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { companyId, supabase } = await loadCompany(context);
    const { data, error } = await supabase
      .from("marketing_media")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return { media: data ?? [] };
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
    const patch: Record<string, unknown> = {};
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
    const patch: Record<string, unknown> = { status: data.status };
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
// SCHEDULE — obrigatório: só conteúdo approved da MESMA empresa
// ============================================================================

const ScheduleSchema = z.object({
  content_id: z.string().uuid(),
  channel: z.enum(["instagram", "facebook", "whatsapp"]),
  scheduled_at: z.string().datetime(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const scheduleMarketingContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ScheduleSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { companyId, userId, supabase } = await loadCompany(context);
    const { data: content, error: cErr } = await supabase
      .from("marketing_contents")
      .select("id, company_id, status")
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
