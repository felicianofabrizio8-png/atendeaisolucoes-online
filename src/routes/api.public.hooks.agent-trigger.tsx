// ============================================================================
// Public hook chamado pelo trigger postgres em `messages` (role='lead').
// Encapsulado para nao tocar em meta-webhook nem meta-send.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { runAgentTick } from "@/lib/ai-agent.server";

export const Route = createFileRoute("/api/public/hooks/agent-trigger")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
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

        // Fire-and-forget seguro: aguardamos o resultado mas erros não vazam pro caller
        try {
          const result = await runAgentTick(conversationId);
          return Response.json({ ok: true, result });
        } catch (e) {
          console.error("[AGENT_TRIGGER_FAIL]", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : "erro" },
            { status: 500 },
          );
        }
      },
    },
  },
});
