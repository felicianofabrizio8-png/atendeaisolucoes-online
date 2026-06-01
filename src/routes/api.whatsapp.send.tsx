// Envia uma mensagem real via WhatsApp Cloud API usando o token salvo
// na integração da empresa do usuário autenticado.
// Também persiste a mensagem em `messages` (role=agent) e atualiza a conversa.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

interface SendBody {
  conversationId?: string;
  leadId?: string;
  phone?: string;
  contactName?: string;
  text: string;
}

export const Route = createFileRoute("/api/whatsapp/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Autenticação via Bearer do usuário
        const authHeader = request.headers.get("authorization") ?? "";
        const accessToken = authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length)
          : "";
        if (!accessToken) {
          return Response.json({ error: "não autenticado" }, { status: 401 });
        }

        const { data: userRes, error: userErr } =
          await supabaseAdmin.auth.getUser(accessToken);
        if (userErr || !userRes.user) {
          return Response.json({ error: "sessão inválida" }, { status: 401 });
        }
        const userId = userRes.user.id;

        let body: SendBody;
        try {
          body = (await request.json()) as SendBody;
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }
        if ((!body.conversationId && !body.leadId && !body.phone) || !body.text?.trim()) {
          return Response.json(
            { error: "conversationId, leadId ou phone e text obrigatórios" },
            { status: 400 },
          );
        }

        // Pega company_id do perfil
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userId)
          .maybeSingle();
        if (!profile?.company_id) {
          return Response.json({ error: "perfil sem empresa" }, { status: 403 });
        }
        const companyId = profile.company_id;

        // Resolve conversa: usa a existente, ou cria a partir do leadId
        let conversationId = body.conversationId ?? null;
        let leadId: string | null = null;

        if (conversationId) {
          const { data: conv } = await supabaseAdmin
            .from("conversations")
            .select("id, company_id, lead_id, channel")
            .eq("id", conversationId)
            .maybeSingle();
          if (!conv || conv.company_id !== companyId) {
            return Response.json({ error: "conversa não encontrada" }, { status: 404 });
          }
          if (conv.channel !== "whatsapp") {
            return Response.json({ error: "conversa não é WhatsApp" }, { status: 400 });
          }
          leadId = conv.lead_id;
        } else if (body.leadId) {
          leadId = body.leadId;
        } else if (body.phone) {
          // Encontra ou cria lead pelo telefone (modo manual / Meta Cloud)
          const phoneDigits = String(body.phone).replace(/\D/g, "");
          if (phoneDigits.length < 8 || phoneDigits.length > 15) {
            return Response.json({ error: "telefone inválido" }, { status: 400 });
          }
          const externalId = `phone:${phoneDigits}`;
          const { data: existingLead } = await supabaseAdmin
            .from("leads")
            .select("id")
            .eq("company_id", companyId)
            .eq("channel", "whatsapp")
            .or(`external_id.eq.${externalId},phone.eq.${phoneDigits}`)
            .limit(1)
            .maybeSingle();
          if (existingLead?.id) {
            leadId = existingLead.id;
          } else {
            const { data: newLead, error: newLeadErr } = await supabaseAdmin
              .from("leads")
              .insert({
                company_id: companyId,
                channel: "whatsapp",
                name: body.contactName?.trim() || `+${phoneDigits}`,
                phone: phoneDigits,
                external_id: externalId,
              })
              .select("id")
              .single();
            if (newLeadErr || !newLead) {
              console.error("[whatsapp send] create lead error", newLeadErr);
              return Response.json({ error: "falha ao criar contato" }, { status: 500 });
            }
            leadId = newLead.id;
          }
        }

        // Garante conversa (cria se faltar)
        if (!conversationId && leadId) {
          const { data: existingConv } = await supabaseAdmin
            .from("conversations")
            .select("id")
            .eq("company_id", companyId)
            .eq("lead_id", leadId)
            .eq("channel", "whatsapp")
            .maybeSingle();
          if (existingConv?.id) {
            conversationId = existingConv.id;
          } else {
            const { data: newConv, error: newConvErr } = await supabaseAdmin
              .from("conversations")
              .insert({
                company_id: companyId,
                lead_id: leadId,
                channel: "whatsapp",
              })
              .select("id")
              .single();
            if (newConvErr || !newConv) {
              console.error("[whatsapp send] create conversation error", newConvErr);
              return Response.json({ error: "falha ao criar conversa" }, { status: 500 });
            }
            conversationId = newConv.id;
          }
        }

        // Lead pra pegar telefone destino
        const { data: lead } = await supabaseAdmin
          .from("leads")
          .select("id, phone, external_id, integration_id, company_id")
          .eq("id", leadId!)
          .maybeSingle();
        if (!lead || lead.company_id !== companyId) {
          return Response.json({ error: "lead não encontrado" }, { status: 404 });
        }
        const rawRecipient = lead.external_id ?? lead.phone;
        if (!rawRecipient) {
          return Response.json({ error: "lead sem telefone" }, { status: 400 });
        }
        // Normaliza para E.164 sem símbolos (apenas dígitos)
        const recipient = String(rawRecipient).replace(/\D/g, "");
        if (recipient.length < 8 || recipient.length > 15) {
          return Response.json({ error: "telefone inválido" }, { status: 400 });
        }

        // Integração: usa a vinculada ao lead, senão a primeira ativa da empresa
        let integrationId = lead.integration_id ?? null;
        const integrationQuery = supabaseAdmin
          .from("integrations")
          .select("id, access_token, external_account_id")
          .eq("company_id", companyId)
          .eq("channel", "whatsapp")
          .eq("active", true);
        const { data: integration } = integrationId
          ? await integrationQuery.eq("id", integrationId).maybeSingle()
          : await integrationQuery.limit(1).maybeSingle();

        if (!integration?.access_token || !integration.external_account_id) {
          return Response.json(
            { error: "WhatsApp não conectado para esta empresa" },
            { status: 400 },
          );
        }
        integrationId = integration.id;

        // Envia via Cloud API
        const apiUrl = `https://graph.facebook.com/v20.0/${integration.external_account_id}/messages`;
        const sentAt = new Date().toISOString();
        let externalId: string | null = null;
        console.log("[whatsapp send] request", {
          conversationId: body.conversationId,
          phoneNumberId: integration.external_account_id,
          to: recipient,
          textLen: body.text.length,
        });
        try {
          const apiRes = await fetch(apiUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${integration.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: recipient,
              type: "text",
              text: { body: body.text },
            }),
          });
          const apiText = await apiRes.text();
          let apiJson: {
            messages?: Array<{ id: string }>;
            error?: { message?: string; code?: number; type?: string };
          } = {};
          try {
            apiJson = JSON.parse(apiText);
          } catch {
            /* not json */
          }
          if (!apiRes.ok) {
            const msg = apiJson.error?.message ?? `HTTP ${apiRes.status}`;
            console.error("[whatsapp send] meta error", {
              status: apiRes.status,
              body: apiText.slice(0, 1000),
              to: recipient,
              phoneNumberId: integration.external_account_id,
            });
            await supabaseAdmin
              .from("integrations")
              .update({ last_error: msg })
              .eq("id", integrationId!);
            return Response.json(
              { error: `WhatsApp API: ${msg}`, metaError: apiJson.error ?? null, status: apiRes.status },
              { status: 502 },
            );
          }
          externalId = apiJson.messages?.[0]?.id ?? null;
          console.log("[whatsapp send] ok", { externalId, to: recipient });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "falha de rede";
          console.error("[whatsapp send] network error", msg);
          return Response.json({ error: `Falha ao enviar: ${msg}` }, { status: 502 });
        }

        // Persiste mensagem
        const { data: inserted, error: insertErr } = await supabaseAdmin
          .from("messages")
          .insert({
            company_id: companyId,
            conversation_id: conversationId!,
            role: "agent",
            text: body.text,
            at: sentAt,
            external_id: externalId,
            integration_id: integrationId,
          })
          .select("id, conversation_id, role, text, at")
          .single();
        if (insertErr) {
          console.error("messages insert error", insertErr);
          return Response.json({ error: "Operação falhou. Tente novamente." }, { status: 500 });
        }

        await supabaseAdmin
          .from("conversations")
          .update({
            last_message_at: sentAt,
            awaiting_reply: false,
            unread: 0,
          })
          .eq("id", conversationId!);

        await supabaseAdmin
          .from("integrations")
          .update({ last_synced_at: sentAt, last_error: null })
          .eq("id", integrationId!);

        // Mirror legado em whatsapp_messages removido — Evolution descontinuado.
        // Fluxo oficial usa apenas tabelas messages/conversations.

        return Response.json({
          id: inserted.id,
          conversationId,
          leadId,
          externalId,
          at: sentAt,
        });
      },
    },
  },
});
