// POST /api/public/render/complete
// Confirma job concluído. Valida contrato, presença real do arquivo no
// Storage, e cria video_library de forma idempotente (UNIQUE render_job_id).

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  authenticateRenderWorker,
  badRequest,
  correlationId,
  deriveOutputVideoPath,
  internalError,
  methodNotAllowed,
  readJsonBody,
} from "@/lib/render-engine/RenderApiAuth.server";
import { VIDEO_FORMAT_DIMENSIONS } from "@/lib/render-engine/render.types";

const DURATION_TOLERANCE = 0.25;

const schema = z.object({
  jobId: z.string().uuid(),
  workerId: z.string().min(3).max(120),
  videoId: z.string().uuid(),
  filePath: z.string().min(5).max(400),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  fileSizeBytes: z.number().int().positive(),
  videoCodec: z.string().max(40),
  audioCodec: z.string().max(40),
  pixelFormat: z.string().max(40),
  mimeType: z.string().max(80),
  renderElapsedMs: z.number().int().min(0).max(24 * 3600 * 1000).optional(),
});

export const Route = createFileRoute("/api/public/render/complete")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const cid = correlationId();
        const authFail = authenticateRenderWorker(request);
        if (authFail) return authFail;
        const body = await readJsonBody(request);
        if ("error" in body) return body.error;
        const parsed = schema.safeParse(body.data);
        if (!parsed.success) return badRequest("invalid_payload");
        const p = parsed.data;

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: job, error } = await supabaseAdmin
            .from("video_render_jobs")
            .select("*")
            .eq("id", p.jobId)
            .maybeSingle();
          if (error || !job) return badRequest("job_not_found");

          // Idempotência: se já existe vídeo para este job, retorna sucesso
          const { data: existing } = await supabaseAdmin
            .from("video_library")
            .select("id")
            .eq("render_job_id", job.id)
            .maybeSingle();
          if (existing?.id) {
            await supabaseAdmin
              .from("video_render_jobs")
              .update({
                status: "completed",
                progress: 100,
                completed_at: job.completed_at ?? new Date().toISOString(),
                output_video_id: existing.id,
                locked_at: null,
                locked_by: null,
              })
              .eq("id", job.id);
            await linkVideoToMarketingCampaign(supabaseAdmin, job.id, existing.id);
            console.info("[render-complete]", { cid, event: "render_completed", idempotent: true, job_id: job.id });
            return Response.json({ ok: true, videoId: existing.id, idempotent: true });
          }

          if (job.status !== "processing") return badRequest("job_not_processing");
          if (job.locked_by !== p.workerId) return badRequest("lock_mismatch");
          if (p.videoId !== job.id) return badRequest("video_id_mismatch");

          const expectedPath = deriveOutputVideoPath(job.company_id, job.id);
          if (p.filePath !== expectedPath) return badRequest("file_path_mismatch");
          if (!p.filePath.startsWith(`${job.company_id}/`)) return badRequest("file_path_cross_tenant");

          const fmt = job.video_format as keyof typeof VIDEO_FORMAT_DIMENSIONS;
          const dims = VIDEO_FORMAT_DIMENSIONS[fmt];
          if (!dims) return badRequest("unknown_format");
          if (p.width !== dims.width || p.height !== dims.height) return badRequest("dimensions_mismatch");
          if (Math.abs(p.durationSeconds - Number(job.duration_seconds)) > DURATION_TOLERANCE) {
            return badRequest("duration_out_of_tolerance");
          }
          if (p.videoCodec !== "h264") return badRequest("bad_video_codec");
          if (p.audioCodec !== "aac") return badRequest("bad_audio_codec");
          if (p.pixelFormat !== "yuv420p") return badRequest("bad_pixel_format");
          if (p.mimeType !== "video/mp4") return badRequest("bad_mime_type");

          // Verifica existência real do arquivo no Storage (via list no prefixo)
          const prefix = `${job.company_id}/${job.id}`;
          const { data: listed, error: listErr } = await supabaseAdmin.storage
            .from("video-library")
            .list(prefix);
          if (listErr) return internalError();
          const found = (listed ?? []).some((o) => o.name === "video.mp4");
          if (!found) return badRequest("file_not_found_in_storage");

          const nameDefault = `Render ${new Date().toISOString().replace("T", " ").slice(0, 16)}`;
          const { data: videoRow, error: vErr } = await supabaseAdmin
            .from("video_library")
            .insert({
              id: p.videoId,
              company_id: job.company_id,
              created_by: job.created_by,
              name: nameDefault,
              file_path: p.filePath,
              source_type: "render_engine",
              source_image_id: job.image_id,
              source_audio_id: job.audio_id,
              render_job_id: job.id,
              video_format: fmt,
              width: p.width,
              height: p.height,
              duration_seconds: p.durationSeconds,
              file_size_bytes: p.fileSizeBytes,
              video_codec: p.videoCodec,
              audio_codec: p.audioCodec,
              mime_type: p.mimeType,
            })
            .select("id")
            .single();

          let finalVideoId = videoRow?.id ?? null;
          if (vErr) {
            // Corrida: outra rota já criou (UNIQUE render_job_id). Recupera existente.
            const { data: dup } = await supabaseAdmin
              .from("video_library")
              .select("id")
              .eq("render_job_id", job.id)
              .maybeSingle();
            if (!dup?.id) {
              console.error("[render-complete]", { cid, event: "video_insert_failed", code: vErr.code ?? null });
              return internalError();
            }
            finalVideoId = dup.id;
          }

          await supabaseAdmin
            .from("video_render_jobs")
            .update({
              status: "completed",
              progress: 100,
              completed_at: new Date().toISOString(),
              output_video_id: finalVideoId,
              locked_at: null,
              locked_by: null,
              error_code: null,
              error_message_sanitized: null,
            })
            .eq("id", job.id);

          if (finalVideoId) {
            await linkVideoToMarketingCampaign(supabaseAdmin, job.id, finalVideoId);
          }

          console.info("[render-complete]", {
            cid,
            event: "render_completed",
            job_id: job.id,
            video_id: finalVideoId,
          });
          return Response.json({ ok: true, videoId: finalVideoId });
        } catch (e) {
          console.error("[render-complete]", {
            cid,
            event: "internal_exception",
            code: e instanceof Error ? e.name : "Error",
          });
          return internalError();
        }
      },
      GET: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
    },
  },
});

/**
 * Fase C.1 + M3 — grava feed_video_id / story_video_id em toda linha de
 * marketing_contents cujo feed_render_job_id ou story_render_job_id aponte
 * para este job. Na Fase M3 um único job master pode ser referenciado nas
 * duas colunas (mesmo MP4 servindo Feed e Story).
 * Best-effort: falhas são apenas logadas para não bloquear a conclusão do render.
 */
async function linkVideoToMarketingCampaign(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  jobId: string,
  videoId: string,
): Promise<void> {
  try {
    const { linkVideoToMarketingCampaign: linker } = await import(
      "@/lib/render-engine/link-campaign-video"
    );
    const result = await linker(admin, jobId, videoId);
    console.info("[render-complete]", {
      event: "campaign_video_ids_linked",
      job_id: jobId,
      video_id: videoId,
      feed_updated: result.feedUpdated.length,
      story_updated: result.storyUpdated.length,
    });
  } catch (e) {
    console.warn("[render-complete] link_campaign_failed", {
      code: e instanceof Error ? e.name : "Error",
    });
  }
}

