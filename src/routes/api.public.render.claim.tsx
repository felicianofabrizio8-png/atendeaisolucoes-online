// POST /api/public/render/claim
// Reserva atomicamente 1 job da fila para o Render Worker externo e retorna
// URLs assinadas (download imagem/áudio + upload MP4). Nenhum path vem do
// worker; tudo é derivado no servidor. 204 = fila vazia (não é erro).

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

const SIGNED_TTL_SECONDS = 600; // 10 min

const claimSchema = z.object({
  worker_id: z.string().min(3).max(120),
});

export const Route = createFileRoute("/api/public/render/claim")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const cid = correlationId();
        const authFail = authenticateRenderWorker(request);
        if (authFail) {
          console.warn("[render-claim]", { cid, event: "render_api_auth_failed" });
          return authFail;
        }
        const body = await readJsonBody(request);
        if ("error" in body) return body.error;
        const parsed = claimSchema.safeParse(body.data);
        if (!parsed.success) return badRequest("invalid_payload");
        const workerId = parsed.data.worker_id;

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: claimed, error: claimErr } = await supabaseAdmin.rpc("claim_render_job", {
            _worker_id: workerId,
            _lock_seconds: 600,
          });
          if (claimErr) {
            console.error("[render-claim]", { cid, event: "claim_rpc_failed", code: claimErr.code });
            return internalError();
          }
          const rows = (claimed ?? []) as Array<Record<string, unknown>>;
          if (rows.length === 0) {
            console.info("[render-claim]", { cid, event: "render_claim_empty" });
            return new Response(null, { status: 204 });
          }
          const job = rows[0] as {
            id: string;
            company_id: string;
            image_id: string;
            audio_id: string;
            video_format: keyof typeof VIDEO_FORMAT_DIMENSIONS;
            audio_start_second: number | string;
            duration_seconds: number | string;
            attempt_count: number;
            status: string;
          };
          if (job.status !== "processing") {
            console.warn("[render-claim]", { cid, event: "claim_status_invalid", status: job.status });
            return internalError();
          }
          const dims = VIDEO_FORMAT_DIMENSIONS[job.video_format];
          if (!dims) return internalError();

          // Resolve imagem e áudio (tenant-safe)
          const [{ data: img, error: imgErr }, { data: aud, error: audErr }] = await Promise.all([
            supabaseAdmin
              .from("marketing_media")
              .select("storage_path, company_id, active, media_type")
              .eq("id", job.image_id)
              .maybeSingle(),
            supabaseAdmin
              .from("audio_library")
              .select("file_path, company_id, is_active, duration_seconds")
              .eq("id", job.audio_id)
              .maybeSingle(),
          ]);
          const fail = async (code: string) => {
            await supabaseAdmin
              .from("video_render_jobs")
              .update({
                status: "failed",
                failed_at: new Date().toISOString(),
                error_code: code,
                error_message_sanitized: code,
                locked_at: null,
                locked_by: null,
              })
              .eq("id", job.id);
            console.error("[render-claim]", { cid, event: "claim_source_invalid", code });
            return internalError();
          };
          if (imgErr || !img) return fail("source_image_not_found");
          if (audErr || !aud) return fail("source_audio_not_found");
          if (img.company_id !== job.company_id) return fail("image_cross_tenant");
          if (aud.company_id !== job.company_id) return fail("audio_cross_tenant");
          if (!img.active) return fail("image_inactive");
          if (!aud.is_active) return fail("audio_inactive");
          if (img.media_type !== "image") return fail("image_wrong_type");

          const audioDuration = Number(aud.duration_seconds ?? 0);
          const dur = Number(job.duration_seconds);
          const start = Number(job.audio_start_second);
          if (audioDuration > 0 && start + dur > audioDuration + 0.25) {
            return fail("audio_range_out_of_bounds");
          }

          // Signed URLs de download
          const [dlImg, dlAud] = await Promise.all([
            supabaseAdmin.storage.from("marketing-media").createSignedUrl(img.storage_path, SIGNED_TTL_SECONDS),
            supabaseAdmin.storage.from("audio-library").createSignedUrl(aud.file_path, SIGNED_TTL_SECONDS),
          ]);
          if (dlImg.error || !dlImg.data?.signedUrl) return fail("image_sign_failed");
          if (dlAud.error || !dlAud.data?.signedUrl) return fail("audio_sign_failed");

          // Reserva determinística: videoId := jobId; path := company/jobId/video.mp4
          const videoId = job.id;
          const outputPath = deriveOutputVideoPath(job.company_id, videoId);

          const { data: upl, error: uplErr } = await supabaseAdmin.storage
            .from("video-library")
            .createSignedUploadUrl(outputPath);
          if (uplErr || !upl?.signedUrl) {
            // Se já existir arquivo (retentativa), o worker deverá tratar via /complete idempotente
            return fail("upload_sign_failed");
          }

          const expiresAt = new Date(Date.now() + SIGNED_TTL_SECONDS * 1000).toISOString();
          console.info("[render-claim]", {
            cid,
            event: "render_job_claimed",
            job_id: job.id,
            company_id: job.company_id,
            worker_id: workerId,
            attempt: job.attempt_count,
          });

          return Response.json({
            job: {
              id: job.id,
              companyId: job.company_id,
              workerId,
              attemptCount: job.attempt_count,
              videoFormat: job.video_format,
              audioStartSecond: start,
              durationSeconds: dur,
              width: dims.width,
              height: dims.height,
            },
            source: {
              imageDownloadUrl: dlImg.data.signedUrl,
              audioDownloadUrl: dlAud.data.signedUrl,
            },
            output: {
              videoId,
              uploadUrl: upl.signedUrl,
              filePath: outputPath,
            },
            expiresAt,
          });
        } catch (e) {
          console.error("[render-claim]", {
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
