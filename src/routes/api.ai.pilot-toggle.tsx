// ============================================================================
// Liga/desliga modo piloto da IA. Bloqueia ativação se readiness incompleta.
// Sempre preserva ai_after_hours_only = true por segurança no piloto.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getReadiness } from "@/lib/ai-readiness.server";
import { logEvent } from "@/lib/ai-agent.server";

export const Route = createFileRoute("/api/ai/pilot-toggle")({
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

        let body: { enable?: boolean };
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "json inválido" }, { status: 400 });
        }
        const enable = !!body.enable;
        const companyId = prof.company_id;

        if (enable) {
          const readiness = await getReadiness(companyId);
          if (!readiness.canActivate) {
            return Response.json(
              { ok: false, error: "Pré-requisitos faltando", missing: readiness.missing },
              { status: 400 },
            );
          }
        }

        const { error } = await supabaseAdmin
          .from("company_settings")
          .update({
            ai_pilot_mode: enable,
            ai_auto_reply_enabled: enable,
            ai_after_hours_only: true,
            ai_pilot_enabled_at: enable ? new Date().toISOString() : null,
          })
          .eq("company_id", companyId);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        await logEvent(companyId, null, null, enable ? "pilot_enabled" : "pilot_disabled", {
          by: userRes.user.id,
        });
        return Response.json({ ok: true, enabled: enable });
      },
    },
  },
});
