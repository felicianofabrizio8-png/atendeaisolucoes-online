// ============================================================================
// RECOVERY DATASET (Fase 6.4) — puro.
//
// Converte tentativas concluídas em linhas de dataset anonimizadas. Uma linha
// = uma tentativa cujo desfecho já é observável. Tentativas em andamento
// (draft/confirmed/sending) não entram: aprender com resultado inexistente é
// a forma mais rápida de aprender errado.
// ============================================================================

import type {
  InsistenceLevel,
  LearningOutcome,
  MessageLengthBucket,
  RecoveryDataset,
  RecoveryDatasetRow,
  RecoveryLearningEvent,
} from "./types";
import { fingerprint } from "./stats";

/** Entrada bruta vinda de `recovery_attempts` (já filtrada por empresa/RLS). */
export interface AttemptLike {
  id: string;
  company_id: string;
  lead_id: string;
  conversation_id: string;
  status: string;
  recovery_score: number | null;
  recovery_chance: number | null;
  recovery_tier: string | null;
  strategy_fingerprint: string | null;
  selected_message_style: string | null;
  selected_message_text: string | null;
  template_id: string | null;
  template_name: string | null;
  window_state: string | null;
  initiated_by: string | null;
  sent_at: string | null;
  replied_at: string | null;
  response_status: string | null;
  outcome: string | null;
  outcome_at: string | null;
  created_at: string;
  /** Metadados de contexto anexados pela camada de leitura (sem PII). */
  product?: string | null;
  source?: string | null;
  channel?: string | null;
  estimated_value?: number | null;
  stalled_hours?: number | null;
  tone?: string | null;
  edited?: boolean | null;
  attempt_index?: number | null;
}

const TERMINAL_OBSERVABLE = new Set([
  "sent",
  "delivered",
  "read",
  "replied",
  "recovered",
  "not_recovered",
  "failed",
]);

export function isObservable(status: string): boolean {
  return TERMINAL_OBSERVABLE.has(status);
}

export function lengthBucket(text: string | null | undefined): MessageLengthBucket | null {
  if (!text) return null;
  const n = text.trim().length;
  if (n <= 120) return "curta";
  if (n <= 300) return "media";
  return "longa";
}

export function insistenceOf(index: number | null | undefined): InsistenceLevel {
  const n = Number(index ?? 1);
  if (n <= 1) return "primeira";
  if (n === 2) return "segunda";
  return "terceira_ou_mais";
}

export function outcomeOf(attempt: AttemptLike): LearningOutcome {
  if (attempt.status === "failed") return "failed";
  if (attempt.outcome === "recovered") return "recovered";
  if (attempt.outcome === "not_recovered") return "not_recovered";
  if (attempt.status === "replied" || attempt.response_status === "replied") {
    return "not_recovered";
  }
  return "no_reply";
}

function diffMs(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return b - a;
}

/**
 * Converte uma tentativa em evento de aprendizado.
 *
 * O texto da mensagem NUNCA é copiado: vira fingerprint + faixa de tamanho.
 */
export function toLearningEvent(attempt: AttemptLike): RecoveryLearningEvent | null {
  if (!isObservable(attempt.status)) return null;

  const at = attempt.sent_at ?? attempt.created_at;
  const when = new Date(at);
  const outcome = outcomeOf(attempt);
  const responded =
    outcome === "recovered" ||
    attempt.status === "replied" ||
    attempt.response_status === "replied" ||
    Boolean(attempt.replied_at);

  return {
    attemptId: attempt.id,
    companyId: attempt.company_id,
    leadId: attempt.lead_id,
    conversationId: attempt.conversation_id,
    product: attempt.product ?? null,
    source: attempt.source ?? null,
    channel: attempt.channel ?? "whatsapp",
    score: attempt.recovery_score ?? null,
    chance: attempt.recovery_chance ?? null,
    tier: attempt.recovery_tier ?? null,
    hourOfDay: Number.isFinite(when.getTime()) ? when.getUTCHours() : 0,
    dayOfWeek: Number.isFinite(when.getTime()) ? when.getUTCDay() : 0,
    stalledHours: attempt.stalled_hours ?? null,
    windowOpen: attempt.window_state === "open" || attempt.window_state === "closing_soon",
    templateId: attempt.template_id ?? null,
    templateName: attempt.template_name ?? null,
    messageFingerprint: attempt.selected_message_text
      ? fingerprint(attempt.selected_message_text.trim().toLowerCase())
      : null,
    messageLengthBucket: lengthBucket(attempt.selected_message_text),
    messageKind: attempt.template_id ? "template" : "livre",
    edited: Boolean(attempt.edited),
    tone: attempt.tone ?? attempt.selected_message_style ?? null,
    strategy: attempt.strategy_fingerprint ?? null,
    insistence: insistenceOf(attempt.attempt_index),
    sellerId: attempt.initiated_by ?? null,
    outcome,
    responded,
    recovered: outcome === "recovered",
    timeToReplyMs: diffMs(attempt.sent_at, attempt.replied_at),
    timeToRecoveryMs:
      attempt.outcome === "recovered" ? diffMs(attempt.sent_at, attempt.outcome_at) : null,
    estimatedValue: attempt.estimated_value ?? null,
    createdAt: attempt.created_at,
  };
}

export function scoreBandOf(score: number | null): string {
  if (score === null || !Number.isFinite(score)) return "sem_score";
  const floor = Math.max(0, Math.min(90, Math.floor(score / 10) * 10));
  return `${floor}-${floor + 9}`;
}

export function stalledBandOf(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "desconhecido";
  if (hours < 24) return "ate_24h";
  if (hours < 72) return "1_3_dias";
  if (hours < 168) return "3_7_dias";
  return "mais_7_dias";
}

export function hourBandOf(hour: number): string {
  if (hour < 6) return "madrugada";
  if (hour < 12) return "manha";
  if (hour < 18) return "tarde";
  return "noite";
}

export function valueBandOf(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "sem_valor";
  if (value < 1000) return "ate_1k";
  if (value < 5000) return "1k_5k";
  if (value < 20000) return "5k_20k";
  return "acima_20k";
}

export function toDatasetRow(event: RecoveryLearningEvent): RecoveryDatasetRow {
  return {
    ...event,
    scoreBand: scoreBandOf(event.score),
    stalledBand: stalledBandOf(event.stalledHours),
    hourBand: hourBandOf(event.hourOfDay),
    valueBand: valueBandOf(event.estimatedValue),
  };
}

export function buildDataset(events: RecoveryLearningEvent[]): RecoveryDataset {
  const rows = events.map(toDatasetRow).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const total = rows.length;
  const responded = rows.filter((r) => r.responded).length;
  const recovered = rows.filter((r) => r.recovered).length;

  return {
    rows,
    from: rows[0]?.createdAt ?? null,
    to: rows[rows.length - 1]?.createdAt ?? null,
    total,
    responded,
    recovered,
    baseRecoveryRate: total > 0 ? recovered / total : 0,
    baseReplyRate: total > 0 ? responded / total : 0,
  };
}

/** Dataset a partir de linhas cruas — atalho usado pela camada de leitura. */
export function buildDatasetFromAttempts(attempts: AttemptLike[]): RecoveryDataset {
  const events: RecoveryLearningEvent[] = [];
  for (const a of attempts) {
    const e = toLearningEvent(a);
    if (e) events.push(e);
  }
  return buildDataset(events);
}
