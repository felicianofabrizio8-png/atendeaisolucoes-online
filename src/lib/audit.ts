// Helper cliente para registrar audit/error logs.
// Fire-and-forget: nunca bloqueia a UI nem propaga erro.

import { logAudit, logError } from "./audit.functions";

export type AuditAction =
  | "login"
  | "logout"
  | "user_signup"
  | "delete_campaign"
  | "delete_creative"
  | "delete_product"
  | "delete_lead"
  | "update_company_settings"
  | "update_integration_token"
  | "update_integration_status"
  | "delete_integration"
  | "connect_meta"
  | "disconnect_meta"
  | "send_campaign"
  | "invite_user"
  | "remove_user"
  | "change_user_role";

export type AuditEntity =
  | "auth"
  | "campaign"
  | "campaign_creative"
  | "product"
  | "lead"
  | "company_settings"
  | "integration"
  | "user_role"
  | "company_invite";

export interface AuditPayload {
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

export function recordAudit(payload: AuditPayload): void {
  void logAudit({ data: payload }).catch((e) => {
    console.warn("[audit] envio falhou:", e);
  });
}

export type ErrorSource = "ia" | "upload" | "meta" | "whatsapp" | "storage" | "supabase" | "client" | "other";

export function recordError(
  source: ErrorSource,
  message: string,
  context?: Record<string, unknown>,
  severity: "info" | "warning" | "error" | "critical" = "error",
): void {
  void logError({ data: { source, severity, message, context } }).catch((e) => {
    console.warn("[errorLog] envio falhou:", e);
  });
}

/** Instala handlers globais para erros não tratados do frontend.
 *  Faz dedupe simples para não inundar o backend em loops. */
let installed = false;
export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const seen = new Map<string, number>();
  const SHOULD_REPORT = (key: string) => {
    const now = Date.now();
    const last = seen.get(key) ?? 0;
    if (now - last < 10_000) return false;
    seen.set(key, now);
    return true;
  };

  window.addEventListener("error", (event) => {
    const msg = `${event.message || "Erro desconhecido"}`;
    if (!SHOULD_REPORT(msg)) return;
    recordError("client", msg.slice(0, 1800), {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack?.slice(0, 1800),
      url: window.location.pathname,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const msg = typeof reason === "string" ? reason : reason?.message ?? "Unhandled promise rejection";
    if (!SHOULD_REPORT(msg)) return;
    recordError("client", String(msg).slice(0, 1800), {
      kind: "unhandledrejection",
      stack: reason?.stack?.slice(0, 1800),
      url: window.location.pathname,
    });
  });
}
