// ============================================================================
// /api/runtime/autonomy — Admin-only. FASE 2: persistência distribuída.
//
// GET: snapshot da autonomia (flags persistidas + métricas).
// POST { systemHealthEnabled?: boolean, killSwitch?: boolean }:
//   Atualiza `company_settings.runtime_*` para o tenant do admin.
//   tenantId derivado do JWT — companyId no body é REJEITADO.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z
  .object({
    systemHealthEnabled: z.boolean().optional(),
    killSwitch: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) => typeof v.systemHealthEnabled === "boolean" || typeof v.killSwitch === "boolean",
    { message: "at least one flag required" },
  );

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

function correlationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
        const { getRuntimeFlags } = await import(
          "@/lib/runtime/RuntimeStateStore.server"
        );
        const [snap, flags, enabled] = await Promise.all([
          RuntimeAutonomyRegistry.snapshot("system-health"),
          getRuntimeFlags(ctx.tenantId),
          RuntimeAutonomyRegistry.isEnabled("system-health", ctx.tenantId),
        ]);
        return Response.json({
          ok: true,
          tenantId: ctx.tenantId,
          tenantEnabled: enabled,
          flags,
          autonomy: snap,
        });
      },
      POST: async ({ request }) => {
        const ctx = await resolveAdminTenant(request);
        if ("error" in ctx) return Response.json({ ok: false, error: ctx.error }, { status: ctx.status });

        // Rejeita explicitamente qualquer companyId/tenantId no body.
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
        }
        if (raw && typeof raw === "object") {
          const forbidden = ["companyId", "tenantId", "company_id", "tenant_id"];
          for (const k of forbidden) {
            if (k in (raw as Record<string, unknown>)) {
              return Response.json(
                { ok: false, error: "tenant_from_server_only" },
                { status: 400 },
              );
            }
          }
        }
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
        }

        const { updateRuntimeFlags } = await import(
          "@/lib/runtime/RuntimeStateStore.server"
        );
        const { RuntimeAutonomyRegistry } = await import(
          "@/lib/runtime/RuntimeAutonomyRegistry.server"
        );

        const cid = correlationId();
        const result = await updateRuntimeFlags(ctx.tenantId, {
          systemHealthEnabled: parsed.data.systemHealthEnabled,
          killSwitch: parsed.data.killSwitch,
          actorId: ctx.userId,
          correlationId: cid,
        });
        if (!result.ok) {
          return Response.json({ ok: false, error: "update_failed" }, { status: 500 });
        }

        RuntimeAutonomyRegistry.invalidateCache(ctx.tenantId);

        return Response.json({
          ok: true,
          tenantId: ctx.tenantId,
          correlationId: cid,
          flags: result.flags,
          autonomy: await RuntimeAutonomyRegistry.snapshot("system-health"),
        });
      },
    },
  },
});
