// ============================================================================
// followup/next-contact.ts
// Responsabilidade: decidir QUANDO será a próxima tentativa de um ciclo.
// Puro (sem I/O) — a sugestão da IA entra já validada por `next-contact-ai.ts`.
//
// Precedência:
//   1. prazo explícito do cliente ("me chama semana que vem", "sexta", "dia 15")
//   2. sugestão da IA a partir do contexto (validada deterministicamente)
//   3. política segura por motivo e tentativa
// O resultado sempre cai num horário útil da empresa (fuso, dias úteis,
// feriados), com espalhamento para não disparar tudo no mesmo minuto.
// ============================================================================

import {
  nextBusinessSlot,
  seededSpreadMinutes,
  zonedParts,
  zonedToUtc,
  type BusinessCalendar,
} from "./calendar";
import type { FollowupSettings } from "./types";

export type CycleReason = "quote_no_reply" | "visit_no_return" | "hot_lead_idle" | "lead_silent";
export type ScheduleSource = "client_deadline" | "ai_suggestion" | "policy" | "manual";

/** Orçamento/visita sem resposta valem por no máximo isto. */
export const REFERENCE_MAX_AGE_DAYS = 30;
/**
 * Nossa mensagem sem resposta abre ciclo automático só até esta idade.
 * Conversa parada há mais tempo é caso de reativação, não de follow-up —
 * sem isso a primeira execução mandaria "retomadas" para conversas mortas.
 */
export const MESSAGE_REFERENCE_MAX_AGE_DAYS = 7;
/** Prazo do cliente/IA além disto é tratado como sem prazo. */
export const DEADLINE_MAX_DAYS = 60;
export const MAX_ATTEMPTS_CAP = 5;

/**
 * Intervalos (horas) por tentativa, contados da referência (1ª) ou da
 * tentativa anterior. A 1ª usa o atraso configurado da empresa.
 */
const POLICY_HOURS: Record<CycleReason, number[]> = {
  hot_lead_idle: [4, 24, 72, 168, 240],
  quote_no_reply: [24, 72, 168, 240, 336],
  visit_no_return: [24, 72, 168, 240, 336],
  lead_silent: [48, 120, 240, 336, 480],
};

export function maxAttemptsFor(settings: Pick<FollowupSettings, "maxPerLead">): number {
  return Math.min(MAX_ATTEMPTS_CAP, Math.max(1, Math.floor(settings.maxPerLead || 1)));
}

export function delayHoursFor(
  reason: CycleReason,
  attemptsDone: number,
  settings: Pick<
    FollowupSettings,
    | "hotDelayHours"
    | "quoteDelayHours"
    | "visitDelayHours"
    | "silenceDelayHours"
    | "minHoursBetween"
  >,
): number {
  const table = POLICY_HOURS[reason];
  if (attemptsDone === 0) {
    const first = {
      hot_lead_idle: settings.hotDelayHours,
      quote_no_reply: settings.quoteDelayHours,
      visit_no_return: settings.visitDelayHours,
      lead_silent: settings.silenceDelayHours,
    }[reason];
    return first > 0 ? first : table[0];
  }
  const policy = table[Math.min(attemptsDone, table.length - 1)];
  return Math.max(policy, settings.minHoursBetween || 0);
}

// ---------------------------------------------------------------------------
// Prazo explícito do cliente
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");
}

const WEEKDAYS: Record<string, number> = {
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
  domingo: 7,
};
const NUMBERS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
};

function dayInZone(base: Date, tz: string, addDays: number): Date {
  const p = zonedParts(base, tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + addDays));
  return zonedToUtc(
    { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
    tz,
  );
}

/**
 * Data que o cliente pediu para ser procurado, a partir do texto dele e do
 * instante em que ele escreveu. `null` quando não há prazo explícito.
 * Devolve o início (00:00 no fuso) do dia pedido — o calendário ajusta a hora.
 */
