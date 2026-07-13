// ============================================================================
// POST /api/scientific-memory/persist
// Admin-only. Persistência controlada com suporte a dryRun.
// - tenant derivado do JWT (nunca do body)
// - dryRun=true (default): NÃO escreve; retorna payload + evolução esperada
// - dryRun=false: escreve via service_role (server-side); idempotente por fingerprint
// - métodos != POST → 405
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

const BodySchema = z
  .object({
    period: z.enum(["7d", "30d", "90d"]).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

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

export const Route = createFileRoute("/api/scientific-memory/persist")({
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

          // Parse do body — rejeita campos extras (ex: companyId).
          let raw: unknown = {};
          try {
            raw = await request.json();
          } catch {
            raw = {};
          }
          const parsed = BodySchema.safeParse(raw);
          if (!parsed.success) {
            return json(400, { ok: false, error: "invalid_body" });
          }

          // Tenant SEMPRE do JWT.
          const { data: profile } = await supabase
            .from("profiles")
            .select("company_id")
            .eq("id", u.user.id)
            .maybeSingle();
          if (!profile?.company_id) return json(403, { ok: false, error: "forbidden_no_company" });

          const { data: isAdmin } = await supabase.rpc("has_role", {
            _user_id: u.user.id,
            _company_id: profile.company_id,
            _role: "admin",
          });
          if (isAdmin !== true) return json(403, { ok: false, error: "forbidden_role" });

          // Carregamento tardio do admin (client.server) — só após autorizar.
          const { ScientificMemoryAgent } = await import(
            "@/lib/scientific-memory/ScientificMemoryAgent.server"
          );
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const agent = new ScientificMemoryAgent({
            supabase,
            companyId: profile.company_id,
            writer: supabaseAdmin as unknown as SupabaseClient<Database>,
          });

          const result = await agent.persist({
            period: parsed.data.period ?? "30d",
            dryRun: parsed.data.dryRun !== false, // default seguro: dryRun
          });

          return json(200, { ok: true, data: result });
        } catch {
          return json(500, { ok: false, error: "internal_error" });
        }
      },
    },
  },
});
