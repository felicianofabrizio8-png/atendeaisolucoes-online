import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  transitionAssistedSuggestion,
  type AssistedSuggestionAction,
} from "@/lib/sales-agent-assisted";
import { logEvent } from "@/lib/ai-agent.server";

export const Route = createFileRoute("/api/ai/v2-suggestion")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const accessToken = authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length)
          : "";
        if (!accessToken) return Response.json({ error: "não autenticado" }, { status: 401 });
        const { data: userRes, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
        if (authError || !userRes.user)
          return Response.json({ error: "sessão inválida" }, { status: 401 });

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userRes.user.id)
          .maybeSingle();
        if (!profile?.company_id) return Response.json({ error: "sem empresa" }, { status: 403 });

        let body: { suggestionId?: string; action?: AssistedSuggestionAction };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }
        if (!body.suggestionId || (body.action !== "approve" && body.action !== "reject")) {
          return Response.json(
            { error: "suggestionId e action são obrigatórios" },
            { status: 400 },
          );
        }

        const { data: settings } = await supabaseAdmin
          .from("company_settings")
          .select("sales_agent_v2_enabled, sales_agent_v2_mode")
          .eq("company_id", profile.company_id)
          .maybeSingle();
        if (
          settings?.sales_agent_v2_enabled !== true ||
          settings.sales_agent_v2_mode !== "assisted"
        ) {
          return Response.json({ error: "modo assisted V2 não está ativo" }, { status: 409 });
        }

        const { data: row, error: rowError } = await supabaseAdmin
          .from("ai_suggestions_log")
          .select("id, company_id, conversation_id, classification, was_sent")
          .eq("id", body.suggestionId)
          .eq("company_id", profile.company_id)
          .maybeSingle();
        if (rowError)
          return Response.json({ error: "falha ao consultar sugestão" }, { status: 500 });

        const transition = transitionAssistedSuggestion(
          row
            ? {
                id: row.id,
                company_id: row.company_id,
                conversation_id: row.conversation_id,
                classification: row.classification,
                was_sent: row.was_sent,
              }
            : null,
          profile.company_id,
          body.action,
        );
        if (!transition.ok) {
          const status =
            transition.code === "cross_tenant"
              ? 403
              : transition.code === "suggestion_not_found"
                ? 404
                : 409;
          return Response.json({ error: transition.code }, { status });
        }

        const { error: updateError } = await supabaseAdmin
          .from("ai_suggestions_log")
          .update(transition.update)
          .eq("id", body.suggestionId)
          .eq("company_id", profile.company_id)
          .eq("was_sent", false);
        if (updateError)
          return Response.json({ error: "falha ao atualizar sugestão" }, { status: 500 });

        await logEvent(profile.company_id, row?.conversation_id ?? null, null, "ai_flow_step", {
          audit_kind: "sales_agent_v2",
          audit_action: "assisted_suggestion_transition",
          status: transition.status,
          send_allowed: false,
        });
        return Response.json({ ok: true, status: transition.status, sendAllowed: false });
      },
    },
  },
});
