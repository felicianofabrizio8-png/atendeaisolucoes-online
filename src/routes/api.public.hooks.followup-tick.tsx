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

        // Reconcilia respostas para TODAS as empresas com follow-ups pendentes
        // nos últimos 14 dias (não apenas as com flag ligada agora). Garante
        // que followup_responded / lead_recovered atualizem mesmo se a
        // empresa desativar o follow-up no meio do caminho.
        const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
        const { data: pendingRows } = await supabaseAdmin
          .from("follow_ups")
          .select("company_id")
          .eq("status", "sent")
          .gte("sent_at", since);
        const companyIds = Array.from(
          new Set((pendingRows ?? []).map((r) => r.company_id).filter(Boolean)),
        );
        const reconciled: Record<string, number> = {};
        for (const cid of companyIds) {
          try {
            reconciled[cid] = await reconcileResponses(cid);
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
