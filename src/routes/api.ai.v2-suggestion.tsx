import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isCompanySalesAgentMasterOff } from "@/lib/sales-agent-master.server";
import {
  transitionAssistedSuggestion,
  type AssistedSuggestionAction,
} from "@/lib/sales-agent-assisted";
import { logEvent } from "@/lib/ai-agent.server";

async function authenticateCompany(
  request: Request,
): Promise<{ companyId: string } | { response: Response }> {
  const authHeader = request.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";

  if (!accessToken) {
    return {
      response: Response.json({ error: "não autenticado" }, { status: 401 }),
    };
  }

  const { data: userRes, error: authError } = await supabaseAdmin.auth.getUser(accessToken);

  if (authError || !userRes.user) {
    return {
      response: Response.json({ error: "sessão inválida" }, { status: 401 }),
    };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", userRes.user.id)
    .maybeSingle();

  if (profileError) {
    return {
      response: Response.json({ error: "falha ao consultar empresa" }, { status: 500 }),
    };
  }

  if (!profile?.company_id) {
    return {
      response: Response.json({ error: "sem empresa" }, { status: 403 }),
    };
  }

  return { companyId: profile.company_id };
}

async function assistedModeIsActive(companyId: string): Promise<boolean> {
  // Vendedora IA desligada no botão mestre: sugestão pendente dela não aparece nem é aprovada.
  if (await isCompanySalesAgentMasterOff(companyId)) return false;
  const { data: settings } = await supabaseAdmin
    .from("company_settings")
    .select("sales_agent_v2_enabled, sales_agent_v2_mode")
    .eq("company_id", companyId)
    .maybeSingle();

  return settings?.sales_agent_v2_enabled === true && settings.sales_agent_v2_mode === "assisted";
}

/**
 * O que embasou a sugestão, para o atendente: nomes dos produtos sugeridos e dos cadastros
 * da empresa citados. Vem do evento do turno que gerou a sugestão, sempre da mesma empresa.
 * Qualquer falha aqui devolve vazio — a sugestão continua aparecendo.
 */
async function loadSuggestionBasis(
  companyId: string,
  conversationId: string,
  since: string,
): Promise<{ products: string[]; company: string[] }> {
  const empty = { products: [], company: [] };
  try {
    const { data: event } = await supabaseAdmin
      .from("ai_flow_events")
      .select("payload")
      .eq("company_id", companyId)
      .eq("conversation_id", conversationId)
      .eq("event_type", "auto_reply_v2_gated")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const payload = (event as { payload?: unknown } | null)?.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return empty;
    const source = payload as Record<string, unknown>;
    const strings = (value: unknown) =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
    const company = strings(source.evidence_labels).slice(0, 6);
    const productIds = strings(source.suggested_products).slice(0, 5);
    if (productIds.length === 0) return { products: [], company };
    const { data: rows } = await supabaseAdmin
      .from("products")
      .select("id, name")
      .eq("company_id", companyId)
      .in("id", productIds);
    const names = new Map(
      (Array.isArray(rows) ? rows : []).map((row) => [String((row as { id: unknown }).id), String((row as { name: unknown }).name ?? "")]),
    );
    return { products: productIds.map((id) => names.get(id) ?? "").filter(Boolean), company };
  } catch {
    return empty;
  }
}

export const Route = createFileRoute("/api/ai/v2-suggestion")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const authentication = await authenticateCompany(request);
        if ("response" in authentication) return authentication.response;

        const conversationId =
          new URL(request.url).searchParams.get("conversationId")?.trim() ?? "";

        if (!conversationId) {
          return Response.json({ error: "conversationId é obrigatório" }, { status: 400 });
        }

        if (!(await assistedModeIsActive(authentication.companyId))) {
          return Response.json({ suggestion: null });
        }

        const { data: suggestion, error } = await supabaseAdmin
          .from("ai_suggestions_log")
          .select("id, conversation_id, generated_text, created_at")
          .eq("company_id", authentication.companyId)
          .eq("conversation_id", conversationId)
          .eq("classification", "v2_status:pending")
          .eq("was_sent", false)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          return Response.json({ error: "falha ao consultar sugestão assistida" }, { status: 500 });
        }

        if (
          !suggestion ||
          typeof suggestion.generated_text !== "string" ||
          !suggestion.generated_text.trim()
        ) {
          return Response.json({ suggestion: null });
        }

        return Response.json({
          suggestion: {
            id: suggestion.id,
            conversation_id: suggestion.conversation_id,
            generated_text: suggestion.generated_text,
            created_at: suggestion.created_at,
            basis: await loadSuggestionBasis(authentication.companyId, conversationId, suggestion.created_at),
          },
        });
      },

      POST: async ({ request }: { request: Request }) => {
        const authentication = await authenticateCompany(request);
        if ("response" in authentication) return authentication.response;

        let body: {
          suggestionId?: string;
          action?: AssistedSuggestionAction;
        };

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

        if (!(await assistedModeIsActive(authentication.companyId))) {
          return Response.json({ error: "modo assisted V2 não está ativo" }, { status: 409 });
        }

        const { data: row, error: rowError } = await supabaseAdmin
          .from("ai_suggestions_log")
          .select("id, company_id, conversation_id, classification, was_sent")
          .eq("id", body.suggestionId)
          .eq("company_id", authentication.companyId)
          .maybeSingle();

        if (rowError) {
          return Response.json({ error: "falha ao consultar sugestão" }, { status: 500 });
        }

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
          authentication.companyId,
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

        const { data: updated, error: updateError } = await supabaseAdmin
          .from("ai_suggestions_log")
          .update(transition.update)
          .eq("id", body.suggestionId)
          .eq("company_id", authentication.companyId)
          .eq("was_sent", false)
          .eq("classification", "v2_status:pending")
          .select("id")
          .maybeSingle();

        if (updateError) {
          return Response.json({ error: "falha ao atualizar sugestão" }, { status: 500 });
        }
        if (!updated) {
          return Response.json({ error: "suggestion_not_pending" }, { status: 409 });
        }

        await logEvent(
          authentication.companyId,
          row?.conversation_id ?? null,
          null,
          "ai_flow_step",
          {
            audit_kind: "sales_agent_v2",
            audit_action: "assisted_suggestion_transition",
            status: transition.status,
            send_allowed: false,
          },
        );

        return Response.json({
          ok: true,
          status: transition.status,
          sendAllowed: false,
        });
      },
    },
  },
});
