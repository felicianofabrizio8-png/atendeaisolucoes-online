// ============================================================================
// POST /api/runtime/execute
// Admin-only. Enfileira UM job para um agente permitido e processa
// sincronamente com o Worker. Sem Scheduler, sem background, sem loops.
// tenantId derivado do JWT (profiles.company_id). companyId no body => 400.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const ALLOWED_AGENTS = [
  "system-health",
  "business-brain",
  "business-learning",
  "scientific-knowledge",
  "scientific-memory",
  "professor",
  "executive-intelligence",
  "executive-knowledge",
  "executive-narrative",
] as const;

const BodySchema = z
  .object({
    agentId: z.enum(ALLOWED_AGENTS),
    mode: z.literal("enqueue-and-process").optional().default("enqueue-and-process"),
    correlationId: z.string().min(1).max(128).optional(),
  })
  .strict();

function sanitizeReport(report: unknown): unknown {
  if (!report || typeof report !== "object") return report;
  const r = report as Record<string, unknown>;
  const result = r.result as Record<string, unknown> | undefined;
  return {
    executionId: r.executionId,
    agentId: r.agentId,
    tenantId: r.tenantId,
    jobId: r.jobId,
    ok: r.ok,
    reason: r.reason,
    totalDurationMs: r.totalDurationMs,
    stages: r.stages,
    result: result
      ? {
          outcome: result.outcome,
          reason: result.reason,
          attempt: result.attempt,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          durationMs: result.durationMs,
          stub: result.stub,
          error: result.error ? "error" : null,
          knowledgeBus: result.knowledgeBus ?? null,
        }
      : null,
  };
}

export const Route = createFileRoute("/api/runtime/execute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Method guard handled by route (POST only). Others => 405 via TSS.
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }

        let rawBody: unknown;
        try {
          rawBody = await request.json();
        } catch {
          return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
        }

        if (
          rawBody &&
          typeof rawBody === "object" &&
          ("companyId" in (rawBody as object) ||
            "tenantId" in (rawBody as object) ||
            "company_id" in (rawBody as object))
        ) {
          return Response.json({ ok: false, error: "tenant_from_jwt_only" }, { status: 400 });
        }

        const parsed = BodySchema.safeParse(rawBody);
        if (!parsed.success) {
          return Response.json(
            { ok: false, error: "invalid_body", details: parsed.error.flatten() },
            { status: 400 },
          );
        }
        const { agentId, correlationId } = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Verify bearer and load tenant + admin role.
        const token = authHeader.slice(7).trim();
        const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
        if (userErr || !userData?.user) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
        const userId = userData.user.id;

        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userId)
          .maybeSingle();
        if (!prof?.company_id) {
          return Response.json({ ok: false, error: "no_company" }, { status: 400 });
        }
        const tenantId = prof.company_id as string;

        const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
          _user_id: userId,
          _company_id: tenantId,
          _role: "admin",
        });
        if (!isAdmin) {
          return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
        }

        const { AutonomousRuntime } = await import("@/lib/runtime/AutonomousRuntime.server");
        const runtime = AutonomousRuntime.instance();
        runtime.bindWriter(supabaseAdmin);

        const dispatched = await runtime.dispatcher.dispatch(
          {
            agentId,
            tenantId,
            priority: "normal",
            correlationId: correlationId ?? null,
          },
          {},
        );

        if (!dispatched.accepted || !dispatched.jobId) {
          return Response.json(
            {
              ok: false,
              error: "dispatch_rejected",
              reason: dispatched.reason,
              agentId,
              tenantId,
            },
            { status: 400 },
          );
        }

        const processed = await runtime.worker.process(dispatched.jobId);
        const finalJob = await runtime.queue?.find(dispatched.jobId).catch(() => null);

        const nowMs = Date.now();
        const latestEnvelope = (topic: string) => {
          const env = runtime.context.bus.latest(tenantId, topic, agentId);
          if (!env) return null;
          return {
            id: env.id,
            topic: env.topic,
            producerAgentId: env.producerAgentId,
            version: env.version,
            createdAt: env.createdAt,
            expiresAt: env.expiresAt,
            ageSeconds: Math.max(
              0,
              Math.floor((nowMs - new Date(env.createdAt).getTime()) / 1000),
            ),
          };
        };

        return Response.json({
          ok: processed.ok,
          agentId,
          tenantId,
          correlationId: correlationId ?? null,
          dispatch: {
            accepted: dispatched.accepted,
            reason: dispatched.reason,
            jobId: dispatched.jobId,
            status: dispatched.status,
            dispatchedAt: dispatched.dispatchedAt,
          },
          job: finalJob
            ? {
                id: finalJob.id,
                status: finalJob.status,
                attempts: finalJob.attempts,
                scheduledAt: finalJob.scheduledAt,
                startedAt: finalJob.startedAt,
                finishedAt: finalJob.finishedAt,
                lastError: finalJob.lastError ? "error" : null,
              }
            : null,
          processing: {
            workerId: processed.workerId,
            found: processed.found,
            ok: processed.ok,
            reason: processed.reason,
            processingMs: processed.processingMs,
          },
          execution: sanitizeReport(processed.report),
          envelope: latestEnvelope(agentId === "system-health" ? "system-health" : agentId),
        });
      },
    },
  },
});
