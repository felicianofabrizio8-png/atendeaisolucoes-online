// Encaminha uma mídia (imagem ou vídeo) RECEBIDA do cliente para outro lead
// da mesma empresa via WhatsApp Cloud API.
//
// V1 — escopo restrito (decisão de produto):
//  - Apenas mensagens recebidas (role='lead').
//  - Apenas mídias armazenadas no bucket privado `whatsapp-media`.
//  - Apenas kind ∈ {image, video}.
//  - Destinatário deve ser um lead JÁ existente da mesma empresa com
//    conversa WhatsApp aberta (não criamos conversas/leads aqui).
//  - Observação opcional vira `caption`.
//
// Este endpoint NÃO altera `api.whatsapp.send-media` (envio normal continua
// inalterado). Compartilha apenas o padrão de auth + Graph API.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isWithin24hWindow } from "@/lib/wa-templates.server";

interface ForwardBody {
  sourceMessageId?: string;
  targetLeadId?: string;
  note?: string;
}

const WA_MEDIA_BUCKET = "whatsapp-media";

export const Route = createFileRoute("/api/whatsapp/forward-message")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // ---- 1. Auth ----
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

        // ---- 2. Input ----
        let body: ForwardBody;
        try {
          body = (await request.json()) as ForwardBody;
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }
        const sourceMessageId = (body.sourceMessageId ?? "").trim();
        const targetLeadId = (body.targetLeadId ?? "").trim();
        const note = (body.note ?? "").trim().slice(0, 1024);
        if (!sourceMessageId || !targetLeadId) {
          return Response.json(
            { error: "sourceMessageId e targetLeadId obrigatórios" },
            { status: 400 },
          );
        }

        // ---- 3. Empresa do operador ----
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userId)
          .maybeSingle();
        if (!profile?.company_id) {
          return Response.json({ error: "perfil sem empresa" }, { status: 403 });
        }
        const companyId = profile.company_id;

        // ---- 4. Mensagem de origem ----
        const { data: srcMsg } = await supabaseAdmin
          .from("messages")
          .select("id, company_id, role, source_metadata, source_subtype")
          .eq("id", sourceMessageId)
          .maybeSingle();
        if (!srcMsg || srcMsg.company_id !== companyId) {
          return Response.json(
            { error: "mensagem de origem não encontrada" },
            { status: 404 },
          );
        }
        if (srcMsg.role !== "lead") {
          return Response.json(
            { error: "apenas mensagens recebidas podem ser encaminhadas" },
            { status: 400 },
          );
        }
        const srcMeta =
          (srcMsg.source_metadata as Record<string, unknown> | null) ?? {};
        const mediaPath = (srcMeta.media_path as string | undefined) ?? null;
        const mediaBucket =
          (srcMeta.media_bucket as string | undefined) ?? null;
        const mediaKindRaw =
          (srcMeta.media_kind as string | undefined) ??
          (srcMeta.type as string | undefined) ??
          srcMsg.source_subtype ??
          "";
        const mediaMime = (srcMeta.media_mime as string | undefined) ?? null;
        const mediaFilename =
          (srcMeta.media_filename as string | undefined) ?? null;
        const mediaSize = (srcMeta.media_size as number | undefined) ?? null;

        if (mediaKindRaw !== "image" && mediaKindRaw !== "video") {
          return Response.json(
            { error: "V1 suporta apenas imagem ou vídeo" },
            { status: 400 },
          );
        }
        const kind: "image" | "video" = mediaKindRaw;
        if (!mediaPath || mediaBucket !== WA_MEDIA_BUCKET) {
          return Response.json(
            { error: "mídia indisponível para encaminhamento" },
            { status: 400 },
          );
        }
        // Segurança multi-tenant: paths em whatsapp-media começam por company_id.
        if (!mediaPath.startsWith(`${companyId}/`)) {
          return Response.json(
            { error: "mídia fora desta empresa" },
            { status: 403 },
          );
        }

        // ---- 5. Lead destino + conversa whatsapp ----
        const { data: targetLead } = await supabaseAdmin
          .from("leads")
          .select("id, company_id, phone, external_id, integration_id")
          .eq("id", targetLeadId)
          .maybeSingle();
        if (!targetLead || targetLead.company_id !== companyId) {
          return Response.json(
            { error: "lead destino não encontrado" },
            { status: 404 },
          );
        }
        const recipient = String(
          targetLead.external_id ?? targetLead.phone ?? "",
        ).replace(/\D/g, "");
        if (recipient.length < 8 || recipient.length > 15) {
          return Response.json(
            { error: "lead destino sem telefone válido" },
            { status: 400 },
          );
        }

        console.log("[forward-message] lookup", {
          sourceMessageId,
          targetLeadId,
          targetPhone: targetLead.phone,
          targetExternalId: targetLead.external_id,
          companyId,
        });

        // 1) tenta por lead_id
        let { data: targetConv } = await supabaseAdmin
          .from("conversations")
          .select("id, company_id, channel, lead_id")
          .eq("lead_id", targetLeadId)
          .eq("company_id", companyId)
          .eq("channel", "whatsapp")
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        // 2) fallback: procura por outros leads da mesma empresa com mesmo
        // telefone/wa_id e pega a conversa WhatsApp mais recente. Cobre o
        // caso em que a conversa foi criada antes do lead destino existir
        // (ex.: webhook criou um lead "irmão" pelo wa_id).
        if (!targetConv) {
          const phoneDigits = String(
            targetLead.external_id ?? targetLead.phone ?? "",
          ).replace(/\D/g, "");
          if (phoneDigits.length >= 8) {
            const { data: siblingLeads } = await supabaseAdmin
              .from("leads")
              .select("id")
              .eq("company_id", companyId)
              .or(`phone.eq.${phoneDigits},external_id.eq.${phoneDigits}`);
            const siblingIds = (siblingLeads ?? []).map((l) => l.id);
            if (siblingIds.length > 0) {
              const { data: convByPhone } = await supabaseAdmin
                .from("conversations")
                .select("id, company_id, channel, lead_id")
                .in("lead_id", siblingIds)
                .eq("company_id", companyId)
                .eq("channel", "whatsapp")
                .order("last_message_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (convByPhone) targetConv = convByPhone;
            }
          }
        }

        console.log("[forward-message] conversation", {
          found: !!targetConv,
          conversationId: targetConv?.id ?? null,
          lead_id: targetConv?.lead_id ?? null,
        });

        if (!targetConv) {
          return Response.json(
            {
              error:
                "lead destino não possui conversa WhatsApp aberta. Abra a conversa antes de encaminhar.",
            },
            { status: 400 },
          );
        }

        // ---- 6. Janela 24h do destinatário ----
        const win = await isWithin24hWindow(targetConv.id);
        if (!win.inside) {
          return Response.json(
            {
              error:
                "Destinatário fora da janela de 24h. Encaminhe quando houver conversa ativa ou use um template.",
              requires_template: true,
              last_lead_at: win.lastLeadAt,
            },
            { status: 409 },
          );
        }

        // ---- 7. Integração WhatsApp ----
        const integrationQuery = supabaseAdmin
          .from("integrations")
          .select("id, access_token, external_account_id")
          .eq("company_id", companyId)
          .eq("channel", "whatsapp")
          .eq("active", true);
        const { data: integration } = targetLead.integration_id
          ? await integrationQuery.eq("id", targetLead.integration_id).maybeSingle()
          : await integrationQuery.limit(1).maybeSingle();
        if (!integration?.access_token || !integration.external_account_id) {
          return Response.json(
            { error: "WhatsApp não conectado para esta empresa" },
            { status: 400 },
          );
        }

        // ---- 8. Signed URL temporária para a Meta consumir ----
        const { data: signed, error: signErr } = await supabaseAdmin.storage
          .from(WA_MEDIA_BUCKET)
          .createSignedUrl(mediaPath, 60 * 60);
        if (signErr || !signed?.signedUrl) {
          console.error("[forward-message] sign error", signErr);
          return Response.json(
            { error: `Falha ao preparar mídia: ${signErr?.message ?? "sign"}` },
            { status: 500 },
          );
        }
        const publicLink = signed.signedUrl;

        // ---- 9. Validação de acessibilidade (HEAD + fallback GET range) ----
        let detectedMime: string | null = mediaMime;
        let detectedSize: number | null = mediaSize;
        try {
          const h = await fetch(publicLink, { method: "HEAD" });
          if (h.ok) {
            detectedMime = h.headers.get("content-type") ?? detectedMime;
            const len = h.headers.get("content-length");
            if (len) detectedSize = Number(len);
          } else {
            const g = await fetch(publicLink, {
              method: "GET",
              headers: { Range: "bytes=0-0" },
            });
            if (!g.ok && g.status !== 206) {
              return Response.json(
                { error: `Mídia inacessível (HTTP ${h.status}/${g.status}).` },
                { status: 400 },
              );
            }
            detectedMime = g.headers.get("content-type") ?? detectedMime;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "erro de rede";
          return Response.json(
            { error: `Falha ao validar mídia: ${msg}` },
            { status: 400 },
          );
        }

        // ---- 10. Envio para Graph API ----
        const apiUrl = `https://graph.facebook.com/v20.0/${integration.external_account_id}/messages`;
        const sentAt = new Date().toISOString();
        const payload: Record<string, unknown> = {
          messaging_product: "whatsapp",
          to: recipient,
          type: kind,
          [kind]: note ? { link: publicLink, caption: note } : { link: publicLink },
        };

        let externalId: string | null = null;
        try {
          const apiRes = await fetch(apiUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${integration.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });
          const apiText = await apiRes.text();
          let apiJson: {
            messages?: Array<{ id: string }>;
            error?: { message?: string; code?: number };
          } = {};
          try {
            apiJson = JSON.parse(apiText);
          } catch {
            /* */
          }
          if (!apiRes.ok) {
            const msg = apiJson.error?.message ?? `HTTP ${apiRes.status}`;
            console.error("[forward-message] meta error", {
              status: apiRes.status,
              body: apiText.slice(0, 800),
            });
            await supabaseAdmin
              .from("integrations")
              .update({ last_error: msg })
              .eq("id", integration.id);
            return Response.json(
              {
                error: `WhatsApp: ${msg}`,
                metaError: apiJson.error ?? null,
                status: apiRes.status,
              },
              { status: 502 },
            );
          }
          externalId = apiJson.messages?.[0]?.id ?? null;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "falha de rede";
          return Response.json(
            { error: `Falha ao enviar: ${msg}` },
            { status: 502 },
          );
        }

        // ---- 11. Persistência aditiva ----
        // Reaproveitamos a referência da mídia original em whatsapp-media.
        // forwarded_from_message_id é um campo aditivo em source_metadata
        // (jsonb), não exige migration.
        const messageText = note || `[${kind === "video" ? "vídeo" : "imagem"} encaminhado]`;
        const { data: inserted, error: insertErr } = await supabaseAdmin
          .from("messages")
          .insert({
            company_id: companyId,
            conversation_id: targetConv.id,
            role: "agent",
            text: messageText,
            at: sentAt,
            external_id: externalId,
            integration_id: integration.id,
            source_subtype: kind,
            source_metadata: {
              // legados (compat com renderer atual)
              media_url: mediaPath,
              type: kind,
              caption: note || null,
              // novos
              media_path: mediaPath,
              media_kind: kind,
              media_mime: detectedMime,
              media_filename: mediaFilename,
              media_size: detectedSize,
              media_bucket: WA_MEDIA_BUCKET,
              // rastreio
              forwarded_from_message_id: sourceMessageId,
            },
          })
          .select("id, conversation_id, role, text, at")
          .single();
        if (insertErr) {
          console.error("[forward-message] insert error", insertErr);
          return Response.json(
            { error: "Falha ao salvar mensagem" },
            { status: 500 },
          );
        }

        await supabaseAdmin
          .from("conversations")
          .update({
            last_message_at: sentAt,
            awaiting_reply: false,
            unread: 0,
          })
          .eq("id", targetConv.id);

        await supabaseAdmin
          .from("integrations")
          .update({ last_synced_at: sentAt, last_error: null })
          .eq("id", integration.id);

        // ---- 12. Auditoria (best-effort, não bloqueia resposta) ----
        try {
          await supabaseAdmin.rpc("log_audit", {
            _company_id: companyId,
            _user_id: userId,
            _action: "forward_media",
            _entity: "message",
            _entity_id: inserted.id,
            _before: null,
            _after: {
              source_message_id: sourceMessageId,
              target_lead_id: targetLeadId,
              target_conversation_id: targetConv.id,
              kind,
              has_note: note.length > 0,
            },
          });
        } catch (e) {
          console.error("[forward-message] audit failed (silent)", e);
        }

        return Response.json({
          id: inserted.id,
          conversationId: targetConv.id,
          externalId,
          at: sentAt,
          kind,
        });
      },
    },
  },
});
