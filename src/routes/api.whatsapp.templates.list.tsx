// Lista templates WhatsApp da empresa autenticada.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function resolveCompany(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { error: "não autenticado", status: 401 as const };
  const { data: userRes, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userRes.user) return { error: "sessão inválida", status: 401 as const };
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", userRes.user.id)
    .maybeSingle();
  if (!profile?.company_id) return { error: "perfil sem empresa", status: 403 as const };
  return { companyId: profile.company_id };
}

export const Route = createFileRoute("/api/whatsapp/templates/list")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ctx = await resolveCompany(request);
        if ("error" in ctx) return Response.json({ error: ctx.error }, { status: ctx.status });
        const { data, error } = await supabaseAdmin
          .from("whatsapp_templates")
          .select(
            "id, name, language, category, status, purpose, auto_use, variables, components, last_synced_at, meta_template_id, created_at, updated_at",
          )
          .eq("company_id", ctx.companyId)
          .order("updated_at", { ascending: false });
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ templates: data ?? [] });
      },
    },
  },
});
