// ============================================================================
// GET /api/scientific-knowledge/timeline?period=30d&limit=30
// Admin-only. Retorna metadata agregado (nunca IDs operacionais nem PII).
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

const QuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d"]).default("30d"),
  limit: z.coerce.number().int().min(1).max(180).default(30),
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

export const Route = createFileRoute("/api/scientific-knowledge/timeline")({
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

          const userClient = makeUserClient(token);
          const { data: u } = await userClient.auth.getUser(token);
          if (!u?.user) return json(401, { ok: false, error: "unauthorized" });

          const { data: profile } = await userClient
            .from("profiles")
            .select("company_id")
            .eq("id", u.user.id)
            .maybeSingle();
          if (!profile?.company_id)
            return json(403, { ok: false, error: "forbidden_no_company" });

          const { data: isAdmin } = await userClient.rpc("has_role", {
            _user_id: u.user.id,
            _company_id: profile.company_id,
            _role: "admin",
          });
          if (isAdmin !== true) return json(403, { ok: false, error: "forbidden_role" });

          const url = new URL(request.url);
          const parsed = QuerySchema.safeParse({
            period: url.searchParams.get("period") ?? undefined,
            limit: url.searchParams.get("limit") ?? undefined,
          });
          if (!parsed.success)
            return json(400, { ok: false, error: "invalid_params" });

          const { data, error } = await userClient
            .from("scientific_knowledge_snapshots")
            .select("snapshot_date, engine_version, quality_json, created_at")
            .eq("company_id", profile.company_id)
            .eq("period", parsed.data.period)
            .order("snapshot_date", { ascending: false })
            .limit(parsed.data.limit);
          if (error) throw error;

          const { data: hyps } = await userClient
            .from("scientific_hypothesis_registry")
            .select("status")
            .eq("company_id", profile.company_id);
          const { data: knows } = await userClient
            .from("scientific_knowledge_registry")
            .select("status")
            .eq("company_id", profile.company_id);

          const countBy = (rows: { status: string }[] | null | undefined) => {
            const m: Record<string, number> = {};
            for (const r of rows ?? []) m[r.status] = (m[r.status] ?? 0) + 1;
            return m;
          };

          return json(200, {
            ok: true,
            data: {
              period: parsed.data.period,
              snapshots: (data ?? []).map((r) => ({
                snapshotDate: r.snapshot_date,
                engineVersion: r.engine_version,
                quality: r.quality_json,
                createdAt: r.created_at,
              })),
              hypothesesByStatus: countBy(hyps as { status: string }[] | null),
              knowledgeByStatus: countBy(knows as { status: string }[] | null),
            },
          });
        } catch {
          return json(500, { ok: false, error: "internal_error" });
        }
      },
    },
  },
});
