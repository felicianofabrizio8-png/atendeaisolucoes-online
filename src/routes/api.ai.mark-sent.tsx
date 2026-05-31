import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/ai/mark-sent")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const accessToken = authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length)
          : "";
        if (!accessToken) return Response.json({ error: "não autenticado" }, { status: 401 });
        const { data: userRes, error } = await supabaseAdmin.auth.getUser(accessToken);
        if (error || !userRes.user) return Response.json({ error: "sessão inválida" }, { status: 401 });

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userRes.user.id)
          .maybeSingle();
        if (!profile?.company_id) return Response.json({ error: "sem empresa" }, { status: 403 });

        let body: { logId?: string; sentText?: string; wasEdited?: boolean };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }
        if (!body.logId) return Response.json({ error: "logId obrigatório" }, { status: 400 });

        const { error: upErr } = await supabaseAdmin
          .from("ai_suggestions_log")
          .update({
            was_sent: true,
            was_edited: !!body.wasEdited,
            sent_text: body.sentText ?? null,
          })
          .eq("id", body.logId)
          .eq("company_id", profile.company_id);

        if (upErr) {
          console.error("[AI_MARK_SENT_ERR]", upErr);
          return Response.json({ error: upErr.message }, { status: 500 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
