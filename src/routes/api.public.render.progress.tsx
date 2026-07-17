// POST /api/public/render/progress
// Atualiza progresso (0..99) de um job em processamento. Rejeita retrocesso,
// job terminal e worker sem lock. Idempotente.

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

const STAGES = [
  "downloading_sources",
  "rendering",
  "validating",
  "uploading",
  "finalizing",
] as const;

const schema = z.object({
  jobId: z.string().uuid(),
  workerId: z.string().min(3).max(120),
  stage: z.enum(STAGES),
  progress: z.number().int().min(0).max(99),
  elapsedMs: z.number().int().min(0).max(24 * 3600 * 1000).optional(),
});

export const Route = createFileRoute("/api/public/render/progress")({
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
        const { jobId, workerId, stage, progress } = parsed.data;

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: job, error } = await supabaseAdmin
            .from("video_render_jobs")
            .select("id, status, locked_by, progress")
            .eq("id", jobId)
            .maybeSingle();
          if (error || !job) return badRequest("job_not_found");
          if (job.status !== "processing") return badRequest("job_not_processing");
          if (job.locked_by !== workerId) return badRequest("lock_mismatch");
          const prev = Number(job.progress ?? 0);
          if (progress < prev) {
            // idempotente: aceita como no-op
            return Response.json({ ok: true, progress: prev, noop: true });
          }
          const { error: upErr } = await supabaseAdmin
            .from("video_render_jobs")
            .update({ progress })
            .eq("id", jobId)
            .eq("locked_by", workerId)
            .eq("status", "processing");
          if (upErr) return internalError();
          console.info("[render-progress]", {
            cid,
            event: "render_progress_updated",
            job_id: jobId,
            stage,
            progress,
          });
          return Response.json({ ok: true, progress });
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
