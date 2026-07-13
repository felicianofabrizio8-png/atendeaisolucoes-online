// ============================================================================
// HTTP Audit — registra chamadas administrativas sem PII.
// Nunca falha o caller.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface HttpAuditInput {
  companyId?: string | null;
  userId?: string | null;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  outcome?: string;
  error?: string | null;
}

export class HttpAudit {
  constructor(private readonly writer: SupabaseClient<Database>) {}

  async record(input: HttpAuditInput): Promise<void> {
    try {
      await this.writer.from("http_audit_log").insert({
        company_id: input.companyId ?? null,
        user_id: input.userId ?? null,
        method: input.method,
        path: input.path,
        status: input.status,
        duration_ms: Math.max(0, Math.floor(input.durationMs)),
        outcome: input.outcome ?? (input.status < 400 ? "ok" : "error"),
        error: sanitizeError(input.error ?? null),
      });
    } catch (err) {
      console.error("[HttpAudit] failed", err);
    }
  }
}

function sanitizeError(err: string | null): string | null {
  if (!err) return null;
  // Remove qualquer padrão que pareça JWT, email ou telefone antes de gravar.
  return err
    .replace(/eyJ[a-zA-Z0-9._-]+/g, "[jwt]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d{2,3}[\s-]?\(?\d{2,3}\)?[\s-]?\d{3,5}[\s-]?\d{3,5}/g, "[phone]")
    .slice(0, 500);
}
