// ============================================================================
// Render Engine — Server functions
// Todo endpoint validado server-side. Frontend NUNCA envia paths de storage.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createRenderJobSchema,
  validateAudioRange,
} from "./render.validation";
import {
  MAX_ACTIVE_JOBS_PER_COMPANY,
  VIDEO_FORMAT_DIMENSIONS,
  type RenderJobRow,
  type VideoLibraryRow,
} from "./render.types";
import { buildVideoBrandSnapshot } from "./video-brand-snapshot";

// --------------------------------------------------------------------- create
export const createRenderJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createRenderJobSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ job: RenderJobRow }> => {
    const { supabase, userId } = context;

    // Company do usuário
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    if (profErr || !prof?.company_id) throw new Error("company_not_found");
    const companyId = prof.company_id;

    // Imagem — a origem determina onde validar o ownership.
    if (data.image_source === "marketing_media") {
      const { data: img, error: imgErr } = await supabase
        .from("marketing_media")
        .select("id, company_id, media_type, active")
        .eq("id", data.image_id)
        .maybeSingle();
      if (imgErr || !img) throw new Error("image_not_found");
      if (img.company_id !== companyId) throw new Error("image_cross_tenant");
      if (!img.active) throw new Error("image_inactive");
      if (img.media_type !== "image") throw new Error("image_wrong_type");
    } else {
      const { data: prod, error: prodErr } = await supabase
        .from("products")
        .select("id, company_id, active, images")
        .eq("id", data.product_id)
        .maybeSingle();
      if (prodErr || !prod) throw new Error("product_not_found");
      if (prod.company_id !== companyId) throw new Error("product_cross_tenant");
      if (!prod.active) throw new Error("product_inactive");
      const imgs = Array.isArray(prod.images)
        ? (prod.images.filter((x) => typeof x === "string") as string[])
        : [];
      if (!imgs.includes(data.product_image_path)) {
        throw new Error("product_image_not_owned");
      }
    }

    // Áudio: mesma empresa, ativo, com duração conhecida
    const { data: aud, error: audErr } = await supabase
      .from("audio_library")
      .select("id, company_id, is_active, duration_seconds")
      .eq("id", data.audio_id)
      .maybeSingle();
    if (audErr || !aud) throw new Error("audio_not_found");
    if (aud.company_id !== companyId) throw new Error("audio_cross_tenant");
    if (!aud.is_active) throw new Error("audio_inactive");
    const audioDuration = Number(aud.duration_seconds ?? 0);
    const rangeErr = validateAudioRange({
      audio_duration_seconds: audioDuration,
      audio_start_second: data.audio_start_second,
      duration_seconds: data.duration_seconds,
    });
    if (rangeErr) throw new Error(rangeErr);

    // Rate limit: jobs ativos
    const { count: activeCount, error: cntErr } = await supabase
      .from("video_render_jobs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", ["queued", "processing"]);
    if (cntErr) throw new Error("active_jobs_count_failed");
    if ((activeCount ?? 0) >= MAX_ACTIVE_JOBS_PER_COMPANY) {
      throw new Error("too_many_active_jobs");
    }

    const insertPayload =
      data.image_source === "marketing_media"
        ? {
            company_id: companyId,
            created_by: userId,
            image_source: "marketing_media" as const,
            image_id: data.image_id,
            audio_id: data.audio_id,
            video_format: data.video_format,
            audio_start_second: data.audio_start_second,
            duration_seconds: data.duration_seconds,
          }
        : {
            company_id: companyId,
            created_by: userId,
            image_source: "product_image" as const,
            product_id: data.product_id,
            product_image_path: data.product_image_path,
            audio_id: data.audio_id,
            video_format: data.video_format,
            audio_start_second: data.audio_start_second,
            duration_seconds: data.duration_seconds,
          };

    const { data: inserted, error: insErr } = await supabase
      .from("video_render_jobs")
      .insert(insertPayload)
      .select("*")
      .single();
    if (insErr || !inserted) throw new Error(insErr?.message ?? "job_insert_failed");
    return { job: inserted as unknown as RenderJobRow };
  });

// ---------------------------------------------------------------------- list
export const listRenderJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ limit: z.number().int().min(1).max(100).optional() }).parse(data ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ jobs: RenderJobRow[] }> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("video_render_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 30);
    if (error) throw new Error(error.message);
    return { jobs: (rows ?? []) as unknown as RenderJobRow[] };
  });

// -------------------------------------------------------------------- cancel
export const cancelRenderJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("video_render_jobs")
      .update({ status: "cancelled", failed_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "queued") // idempotente: só cancela se ainda estiver na fila
      .select("id, status")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { cancelled: !!row };
  });

// ------------------------------------------------------------------- videos
export const listVideos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ limit: z.number().int().min(1).max(100).optional() }).parse(data ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ videos: VideoLibraryRow[] }> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("video_library")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 60);
    if (error) throw new Error(error.message);
    return { videos: (rows ?? []) as unknown as VideoLibraryRow[] };
  });

// -------------------------------------------------------- signed url (video)
export const getVideoSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<{ url: string; expires_in: number }> => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles").select("company_id").eq("id", userId).maybeSingle();
    if (!prof?.company_id) throw new Error("company_not_found");

    const { data: video, error } = await supabase
      .from("video_library")
      .select("id, company_id, file_path, is_active")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !video) throw new Error("video_not_found");
    if (video.company_id !== prof.company_id) throw new Error("video_cross_tenant");
    if (!video.is_active) throw new Error("video_inactive");
    // Path deve começar com company_id/ para prevenir escape
    if (!video.file_path.startsWith(`${prof.company_id}/`)) {
      throw new Error("video_path_invalid");
    }
    const expiresIn = 300; // 5 min
    const { data: signed, error: signErr } = await supabase.storage
      .from("video-library")
      .createSignedUrl(video.file_path, expiresIn);
    if (signErr || !signed?.signedUrl) throw new Error("video_sign_failed");
    return { url: signed.signedUrl, expires_in: expiresIn };
  });

// ----------------------------------------------------------- set video active
export const setVideoActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid(), active: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("video_library")
      .update({ is_active: data.active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ------------------------------------------------------------ delete video
export const deleteVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles").select("company_id").eq("id", userId).maybeSingle();
    if (!prof?.company_id) throw new Error("company_not_found");

    const { data: v, error: getErr } = await supabase
      .from("video_library")
      .select("id, company_id, file_path, thumbnail_path")
      .eq("id", data.id)
      .maybeSingle();
    if (getErr || !v) throw new Error("video_not_found");
    if (v.company_id !== prof.company_id) throw new Error("video_cross_tenant");

    // Deleta storage (best-effort) e depois a linha
    const paths = [v.file_path, v.thumbnail_path].filter(Boolean) as string[];
    if (paths.length > 0) {
      await supabase.storage.from("video-library").remove(paths).catch(() => {});
    }
    const { error: delErr } = await supabase
      .from("video_library").delete().eq("id", data.id);
    if (delErr) throw new Error(delErr.message);
    return { ok: true };
  });

// ---------------------------------------------- helper para UI: dimensões
export function formatDimensions(fmt: keyof typeof VIDEO_FORMAT_DIMENSIONS) {
  return VIDEO_FORMAT_DIMENSIONS[fmt];
}
