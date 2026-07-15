// ============================================================================
// followup/types.ts
// Responsabilidade: contratos públicos do módulo Follow-up.
// Nenhum comportamento — apenas tipos e formatos de dados.
// Não importa outros arquivos do módulo para evitar ciclos.
// ============================================================================

export type FollowupRule =
  | "quote_no_reply"
  | "lead_silent"
  | "visit_no_return"
  | "hot_lead_idle"
  | "returning_customer";

export interface FollowupSettings {
  enabled: boolean;
  maxPerLead: number;
  minHoursBetween: number;
  quoteDelayHours: number;
  silenceDelayHours: number;
  visitDelayHours: number;
  hotDelayHours: number;
  businessHoursOnly: boolean;
  businessHoursStart: string;
  businessHoursEnd: string;
  tone: string;
  templates: Record<FollowupRule, string>;
  initialMessage: string | null;
  agentName: string;
}

export interface Candidate {
  conversationId: string;
  leadId: string;
  rule: FollowupRule;
  lastClientMessageAt: string | null;
  signal: string;
}

export interface TickResult {
  companyId: string;
  scanned: number;
  sent: number;
  skipped: Array<{ conversationId: string; rule: FollowupRule; reason: string }>;
  errors: string[];
}

export interface SafetyCheck {
  ok: boolean;
  reason?: string;
  attempt?: number;
  outsideWindow?: boolean;
}

// ---------------------------------------------------------------------------
// v2 (opt-in)
// ---------------------------------------------------------------------------

export type LeadTemperature = "hot" | "warm" | "cold";

export interface WhatsappIntegrationStatus {
  connected: boolean;
  hasUnmapped: boolean;
  unmappedCount: number;
  displayName: string | null;
  externalAccountId: string | null;
  tokenExpiresAt: string | null;
  lastError: string | null;
  unmappedSamples: Array<{
    phone_number_id: string;
    display_phone_number: string | null;
    contact_name: string | null;
    created_at: string;
  }>;
}

export interface FollowupV2Settings {
  humanize: boolean;
  delayJitterMinutes: number;
  dailyLimit: number;
  minResponseRate: number;
  warmupEnabled: boolean;
  warmupStartedAt: string | null;
  reactivationEnabled: boolean;
  reactivationDays: number;
  reactivationDailyMax: number;
  reactivationHoursStart: string;
  reactivationHoursEnd: string;
  reactivationTemplate: string;
}

export interface SendGateResult {
  ok: boolean;
  reason?: string;
  remainingToday?: number;
}

export interface LeadScoreResult {
  score: number;
  temperature: LeadTemperature;
}

export interface AdvancedAnalytics {
  byDay: Array<{ day: string; sent: number; responded: number; recovered: number }>;
  byRule: Array<{ rule: string; sent: number; responded: number; rate: number }>;
  recoveredValue: number;
  bestHour: number | null;
  bestTemplate: string | null;
  bestTemplateRate: number;
  todaySent: number;
  todayLimit: number;
}

export interface ReactivationResult {
  scanned: number;
  sent: number;
  skipped: Array<{ leadId: string; reason: string }>;
}

export interface ManualFollowupResult {
  eligible: boolean;
  blockedReason?: string;
  rule?: string;
  generatedMessage?: string;
  sendStatus?: "sent" | "failed" | "blocked";
  sendError?: string;
  externalId?: string | null;
  via?: "text" | "template";
}
