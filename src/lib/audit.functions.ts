// Server functions para auditoria e log de erros.
// Usam supabaseAdmin (service role) para inserir, mas SEMPRE validam o
// company_id do usuário autenticado — nunca confiam em valores enviados pelo
// cliente.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const AuditSchema = z.object({
  action: z.string().min(1).max(64),
  entity: z.string().min(1).max(64),
  entityId: z.string().max(128).nullable().optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});

const ErrorSchema = z.object({
  source: z.enum(["ia", "upload", "meta", "whatsapp", "storage", "supabase", "client", "other"]),
  severity: z.enum(["info", "warning", "error", "critical"]).default("error"),
  message: z.string().min(1).max(2000),
  context: z.record(z.string(), z.unknown()).optional(),
});

async function getCompanyId(supabase: unknown, userId: string): Promise<string | null> {
  const s = supabase as { from: (t: string) => { select: (c: string) => { eq: (col: string, v: string) => { maybeSingle: () => Promise<{ data: { company_id: string } | null }> } } } };
  const { data } = await s.from("profiles").select("company_id").eq("id", userId).maybeSingle();
  return data?.company_id ?? null;
}

export const logAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => AuditSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const companyId = await getCompanyId(supabase, userId);
    if (!companyId) return { ok: false as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      await supabaseAdmin.from("audit_log").insert({
        company_id: companyId,
        user_id: userId,
        action: data.action,
        entity: data.entity,
        entity_id: data.entityId ?? null,
        before: (data.before ?? null) as never,
        after: (data.after ?? null) as never,
      });
      return { ok: true as const };
    } catch (e) {
      console.error("[logAudit] falhou (silencioso)", e);
      return { ok: false as const };
    }
  });

export const logError = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ErrorSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const companyId = await getCompanyId(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      await supabaseAdmin.from("error_log").insert({
        company_id: companyId,
        user_id: userId,
        source: data.source,
        severity: data.severity,
        message: data.message,
        context: (data.context ?? {}) as never,
      });
      return { ok: true as const };
    } catch (e) {
      console.error("[logError] falhou (silencioso)", e);
      return { ok: false as const };
    }
  });
