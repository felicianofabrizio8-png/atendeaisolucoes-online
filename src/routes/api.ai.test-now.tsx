// ============================================================================
// "Testar IA agora" — simula um turno completo SEM enviar mensagem real.
// Roda: pré-checks → loadContext → safety/handoff regex → LLM turn (opcional).
// Resultado fica em company_settings.ai_last_test_result.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  loadAgentContext,
  detectHandoffNeeded,
  runSafetyLayer,
  runAgentTurn,
  isWithinBusinessHours,
  logEvent,
} from "@/lib/ai-agent.server";
import { getReadiness } from "@/lib/ai-readiness.server";

export const Route = createFileRoute("/api/ai/test-now")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const h = request.headers.get("authorization") ?? "";
        const token = h.startsWith("Bearer ") ? h.slice(7) : "";
        if (!token) return Response.json({ ok: false, error: "não autenticado" }, { status: 401 });
        const { data: userRes } = await supabaseAdmin.auth.getUser(token);
        if (!userRes?.user) return Response.json({ ok: false, error: "sessão inválida" }, { status: 401 });
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userRes.user.id)
          .maybeSingle();
        if (!prof?.company_id) return Response.json({ ok: false, error: "sem empresa" }, { status: 403 });
        const companyId = prof.company_id;

        let body: { message?: string } = {};
        try {
          body = await request.json();
        } catch {
          /* */
        }
        const sample =
          body.message?.trim() ||
          "Boa noite! Quanto custa uma piscina de fibra 6x3 para Campinas?";

        type Step = { name: string; ok: boolean; detail?: string };
        const steps: Step[] = [];

        const readiness = await getReadiness(companyId);
        steps.push({
          name: "Pré-requisitos",
          ok: readiness.canActivate,
          detail: readiness.canActivate ? "Todos OK" : `Faltando: ${readiness.missing.join("; ")}`,
        });

        const ctx = await loadAgentContext(companyId);
        steps.push({
          name: "Carregar contexto",
          ok: !!ctx,
          detail: ctx ? `Tom: ${ctx.aiProfile?.tone ?? "—"}, produtos: ${ctx.products.length}` : "ctx vazio",
        });

        if (!ctx) {
          const result = { ok: false, steps, sample };
          await supabaseAdmin
            .from("company_settings")
            .update({ ai_last_test_at: new Date().toISOString(), ai_last_test_result: result as never })
            .eq("company_id", companyId);
          return Response.json(result);
        }

        const inHours = isWithinBusinessHours(ctx.settings);
        steps.push({
          name: "Janela",
          ok: true,
          detail: inHours
            ? "Dentro do horário comercial (em produção IA NÃO responderia)"
            : "Fora do horário (IA responderia)",
        });

        const handoff = detectHandoffNeeded(sample);
        steps.push({
          name: "Pre-check handoff",
          ok: true,
          detail: handoff.needed ? `Handoff por padrão: ${handoff.reason}` : "Sem gatilho de handoff",
        });

        if (handoff.needed) {
          const result = {
            ok: true,
            steps,
            sample,
            outcome: { action: "handoff", reason: handoff.reason },
          };
          await supabaseAdmin
            .from("company_settings")
            .update({ ai_last_test_at: new Date().toISOString(), ai_last_test_result: result as never })
            .eq("company_id", companyId);
          await logEvent(companyId, null, null, "test_run", { outcome: "handoff_precheck" });
          return Response.json(result);
        }

        let decision;
        try {
          decision = runSafetyLayer(
            await runAgentTurn({
              ctx,
              history: [{ role: "lead", text: sample }],
              leadName: "Cliente Teste",
            }),
          );
          steps.push({
            name: "LLM + safety",
            ok: true,
            detail:
              decision.kind === "reply"
                ? `Resposta gerada (${(decision.message ?? "").slice(0, 60)}…)`
                : `Handoff: ${decision.reason}`,
          });
        } catch (e) {
          steps.push({
            name: "LLM + safety",
            ok: false,
            detail: e instanceof Error ? e.message : "erro desconhecido",
          });
          const result = { ok: false, steps, sample };
          await supabaseAdmin
            .from("company_settings")
            .update({ ai_last_test_at: new Date().toISOString(), ai_last_test_result: result as never })
            .eq("company_id", companyId);
          return Response.json(result);
        }

        const outcome =
          decision.kind === "reply"
            ? {
                action: "reply",
                message: decision.message,
                qualification: {
                  city: decision.detected_city,
                  state: decision.detected_state,
                  pool: decision.detected_pool_size,
                  interest: decision.detected_interest,
                  budget: decision.detected_budget,
                  timing: decision.purchase_timing,
                  stage: decision.customer_stage,
                },
              }
            : { action: "handoff", reason: decision.reason };

        const result = { ok: true, steps, sample, outcome };
        await supabaseAdmin
          .from("company_settings")
          .update({ ai_last_test_at: new Date().toISOString(), ai_last_test_result: result as never })
          .eq("company_id", companyId);
        await logEvent(companyId, null, null, "test_run", { outcome: outcome.action });
        return Response.json(result);
      },
    },
  },
});
