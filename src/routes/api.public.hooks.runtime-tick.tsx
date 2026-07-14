// ============================================================================
// POST /api/public/hooks/runtime-tick
// Endpoint interno seguro para o Runtime Tick.
// - Requer header x-runtime-secret === RUNTIME_TICK_SECRET (server-side).
// - NÃO aceita companyId/tenantId no body (server-side only).
// - Etapa 17: enfileira system-health (5 min) + business-brain (60 min),
//   apenas para tenants com a flag correspondente ativa.
// - Dedupe distribuído por bucket do agente + lock por tenant/bucket.
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

// Allowlist explícita — o hook NUNCA consome outros agentes.
const TICK_AGENT_ALLOWLIST = ["system-health", "business-brain"] as const;
type TickAgent = (typeof TICK_AGENT_ALLOWLIST)[number];

const AGENT_PRIORITY: Record<TickAgent, "background"> = {
  "system-health": "background",
  "business-brain": "background",
};

export const Route = createFileRoute("/api/public/hooks/runtime-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getHookSecret } = await import("@/lib/runtime/HookSecretVault.server");
        const envSecret = process.env.RUNTIME_TICK_SECRET ?? null;
        const vaultSecret = await getHookSecret("runtime_tick_secret");
        if (!envSecret && !vaultSecret) {
          return Response.json({ ok: false, error: "secret_not_configured" }, { status: 503 });
        }
        const provided = request.headers.get("x-runtime-secret") ?? "";
        const matches =
          (!!provided && !!envSecret && safeEqual(provided, envSecret)) ||
          (!!provided && !!vaultSecret && safeEqual(provided, vaultSecret));
        if (!matches) {
          const { RuntimeAutonomyRegistry } = await import(
            "@/lib/runtime/RuntimeAutonomyRegistry.server"
          );
          for (const a of TICK_AGENT_ALLOWLIST) {
            RuntimeAutonomyRegistry.recordTickRejected(a);
          }
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

        const perAgentResults: Array<Record<string, unknown>> = [];

        for (const agent of TICK_AGENT_ALLOWLIST) {
          const tenants = await RuntimeAutonomyRegistry.enabledTenants(agent);
          RuntimeAutonomyRegistry.recordTick(
            agent,
            tenants,
            tenants.length === 0 ? "no_enabled_tenants" : "tick_accepted",
          );

          const interval = RuntimeAutonomyRegistry.intervalSeconds(agent);
          const bucket = RuntimeAutonomyRegistry.bucketFor(Date.now(), agent);
          const ownerId = `runtime-tick:${agent}:${bucket}:${Math.random().toString(36).slice(2, 10)}`;
          const results: Array<Record<string, unknown>> = [];

          for (const tenantId of tenants) {
            // Dedupe DISTRIBUÍDO por agente+tenant+bucket.
            const dedupeOk = await tryDedupe({
              operation: `runtime-tick:${agent}`,
              resourceKey: tenantId,
              bucket,
              ttlSeconds: interval + 60,
              companyId: tenantId,
            });
            if (!dedupeOk) {
              RuntimeAutonomyRegistry.recordDuplicatePrevented(agent);
              await auditRuntimeEvent({
                companyId: tenantId,
                action: "runtime_tick_dedup_hit",
                after: { agent, bucket },
              });
              results.push({ tenantId, status: "duplicate_prevented", reason: "distributed_dedupe" });
              continue;
            }

            // Lock DISTRIBUÍDO por tenant+agente+bucket.
            const lockKey = `runtime:${agent}:${tenantId}:${bucket}`;
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
                after: { agent, bucket },
              });
              results.push({ tenantId, status: "lock_denied" });
              continue;
            }

            try {
              const dedupeKey = RuntimeAutonomyRegistry.dedupeKey(agent, tenantId, bucket);
              const dispatched = await runtime.dispatcher.dispatch(
                {
                  agentId: agent,
                  tenantId,
                  priority: AGENT_PRIORITY[agent],
                  executionMode: "scheduled",
                  dedupeKey,
                  reason: `runtime-tick:autonomy:${agent}`,
                },
                {},
              );

              if (!dispatched.accepted && dispatched.reason === "duplicate_dedupe_key") {
                RuntimeAutonomyRegistry.recordDuplicatePrevented(agent);
                results.push({
                  tenantId,
                  status: "duplicate_prevented",
                  reason: dispatched.reason,
                });
                continue;
              }
              if (!dispatched.accepted || !dispatched.jobId) {
                results.push({
                  tenantId,
                  status: "dispatch_rejected",
                  reason: dispatched.reason,
                });
                continue;
              }

              RuntimeAutonomyRegistry.recordJobCreated(agent);
              const processed = await runtime.worker.process(dispatched.jobId);
              RuntimeAutonomyRegistry.recordJobCompleted(agent, processed.ok);

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

          perAgentResults.push({
            agent,
            bucket,
            intervalSeconds: interval,
            enabledTenantCount: tenants.length,
            results,
          });
        }

        return Response.json({
          ok: true,
          agents: perAgentResults,
        });
      },
    },
  },
});
