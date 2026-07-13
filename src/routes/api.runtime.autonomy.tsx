// ============================================================================
// /api/runtime/autonomy — Admin-only.
// GET: snapshot da autonomia (system-health).
// POST { enabled: boolean }: liga/desliga autonomia para o tenant do admin.
// Kill switch: enabled=false remove override + apaga o tenant da lista efetiva.
// tenantId derivado do JWT (profiles.company_id).
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({ enabled: z.boolean() }).strict();

async function resolveAdminTenant(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return { error: "unauthorized" as const, status: 401 as const };
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const token = authHeader.slice(7).trim();
  const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userData?.user) return { error: "unauthorized" as const, status: 401 as const };
  const userId = userData.user.id;
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  if (!prof?.company_id) return { error: "no_company" as const, status: 400 as const };
  const tenantId = prof.company_id as string;
  const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _company_id: tenantId,
    _role: "admin",
  });
  if (!isAdmin) return { error: "forbidden" as const, status: 403 as const };
  return { tenantId, userId };
}

export const Route = createFileRoute("/api/runtime/autonomy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ctx = await resolveAdminTenant(request);
        if ("error" in ctx) return Response.json({ ok: false, error: ctx.error }, { status: ctx.status });
        const { RuntimeAutonomyRegistry } = await import(
          "@/lib/runtime/RuntimeAutonomyRegistry.server"
        );
        const snap = RuntimeAutonomyRegistry.snapshot("system-health");
        return Response.json({
          ok: true,
          tenantId: ctx.tenantId,
          tenantEnabled: RuntimeAutonomyRegistry.isEnabled("system-health", ctx.tenantId),
          autonomy: snap,
        });
      },
      POST: async ({ request }) => {
        const ctx = await resolveAdminTenant(request);
        if ("error" in ctx) return Response.json({ ok: false, error: ctx.error }, { status: ctx.status });
        let raw: unknown;
        try { raw = await request.json(); } catch { return Response.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
        }
        const { RuntimeAutonomyRegistry } = await import(
          "@/lib/runtime/RuntimeAutonomyRegistry.server"
        );
        RuntimeAutonomyRegistry.setOverride("system-health", ctx.tenantId, parsed.data.enabled);
        return Response.json({
          ok: true,
          tenantId: ctx.tenantId,
          enabled: parsed.data.enabled,
          autonomy: RuntimeAutonomyRegistry.snapshot("system-health"),
        });
      },
    },
  },
});
