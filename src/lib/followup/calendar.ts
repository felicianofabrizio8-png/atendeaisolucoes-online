// ============================================================================
// followup/calendar.ts
// Responsabilidade: calendário comercial da empresa — fuso, dias úteis,
// feriados nacionais e próximo horário útil. Puro (sem I/O).
//
// O servidor roda em UTC (Cloudflare Worker): toda comparação de horário
// comercial precisa ser feita no fuso da empresa, nunca com getHours().
// ============================================================================

export interface BusinessCalendar {
  timeZone: string;
  /** "HH:MM" ou "HH:MM:SS" no fuso da empresa. */
  start: string;
  end: string;
  /** ISO: 1 = segunda … 7 = domingo. */
  days: number[];
  /** false = qualquer dia/hora vale (a empresa desligou a restrição). */
  businessHoursOnly: boolean;
}

export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

/** Calendário a partir das configurações de follow-up da empresa. */
export function calendarFor(s: {
  timeZone: string;
  businessDays: number[];
  businessHoursStart: string;
  businessHoursEnd: string;
  businessHoursOnly: boolean;
}): BusinessCalendar {
  return {
    timeZone: s.timeZone,
    start: s.businessHoursStart,
    end: s.businessHoursEnd,
    days: s.businessDays,
    businessHoursOnly: s.businessHoursOnly,
  };
}

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // ISO 1-7
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function safeTimeZone(tz: string | null | undefined): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz ?? DEFAULT_TIME_ZONE });
    return tz ?? DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: WEEKDAY[get("weekday")] ?? 1,
  };
}

/** Horário de parede no fuso → instante UTC (resolve o offset iterativamente). */
export function zonedToUtc(
  wall: { year: number; month: number; day: number; hour?: number; minute?: number },
  timeZone: string,
): Date {
  const target = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour ?? 0, wall.minute ?? 0);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const diff = asUtc - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
function easter(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/**
 * Feriados nacionais (lei federal): fixos + Sexta-feira Santa. Pontos
 * facultativos (Carnaval, Corpus Christi) e feriados locais ficam de fora.
 */
export function isNationalHoliday(year: number, month: number, day: number): boolean {
  const fixed = ["1-1", "4-21", "5-1", "9-7", "10-12", "11-2", "11-15", "11-20", "12-25"];
  if (fixed.includes(`${month}-${day}`)) return true;
  const e = easter(year);
  const goodFriday = new Date(Date.UTC(year, e.month - 1, e.day - 2));
  return goodFriday.getUTCMonth() + 1 === month && goodFriday.getUTCDate() === day;
}

function isBusinessDay(
  p: Pick<ZonedParts, "year" | "month" | "day" | "weekday">,
  cal: BusinessCalendar,
) {
  return cal.days.includes(p.weekday) && !isNationalHoliday(p.year, p.month, p.day);
}

/** O instante está dentro do horário comercial da empresa? */
export function isBusinessTime(date: Date, cal: BusinessCalendar): boolean {
  if (!cal.businessHoursOnly) return true;
  const p = zonedParts(date, cal.timeZone);
  if (!isBusinessDay(p, cal)) return false;
  const mins = p.hour * 60 + p.minute;
  return mins >= minutesOf(cal.start) && mins < minutesOf(cal.end);
}

/** Meia-noite (no fuso da empresa) do dia do instante, em UTC. */
export function startOfZonedDay(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return zonedToUtc({ year: p.year, month: p.month, day: p.day }, timeZone);
}

/** Espalhamento determinístico em minutos (0..spread) — evita rajadas no mesmo horário. */
export function seededSpreadMinutes(seed: string, spread: number): number {
  if (spread <= 0) return 0;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % (spread + 1);
}

/**
 * Primeiro instante útil em ou depois de `from`. Com `spreadMinutes`, desloca
 * dentro do mesmo expediente sem ultrapassar o fim dele.
 */
export function nextBusinessSlot(from: Date, cal: BusinessCalendar, spreadMinutes = 0): Date {
  if (!cal.businessHoursOnly) return new Date(from.getTime() + spreadMinutes * 60_000);
  const startMin = minutesOf(cal.start);
  const endMin = minutesOf(cal.end);
  let cursor = from;
  for (let i = 0; i < 30; i++) {
    const p = zonedParts(cursor, cal.timeZone);
    const mins = p.hour * 60 + p.minute;
    if (isBusinessDay(p, cal) && mins < endMin) {
      const base =
        mins >= startMin
          ? cursor
          : zonedToUtc(
              { year: p.year, month: p.month, day: p.day, hour: 0, minute: startMin },
              cal.timeZone,
            );
      const room = Math.max(0, endMin - Math.max(mins, startMin) - 1);
      return new Date(base.getTime() + Math.min(spreadMinutes, room) * 60_000);
    }
    // Próximo dia, no início do expediente.
    const nextDay = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    cursor = zonedToUtc(
      {
        year: nextDay.getUTCFullYear(),
        month: nextDay.getUTCMonth() + 1,
        day: nextDay.getUTCDate(),
        hour: 0,
        minute: startMin,
      },
      cal.timeZone,
    );
  }
  return cursor;
}
