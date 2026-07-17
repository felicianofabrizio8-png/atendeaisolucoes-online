// Server functions for the Audio Library module.
// - Todas as operações passam por requireSupabaseAuth.
// - company_id é sempre resolvido a partir do usuário autenticado; nunca
//   confiamos em company_id vindo do frontend.
// - RLS + policies do storage.objects garantem isolamento entre empresas;
//   estas funções adicionam validação server-side redundante para defesa
//   em profundidade.

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  extractCompanyIdFromAudioPath,
  sanitizeBrandStyleList,
  sanitizeMarketingObjectiveList,
  sanitizeRecommendedForList,
  sanitizeSeasonList,
  sanitizeTargetAudienceList,
  sanitizeVideoDurationList,
  validateAudioFile,
  validatePreferredRange,
} from "./audio-library-validation";
import {
  AUDIO_BRAND_STYLES,
  AUDIO_CATEGORIES,
  AUDIO_ENERGIES,
  AUDIO_MARKETING_OBJECTIVES,
  AUDIO_MOODS,
  AUDIO_PLAN_TIERS,
  AUDIO_RECOMMENDED_FOR,
  AUDIO_SEASONS,
  AUDIO_TARGET_AUDIENCES,
  AUDIO_VIDEO_DURATIONS,
  AUDIO_VOCAL_TYPES,
  computeAudioQuota,
  type AudioLibraryRow,
  type AudioPlanTier,
  type AudioQuotaInfo,
} from "./audio-library.types";

type SB = SupabaseClient<Database>;

const BUCKET = "audio-library";
const SIGNED_URL_TTL_SECONDS = 60 * 10; // 10 min

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

