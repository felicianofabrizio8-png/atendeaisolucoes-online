import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { detectReadyToClose } from "@/lib/ai-qualifier.server";
import {
  detectHandoffNeeded,
  loadAgentContext,
  runAgentTurn,
  runSafetyLayer,
} from "@/lib/ai-agent.server";

export const Route = createFileRoute("/api/ai/suggest-reply")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length)
          : "";

        if (!token) {
          return Response.json({ ok: false, error: "não autenticado" }, { status: 401 });
        }

        const { data: userRes, error: authError } =
          await supabaseAdmin.auth.getUser(token);

        if (authError || !userRes.user) {
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
          return Response.json(
            { ok: false, error: "conversation_id obrigatório" },
            { status: 400 },
          );
        }

        const { data: conv } = await supabaseAdmin
          .from("conversations")
          .select(
            "id, company_id, lead_id, channel, detected_pool_size, detected_intent, detected_interest, detected_budget",
          )
          .eq("id", conversationId)
          .maybeSingle();

        if (!conv || conv.company_id !== profile.company_id) {
          return Response.json(
            { ok: false, error: "conversa não pertence à empresa" },
            { status: 403 },
          );
        }

        if (conv.channel !== "whatsapp") {
          return Response.json(
            { ok: false, error: "canal não suportado para sugestão nesta etapa" },
            { status: 400 },
          );
        }

        const { data: msgs } = await supabaseAdmin
          .from("messages")
          .select("role, text, at, source_metadata")
          .eq("conversation_id", conv.id)
          .order("at", { ascending: false })
          .limit(40);

        const history = [...(msgs ?? [])].reverse().map((message) => {
          const metadata =
            message.source_metadata &&
            typeof message.source_metadata === "object" &&
            !Array.isArray(message.source_metadata)
              ? (message.source_metadata as Record<string, unknown>)
              : {};

          const productIds = Array.isArray(metadata.catalog_product_ids)
            ? metadata.catalog_product_ids.filter(
                (id): id is string => typeof id === "string",
              )
            : typeof metadata.product_id === "string"
              ? [metadata.product_id]
              : [];

          return {
            role: message.role as "lead" | "agent" | "system",
            text: message.text,
            ...(productIds.length > 0 ? { productIds } : {}),
          };
        });

        const lastLeadMessage = [...history]
          .reverse()
          .find((message) => message.role === "lead");

        if (!lastLeadMessage) {
          return Response.json({
            ok: true,
            kind: "skip",
            reason: "no_lead_message",
          });
        }

        const triggerCheck = detectHandoffNeeded(lastLeadMessage.text);
        const readyToClose = detectReadyToClose(lastLeadMessage.text);

        if (triggerCheck.needed || readyToClose) {
          return Response.json({
            ok: true,
            kind: "handoff",
            reason:
              triggerCheck.reason ??
              (readyToClose ? "ready_to_close" : "handoff_required"),
          });
        }

        const { data: lead } = await supabaseAdmin
          .from("leads")
          .select("name")
          .eq("id", conv.lead_id)
          .maybeSingle();

        const context = await loadAgentContext(conv.company_id, history);

        if (!context) {
          return Response.json(
            { ok: false, error: "configuração da IA indisponível" },
            { status: 503 },
          );
        }

        const decision = runSafetyLayer(
          await runAgentTurn({
            ctx: context,
            history,
            leadName: lead?.name ?? null,
            salesStateScope: {
              scopeType: "whatsapp_conversation",
              scopeId: conv.id,
            },
            qualification: {
              detected_pool_size: conv.detected_pool_size ?? null,
              detected_interest: conv.detected_interest ?? null,
              detected_intent: conv.detected_intent ?? null,
              detected_budget: conv.detected_budget ?? null,
            },
          }),
          context.grounding.commercialRules.commercialTerms,
        );

        if (decision.kind === "reply" && decision.message?.trim()) {
          return Response.json({
            ok: true,
            kind: "reply",
            message: decision.message.trim(),
          });
        }

        return Response.json({
          ok: true,
          kind: decision.kind,
          reason: decision.reason ?? "no_message",
        });
      },
    },
  },
});
