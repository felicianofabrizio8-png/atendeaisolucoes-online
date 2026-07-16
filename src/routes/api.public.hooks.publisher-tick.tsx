// POST /api/public/hooks/publisher-tick
// Cron-friendly. Requer header x-publisher-tick-secret === PUBLISHER_TICK_SECRET.
// Sem PII na resposta. Lock técnico impede execução concorrente no mesmo isolate.

import { createFileRoute } from "@tanstack/react-router";
import { safeEqualSecret, rateLimit, tryAcquireLock, releaseLock, correlationId } from "@/lib/runtime/HookSecurity.server";

const LOCK_KEY = "publisher-tick:global";
const RATE_MAX_PER_MIN = 12;

function unauthorized() {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}
function methodNotAllowed() {
  return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
    status: 405,
    headers: { "content-type": "application/json", allow: "POST" },
  });
}

export const Route = createFileRoute("/api/public/hooks/publisher-tick")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const cid = correlationId();
        const start = Date.now();
        const expectedSecret = process.env.PUBLISHER_TICK_SECRET ?? null;
        const expectedAnon =
          process.env.SUPABASE_ANON_KEY ??
          process.env.SUPABASE_PUBLISHABLE_KEY ??
          null;
        const providedSecret = request.headers.get("x-publisher-tick-secret") ?? "";
        const providedApiKey = request.headers.get("apikey") ?? "";
        const secretOk =
          !!expectedSecret && safeEqualSecret(providedSecret, expectedSecret);
        const apiKeyOk =
          !!expectedAnon && safeEqualSecret(providedApiKey, expectedAnon);
        if (!secretOk && !apiKeyOk) {
          console.warn("[publisher-tick]", { cid, event: "auth_failed" });
          return unauthorized();
        }
        const rl = rateLimit("publisher-tick:global", RATE_MAX_PER_MIN, 60_000);
        if (!rl.allowed) {
          return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
        }
        if (!tryAcquireLock(LOCK_KEY)) {
          return Response.json({ ok: true, alreadyRunning: true }, { status: 409 });
        }
        try {
          const { PublisherAgent } = await import("@/lib/marketing-publisher/PublisherAgent.server");
          const agent = new PublisherAgent();
          const result = await agent.tick(`publisher:${cid}`);
          console.info("[publisher-tick]", { cid, event: "ok", tickMs: Date.now() - start, ...result });
          return Response.json({ ok: true, ...result });
        } catch (e) {
          console.error("[publisher-tick]", {
            cid,
            event: "internal_error",
            code: e instanceof Error ? e.name : "Error",
          });
          return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
        } finally {
          releaseLock(LOCK_KEY);
        }
      },
      GET: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
    },
  },
});