/** Log sanitizado: nunca inclui token, url assinada completa ou payload. */
function logEvent(event: string, payload: Record<string, unknown>) {
  try {
    // eslint-disable-next-line no-console
    console.info(`[audio-library] ${event}`, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

async function loadQuota(ctx: Ctx): Promise<AudioQuotaInfo> {
  const sb = ctx.supabase as unknown as SupabaseClient;
  const { data: company, error: compErr } = await sb
    .from("companies")
    .select("plan_tier")
    .eq("id", ctx.companyId)
    .maybeSingle();
  if (compErr) throw new Error(compErr.message);
  const rawTier = (company as { plan_tier?: string } | null)?.plan_tier ?? "starter";
  const tier: AudioPlanTier = (AUDIO_PLAN_TIERS as string[]).includes(rawTier)
    ? (rawTier as AudioPlanTier)
    : "starter";
  const { count, error: countErr } = await ctx.supabase
    .from("audio_library")
    .select("id", { count: "exact", head: true })
    .eq("company_id", ctx.companyId);
  if (countErr) throw new Error(countErr.message);
  return computeAudioQuota(tier, count ?? 0);
}

// ============================================================================
// Schemas
// ============================================================================

const zNullableStr = z
  .union([z.string().trim().min(1), z.null(), z.undefined()])
  .transform((v) => (v == null || v === "" ? null : v));

const zCategory = z.enum(AUDIO_CATEGORIES as [string, ...string[]]).nullish();
const zMood = z.enum(AUDIO_MOODS as [string, ...string[]]).nullish();
const zEnergy = z.enum(AUDIO_ENERGIES as [string, ...string[]]).nullish();
const zVocal = z.enum(AUDIO_VOCAL_TYPES as [string, ...string[]]).nullish();
const zRecommended = z
  .array(z.enum(AUDIO_RECOMMENDED_FOR as [string, ...string[]]))
  .default([]);

// Novos metadados (fase de enriquecimento) — todos opcionais, default [].
const zMarketingObjectives = z
  .array(z.enum(AUDIO_MARKETING_OBJECTIVES as [string, ...string[]]))
  .default([]);
const zBrandStyles = z
  .array(z.enum(AUDIO_BRAND_STYLES as [string, ...string[]]))
  .default([]);
const zSeasons = z
  .array(z.enum(AUDIO_SEASONS as [string, ...string[]]))
  .default([]);
const zTargetAudiences = z
  .array(z.enum(AUDIO_TARGET_AUDIENCES as [string, ...string[]]))
  .default([]);
// integer[] com whitelist estrita.
const zVideoDurations = z
  .array(
    z
      .number()
      .int()
      .refine((n) => (AUDIO_VIDEO_DURATIONS as number[]).includes(n), {
        message: "invalid_video_duration",
      }),
  )
  .default([]);
const zNullableInt = z.number().int().nullable().optional();

const createSchema = z.object({
  file_path: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  description: zNullableStr,
  original_filename: zNullableStr,
  mime_type: z.string().min(1),
  file_size_bytes: z.number().int().positive().nullable().optional(),
  duration_seconds: z.number().nonnegative().nullable().optional(),
  category: zCategory,
  mood: zMood,
  energy: zEnergy,
  vocal_type: zVocal,
  recommended_for: zRecommended,
  source: zNullableStr,
  commercial_use_confirmed: z.literal(true),
  commercial_rights_notes: zNullableStr,
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional()
    .nullable(),
  // novos — todos opcionais no payload; default [] / null.
  marketing_objectives: zMarketingObjectives.optional(),
  brand_styles: zBrandStyles.optional(),
  seasons: zSeasons.optional(),
  target_audiences: zTargetAudiences.optional(),
  best_video_durations: zVideoDurations.optional(),
  preferred_start_second: zNullableInt,
  preferred_end_second: zNullableInt,
});

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  description: zNullableStr.optional(),
  category: zCategory,
  mood: zMood,
  energy: zEnergy,
  vocal_type: zVocal,
  recommended_for: zRecommended.optional(),
  source: zNullableStr.optional(),
  commercial_rights_notes: zNullableStr.optional(),
  is_active: z.boolean().optional(),
  // novos — undefined = não altera; array vazio = limpa; null = limpa para
  // preferred_*_second (ambos precisam ser informados juntos).
  marketing_objectives: zMarketingObjectives.optional(),
  brand_styles: zBrandStyles.optional(),
  seasons: zSeasons.optional(),
  target_audiences: zTargetAudiences.optional(),
  best_video_durations: zVideoDurations.optional(),
  preferred_start_second: zNullableInt,
  preferred_end_second: zNullableInt,
});

const idSchema = z.object({ id: z.string().uuid() });

const listSchema = z
  .object({
    category: zCategory,
    mood: zMood,
    energy: zEnergy,
    recommended_for: z
      .enum(AUDIO_RECOMMENDED_FOR as [string, ...string[]])
      .nullish(),
    // filtros novos — todos opcionais, aplicados no servidor via .contains().
    marketing_objective: z
      .enum(AUDIO_MARKETING_OBJECTIVES as [string, ...string[]])
      .nullish(),
    brand_style: z.enum(AUDIO_BRAND_STYLES as [string, ...string[]]).nullish(),
    season: z.enum(AUDIO_SEASONS as [string, ...string[]]).nullish(),
    target_audience: z
      .enum(AUDIO_TARGET_AUDIENCES as [string, ...string[]])
      .nullish(),
    best_video_duration: z
      .number()
      .int()
      .refine((n) => (AUDIO_VIDEO_DURATIONS as number[]).includes(n))
      .nullish(),
    search: zNullableStr.optional(),
    active_only: z.boolean().optional(),
  })
  .partial()
  .optional();

const sha256Schema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

// ============================================================================
// listAudios
// ============================================================================

export const listAudios = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const ctx = await loadCompany(context);
    let query = ctx.supabase
      .from("audio_library")
      .select("*")
      .eq("company_id", ctx.companyId)
      .order("created_at", { ascending: false });
    if (data?.active_only) query = query.eq("is_active", true);
    if (data?.category) query = query.eq("category", data.category);
    if (data?.mood) query = query.eq("mood", data.mood);
    if (data?.energy) query = query.eq("energy", data.energy);
    if (data?.recommended_for) {
      query = query.contains("recommended_for", [data.recommended_for]);
    }
    if (data?.marketing_objective) {
      query = query.contains("marketing_objectives", [data.marketing_objective]);
    }
    if (data?.brand_style) {
      query = query.contains("brand_styles", [data.brand_style]);
    }
    if (data?.season) {
      query = query.contains("seasons", [data.season]);
    }
    if (data?.target_audience) {
      query = query.contains("target_audiences", [data.target_audience]);
    }
    if (data?.best_video_duration != null) {
      query = query.contains("best_video_durations", [data.best_video_duration]);
    }
    if (data?.search) {
      const term = data.search.replace(/[%_]/g, "\\$&");
      query = query.ilike("name", `%${term}%`);
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return { audios: (rows ?? []) as unknown as AudioLibraryRow[] };
  });

