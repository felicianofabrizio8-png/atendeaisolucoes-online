// Diagnóstico: grava erros do frontend (React error boundary) em public.error_log
// Sem efeitos colaterais além do insert. Best-effort: nunca lança.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface FrontendErrorPayload {
  route: string;
  message: string;
  stack?: string | null;
  componentStack?: string | null;
  userAgent?: string | null;
  category?: string | null;
}

export const logFrontendError = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: FrontendErrorPayload) => d)
  .handler(async ({ data, context }) => {
    try {
      const { supabase, userId } = context as { supabase: any; userId: string };
      const { data: prof } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", userId)
        .maybeSingle();
      const companyId = prof?.company_id ?? null;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("error_log").insert({
        company_id: companyId,
        source: "frontend",
        severity: "error",
        message: `[${data.category ?? "react_error"}] ${data.route} :: ${data.message}`.slice(0, 2000),
        context: {
          route: data.route,
          stack: (data.stack ?? "").slice(0, 4000),
          componentStack: (data.componentStack ?? "").slice(0, 4000),
          userAgent: data.userAgent ?? null,
          userId,
          category: data.category ?? "react_error",
          ts: new Date().toISOString(),
        },
      });
      return { ok: true };
    } catch (e) {
      console.error("[logFrontendError] insert failed", e);
      return { ok: false };
    }
  });
