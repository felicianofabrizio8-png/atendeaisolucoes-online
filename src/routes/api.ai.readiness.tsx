// ============================================================================
// Status + saúde da IA por empresa (uso pelo painel /ia).
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getReadiness, getHealth } from "@/lib/ai-readiness.server";

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

export const Route = createFileRoute("/api/ai/readiness")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const companyId = await authedCompanyId(request);
        if (!companyId) return Response.json({ ok: false, error: "não autenticado" }, { status: 401 });
        const [readiness, health] = await Promise.all([
          getReadiness(companyId),
          getHealth(companyId),
        ]);
        return Response.json({ ok: true, readiness, health });
      },
    },
  },
});