// ============================================================================
// getAudioQuota — retorna tier + limite + uso atual.
// ============================================================================

export const getAudioQuota = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = await loadCompany(context);
    const quota = await loadQuota(ctx);
    return { quota };
  });

// ============================================================================
// checkAudioDuplicate — verifica se o sha256 já existe para a empresa antes
// do upload; permite rejeitar cedo sem gastar banda enviando o arquivo.
// ============================================================================

export const checkAudioDuplicate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => sha256Schema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await loadCompany(context);
    const { data: row, error } = await ctx.supabase
      .from("audio_library")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select("id, name")
      .eq("company_id", ctx.companyId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .eq("sha256" as any, data.sha256)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (row) {
      logEvent("upload_duplicate_detected", {
        stage: "pre_upload",
        existing_id: (row as { id: string }).id,
      });
      return {
        duplicate: true as const,
        existing: row as { id: string; name: string },
      };
    }
    return { duplicate: false as const };
  });

// ============================================================================
// createAudio — assume que o arquivo já foi enviado ao storage pelo cliente.
// Valida path prefix + mime + tamanho + quota + duplicidade antes de gravar.
// ============================================================================

export const createAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await loadCompany(context);

    async function cleanupUpload(reason: string) {
      try {
        await ctx.supabase.storage.from(BUCKET).remove([data.file_path]);
      } catch (e) {
        logEvent("cleanup_failed", { reason, error: (e as Error).message });
      }
    }

    // Defesa em profundidade: path deve começar pelo companyId do usuário.
    const pathCompany = extractCompanyIdFromAudioPath(data.file_path);
    if (pathCompany !== ctx.companyId) {
      logEvent("cross_tenant_access_attempt", {
        company_id: ctx.companyId,
        user_id: ctx.userId,
        stage: "create",
        path_prefix: pathCompany,
      });
      await cleanupUpload("cross_tenant");
      throw new Error("Caminho de arquivo inválido para esta empresa.");
    }

    const validation = validateAudioFile({
      mimeType: data.mime_type,
      sizeBytes: data.file_size_bytes ?? 0,
      commercialUseConfirmed: data.commercial_use_confirmed,
    });
    if (!validation.ok) {
      await cleanupUpload("invalid_file");
      logEvent("upload_rejected", {
        reason: validation.reason,
        mime: data.mime_type,
      });
      throw new Error(`Arquivo inválido: ${validation.reason}`);
    }

    // Dedupe por hash (defesa em profundidade — o índice único garante).
    if (data.sha256) {
      const { data: existing, error: dupErr } = await ctx.supabase
        .from("audio_library")
        .select("id")
        .eq("company_id", ctx.companyId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .eq("sha256" as any, data.sha256)
        .maybeSingle();
      if (dupErr) throw new Error(dupErr.message);
      if (existing) {
        await cleanupUpload("duplicate");
        logEvent("upload_duplicate_detected", {
          stage: "create",
          existing_id: (existing as { id: string }).id,
        });
        throw new Error(
          `duplicate:${(existing as { id: string }).id}:Este arquivo já existe na sua biblioteca.`,
        );
      }
    }

    // Verificação de quota (limite de músicas por empresa).
    const quota = await loadQuota(ctx);
    if (quota.limit != null && quota.used >= quota.limit) {
      await cleanupUpload("quota_exceeded");
      logEvent("upload_quota_exceeded", {
        tier: quota.tier,
        limit: quota.limit,
        used: quota.used,
      });
      throw new Error(
        `quota_exceeded:${quota.tier}:${quota.limit}:Limite de músicas do plano ${quota.tier} atingido (${quota.used}/${quota.limit}).`,
      );
    }

    const payload = {
      company_id: ctx.companyId,
      created_by: ctx.userId,
      name: data.name,
      description: data.description,
      file_path: data.file_path,
      original_filename: data.original_filename,
      mime_type: data.mime_type,
      file_size_bytes: data.file_size_bytes ?? null,
      duration_seconds: data.duration_seconds ?? null,
      category: data.category ?? null,
      mood: data.mood ?? null,
      energy: data.energy ?? null,
      vocal_type: data.vocal_type ?? null,
      recommended_for: sanitizeRecommendedForList(data.recommended_for),
      source: data.source,
      commercial_use_confirmed: true,
      commercial_rights_notes: data.commercial_rights_notes,
      is_active: true,
      sha256: data.sha256 ?? null,
    };

    const { data: row, error } = await ctx.supabase
      .from("audio_library")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(payload as any)
      .select("*")
      .single();
    if (error) {
      await cleanupUpload("db_error");
      // Índice único de sha256: código 23505.
      if ((error as { code?: string }).code === "23505") {
        throw new Error("Este arquivo já existe na sua biblioteca.");
      }
      throw new Error(error.message);
    }
    logEvent("upload_completed", {
      audio_id: (row as { id: string }).id,
      size_bytes: data.file_size_bytes,
      mime: data.mime_type,
      has_sha256: !!data.sha256,
    });
    return { audio: row as unknown as AudioLibraryRow };
  });

