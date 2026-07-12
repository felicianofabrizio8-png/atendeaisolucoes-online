// ============================================================================
// GET /api/executive/snapshot
// Endpoint READ-ONLY do Executive Intelligence.
// - Exige autenticação (bearer Supabase).
// - company_id é derivado do perfil autenticado (nunca do body/query).
// - period ∈ {"7d","30d","90d"}, default "30d", validado por Zod.
// - Nenhuma escrita. Nenhuma mutação. Apenas leitura.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ExecutiveAgent } from "@/lib/executive-ai/ExecutiveAgent.server";

const QuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d"]).default("30d"),
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function authedCompanyId(request: Request): Promise<string | null> {
  const h = request.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", data.user.id)
    .maybeSingle();
  return prof?.company_id ?? null;
}

export const Route = createFileRoute("/api/executive/snapshot")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        try {
          if (request.method !== "GET") {
            return json(405, { ok: false, error: "method_not_allowed" });
          }

          const companyId = await authedCompanyId(request);
          if (!companyId) {
            return json(401, { ok: false, error: "unauthorized" });
          }

          const url = new URL(request.url);
          const parsed = QuerySchema.safeParse({
            period: url.searchParams.get("period") ?? undefined,
          });
          if (!parsed.success) {
            return json(400, {
              ok: false,
              error: "invalid_params",
              details: parsed.error.flatten(),
            });
          }

          const agent = new ExecutiveAgent(companyId);
          const snapshot = await agent.snapshot(parsed.data.period);

          return json(200, {
            ok: true,
            data: {
              generatedAt: snapshot.generatedAt,
              period: snapshot.period,
              range: snapshot.range,
              metrics: snapshot.metrics,
              insights: snapshot.insights,
              dataQuality: snapshot.dataQuality,
            },
          });
        } catch {
          // Nunca expõe stack traces, queries internas ou secrets.
          return json(500, { ok: false, error: "internal_error" });
        }
      },
    },
  },
});
