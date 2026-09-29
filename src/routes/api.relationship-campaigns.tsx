import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  createRelationshipCampaign,
  createRelationshipSegment,
  materializeRelationshipRecipients,
  previewRelationshipSegment,
} from "@/lib/relationship-campaigns.server";
import {
  dispatchRelationshipRecipient,
  getRelationshipSettings,
  listRelationshipCampaigns,
  listRelationshipRecipients,
  saveRelationshipSettings,
  scheduleRelationshipCampaign,
  upsertRelationshipSuppression,
} from "@/lib/relationship-campaign-dispatcher.server";

async function authenticatedCompanyId(request: Request): Promise<string | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return null;
  const { data: userData } = await supabaseAdmin.auth.getUser(token);
  if (!userData.user) return null;
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", userData.user.id)
    .maybeSingle();
  return profile?.company_id ?? null;
}

export const Route = createFileRoute("/api/relationship-campaigns")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const companyId = await authenticatedCompanyId(request);
        if (!companyId) return Response.json({ ok: false, error: "não autenticado" }, { status: 401 });
        try {
          const url = new URL(request.url);
          const campaignId = url.searchParams.get("campaign_id");
          if (campaignId) {
            return Response.json({
              ok: true,
              recipients: await listRelationshipRecipients(companyId, campaignId),
            });
          }
          return Response.json({ ok: true, ...(await listRelationshipCampaigns(companyId)) });
        } catch (error) {
          return Response.json({ ok: false, error: error instanceof Error ? error.message : "falha ao carregar" }, { status: 500 });
        }
      },
      POST: async ({ request }: { request: Request }) => {
        const companyId = await authenticatedCompanyId(request);
        if (!companyId) return Response.json({ ok: false, error: "não autenticado" }, { status: 401 });

        try {
          const body = (await request.json()) as Record<string, unknown>;
          const action = body.action;

          if (action === "preview_segment") {
            let definition = body.definition;
            if (body.segment_id) {
              const { data: segment, error } = await (supabaseAdmin as any)
                .from("relationship_segments")
                .select("definition")
                .eq("company_id", companyId)
                .eq("id", body.segment_id)
                .maybeSingle();
              if (error) throw error;
              if (!segment) return Response.json({ ok: false, error: "segmento não encontrado" }, { status: 404 });
              definition = segment.definition;
            }
            return Response.json({ ok: true, ...(await previewRelationshipSegment(companyId, definition, 25)) });
          }

          if (action === "create_segment") {
            if (typeof body.name !== "string" || !body.name.trim()) {
              return Response.json({ ok: false, error: "name é obrigatório" }, { status: 400 });
            }
            return Response.json({
              ok: true,
              segment: await createRelationshipSegment(companyId, body.name, body.definition),
            }, { status: 201 });
          }

          if (action === "create_campaign") {
            if (typeof body.name !== "string" || typeof body.segment_id !== "string") {
              return Response.json({ ok: false, error: "name e segment_id são obrigatórios" }, { status: 400 });
            }
            const campaign = await createRelationshipCampaign(companyId, body.name, body.segment_id);
            if (typeof body.template_purpose === "string") {
              await (supabaseAdmin as any).from("relationship_campaigns")
                .update({ template_purpose: body.template_purpose })
                .eq("company_id", companyId).eq("id", campaign.id);
            }
            return Response.json({ ok: true, campaign }, { status: 201 });
          }

          if (action === "materialize_recipients") {
            if (typeof body.relationship_campaign_id !== "string") {
              return Response.json({ ok: false, error: "relationship_campaign_id é obrigatório" }, { status: 400 });
            }
            return Response.json({
              ok: true,
              ...(await materializeRelationshipRecipients(companyId, body.relationship_campaign_id)),
            });
          }

          if (action === "save_settings") {
            return Response.json({
              ok: true,
              settings: await saveRelationshipSettings(companyId, (body.settings ?? {}) as Record<string, unknown>),
            });
          }

          if (action === "activate_automation") {
            const enabled = body.enabled === true;
            return Response.json({
              ok: true,
              settings: await saveRelationshipSettings(companyId, {
                mode: enabled ? "automatic" : "manual",
                automatic_enabled: enabled,
              }),
            });
          }

          if (action === "schedule") {
            if (typeof body.relationship_campaign_id !== "string") {
              return Response.json({ ok: false, error: "relationship_campaign_id é obrigatório" }, { status: 400 });
            }
            return Response.json({
              ok: true,
              ...(await scheduleRelationshipCampaign({
                companyId,
                relationshipCampaignId: body.relationship_campaign_id,
                mode: (body.mode as "manual" | "assisted" | "automatic") ?? "assisted",
                limit: typeof body.limit === "number" ? body.limit : undefined,
              })),
            });
          }

          if (action === "dispatch_preview") {
            if (typeof body.relationship_campaign_id !== "string" || typeof body.recipient_id !== "string") {
              return Response.json({ ok: false, error: "campaign_id e recipient_id são obrigatórios" }, { status: 400 });
            }
            return Response.json({
              ok: true,
              ...(await dispatchRelationshipRecipient({
                companyId,
                relationshipCampaignId: body.relationship_campaign_id,
                recipientId: body.recipient_id,
                mode: (body.mode as "manual" | "assisted" | "automatic") ?? "manual",
                dryRun: true,
              })),
            });
          }

          if (action === "suppress") {
            return Response.json({
              ok: true,
              suppression: await upsertRelationshipSuppression(companyId, {
                leadId: typeof body.lead_id === "string" ? body.lead_id : undefined,
                phone: typeof body.phone === "string" ? body.phone : undefined,
                reason: typeof body.reason === "string" ? body.reason : undefined,
                source: "operator",
              }),
            });
          }

          return Response.json({ ok: false, error: "action inválida" }, { status: 400 });
        } catch (error) {
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "falha na operação" },
            { status: 500 },
          );
        }
      },
    },
  },
});
