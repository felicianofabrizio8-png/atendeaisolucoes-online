// ============================================================================
// GET /api/onboarding/checklist — admin-only, READ ONLY
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const fetchOnboardingChecklist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (col: string, v: string) => {
            maybeSingle: () => Promise<{ data: { company_id: string } | null }>;
          };
        };
      };
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }>;
    };
    const { data: prof } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!prof?.company_id) throw new Error("no_company");
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: context.userId,
      _company_id: prof.company_id,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { OnboardingAgent } = await import("@/lib/onboarding/OnboardingAgent.server");
    const agent = new OnboardingAgent(supabaseAdmin);
    const [checklist, next, score] = await Promise.all([
      agent.checklist(prof.company_id),
      agent.nextBestAction(prof.company_id),
      agent.score(prof.company_id),
    ]);
    return { checklist, nextBestAction: next, readinessScore: score };
  });

export const Route = createFileRoute("/api/onboarding/checklist")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const data = await fetchOnboardingChecklist();
          return Response.json({ ok: true, ...data });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "error";
          const status = msg === "forbidden" ? 403 : msg === "no_company" ? 400 : 500;
          return Response.json({ ok: false, error: msg }, { status });
        }
      },
    },
  },
});
