// Helper cliente para registrar audit/error logs.
// Fire-and-forget: nunca bloqueia a UI nem propaga erro.

import { logAudit, logError } from "./audit.functions";

export type AuditAction =
  | "delete_campaign"
  | "delete_creative"
  | "delete_product"
  | "delete_lead"
  | "update_company_settings"
  | "update_integration_token"
  | "update_integration_status"
  | "delete_integration"
  | "invite_user"
  | "remove_user"
  | "change_user_role";

export type AuditEntity =
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
  // Não aguardamos — eventos de auditoria não devem segurar a UI.
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
