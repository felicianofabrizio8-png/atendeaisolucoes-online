// src/routes/api.public.hooks.goals-tick.tsx
// ============================================================================
// POST /api/public/hooks/goals-tick — chamado 1x por dia pelo pg_cron.
// Mesmo padrão do followup-tick: segredo (GOALS_TICK_SECRET ou cofre),
// comparação segura, corpo vazio estrito, limite de taxa e trava global.
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  correlationId,
  rateLimit,
  releaseLock,
  safeEqualSecret,
  tryAcquireLock,
} from "@/lib/runtime/HookSecurity.server";
import { getHookSecret } from "@/lib/runtime/HookSecretVault.server";
import { todayInSaoPaulo } from "@/lib/goals/model";
import { runGoalsTick } from "@/lib/goals/tick.server";

const LOCK_KEY = "goals-tick:global";

export const Route = createFileRoute("/api/public/hooks/goals-tick")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const cid = correlationId();
        const expected =
          (await getHookSecret("goals_tick_secret")) ?? process.env.GOALS_TICK_SECRET ?? null;
        if (!expected) return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
        if (!safeEqualSecret(request.headers.get("x-goals-tick-secret") ?? "", expected))
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        const raw = await request.text().catch(() => "");
        if (raw.length > 512)
          return Response.json({ ok: false, error: "payload_too_large" }, { status: 413 });
        if (raw.trim() && raw.trim() !== "{}")
          return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
        if (!rateLimit(LOCK_KEY, 6, 60_000).allowed)
          return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
        if (!tryAcquireLock(LOCK_KEY))
          return Response.json({ ok: false, error: "busy" }, { status: 409 });
        try {
          const result = await runGoalsTick(supabaseAdmin as never, { today: todayInSaoPaulo() });
          console.info("[goals-tick]", { cid, ...result });
          return Response.json({ ok: true, ...result });
        } finally {
          releaseLock(LOCK_KEY);
        }
      },
    },
  },
});
