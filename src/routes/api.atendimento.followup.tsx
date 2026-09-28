import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getAtendimentoFollowupReadModel } from "@/lib/atendimento/followup-read.server";

async function authedCompanyId(request: Request): Promise<string | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  if (!data?.user) return null;
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", data.user.id)
    .maybeSingle();
  return profile?.company_id ?? null;
}

export const Route = createFileRoute("/api/atendimento/followup")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const companyId = await authedCompanyId(request);
        if (!companyId) return Response.json({ ok: false, error: "não autenticado" }, { status: 401 });

        const requested = new URL(request.url).searchParams
          .get("conversation_ids")
          ?.split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 500);

        try {
          const cycles = await getAtendimentoFollowupReadModel(companyId, {
            conversationIds: requested,
          });
          return Response.json({ ok: true, cycles });
        } catch (error) {
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "falha ao carregar follow-ups" },
            { status: 500 },
          );
        }
      },
    },
  },
});
