// POST /api/public/render/fail
// Registra falha do job. Se attempt_count < max_attempts: reagenda com backoff.
// Caso contrário: marca como failed permanentemente. Idempotente por status.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  authenticateRenderWorker,
  badRequest,
  correlationId,
  internalError,
  methodNotAllowed,
  readJsonBody,
} from "@/lib/render-engine/RenderApiAuth.server";

const BACKOFF_SECONDS = [30, 120, 600];

const schema = z.object({
  jobId: z.string().uuid(),
  workerId: z.string().min(3).max(120),
  stage: z.string().min(1).max(60),
  errorCode: z.string().min(1).max(80),
  errorMessageSanitized: z.string().max(500).optional(),
  elapsedMs: z.number().int().min(0).max(24 * 3600 * 1000).optional(),
  permanent: z.boolean().optional(),
});

function sanitize(msg: string | undefined): string {
  if (!msg) return "";
  return msg
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\/(tmp|home|root|var)\/\S+/g, "[path]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export const Route = createFileRoute("/api/public/render/fail")({
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
        const message = sanitize(p.errorMessageSanitized);

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: job, error } = await supabaseAdmin
            .from("video_render_jobs")
            .select("id, status, locked_by, attempt_count, max_attempts")
            .eq("id", p.jobId)
            .maybeSingle();
          if (error || !job) return badRequest("job_not_found");

          if (job.status === "failed" || job.status === "completed" || job.status === "cancelled") {
            // Idempotente
            return Response.json({ ok: true, idempotent: true, status: job.status });
          }
          if (job.locked_by !== p.workerId) return badRequest("lock_mismatch");

          const isFinal = p.permanent === true || (job.attempt_count ?? 0) >= (job.max_attempts ?? 3);
          if (isFinal) {
            await supabaseAdmin
              .from("video_render_jobs")
              .update({
                status: "failed",
                failed_at: new Date().toISOString(),
                error_code: p.errorCode.slice(0, 80),
                error_message_sanitized: message,
                locked_at: null,
                locked_by: null,
              })
              .eq("id", job.id);
            console.error("[render-fail]", {
              cid,
              event: "render_failed_permanently",
              job_id: job.id,
              stage: p.stage,
              code: p.errorCode.slice(0, 80),
              attempt: job.attempt_count,
            });
            return Response.json({ ok: true, permanent: true });
          }

          const idx = Math.min((job.attempt_count ?? 1) - 1, BACKOFF_SECONDS.length - 1);
          const backoff = BACKOFF_SECONDS[Math.max(0, idx)] ?? 600;
          const nextAt = new Date(Date.now() + backoff * 1000).toISOString();
          await supabaseAdmin
            .from("video_render_jobs")
            .update({
              status: "queued",
              available_at: nextAt,
              error_code: p.errorCode.slice(0, 80),
              error_message_sanitized: message,
              locked_at: null,
              locked_by: null,
              progress: 0,
            })
            .eq("id", job.id);
          console.warn("[render-fail]", {
            cid,
            event: "render_retry_scheduled",
            job_id: job.id,
            attempt: job.attempt_count,
            backoff_seconds: backoff,
            code: p.errorCode.slice(0, 80),
          });
          return Response.json({ ok: true, retryInSeconds: backoff });
        } catch {
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
