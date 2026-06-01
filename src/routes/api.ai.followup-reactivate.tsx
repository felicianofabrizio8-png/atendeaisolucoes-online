// ============================================================================
// /api/ai/followup-reactivate — dispara reativação manual de leads antigos.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runReactivation } from "@/lib/ai-followup-v2.server";

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

export const Route = createFileRoute("/api/ai/followup-reactivate")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const companyId = await authedCompanyId(request);
        if (!companyId)
          return Response.json({ ok: false, error: "não autenticado" }, { status: 401 });
        const result = await runReactivation(companyId);
        return Response.json({ ok: true, result });
      },
    },
  },
});
