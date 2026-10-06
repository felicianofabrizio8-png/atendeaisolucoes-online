// ============================================================================
// Botão mestre da Vendedora IA da empresa (company_settings.sales_agent_master_enabled).
// POST { enabled } — só admin, sempre na empresa do usuário autenticado e só para empresa
// que usa a Vendedora. A troca passa por aqui para que as sugestões pendentes dela saiam
// do cartão do atendente e não reapareçam quando a empresa religar.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { setCompanySalesAgentMaster } from "@/lib/sales-agent-master.server";

export const Route = createFileRoute("/api/ai/sales-agent-master")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
        if (!token) return Response.json({ ok: false, error: "não autenticado" }, { status: 401 });
        const { data: userRes, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !userRes?.user) {
          return Response.json({ ok: false, error: "sessão inválida" }, { status: 401 });
        }

        // company_id vem sempre do perfil autenticado, nunca do payload.
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userRes.user.id)
          .maybeSingle();
        if (!profile?.company_id)
          return Response.json({ ok: false, error: "sem empresa" }, { status: 403 });
        const companyId = profile.company_id;

        const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
          _user_id: userRes.user.id,
          _company_id: companyId,
          _role: "admin",
        });
        if (isAdmin !== true) {
          return Response.json(
            { ok: false, error: "Apenas administradores alteram esta configuração." },
            { status: 403 },
          );
        }

        let body: { enabled?: unknown };
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "json inválido" }, { status: 400 });
        }
        if (typeof body.enabled !== "boolean") {
          return Response.json({ ok: false, error: "enabled obrigatório" }, { status: 400 });
        }

        const result = await setCompanySalesAgentMaster({ companyId, enabled: body.enabled });
        if (result.ok) return Response.json({ ok: true, enabled: result.enabled });
        if (result.code === "not_eligible") {
          return Response.json(
            { ok: false, error: "Esta empresa não usa a Vendedora IA." },
            { status: 409 },
          );
        }
        return Response.json(
          { ok: false, error: "Não foi possível salvar.", code: result.code },
          { status: 500 },
        );
      },
    },
  },
});
