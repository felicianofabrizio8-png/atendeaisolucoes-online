// ============================================================================
// GET /api/executive/sales-intelligence?period=7d|30d|90d
// Sales Intelligence Agent (Diretor Comercial AI).
// READ-ONLY. Admin somente. Reutiliza Executive Snapshot + Knowledge + CRM.
// Nenhum INSERT/UPDATE/DELETE. Nenhum envio de mensagem.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { SalesIntelligenceAgent } from "@/lib/sales-intelligence/SalesIntelligenceAgent.server";

const QuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d"]).default("30d"),
});

const ALLOWED_ROLES = ["admin"] as const;

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

export const Route = createFileRoute("/api/executive/sales-intelligence")({
  server: {
    handlers: {
      POST: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
      GET: async ({ request }: { request: Request }) => {
        try {
          const token = bearer(request);
          if (!token) return json(401, { ok: false, error: "unauthorized" });

          const supabase = makeUserClient(token);
          const { data: userData, error: userErr } = await supabase.auth.getUser(token);
          if (userErr || !userData?.user) return json(401, { ok: false, error: "unauthorized" });
          const userId = userData.user.id;

          const { data: profile, error: profErr } = await supabase
            .from("profiles")
            .select("company_id")
            .eq("id", userId)
            .maybeSingle();
          if (profErr || !profile?.company_id)
            return json(403, { ok: false, error: "forbidden_no_company" });

          let allowed = false;
          for (const role of ALLOWED_ROLES) {
            const { data: ok } = await supabase.rpc("has_role", {
              _user_id: userId,
              _company_id: profile.company_id,
              _role: role,
            });
            if (ok === true) {
              allowed = true;
              break;
            }
          }
          if (!allowed) return json(403, { ok: false, error: "forbidden_role" });

          const url = new URL(request.url);
          const parsed = QuerySchema.safeParse({
            period: url.searchParams.get("period") ?? undefined,
          });
          if (!parsed.success)
            return json(400, { ok: false, error: "invalid_params" });

          const agent = new SalesIntelligenceAgent({ supabase, companyId: profile.company_id });
          const bundle = await agent.run(parsed.data.period);
          return json(200, { ok: true, data: bundle });
        } catch {
          return json(500, { ok: false, error: "internal_error" });
        }
      },
    },
  },
});