// ============================================================================
// updateAudio
// ============================================================================

export const updateAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await loadCompany(context);
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.category !== undefined) patch.category = data.category ?? null;
    if (data.mood !== undefined) patch.mood = data.mood ?? null;
    if (data.energy !== undefined) patch.energy = data.energy ?? null;
    if (data.vocal_type !== undefined) patch.vocal_type = data.vocal_type ?? null;
    if (data.recommended_for !== undefined) {
      patch.recommended_for = sanitizeRecommendedForList(data.recommended_for);
    }
    if (data.source !== undefined) patch.source = data.source;
    if (data.commercial_rights_notes !== undefined) {
      patch.commercial_rights_notes = data.commercial_rights_notes;
    }
    if (data.is_active !== undefined) patch.is_active = data.is_active;

    const { data: row, error } = await ctx.supabase
      .from("audio_library")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(patch as any)
      .eq("id", data.id)
      .eq("company_id", ctx.companyId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { audio: row as unknown as AudioLibraryRow };
  });

// ============================================================================
// deleteAudio — remove DB + storage. Trata falhas parciais.
// ============================================================================

export const deleteAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await loadCompany(context);
    const { data: row, error: readErr } = await ctx.supabase
      .from("audio_library")
      .select("id, company_id, file_path")
      .eq("id", data.id)
      .eq("company_id", ctx.companyId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("Áudio não encontrado.");

    const { error: delErr } = await ctx.supabase
      .from("audio_library")
      .delete()
      .eq("id", data.id)
      .eq("company_id", ctx.companyId);
    if (delErr) {
      logEvent("delete_failed", { audio_id: data.id, stage: "db" });
      throw new Error(delErr.message);
    }
    // Remoção do storage: best-effort. Se falhar, registra mas não reverte
    // (o registro já foi apagado — arquivo órfão fica visível pela ausência
    // de referência e pode ser limpo em varredura futura).
    try {
      const { error: storageErr } = await ctx.supabase.storage
        .from(BUCKET)
        .remove([row.file_path]);
      if (storageErr) {
        logEvent("delete_failed", {
          audio_id: data.id,
          stage: "storage",
          error: storageErr.message,
        });
      }
    } catch (e) {
      logEvent("delete_failed", {
        audio_id: data.id,
        stage: "storage_exception",
        error: e instanceof Error ? e.message : String(e),
      });
    }
    logEvent("delete_completed", { audio_id: data.id });
    return { ok: true };
  });

// ============================================================================
// getAudioSignedUrl — gera signed URL temporária para o player.
// ============================================================================

export const getAudioSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await loadCompany(context);
    const { data: row, error } = await ctx.supabase
      .from("audio_library")
      .select("id, company_id, file_path")
      .eq("id", data.id)
      .eq("company_id", ctx.companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) {
      logEvent("cross_tenant_access_attempt", {
        company_id: ctx.companyId,
        user_id: ctx.userId,
        stage: "sign",
        audio_id: data.id,
      });
      throw new Error("Áudio não encontrado.");
    }
    const { data: signed, error: signErr } = await ctx.supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.file_path, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed?.signedUrl) {
      throw new Error(signErr?.message ?? "Falha ao gerar URL.");
    }
    logEvent("signed_url_issued", {
      audio_id: data.id,
      ttl_seconds: SIGNED_URL_TTL_SECONDS,
    });
    return {
      signed_url: signed.signedUrl,
      expires_at: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      ttl_seconds: SIGNED_URL_TTL_SECONDS,
    };
  });
