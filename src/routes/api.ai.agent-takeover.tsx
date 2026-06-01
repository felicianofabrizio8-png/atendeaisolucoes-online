// ============================================================================
// Marca a conversa como assumida pelo humano (para o badge sumir e bloquear IA).
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/ai/agent-takeover")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const accessToken = authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length)
          : "";
        if (!accessToken) return Response.json({ ok: false, error: "não autenticado" }, { status: 401 });
        const { data: userRes } = await supabaseAdmin.auth.getUser(accessToken);
        if (!userRes?.user) return Response.json({ ok: false, error: "sessão inválida" }, { status: 401 });

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userRes.user.id)
          .maybeSingle();
        if (!profile?.company_id) return Response.json({ ok: false, error: "sem empresa" }, { status: 403 });

        let body: { conversation_id?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "json inválido" }, { status: 400 });
        }
        const id = String(body.conversation_id ?? "").trim();
        if (!id) return Response.json({ ok: false, error: "conversation_id obrigatório" }, { status: 400 });

        const { error } = await supabaseAdmin
          .from("conversations")
          .update({
            ai_status: "assumido_humano",
            human_takeover_at: new Date().toISOString(),
            ai_handling: false,
          })
          .eq("id", id)
          .eq("company_id", profile.company_id);

        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true });
      },
    },
  },
});
