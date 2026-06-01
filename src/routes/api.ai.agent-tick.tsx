// ============================================================================
// Rota interna autenticada para disparar um tick do agente manualmente
// (usada pelo cron e por testes do painel).
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAgentTick } from "@/lib/ai-agent.server";

export const Route = createFileRoute("/api/ai/agent-tick")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const accessToken = authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length)
          : "";
        if (!accessToken) {
          return Response.json({ ok: false, error: "não autenticado" }, { status: 401 });
        }
        const { data: userRes, error } = await supabaseAdmin.auth.getUser(accessToken);
        if (error || !userRes.user) {
          return Response.json({ ok: false, error: "sessão inválida" }, { status: 401 });
        }
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userRes.user.id)
          .maybeSingle();
        if (!profile?.company_id) {
          return Response.json({ ok: false, error: "sem empresa" }, { status: 403 });
        }

        let body: { conversation_id?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "json inválido" }, { status: 400 });
        }
        const conversationId = String(body.conversation_id ?? "").trim();
        if (!conversationId) {
          return Response.json({ ok: false, error: "conversation_id obrigatório" }, { status: 400 });
        }

        // Garante que a conversa pertence à empresa do usuário
        const { data: conv } = await supabaseAdmin
          .from("conversations")
          .select("company_id")
          .eq("id", conversationId)
          .maybeSingle();
        if (!conv || conv.company_id !== profile.company_id) {
          return Response.json({ ok: false, error: "conversa não pertence à empresa" }, { status: 403 });
        }

        const result = await runAgentTick(conversationId);
        return Response.json({ ok: true, result });
      },
    },
  },
});