export function parseClientDeadline(
  text: string,
  writtenAt: Date,
  timeZone: string,
): { date: Date; evidence: string } | null {
  const t = norm(text);
  const p = zonedParts(writtenAt, timeZone);
  const hit = (re: RegExp) => t.match(re);

  let m = hit(/\bdepois de amanha\b/);
  if (m) return { date: dayInZone(writtenAt, timeZone, 2), evidence: m[0] };
  m = hit(/\bamanha\b/);
  if (m) return { date: dayInZone(writtenAt, timeZone, 1), evidence: m[0] };

  m = hit(/\b(semana que vem|proxima semana)\b/);
  if (m) return { date: dayInZone(writtenAt, timeZone, 8 - p.weekday), evidence: m[0] };

  m = hit(/\b(mes que vem|proximo mes)\b/);
  if (m) {
    const d = new Date(Date.UTC(p.year, p.month, 1));
    return {
      date: zonedToUtc({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: 1 }, timeZone),
      evidence: m[0],
    };
  }

  m = hit(/\b(fim|final) do mes\b/);
  if (m) {
    const last = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
    return {
      date: zonedToUtc({ year: p.year, month: p.month, day: Math.max(p.day, last - 2) }, timeZone),
      evidence: m[0],
    };
  }

  m = hit(
    /\b(?:daqui a|daqui|em|dentro de) (\d{1,2}|um|uma|dois|duas|tres|quatro|cinco) (dias?|semanas?)\b/,
  );
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBERS[m[1]];
    const days = m[2].startsWith("semana") ? n * 7 : n;
    if (days > 0) return { date: dayInZone(writtenAt, timeZone, days), evidence: m[0] };
  }

  m = hit(
    /\b(?:na|nessa|essa|proxima|ate a|ate|pra|para|la pra|la para|a partir de|a partir da)\s+(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:\s*-?\s*feira)?\b/,
  );
  if (m) {
    const target = WEEKDAYS[m[1]];
    let add = (target - p.weekday + 7) % 7;
    if (add === 0) add = 7;
    return { date: dayInZone(writtenAt, timeZone, add), evidence: m[0] };
  }

  m = hit(/\b(no|ate o|depois do|a partir do|apos o) dia (\d{1,2})\b/);
  if (m) {
    let day = Number(m[2]);
    if (day >= 1 && day <= 31) {
      if (m[1] === "depois do" || m[1] === "apos o") day += 1;
      let month = p.month;
      let year = p.year;
      if (day <= p.day) {
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return {
        date: zonedToUtc({ year, month, day: Math.min(day, last) }, timeZone),
        evidence: m[0],
      };
    }
  }
  return null;
}

/** Texto do cliente menciona tempo mas sem forma que o parser resolva? */
export function hasTemporalHint(text: string): boolean {
  return /\b(semana|mes|dia|depois|feriado|ferias|salario|pagamento|receber|quinzena|ano que vem|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|prazo|mais pra frente|mais para frente|daqui)\b/.test(
    norm(text),
  );
}

/**
 * Valida uma sugestão de data (IA). Aceita só se: a evidência aparece de
 * verdade numa mensagem do cliente, a data é real e está entre hoje e o
 * horizonte máximo.
 */
export function validateSuggestedDate(
  suggestion: { date?: unknown; evidence?: unknown } | null,
  args: { now: Date; timeZone: string; leadTexts: string[] },
): Date | null {
  if (!suggestion || typeof suggestion.date !== "string" || typeof suggestion.evidence !== "string")
    return null;
  const evidence = norm(suggestion.evidence).trim();
  if (evidence.length < 3 || !args.leadTexts.some((t) => norm(t).includes(evidence))) return null;
  const m = suggestion.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) return null;
  const date = zonedToUtc({ year, month, day }, args.timeZone);
  const today = dayInZone(args.now, args.timeZone, 0);
  const horizon = dayInZone(args.now, args.timeZone, DEADLINE_MAX_DAYS);
  if (date < today || date > horizon) return null;
  return date;
}

// ---------------------------------------------------------------------------
// Próxima tentativa
// ---------------------------------------------------------------------------

export interface NextContactInput {
  reason: CycleReason;
  attemptsDone: number;
  /** Referência (1ª tentativa) ou instante da tentativa anterior. */
  anchor: Date;
  now: Date;
  settings: Pick<
    FollowupSettings,
    | "hotDelayHours"
    | "quoteDelayHours"
    | "visitDelayHours"
    | "silenceDelayHours"
    | "minHoursBetween"
  >;
  calendar: BusinessCalendar;
  jitterMinutes: number;
  seed: string;
  /** Só vale para a 1ª tentativa do ciclo. */
  deadline?: { date: Date; source: "client_deadline" | "ai_suggestion" } | null;
}

export function computeNextFollowupAt(input: NextContactInput): {
  at: Date;
  source: ScheduleSource;
} {
  const spread = seededSpreadMinutes(`${input.seed}:${input.attemptsDone}`, input.jitterMinutes);
  const horizon = input.now.getTime() + DEADLINE_MAX_DAYS * 24 * 3600_000;
  if (input.attemptsDone === 0 && input.deadline && input.deadline.date.getTime() <= horizon) {
    // Prazo que já passou (o cliente pediu "amanhã" e ninguém chamou) = agora.
    const target = new Date(Math.max(input.deadline.date.getTime(), input.now.getTime()));
    return { at: nextBusinessSlot(target, input.calendar, spread), source: input.deadline.source };
  }
  const hours = delayHoursFor(input.reason, input.attemptsDone, input.settings);
  const due = new Date(Math.max(input.anchor.getTime() + hours * 3600_000, input.now.getTime()));
  return { at: nextBusinessSlot(due, input.calendar, spread), source: "policy" };
}
