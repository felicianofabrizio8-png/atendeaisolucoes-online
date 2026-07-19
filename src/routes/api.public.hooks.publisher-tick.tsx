// POST /api/public/hooks/publisher-tick
// Autenticação via header x-publisher-tick-secret comparado (timing-safe) contra o
// segredo armazenado no Vault (Option A: Vault é a ÚNICA fonte de verdade).
// O runtime NÃO possui cópia própria — busca sob demanda via RPC service_role.
// Sem PII na resposta. Lock técnico impede execução concorrente no mesmo isolate.

import { createFileRoute } from "@tanstack/react-router";
import { safeEqualSecret, rateLimit, tryAcquireLock, releaseLock, correlationId } from "@/lib/runtime/HookSecurity.server";

const LOCK_KEY = "publisher-tick:global";
const RATE_MAX_PER_MIN = 12;
// TTL do lock do hook: cobre o pior caso do tick (polling Meta + upload).
// Justificativa detalhada em HookSecurity.DEFAULT_LOCK_TTL_MS.
const LOCK_TTL_MS = 120_000;


function unauthorized() {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}
function methodNotAllowed() {
  return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
    status: 405,
    headers: { "content-type": "application/json", allow: "POST" },
  });
}

async function loadVaultSecret(): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("get_publisher_tick_secret");
  if (error) return null;
  const v = typeof data === "string" ? data.trim() : "";
  return v.length > 0 ? v : null;
}

export const Route = createFileRoute("/api/public/hooks/publisher-tick")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const cid = correlationId();
        const start = Date.now();
        const expected = await loadVaultSecret();
        if (!expected) {
          console.error("[publisher-tick]", { cid, event: "vault_secret_unavailable" });
          return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
        }
        const provided = request.headers.get("x-publisher-tick-secret") ?? "";
        if (!provided || !safeEqualSecret(provided, expected)) {
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
