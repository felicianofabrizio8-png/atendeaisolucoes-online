// ============================================================================
// GET /api/scientific-memory/latest
// Admin-only. READ-ONLY. Última memória científica + evolução vs. anterior.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ScientificMemoryAgent } from "@/lib/scientific-memory/ScientificMemoryAgent.server";

const QuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d"]).optional(),
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

export const Route = createFileRoute("/api/scientific-memory/latest")({
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

          const url = new URL(request.url);
          const parsed = QuerySchema.safeParse({
            period: url.searchParams.get("period") ?? undefined,
          });
          if (!parsed.success)
            return json(400, { ok: false, error: "invalid_params" });

          const agent = new ScientificMemoryAgent({
            supabase,
            companyId: profile.company_id,
          });
          const { record, evolution } = await agent.latest(parsed.data.period);

          return json(200, { ok: true, data: { record, evolution } });
        } catch {
          return json(500, { ok: false, error: "internal_error" });
        }
      },
    },
  },
});
