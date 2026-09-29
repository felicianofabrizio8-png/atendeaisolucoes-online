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
  /** Fuso IANA da empresa (o servidor roda em UTC). */
  timeZone: string;
  /** Dias úteis ISO: 1 = segunda … 7 = domingo. */
  businessDays: number[];
}

/**
 * Conversa em que uma mensagem NOSSA (ou orçamento/visita) ficou sem
 * resposta — candidata a abrir um ciclo de follow-up.
 */
export interface Candidate {
  conversationId: string;
  leadId: string;
  rule: FollowupRule;
  /** quote:<id> | visit:<id> | msg:<id> — a mesma referência nunca reabre. */
  referenceKey: string;
  /** Instante da referência; mensagem do cliente depois disso = respondeu. */
  referenceAt: string;
  signal: string;
}

export interface TickResult {
  companyId: string;
  /** Ciclos vencidos avaliados. */
  scanned: number;
  /** Ciclos abertos neste tick. */
  opened?: number;
  /** Ciclos encerrados neste tick (resposta, venda, fim das tentativas…). */
  closed?: number;
  /** Conversas com o cliente esperando resposta — pendência de atendimento, não follow-up. */
  pendingAttendance?: number;
  sent: number;
  /** Envios bloqueados por EnvironmentGuard (staging/unknown). Não são falhas. */
  simulated?: number;
  skipped: Array<{ conversationId: string; rule: FollowupRule; reason: string }>;
  errors: string[];
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
  /** Envios bloqueados por EnvironmentGuard. Nenhuma reativação real. */
  simulated?: number;
  skipped: Array<{ leadId: string; reason: string }>;
}

export interface ManualFollowupResult {
  eligible: boolean;
  blockedReason?: string;
  rule?: string;
  generatedMessage?: string;
  /** Template: mensagem com a variável entre {{ }} — só para exibição. */
  generatedMessagePreview?: string | null;
  /** Nome do template usado (fora da janela 24h). */
  templateName?: string | null;
  /** Origem do {{1}} da retomada: "ai" | "context" | "generic". */
  resumePhraseSource?: string | null;
  sendStatus?: "sent" | "failed" | "blocked" | "simulated";
  sendError?: string;
  externalId?: string | null;
  /** True quando o EnvironmentGuard bloqueou o envio (staging/unknown). */
  simulated?: boolean;
  simulationId?: string | null;
  via?: "text" | "template";
  /** Tentativa do ciclo que este envio representou. */
  attempt?: number;
  /** Próxima tentativa agendada no ciclo (null se o ciclo encerrou). */
  nextFollowupAt?: string | null;
  /** Por que o ciclo encerrou com este envio, se encerrou. */
  cycleClosedReason?: string | null;
}
