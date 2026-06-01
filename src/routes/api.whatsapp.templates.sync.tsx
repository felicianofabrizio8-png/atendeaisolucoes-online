// Sincroniza templates da Meta para a empresa autenticada.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { syncTemplatesFromMeta } from "@/lib/wa-templates.server";

export const Route = createFileRoute("/api/whatsapp/templates/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) return Response.json({ error: "não autenticado" }, { status: 401 });
        const { data: userRes, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !userRes.user)
          return Response.json({ error: "sessão inválida" }, { status: 401 });
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userRes.user.id)
          .maybeSingle();
        if (!profile?.company_id)
          return Response.json({ error: "perfil sem empresa" }, { status: 403 });

        const result = await syncTemplatesFromMeta(profile.company_id);
        if (!result.ok) return Response.json(result, { status: 400 });
        return Response.json(result);
      },
    },
  },
});
