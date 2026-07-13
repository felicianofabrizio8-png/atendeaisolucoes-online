// ============================================================================
// GET /api/executive/narrative?period=7d|30d|90d
// Gera a narrativa executiva (CEO AI) a partir do snapshot.
// READ-ONLY. Autenticação bearer + admin. RLS aplicada via cliente do usuário.
// Nunca envia PII para o LLM (ver ExecutiveNarrativePrompt.sanitizeSnapshotForLLM).
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ExecutiveAgent } from "@/lib/executive-ai/ExecutiveAgent.server";
import { ExecutiveNarrativeService } from "@/lib/executive-narrative/ExecutiveNarrativeService.server";

const QuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d"]).default("30d"),
  hour: z.coerce.number().int().min(0).max(23).optional(),
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

export const Route = createFileRoute("/api/executive/narrative")({
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
            .select("company_id, display_name")
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
            hour: url.searchParams.get("hour") ?? undefined,
          });
          if (!parsed.success)
            return json(400, { ok: false, error: "invalid_params" });

          const agent = new ExecutiveAgent({ supabase, companyId: profile.company_id });
          const bundle = await agent.snapshot(parsed.data.period);

          // Ingest Executive Knowledge (idempotente por snapshot_generated_at).
          // Falhas aqui NÃO derrubam a narrativa — knowledge é enriquecimento.
          let previousCtx: import(
            "@/lib/executive-narrative/ExecutiveNarrativePrompt"
          ).PreviousKnowledgeContext | undefined;
          try {
            const { ExecutiveKnowledgeService } = await import(
              "@/lib/executive-knowledge/ExecutiveKnowledgeService.server"
            );
            const ingest = await ExecutiveKnowledgeService.ingestSnapshot(
              supabase,
              profile.company_id,
              bundle,
            );
            if (ingest.previous) {
              previousCtx = {
                previousSnapshotAt: ingest.comparison.previousSnapshotAt ?? ingest.previous.snapshotGeneratedAt,
                daysBetween: ingest.comparison.daysBetween,
                improvements: ingest.comparison.improvements,
                regressions: ingest.comparison.regressions,
                newFacts: ingest.comparison.newFacts,
                summary: ingest.comparison.summary,
              };
            }
          } catch {
            // silencioso: nunca bloqueia a narrativa por causa do histórico.
          }

          const firstName =
            (profile.display_name ?? userData.user.email ?? "Executivo")
              .split(/\s+|@/)[0] || "Executivo";
          const localHour = parsed.data.hour ?? new Date().getUTCHours();

          const narrative = await ExecutiveNarrativeService.generate({
            bundle,
            executiveFirstName: firstName,
            localHour,
            previousKnowledge: previousCtx,
          });

          return json(200, { ok: true, data: narrative });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "internal_error";
          if (msg === "rate_limited") return json(429, { ok: false, error: "rate_limited" });
          if (msg === "credits_exhausted")
            return json(402, { ok: false, error: "credits_exhausted" });
          return json(500, { ok: false, error: "internal_error" });
        }
      },
    },
  },
});
