// ============================================================================
// HTTP Audit — registra chamadas administrativas sem PII.
// Nunca lança exceção para o caller; devolve resultado explícito
// ({ ok: true } | { ok: false, code, pgCode? }) para que o caller possa
// decidir se emite fallback observável.
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

export type HttpAuditResult =
  | { ok: true }
  | { ok: false; code: string; pgCode?: string };

export class HttpAudit {
  constructor(private readonly writer: SupabaseClient<Database>) {}

  async record(input: HttpAuditInput): Promise<HttpAuditResult> {
    const path = input.path;
    const outcome = input.outcome ?? (input.status < 400 ? "ok" : "error");
    try {
      const { error } = await this.writer.from("http_audit_log").insert({
        company_id: input.companyId ?? null,
        user_id: input.userId ?? null,
        method: input.method,
        path,
        status: input.status,
        duration_ms: Math.max(0, Math.floor(input.durationMs)),
        outcome,
        error: sanitizeError(input.error ?? null),
      });
      if (error) {
        const pgCode = (error as { code?: string }).code;
        const code = classifyPgError(pgCode);
        console.error("[http_audit] write_failed", {
          pgCode: pgCode ?? null,
          code,
          message: sanitizeError(error.message ?? null),
          path,
          outcome,
        });
        return { ok: false, code, pgCode };
      }
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const pgCode = (err as { code?: string } | null)?.code;
      const code = pgCode ? classifyPgError(pgCode) : "network";
      console.error("[http_audit] write_failed", {
        pgCode: pgCode ?? null,
        code,
        message: sanitizeError(message),
        path,
        outcome,
      });
      return { ok: false, code, pgCode };
    }
  }
}

function classifyPgError(pgCode: string | undefined | null): string {
  switch (pgCode) {
    case "42501":
      return "permission_denied";
    case "42P01":
      return "table_unavailable";
    case "23503":
      return "foreign_key_violation";
    case "23505":
      return "unique_violation";
    case "23514":
      return "check_violation";
    case undefined:
    case null:
    case "":
      return "unknown";
    default:
      return "postgrest_error";
  }
}

function sanitizeError(err: string | null): string | null {
  if (!err) return null;
  // Remove qualquer padrão que pareça JWT, email, telefone ou UUID antes de gravar.
  return err
    .replace(/eyJ[a-zA-Z0-9._-]+/g, "[jwt]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d{2,3}[\s-]?\(?\d{2,3}\)?[\s-]?\d{3,5}[\s-]?\d{3,5}/g, "[phone]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[uuid]",
    )
    .slice(0, 500);
}
