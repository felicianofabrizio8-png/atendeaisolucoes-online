// Atualiza propósito / auto_use de um template.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Propósito → categoria esperada (marketing ou utility).
// Marketing: follow-ups e reativação. Utility: eventos operacionais.
const PURPOSE_CATEGORY: Record<string, "marketing" | "utility"> = {
  // Legacy + canônicos de marketing
  quote_no_reply: "marketing",
  lead_silent: "marketing",
  hot_lead_idle: "marketing",
  returning_customer: "marketing",
  conversation_resume: "marketing",
  quote_followup: "marketing",
  reactivation: "marketing",
  // Operacionais (utility)
  visit_no_return: "utility",
  appointment_confirmation: "utility",
  visit_confirmed: "utility",
  visit_rescheduled: "utility",
  installation_confirmed: "utility",
};
const PURPOSES = new Set(Object.keys(PURPOSE_CATEGORY));

interface UpdateBody {
  id?: string;
  purpose?: string | null;
  auto_use?: boolean;
}

export const Route = createFileRoute("/api/whatsapp/templates/update")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) return Response.json({ error: "não autenticado" }, { status: 401 });
        const { data: userRes, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !userRes.user)
          return Response.json({ error: "sessão inválida" }, { status: 401 });
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userRes.user.id)
          .maybeSingle();
        if (!profile?.company_id)
          return Response.json({ error: "perfil sem empresa" }, { status: 403 });

        let body: UpdateBody;
        try {
          body = (await request.json()) as UpdateBody;
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }
        if (!body.id) return Response.json({ error: "id obrigatório" }, { status: 400 });
        if (body.purpose != null && !PURPOSES.has(body.purpose))
          return Response.json({ error: "purpose inválido" }, { status: 400 });

        // Confirma que pertence à empresa
        const { data: tpl } = await supabaseAdmin
          .from("whatsapp_templates")
          .select("id, company_id, category, status")
          .eq("id", body.id)
          .maybeSingle();
        if (!tpl || tpl.company_id !== profile.company_id)
          return Response.json({ error: "template não encontrado" }, { status: 404 });

        // Segurança:
        //  - auto_use exige status='approved' E categoria utility OU marketing.
        //  - Se propósito definido, sua categoria esperada precisa bater com a do template.
        let nextAutoUse = body.auto_use;
        if (nextAutoUse === true) {
          if (tpl.status !== "approved") {
            return Response.json(
              { error: "auto_use só é permitido em templates aprovados" },
              { status: 400 },
            );
          }
          if (tpl.category !== "utility" && tpl.category !== "marketing") {
            return Response.json(
              { error: "auto_use só é permitido em templates Utility ou Marketing" },
              { status: 400 },
            );
          }
        }
        if (body.purpose && PURPOSE_CATEGORY[body.purpose]) {
          const expected = PURPOSE_CATEGORY[body.purpose];
          if (tpl.category !== expected) {
            return Response.json(
              {
                error: `O propósito "${body.purpose}" exige categoria ${expected}, mas o template é ${tpl.category}.`,
              },
              { status: 400 },
            );
          }
        }

        const patch: { purpose?: string | null; auto_use?: boolean } = {};
        if (body.purpose !== undefined) patch.purpose = body.purpose;
        if (nextAutoUse !== undefined) patch.auto_use = nextAutoUse;
        if (Object.keys(patch).length === 0)
          return Response.json({ error: "nada para atualizar" }, { status: 400 });

        const { data: updated, error: updErr } = await supabaseAdmin
          .from("whatsapp_templates")
          .update(patch)

          .eq("id", body.id)
          .eq("company_id", profile.company_id)
          .select("id, purpose, auto_use")
          .single();
        if (updErr) return Response.json({ error: updErr.message }, { status: 500 });

        return Response.json({ ok: true, template: updated });
      },
    },
  },
});
