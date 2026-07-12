// ============================================================================
// GET /api/executive/snapshot
// Endpoint READ-ONLY do Executive Intelligence.
//
// Segurança:
//  - Exige bearer token do Supabase (usuário autenticado).
//  - Cliente Supabase é criado com a chave PUBLISHABLE + token do usuário.
//    RLS é aplicada normalmente. NUNCA usa SUPABASE_SERVICE_ROLE_KEY.
//  - company_id vem do perfil do próprio usuário (RLS), nunca do cliente.
//  - Apenas o papel 'admin' tem acesso (app_role atual: admin/atendente/financeiro).
//    'manager' não existe no enum; ver relatório para migração futura.
//  - Somente método GET; período validado por Zod: 7d | 30d | 90d (default 30d).
//  - Erros nunca expõem stack traces, queries internas ou secrets.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ExecutiveAgent } from "@/lib/executive-ai/ExecutiveAgent.server";

const QuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d"]).default("30d"),
});

// Papéis autorizados. 'manager' não existe no enum app_role neste projeto.
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

export const Route = createFileRoute("/api/executive/snapshot")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        try {
          if (request.method !== "GET") {
            return json(405, { ok: false, error: "method_not_allowed" });
          }

          const token = bearer(request);
          if (!token) return json(401, { ok: false, error: "unauthorized" });

          const supabase = makeUserClient(token);

          // Valida o token contra o Auth server (não confia só na assinatura local).
          const { data: userData, error: userErr } = await supabase.auth.getUser(token);
          if (userErr || !userData?.user) {
            return json(401, { ok: false, error: "unauthorized" });
          }
          const userId = userData.user.id;

          // company_id vem do perfil do próprio usuário (RLS filtra a linha certa).
          const { data: profile, error: profErr } = await supabase
            .from("profiles")
            .select("company_id")
            .eq("id", userId)
            .maybeSingle();
          if (profErr || !profile?.company_id) {
            return json(403, { ok: false, error: "forbidden_no_company" });
          }
          const companyId = profile.company_id;

          // Autorização por papel via helper existente (has_role).
          let allowed = false;
          for (const role of ALLOWED_ROLES) {
            const { data: ok } = await supabase.rpc("has_role", {
              _user_id: userId,
              _company_id: companyId,
              _role: role,
            });
            if (ok === true) {
              allowed = true;
              break;
            }
          }
          if (!allowed) {
            return json(403, { ok: false, error: "forbidden_role" });
          }

          // Validação de parâmetros.
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

          // Executa o agente com o cliente autenticado (RLS aplicada em cada query).
          const agent = new ExecutiveAgent({ supabase, companyId });
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
          return json(500, { ok: false, error: "internal_error" });
        }
      },
    },
  },
});
