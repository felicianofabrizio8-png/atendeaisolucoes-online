// ============================================================================
// GET /api/runtime/status
// READ-ONLY. Admin-only por tenant. Retorna snapshot completo do Runtime:
// status, heartbeat, registry, jobs, health. Nenhuma escrita.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const fetchRuntimeStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            col: string,
            v: string,
          ) => { maybeSingle: () => Promise<{ data: { company_id: string } | null }> };
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
    const { AutonomousRuntime } = await import("@/lib/runtime/AutonomousRuntime.server");
    const runtime = AutonomousRuntime.instance();
    runtime.bindWriter(supabaseAdmin);
    return runtime.fullSnapshot(prof.company_id);
  });

export const Route = createFileRoute("/api/runtime/status")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const snapshot = await fetchRuntimeStatus();
          return Response.json({ ok: true, snapshot });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "error";
          const status = msg === "forbidden" ? 403 : msg === "no_company" ? 400 : 500;
          return Response.json({ ok: false, error: msg }, { status });
        }
      },
    },
  },
});
