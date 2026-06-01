// ============================================================================
// Cron-friendly hook: roda follow-ups e reconcilia respostas para todas as
// empresas com ai_followup_enabled=true. Chamado por pg_cron via net.http_post.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  runFollowupTickAll,
  reconcileResponses,
} from "@/lib/ai-followup.server";

export const Route = createFileRoute("/api/public/hooks/followup-tick")({
  server: {
    handlers: {
      POST: async () => {
        const results = await runFollowupTickAll();
        // Reconcilia respostas das mesmas empresas
        const { data: companies } = await supabaseAdmin
          .from("company_settings")
          .select("company_id")
          .eq("ai_followup_enabled", true);
        const reconciled: Record<string, number> = {};
        for (const c of companies ?? []) {
          try {
            reconciled[c.company_id] = await reconcileResponses(c.company_id);
          } catch {
            /* noop */
          }
        }
        const totals = results.reduce(
          (acc, r) => {
            acc.scanned += r.scanned;
            acc.sent += r.sent;
            acc.skipped += r.skipped.length;
            acc.errors += r.errors.length;
            return acc;
          },
          { scanned: 0, sent: 0, skipped: 0, errors: 0 },
        );
        return Response.json({ ok: true, totals, results, reconciled });
      },
      GET: async () =>
        Response.json({
          ok: true,
          info: "POST to run the follow-up tick",
        }),
    },
  },
});
