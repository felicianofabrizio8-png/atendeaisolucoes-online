// ============================================================================
// POST /api/public/hooks/runtime-tick
// Endpoint interno seguro para o Runtime Tick da Etapa 15.
// - Requer header x-runtime-secret === RUNTIME_TICK_SECRET (server-side).
// - NÃO aceita companyId/tenantId no body (server-side only).
// - Enfileira SOMENTE system-health, apenas para tenants em autonomia.
// - Dedupe por bucket de 5 minutos.
// - Processa síncronamente pelo Worker do Runtime (sem loops).
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export const Route = createFileRoute("/api/public/hooks/runtime-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.RUNTIME_TICK_SECRET;
        if (!expected) {
          return Response.json({ ok: false, error: "secret_not_configured" }, { status: 503 });
        }
        const provided = request.headers.get("x-runtime-secret") ?? "";
        if (!provided || !safeEqual(provided, expected)) {
          const { RuntimeAutonomyRegistry } = await import(
            "@/lib/runtime/RuntimeAutonomyRegistry.server"
          );
          RuntimeAutonomyRegistry.recordTickRejected("system-health");
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }

        // Rejeita qualquer tentativa de forçar tenant pelo cliente.
        try {
          const body = await request.json().catch(() => null);
          if (
            body &&
            typeof body === "object" &&
            ("companyId" in body || "tenantId" in body || "company_id" in body)
          ) {
            return Response.json(
              { ok: false, error: "tenant_from_server_only" },
              { status: 400 },
            );
          }
        } catch {
          /* body opcional */
        }

        const { RuntimeAutonomyRegistry } = await import(
          "@/lib/runtime/RuntimeAutonomyRegistry.server"
        );
        const { AutonomousRuntime } = await import("@/lib/runtime/AutonomousRuntime.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const {
          tryDedupe,
          tryAcquireLock,
          releaseLock,
          auditRuntimeEvent,
        } = await import("@/lib/runtime/RuntimeStateStore.server");

        const runtime = AutonomousRuntime.instance();
        runtime.bindWriter(supabaseAdmin);

        // Fonte de verdade PERSISTIDA (batch, respeita kill switch).
        const tenants = await RuntimeAutonomyRegistry.enabledTenants("system-health");
        RuntimeAutonomyRegistry.recordTick(
          "system-health",
          tenants,
          tenants.length === 0 ? "no_enabled_tenants" : "tick_accepted",
        );

        const bucket = RuntimeAutonomyRegistry.bucketFor();
        const ownerId = `runtime-tick:${bucket}:${Math.random().toString(36).slice(2, 10)}`;
        const results: Array<Record<string, unknown>> = [];

        for (const tenantId of tenants) {
          // Dedupe DISTRIBUÍDO (unique constraint no banco) — TTL do bucket.
          const dedupeOk = await tryDedupe({
            operation: "runtime-tick:system-health",
            resourceKey: tenantId,
            bucket,
            ttlSeconds: RuntimeAutonomyRegistry.INTERVAL_SECONDS + 60,
            companyId: tenantId,
          });
          if (!dedupeOk) {
            RuntimeAutonomyRegistry.recordDuplicatePrevented("system-health");
            await auditRuntimeEvent({
              companyId: tenantId,
              action: "runtime_tick_dedup_hit",
              after: { bucket },
            });
            results.push({ tenantId, status: "duplicate_prevented", reason: "distributed_dedupe" });
            continue;
          }

          // Lock DISTRIBUÍDO por tenant+bucket
          const lockKey = `runtime:system-health:${tenantId}:${bucket}`;
          const locked = await tryAcquireLock({
            lockKey,
            ownerId,
            ttlSeconds: 120,
            companyId: tenantId,
          });
          if (!locked) {
            await auditRuntimeEvent({
              companyId: tenantId,
              action: "runtime_tick_lock_denied",
              after: { bucket },
            });
            results.push({ tenantId, status: "lock_denied" });
            continue;
          }

          try {
            const dedupeKey = RuntimeAutonomyRegistry.dedupeKey("system-health", tenantId, bucket);
            const dispatched = await runtime.dispatcher.dispatch(
              {
                agentId: "system-health",
                tenantId,
                priority: "background",
                executionMode: "scheduled",
                dedupeKey,
                reason: "runtime-tick:autonomy",
              },
              {},
            );

            if (!dispatched.accepted && dispatched.reason === "duplicate_dedupe_key") {
              RuntimeAutonomyRegistry.recordDuplicatePrevented("system-health");
              results.push({ tenantId, status: "duplicate_prevented", reason: dispatched.reason });
              continue;
            }
            if (!dispatched.accepted || !dispatched.jobId) {
              results.push({ tenantId, status: "dispatch_rejected", reason: dispatched.reason });
              continue;
            }

            RuntimeAutonomyRegistry.recordJobCreated("system-health");
            const processed = await runtime.worker.process(dispatched.jobId);
            RuntimeAutonomyRegistry.recordJobCompleted("system-health", processed.ok);

            results.push({
              tenantId,
              status: processed.ok ? "completed" : "failed",
              jobId: dispatched.jobId,
              processingMs: processed.processingMs,
              reason: processed.reason,
            });
          } finally {
            await releaseLock(lockKey, ownerId);
          }
        }

        return Response.json({
          ok: true,
          agent: "system-health",
          bucket,
          intervalSeconds: RuntimeAutonomyRegistry.INTERVAL_SECONDS,
          enabledTenantCount: tenants.length,
          results,
        });
      },
    },
  },
});
