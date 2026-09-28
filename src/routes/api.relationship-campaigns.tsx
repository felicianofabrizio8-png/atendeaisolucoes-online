import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  createRelationshipCampaign,
  createRelationshipSegment,
  materializeRelationshipRecipients,
  previewRelationshipSegment,
} from "@/lib/relationship-campaigns.server";

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
      POST: async ({ request }: { request: Request }) => {
        const companyId = await authenticatedCompanyId(request);
        if (!companyId) {
          return Response.json({ ok: false, error: "não autenticado" }, { status: 401 });
        }

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
            const segment = await createRelationshipSegment(companyId, body.name, body.definition);
            return Response.json({ ok: true, segment }, { status: 201 });
          }

          if (action === "create_campaign") {
            if (typeof body.name !== "string" || !body.name.trim() || typeof body.segment_id !== "string") {
              return Response.json({ ok: false, error: "name e segment_id são obrigatórios" }, { status: 400 });
            }
            const campaign = await createRelationshipCampaign(companyId, body.name, body.segment_id);
            return Response.json({ ok: true, campaign }, { status: 201 });
          }

          if (action === "materialize_recipients") {
            if (typeof body.relationship_campaign_id !== "string") {
              return Response.json({ ok: false, error: "relationship_campaign_id é obrigatório" }, { status: 400 });
            }
            const result = await materializeRelationshipRecipients(companyId, body.relationship_campaign_id);
            return Response.json({ ok: true, ...result });
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
