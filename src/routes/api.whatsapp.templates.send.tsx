// Envia um template aprovado da Meta para reabrir conversa fora da janela de 24h.
// Reutiliza a mesma tabela `whatsapp_templates` (sincronizada via /api/whatsapp/templates/sync).
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { renderTemplateBody, type TemplateRow } from "@/lib/wa-templates.server";
import { postGraph } from "@/lib/outbound/MetaOutbound.server";
import { isSimulation, isRealDelivery } from "@/lib/outbound/MetaOutboundContract";


async function resolveCompany(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { error: "não autenticado", status: 401 as const };
  const { data: userRes, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userRes.user) return { error: "sessão inválida", status: 401 as const };
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", userRes.user.id)
    .maybeSingle();
  if (!profile?.company_id) return { error: "perfil sem empresa", status: 403 as const };
  return { companyId: profile.company_id };
}

export const Route = createFileRoute("/api/whatsapp/templates/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ctx = await resolveCompany(request);
        if ("error" in ctx) return Response.json({ error: ctx.error }, { status: ctx.status });

        let body: { conversationId?: string; templateId?: string; variables?: Record<string, string> };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "json inválido" }, { status: 400 });
        }
        const { conversationId, templateId } = body;
        const variables = body.variables ?? {};
        if (!conversationId || !templateId) {
          return Response.json({ error: "conversationId e templateId são obrigatórios" }, { status: 400 });
        }

        // Conversa
        const { data: conv } = await supabaseAdmin
          .from("conversations")
          .select("id, company_id, lead_id")
          .eq("id", conversationId)
          .maybeSingle();
        if (!conv || conv.company_id !== ctx.companyId) {
          return Response.json({ error: "conversa não encontrada" }, { status: 404 });
        }

        // Template
        const { data: tplData } = await supabaseAdmin
          .from("whatsapp_templates")
          .select("*")
          .eq("id", templateId)
          .eq("company_id", ctx.companyId)
          .maybeSingle();
        const template = tplData as unknown as TemplateRow | null;
        if (!template) return Response.json({ error: "template não encontrado" }, { status: 404 });
        if (template.status !== "approved") {
          return Response.json({ error: "template não está aprovado" }, { status: 400 });
        }

        // Lead + telefone
        const { data: lead } = await supabaseAdmin
          .from("leads")
          .select("phone, external_id, integration_id")
          .eq("id", conv.lead_id)
          .maybeSingle();
        if (!lead) return Response.json({ error: "lead não encontrado" }, { status: 404 });
        const recipient = String(lead.external_id ?? lead.phone ?? "").replace(/\D/g, "");
        if (recipient.length < 8 || recipient.length > 15) {
          return Response.json({ error: "telefone inválido" }, { status: 400 });
        }

        // Integração
        const intQuery = supabaseAdmin
          .from("integrations")
          .select("id, access_token, external_account_id")
          .eq("company_id", ctx.companyId)
          .eq("channel", "whatsapp")
          .eq("active", true);
        const { data: integration } = lead.integration_id
          ? await intQuery.eq("id", lead.integration_id).maybeSingle()
          : await intQuery.limit(1).maybeSingle();
        if (!integration?.access_token || !integration.external_account_id) {
          return Response.json({ error: "WhatsApp Cloud não conectado" }, { status: 400 });
        }

        const rendered = renderTemplateBody(template, variables);
        const payload = {
          messaging_product: "whatsapp",
          to: recipient,
          type: "template",
          template: {
            name: template.name,
            language: { code: template.language },
            components:
              rendered.parameters.length > 0
                ? [
                    {
                      type: "body",
                      parameters: rendered.parameters.map((text) => ({ type: "text", text })),
                    },
                  ]
                : [],
          },
        };

        const apiUrl = `https://graph.facebook.com/v20.0/${integration.external_account_id}/messages`;
        const outbound = await postGraph<{
          messages?: Array<{ id: string }>;
          error?: { message?: string; code?: number; type?: string };
        }>({
          companyId: ctx.companyId,
          action: "whatsapp.send.template",
          url: apiUrl,
          method: "POST",
          headers: {
            Authorization: `Bearer ${integration.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          logicalPayload: payload,
          extractExternalId: (j) =>
            (j as { messages?: Array<{ id: string }> })?.messages?.[0]?.id ?? null,
        });

        if (isSimulation(outbound)) {
          // staging: nenhuma persistência, nenhum consumo real de template.
          return Response.json({
            ok: true,
            simulated: true,
            externalRequestSent: false,
            simulationId: outbound.simulationId,
            environment: outbound.environment,
          });
        }

        if (!isRealDelivery(outbound)) {
          if (!outbound.externalRequestSent) {
            return Response.json({ error: `network: ${outbound.error}` }, { status: 502 });
          }
          const providerErr = outbound.providerError as
            | { message?: string; code?: number; type?: string }
            | null
            | undefined;
          const msg = providerErr?.message ?? outbound.error;
          return Response.json({ error: msg }, { status: outbound.status ?? 502 });
        }

        const externalId = outbound.externalId;

        const sentAt = new Date().toISOString();
        await supabaseAdmin.from("messages").insert({
          company_id: ctx.companyId,
          conversation_id: conversationId,
          role: "agent",
          text: rendered.body,
          at: sentAt,
          external_id: externalId,
          integration_id: integration.id,
          source: "wa_template_manual",
          source_subtype: "template",
          source_metadata: {
            template_name: template.name,
            template_id: template.id,
            meta_template_id: template.meta_template_id,
            language: template.language,
            category: template.category,
            wamid: externalId,
            variables: rendered.parameters,
            sent_by: "manual_inbox",
          },
        });
        await supabaseAdmin
          .from("conversations")
          .update({ last_message_at: sentAt, awaiting_reply: false })
          .eq("id", conversationId);

        return Response.json({ ok: true, externalId });
      },
    },
  },
});
