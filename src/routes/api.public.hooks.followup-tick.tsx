// ============================================================================
// POST /api/public/hooks/followup-tick
// Cron-friendly hook chamado por pg_cron/net.http_post.
//
// Segurança (FASE 1 hardening):
//  - Requer header x-followup-tick-secret === FOLLOWUP_TICK_SECRET.
//  - Comparação timing-safe.
//  - Somente método POST (405 nos demais).
//  - Body vazio ou objeto vazio strict (rejeita companyId do cliente).
//  - Rate limit global + lock técnico (uma execução por vez).
//  - Iteração de tenants derivada server-side por runFollowupTickAll —
//    caller nunca escolhe empresas.
//  - Regras operacionais existentes (integração ativa, janela, template
//    aprovado, idempotência) permanecem intactas em ai-followup.server.
//  - Logs sanitizados (agregados, sem PII).
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runFollowupTickAll, reconcileResponses } from "@/lib/ai-followup.server";
import {
  safeEqualSecret,
  rateLimit,
  tryAcquireLock,
  releaseLock,
  correlationId,
} from "@/lib/runtime/HookSecurity.server";
import { getHookSecret } from "@/lib/runtime/HookSecretVault.server";

const MAX_BODY_BYTES = 512;
const RATE_GLOBAL_PER_MIN = 12;
const LOCK_KEY = "followup-tick:global";

const BodySchema = z.object({}).strict();

function unauthorized() {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}
function methodNotAllowed() {
  return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
    status: 405,
    headers: { "content-type": "application/json", allow: "POST" },
  });
}

export const Route = createFileRoute("/api/public/hooks/followup-tick")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const cid = correlationId();
        const startedAt = Date.now();

        const expected =
          (await getHookSecret("followup_tick_secret")) ??
          process.env.FOLLOWUP_TICK_SECRET ??
          null;
        if (!expected) {
          console.error("[followup-tick]", { cid, event: "secret_not_configured" });
          return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
        }

        const provided = request.headers.get("x-followup-tick-secret") ?? "";
        if (!safeEqualSecret(provided, expected)) {
          console.warn("[followup-tick]", { cid, event: "auth_failed" });
          return unauthorized();
        }

        // Body: opcional; se vier, precisa ser {} estrito.
        const raw = await request.text().catch(() => "");
        if (raw.length > MAX_BODY_BYTES) {
          return Response.json({ ok: false, error: "payload_too_large" }, { status: 413 });
        }
        if (raw && raw.trim().length > 0) {
          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(raw);
          } catch {
            return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
          }
          const parsed = BodySchema.safeParse(parsedJson);
          if (!parsed.success) {
            console.warn("[followup-tick]", { cid, event: "invalid_body" });
            return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
          }
        }

        // Rate limit global.
        const rl = rateLimit("followup-tick:global", RATE_GLOBAL_PER_MIN, 60_000);
        if (!rl.allowed) {
          console.warn("[followup-tick]", { cid, event: "rate_limited" });
          return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
        }

        // Lock técnico: se já houver execução, resposta idempotente.
        if (!tryAcquireLock(LOCK_KEY)) {
          console.info("[followup-tick]", { cid, event: "already_running" });
          return Response.json(
            { ok: true, alreadyRunning: true },
            { status: 409 },
          );
        }

        try {
          const results = await runFollowupTickAll();

          // Reconcilia respostas para tenants com follow-ups pendentes recentes.
          const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
          const { data: pendingRows } = await supabaseAdmin
            .from("follow_ups")
            .select("company_id")
            .eq("status", "sent")
            .gte("sent_at", since);
          const companyIds = Array.from(
            new Set((pendingRows ?? []).map((r) => r.company_id).filter(Boolean)),
          );
          let reconciledCount = 0;
          for (const cidTenant of companyIds) {
            try {
              reconciledCount += (await reconcileResponses(cidTenant)) ?? 0;
            } catch {
              /* silencioso, agregado abaixo */
            }
          }

          const totals = results.reduce(
            (acc, r) => {
              acc.scanned += r.scanned;
              acc.sent += r.sent;
              acc.skipped += r.skipped.length;
              acc.errors += r.errors.length;
              return acc;
            },
            { scanned: 0, sent: 0, skipped: 0, errors: 0 },
          );

          console.info("[followup-tick]", {
            cid,
            event: "ok",
            tenants: results.length,
            reconciledTenants: companyIds.length,
            ms: Date.now() - startedAt,
            totals,
          });

          // Resposta agregada, sem PII, sem por-tenant detalhes.
          return Response.json({
            ok: true,
            tenants: results.length,
            totals,
            reconciled: { tenants: companyIds.length, updates: reconciledCount },
          });
        } catch (e) {
          console.error("[followup-tick]", {
            cid,
            event: "internal_error",
            ms: Date.now() - startedAt,
            code: e instanceof Error ? e.name : "Error",
          });
          return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
        } finally {
          releaseLock(LOCK_KEY);
        }
      },
      GET: async () => methodNotAllowed(),
      PUT: async () => methodNotAllowed(),
      PATCH: async () => methodNotAllowed(),
      DELETE: async () => methodNotAllowed(),
    },
  },
});
