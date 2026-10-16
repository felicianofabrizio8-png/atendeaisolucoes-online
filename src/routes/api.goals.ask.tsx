// src/routes/api.goals.ask.tsx
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { askGoals, loadGoalsContext } from "@/lib/goals/ai.server";
import { todayInSaoPaulo } from "@/lib/goals/model";

// Permissão "Ver metas" é aplicada antes pelo middleware de API (apiPermission).
export const Route = createFileRoute("/api/goals/ask")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization") ?? "";
        if (!authorization.startsWith("Bearer "))
          return Response.json({ error: "Entre na sua conta." }, { status: 401 });
        const body = (await request.json().catch(() => null)) as { question?: unknown } | null;
        const question = typeof body?.question === "string" ? body.question.trim() : "";
        if (!question) return Response.json({ error: "Escreva a pergunta." }, { status: 400 });
        const client = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          {
            global: { headers: { Authorization: authorization } },
            auth: { persistSession: false, autoRefreshToken: false },
          },
        );
        const { data: identity } = await client.auth.getUser(authorization.slice(7));
        if (!identity.user) return Response.json({ error: "Sessão inválida." }, { status: 401 });
        const { data: profile } = await client
          .from("profiles")
          .select("company_id")
          .eq("id", identity.user.id)
          .maybeSingle();
        if (!profile?.company_id)
          return Response.json({ error: "Empresa não encontrada." }, { status: 403 });
        try {
          // Sessão da própria pessoa: só entra no contexto o que ela pode ver (RLS).
          const ctx = await loadGoalsContext(
            client as never,
            profile.company_id,
            todayInSaoPaulo(),
            { service: false },
          );
          return Response.json(await askGoals(question, ctx), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "A Lume não respondeu." },
            { status: 503 },
          );
        }
      },
    },
  },
});
