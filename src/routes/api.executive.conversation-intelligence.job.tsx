// ============================================================================
// POST /api/executive/conversation-intelligence/job
// Admin-only. Dispara dry-run ou backfill em SHADOW MODE.
// - dry-run: simula análise, NÃO grava fatos, NÃO altera state.
// - backfill: grava fatos idempotentemente. Máx 50 conversas por chamada.
// Nunca consome LLM. Nunca modifica dados operacionais.
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { dryRun, backfill } from "@/lib/conversation-intelligence/ConversationIntelligenceService.server";

const BodySchema = z.object({
  mode: z.enum(["dry-run", "backfill"]),
  limit: z.number().int().min(1).max(50).default(20),
  channels: z.array(z.enum(["whatsapp", "instagram", "facebook", "messenger"])).optional(),
  onlyTerminated: z.boolean().optional(),
  olderThanDays: z.number().int().min(0).max(3650).optional(),
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ")) return null;
  const t = h.slice(7).trim();
  return t.length > 0 ? t : null;
}

function makeUserClient(token: string): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("missing_env");
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

const methodNotAllowed = () => json(405, { ok: false, error: "method_not_allowed" });

export const Route = createFileRoute("/api/executive/conversation-intelligence/job")({
  server: {
    handlers: {
      GET: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
      POST: async ({ request }: { request: Request }) => {
        try {
          const token = bearer(request);
          if (!token) return json(401, { ok: false, error: "unauthorized" });
          const supabase = makeUserClient(token);
          const { data: u } = await supabase.auth.getUser(token);
          if (!u?.user) return json(401, { ok: false, error: "unauthorized" });

          const { data: profile } = await supabase
            .from("profiles")
            .select("company_id")
            .eq("id", u.user.id)
            .maybeSingle();
          if (!profile?.company_id)
            return json(403, { ok: false, error: "forbidden_no_company" });

          const { data: isAdmin } = await supabase.rpc("has_role", {
            _user_id: u.user.id,
            _company_id: profile.company_id,
            _role: "admin",
          });
          if (isAdmin !== true) return json(403, { ok: false, error: "forbidden_role" });

          const raw = await request.json().catch(() => ({}));
          const parsed = BodySchema.safeParse(raw);
          if (!parsed.success) {
            return json(400, { ok: false, error: "invalid_body" });
          }

          const opts = {
            companyId: profile.company_id,
            limit: parsed.data.limit,
            channels: parsed.data.channels,
            onlyTerminated: parsed.data.onlyTerminated,
            olderThanDays: parsed.data.olderThanDays,
          };

          const t0 = Date.now();
          const report =
            parsed.data.mode === "dry-run"
              ? await dryRun(opts)
              : await backfill(opts);
          const duration_ms = Date.now() - t0;

          // Log sanitizado — apenas metadados agregados.
          console.log(
            JSON.stringify({
              module: "conversation-intelligence",
              mode: parsed.data.mode,
              company_hash: profile.company_id.slice(0, 8),
              duration_ms,
              scanned: report.scanned,
            })
          );

          return json(200, { ok: true, mode: parsed.data.mode, duration_ms, report });
        } catch {
          return json(500, { ok: false, error: "internal_error" });
        }
      },
    },
  },
});
