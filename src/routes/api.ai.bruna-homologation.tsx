import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveShadowControlConfig, runSalesAgentShadowWithControls } from "@/lib/sales-agent-shadow-controls.server";
import { isSalesAgentShadowEnabledForCompany, runSalesAgentShadow } from "@/lib/sales-agent-shadow.server";
import { buildBrunaHomologationRequest, BRUNA_HOMOLOGATION_CURRENT_DECISION } from "@/lib/bruna-homologation.server";

type HistoryItem = { role: "lead" | "agent"; text: string };

async function adminCompany(request: Request): Promise<{ userId: string; companyId: string } | null> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const { data: userRes } = await supabaseAdmin.auth.getUser(token);
  const user = userRes?.user;
  if (!user) return null;
  const { data: profile } = await supabaseAdmin.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
  const companyId = profile?.company_id ?? null;
  if (!companyId) return null;
  const { data: isAdmin, error } = await supabaseAdmin.rpc("has_role", { _user_id: user.id, _company_id: companyId, _role: "admin" });
  if (error || isAdmin !== true) return null;
  return { userId: user.id, companyId };
}

export const Route = createFileRoute("/api/ai/bruna-homologation")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const actor = await adminCompany(request);
        if (!actor) return Response.json({ ok: false, error: "admin_required" }, { status: 403 });
        if (process.env.BRUNA_OPENAI_HOMOLOGATION_UI !== "enabled") {
          return Response.json({ ok: false, error: "homologation_disabled" }, { status: 404 });
        }
        const pilotCompanyId = process.env.BRUNA_HOMOLOGATION_COMPANY_ID?.trim() || process.env.SALES_AGENT_OPENAI_SHADOW_COMPANY_ID?.trim();
        if (!pilotCompanyId || pilotCompanyId !== actor.companyId || !isSalesAgentShadowEnabledForCompany(actor.companyId)) {
          return Response.json({ ok: false, error: "company_not_allowlisted" }, { status: 403 });
        }
        const controls = resolveShadowControlConfig();
        if (!controls.enabled || controls.budgetMicroUsd > 1_000_000 || controls.hourlyCallLimit > 20 || controls.dailyCallLimit > 50) {
          return Response.json({ ok: false, error: "shadow_controls_incomplete" }, { status: 503 });
        }
        let body: { message?: string; history?: HistoryItem[] };
        try { body = await request.json(); } catch { return Response.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
        const message = typeof body.message === "string" ? body.message.trim().slice(0, 1200) : "";
        if (!message) return Response.json({ ok: false, error: "message_required" }, { status: 400 });
        const history: HistoryItem[] = Array.isArray(body.history)
          ? body.history.filter((item): item is HistoryItem => Boolean(item && (item.role === "lead" || item.role === "agent") && typeof item.text === "string")).slice(-11)
          : [];
        const requestForModel = buildBrunaHomologationRequest(controls.model, actor.companyId, [...history, { role: "lead", text: message }]);
        const result = await runSalesAgentShadowWithControls({
          companyId: actor.companyId,
          request: requestForModel,
          currentDecision: BRUNA_HOMOLOGATION_CURRENT_DECISION,
          execute: (boundedRequest) => runSalesAgentShadow({ companyId: actor.companyId, request: boundedRequest, modelOverride: controls.model, currentDecision: BRUNA_HOMOLOGATION_CURRENT_DECISION }),
        });
        if (!result.executed || !result.report) return Response.json({ ok: false, error: result.reason ?? "homologation_blocked" }, { status: 409 });
        const { openAiMessage, ...safeReport } = result.report;
        return Response.json({ ok: true, message: openAiMessage ?? null, report: safeReport, externalToolsExecuted: false, metaMessagesSent: false });
      },
    },
  },
});
