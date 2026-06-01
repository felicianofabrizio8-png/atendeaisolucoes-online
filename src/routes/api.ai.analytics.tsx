// ============================================================================
// Analytics da IA — endpoint do painel /ia (aba Analytics).
// Apenas leitura. Não altera engine, meta-send, meta-webhook ou Evolution.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getAnalytics, type AnalyticsPeriod } from "@/lib/ai-analytics.server";

async function authedCompanyId(request: Request): Promise<string | null> {
  const h = request.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  if (!data?.user) return null;
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", data.user.id)
    .maybeSingle();
  return prof?.company_id ?? null;
}

export const Route = createFileRoute("/api/ai/analytics")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const companyId = await authedCompanyId(request);
        if (!companyId)
          return Response.json(
            { ok: false, error: "não autenticado" },
            { status: 401 },
          );
        const url = new URL(request.url);
        const periodParam = (url.searchParams.get("period") ?? "7d") as AnalyticsPeriod;
        const period: AnalyticsPeriod =
          periodParam === "today" || periodParam === "7d" || periodParam === "30d"
            ? periodParam
            : "7d";
        const data = await getAnalytics(companyId, period);
        return Response.json({ ok: true, ...data });
      },
    },
  },
});
