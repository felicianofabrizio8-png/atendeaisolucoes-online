// ============================================================================
// POST /api/public/hooks/agent-trigger
// Endpoint server-to-server chamado pelo trigger postgres em `messages`.
//
// Segurança (FASE 1 hardening):
//  - Requer header x-agent-trigger-secret === AGENT_TRIGGER_SECRET.
//  - Comparação timing-safe.
//  - Somente método POST (405 nos demais).
//  - Body validado por Zod strict (rejeita campos extras).
//  - Rejeita companyId/tenantId vindos do cliente — company_id derivado
//    server-side a partir da conversa.
//  - Rate limit por conversation_id e global.
//  - Dedupe por conversation_id em bucket curto (evita custo LLM duplicado).
//  - Logs sanitizados (sem PII, sem secret, sem payload bruto).
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { runAgentTick } from "@/lib/ai-agent.server";
import {
  safeEqualSecret,
  rateLimit,
  seenRecently,
  correlationId,
  maskId,
} from "@/lib/runtime/HookSecurity.server";
import { getHookSecret } from "@/lib/runtime/HookSecretVault.server";

const MAX_BODY_BYTES = 2 * 1024;
const DEDUPE_TTL_MS = 30_000;
const RATE_PER_CONV_PER_MIN = 6;
const RATE_GLOBAL_PER_MIN = 300;

const BodySchema = z
  .object({
    conversation_id: z.string().uuid().max(64),
  })
  .strict();

function unauthorized() {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function methodNotAllowed() {
  return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
    status: 405,
    headers: { "content-type": "application/json", allow: "POST" },
  });
}

export const Route = createFileRoute("/api/public/hooks/agent-trigger")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const cid = correlationId();
        const startedAt = Date.now();

        const expected =
          (await getHookSecret("agent_trigger_secret")) ??
          process.env.AGENT_TRIGGER_SECRET ??
          null;
        if (!expected) {
          console.error("[agent-trigger]", { cid, event: "secret_not_configured" });
          return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
        }

        const provided = request.headers.get("x-agent-trigger-secret") ?? "";
        if (!safeEqualSecret(provided, expected)) {
          console.warn("[agent-trigger]", { cid, event: "auth_failed" });
          return unauthorized();
        }

        // Body: exige JSON pequeno e schema estrito.
        const raw = await request.text().catch(() => "");
        if (raw.length > MAX_BODY_BYTES) {
          return Response.json({ ok: false, error: "payload_too_large" }, { status: 413 });
        }
        let parsedJson: unknown;
        try {
          parsedJson = raw ? JSON.parse(raw) : {};
        } catch {
          return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
        }
        const parsed = BodySchema.safeParse(parsedJson);
        if (!parsed.success) {
          console.warn("[agent-trigger]", { cid, event: "invalid_body" });
          return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
        }
        const conversationId = parsed.data.conversation_id;

        // Rate limit local (fast-path) + distribuído (fonte de verdade).
        const globalRl = rateLimit("agent-trigger:global", RATE_GLOBAL_PER_MIN, 60_000);
        if (!globalRl.allowed) {
          console.warn("[agent-trigger]", { cid, event: "rate_limited_global" });
          return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
        }
        const convRl = rateLimit(
          `agent-trigger:conv:${conversationId}`,
          RATE_PER_CONV_PER_MIN,
          60_000,
        );
        if (!convRl.allowed) {
          console.warn("[agent-trigger]", { cid, event: "rate_limited_conv", conv: maskId(conversationId) });
          return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
        }

        const { rateLimitCheck, tryDedupe, auditRuntimeEvent } = await import(
          "@/lib/runtime/RuntimeStateStore.server"
        );
        const distGlobalOk = await rateLimitCheck({
          companyId: null,
          bucket: "agent-trigger:global",
          windowSeconds: 60,
          max: RATE_GLOBAL_PER_MIN,
        });
        if (!distGlobalOk) {
          console.warn("[agent-trigger]", { cid, event: "rate_limited_global_dist" });
          return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
        }

        // Dedupe LOCAL curto (evita callback repetido no mesmo isolate).
        if (seenRecently(`agent-trigger:${conversationId}`, DEDUPE_TTL_MS)) {
          console.info("[agent-trigger]", { cid, event: "duplicate_prevented_local", conv: maskId(conversationId), ms: Date.now() - startedAt });
          return Response.json({ ok: true, deduped: true, scope: "local" });
        }
        // Dedupe DISTRIBUÍDO (unique constraint) — bucket de 30s.
        const nowSec = Math.floor(Date.now() / 1000);
        const distDedupeOk = await tryDedupe({
          operation: "agent-trigger",
          resourceKey: conversationId,
          bucket: Math.floor(nowSec / 30),
          ttlSeconds: 60,
        });
        if (!distDedupeOk) {
          await auditRuntimeEvent({ action: "agent_trigger_dedup_hit", after: { conv: maskId(conversationId) } });
          console.info("[agent-trigger]", { cid, event: "duplicate_prevented_dist", conv: maskId(conversationId), ms: Date.now() - startedAt });
          return Response.json({ ok: true, deduped: true, scope: "distributed" });
        }

        try {
          // company_id é derivado dentro de runAgentTick a partir da conversa.
          // Guardas de tenant/integração já existentes são respeitadas.
          const result = await runAgentTick(conversationId);
          console.info("[agent-trigger]", {
            cid,
            event: "ok",
            conv: maskId(conversationId),
            action: result.action,
            reason: result.reason ?? null,
            ms: Date.now() - startedAt,
          });
          return Response.json({ ok: true, result: { action: result.action } });
        } catch (e) {
          console.error("[agent-trigger]", {
            cid,
            event: "internal_error",
            conv: maskId(conversationId),
            ms: Date.now() - startedAt,
            code: e instanceof Error ? e.name : "Error",
          });
          return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
        }
      },
      GET: async () => methodNotAllowed(),
      PUT: async () => methodNotAllowed(),
      PATCH: async () => methodNotAllowed(),
      DELETE: async () => methodNotAllowed(),
    },
  },
});
