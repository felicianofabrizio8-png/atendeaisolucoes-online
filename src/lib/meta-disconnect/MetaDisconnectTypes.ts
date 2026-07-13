// ============================================================================
// Tipos para o fluxo de desconexão Meta (WhatsApp / Instagram / Facebook).
// Nada aqui trafega token — apenas metadados sanitizados.
// ============================================================================

export type MetaChannel = "whatsapp" | "instagram" | "facebook";

export type DisconnectMode = "dry-run" | "disconnect";

export type DisconnectStatus =
  | "connected"
  | "disconnecting"
  | "disconnected"
  | "partial_disconnect"
  | "disconnect_failed"
  | "already_disconnected";

export type StepStatus = "ok" | "failed" | "skipped" | "manual_action_required";

export interface DisconnectStep {
  step: string;
  status: StepStatus;
  code?: string;
  detail?: string;
}

export interface AssetSummary {
  channel: MetaChannel;
  hasAccessToken: boolean;
  hasWebhookSecret: boolean;
  externalAccountIdMasked: string | null;
  pageIdMasked?: string | null;
  igBusinessAccountIdMasked?: string | null;
  wabaIdMasked?: string | null;
  phoneMasked?: string | null;
  tokenExpiresAt?: string | null;
  active: boolean;
}

export interface DisconnectPlan {
  integrationId: string;
  companyId: string; // apenas para uso server-side; sanitizado antes de sair
  asset: AssetSummary;
  metaPages: AssetSummary[]; // páginas/IG associadas ao mesmo tenant+integration
  actions: string[];
  risks: string[];
  sharedDependencies: string[];
}

export interface DisconnectReport {
  integrationId: string;
  status: DisconnectStatus;
  alreadyDisconnected: boolean;
  steps: DisconnectStep[];
  manualActionsRequired: string[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface DryRunReport {
  integrationId: string;
  plan: DisconnectPlan;
  wouldExecute: string[];
  writeAttempted: false;
}
