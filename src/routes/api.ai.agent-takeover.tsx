// ============================================================================
// Controle humano × IA da conversa.
//  - padrão / action "takeover": humano assume (badge some e IA é bloqueada).
//  - action "release" (ou "resume"): devolve a conversa para a IA.
//  - action "auto_reply_status" / "auto_reply_on" / "auto_reply_off" (ou "disable"):
//    a Vendedora 2.0 responde sozinha só nesta conversa (empresa em modo assistido).
// Sempre restrito à empresa do usuário autenticado e a quem tem papel de atendimento.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isCompanySalesAgentMasterOff } from "@/lib/sales-agent-master.server";
import {
  releaseConversationToAi,
  type ConversationControlClient,
} from "@/lib/sales-agent-control";
import { resolveSalesAgentMode } from "@/lib/sales-agent-mode";
import { normalizeAiReplyScope } from "@/lib/ai-reply-control";

const CONVERSATION_STATE = "id, ai_status, ai_handling, sales_agent_auto_reply, human_takeover_at";

type ControlAction = "takeover" | "release" | "auto_reply_status" | "auto_reply_on" | "auto_reply_off";

/** Aceita o vocabulário da tela da main e o da Bruna. */
function parseControlAction(value: unknown): ControlAction | null {
  if (value === undefined || value === "takeover") return "takeover";
  if (value === "release" || value === "resume") return "release";
  if (value === "disable") return "auto_reply_off";
  if (value === "auto_reply_status" || value === "auto_reply_on" || value === "auto_reply_off") return value;
  return null;
}

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

        const [attendantRole, adminRole] = await Promise.all([
          supabaseAdmin.rpc("has_role", { _user_id: userRes.user.id, _company_id: profile.company_id, _role: "atendente" }),
          supabaseAdmin.rpc("has_role", { _user_id: userRes.user.id, _company_id: profile.company_id, _role: "admin" }),
        ]);
        if (attendantRole.error || adminRole.error) return Response.json({ ok: false, error: "permissão indisponível" }, { status: 503 });
        if (!attendantRole.data && !adminRole.data) return Response.json({ ok: false, error: "sem permissão para controlar atendimentos" }, { status: 403 });

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "json inválido" }, { status: 400 });
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return Response.json({ ok: false, error: "json inválido" }, { status: 400 });
        }
        const rawBody = body as { conversation_id?: unknown; action?: unknown };
        const id = typeof rawBody.conversation_id === "string" ? rawBody.conversation_id.trim() : "";
        if (!id) return Response.json({ ok: false, error: "conversation_id obrigatório" }, { status: 400 });
        const action = parseControlAction(rawBody.action);
        if (!action) return Response.json({ ok: false, error: "action inválida" }, { status: 400 });

        const loadState = () =>
          supabaseAdmin
            .from("conversations")
            .select(CONVERSATION_STATE)
            .eq("id", id)
            .eq("company_id", profile.company_id)
            .maybeSingle();

        // Devolver a conversa para a IA (mesma empresa do usuário autenticado).
        if (action === "release") {
          const { data: owned, error: ownedError } = await loadState();
          if (ownedError) return Response.json({ ok: false, error: "estado da conversa indisponível" }, { status: 503 });
          if (!owned) return Response.json({ ok: false, error: "conversa não pertence à empresa" }, { status: 403 });
          const { data: settings, error: settingsError } = await supabaseAdmin
            .from("company_settings")
            .select("ai_auto_reply_scope, ai_auto_reply_enabled")
            .eq("company_id", profile.company_id)
            .maybeSingle();
          if (settingsError || !settings) {
            return Response.json({ ok: false, error: "configuração indisponível" }, { status: 503 });
          }
          if (normalizeAiReplyScope(settings.ai_auto_reply_scope, settings.ai_auto_reply_enabled) === "desligado") {
            return Response.json({ ok: false, error: "atendimento global desligado" }, { status: 409 });
          }
          const released = await releaseConversationToAi(
            supabaseAdmin as unknown as ConversationControlClient,
            { companyId: profile.company_id, conversationId: id, userId: userRes.user.id },
          );
          if (!released.ok) {
            const status = released.code === "not_found" ? 404 : released.code === "invalid_input" ? 400 : 500;
            return Response.json({ ok: false, error: released.code }, { status });
          }
          const { data: conversation } = await loadState();
          return Response.json({ ok: true, released: true, action: "resume", conversation });
        }

        if (action === "auto_reply_status" || action === "auto_reply_on" || action === "auto_reply_off") {
          // Só existe onde a política exige opt-in da conversa: Vendedora V2 em modo
          // assistido ou, sem V2, escopo "teste". Nos demais modos o botão não aparece.
          const { data: settings } = await supabaseAdmin
            .from("company_settings")
            .select("sales_agent_v2_enabled, sales_agent_v2_mode, ai_auto_reply_scope, ai_auto_reply_enabled")
            .eq("company_id", profile.company_id)
            .maybeSingle();
          const mode = settings ? resolveSalesAgentMode(settings) : null;
          const optInApplies = settings != null && (
            mode === "assisted" ||
            (mode === null && normalizeAiReplyScope(settings.ai_auto_reply_scope, settings.ai_auto_reply_enabled) === "teste")
          );
          // Vendedora IA desligada no botão mestre: o controle some da conversa, mas o valor
          // gravado nela é preservado e volta a valer quando a empresa religar.
          if (!optInApplies || (await isCompanySalesAgentMasterOff(profile.company_id))) {
            return Response.json({ ok: true, available: false, enabled: false });
          }
          if (action === "auto_reply_status") {
            const { data, error } = await loadState();
            // Coluna ainda não criada (migration pendente) ou conversa de outra empresa.
            if (error || !data) return Response.json({ ok: true, available: false, enabled: false });
            const enabled = (data as { sales_agent_auto_reply?: boolean | null }).sales_agent_auto_reply === true;
            return Response.json({ ok: true, available: true, enabled });
          }
          const enabled = action === "auto_reply_on";
          const { data, error } = await supabaseAdmin
            .from("conversations")
            .update({ sales_agent_auto_reply: enabled } as never)
            .eq("id", id)
            .eq("company_id", profile.company_id)
            .select(CONVERSATION_STATE)
            .maybeSingle();
          if (error) return Response.json({ ok: false, error: "não foi possível salvar" }, { status: 500 });
          if (!data) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
          return Response.json({ ok: true, available: true, enabled, conversation: data });
        }

        const { data: current, error: currentError } = await loadState();
        if (currentError) return Response.json({ ok: false, error: "estado da conversa indisponível" }, { status: 503 });
        if (!current) return Response.json({ ok: false, error: "conversa não pertence à empresa" }, { status: 403 });
        if (current.ai_status === "assumido_humano" || current.human_takeover_at) {
          return Response.json({ ok: true, action, conversation: current });
        }
        // Takeover é uma parada de mão única para o turno automático em curso. Não
        // zera ai_handling: o worker em andamento é dono desse lock e o libera no
        // finally. A marca de takeover é a barreira que todo efeito posterior revalida.
        const { data: updated, error } = await supabaseAdmin
          .from("conversations")
          .update({ ai_status: "assumido_humano", human_takeover_at: new Date().toISOString() })
          .eq("id", id)
          .eq("company_id", profile.company_id)
          .select(CONVERSATION_STATE)
          .maybeSingle();

        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        if (!updated) return Response.json({ ok: false, error: "estado da conversa mudou; atualize e tente novamente" }, { status: 409 });
        return Response.json({ ok: true, action, conversation: updated });
      },
    },
  },
});
