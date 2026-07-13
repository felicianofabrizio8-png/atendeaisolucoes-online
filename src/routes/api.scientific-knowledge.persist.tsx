// ============================================================================
// POST /api/scientific-knowledge/persist
// Admin-only. Persiste snapshot científico imutável + upsert nos registries.
// Body: { period: "7d"|"30d"|"90d", dryRun: boolean }
// Tenant sempre derivado do JWT; nunca aceita companyId livre.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ScientificPersistenceService } from "@/lib/scientific-knowledge-persistence/ScientificPersistenceService.server";

const BodySchema = z.object({
  period: z.enum(["7d", "30d", "90d"]).default("30d"),
  dryRun: z.boolean().default(true),
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

export const Route = createFileRoute("/api/scientific-knowledge/persist")({
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

          let body: unknown = {};
          try {
            body = await request.json();
          } catch {
            body = {};
          }
          const parsed = BodySchema.safeParse(body);
          if (!parsed.success)
            return json(400, { ok: false, error: "invalid_body" });

          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const svc = new ScientificPersistenceService(
            userClient,
            supabaseAdmin,
            profile.company_id,
          );

          if (parsed.data.dryRun) {
            const plan = await svc.plan(parsed.data.period);
            return json(200, {
              ok: true,
              dryRun: true,
              data: {
                snapshotDate: plan.snapshotDate,
                engineVersion: plan.engineVersion,
                sourceFingerprint: plan.sourceFingerprint,
                changes: plan.changes,
                quality: plan.quality,
                sample: plan.snapshot.sample,
              },
            });
          }

          const result = await svc.persist(parsed.data.period);
          return json(200, {
            ok: true,
            dryRun: false,
            data: {
              snapshotId: result.snapshotId,
              snapshotDate: result.snapshotDate,
              engineVersion: result.engineVersion,
              sourceFingerprint: result.sourceFingerprint,
              changes: result.changes,
              quality: result.quality,
              sample: result.snapshot.sample,
            },
          });
        } catch {
          return json(500, { ok: false, error: "internal_error" });
        }
      },
    },
  },
});
