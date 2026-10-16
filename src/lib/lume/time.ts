import { safeTimeZone, zonedParts, zonedToUtc } from "@/lib/followup/calendar";

/**
 * A Lume conversa em horário local da empresa ("amanhã às 14h"); o banco guarda UTC.
 * O modelo sempre manda e recebe datas no formato local "2026-10-16T14:00".
 */

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/;

export function parseLocal(value: string, timeZone: string): Date | null {
  const match = LOCAL.exec(value.trim());
  if (!match) {
    // Aceita ISO com fuso explícito, se o modelo mandar.
    const parsed = new Date(value);
    return /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }
  const [, year, month, day, hour = "0", minute = "0"] = match;
  const wall = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31) return null;
  if (wall.hour > 23 || wall.minute > 59) return null;
  return zonedToUtc(wall, safeTimeZone(timeZone));
}

export function formatLocal(date: Date, timeZone: string): string {
  const p = zonedParts(date, safeTimeZone(timeZone));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Linha de contexto para o prompt: data, dia da semana e hora local. */
export function describeNow(now: Date, timeZone: string): string {
  const p = zonedParts(now, safeTimeZone(timeZone));
  return `${formatLocal(now, timeZone)} (${WEEKDAYS[p.weekday % 7]}), fuso ${safeTimeZone(timeZone)}`;
}

/** Fala humana para cartões: "qui 16/10 às 14:00". */
export function humanLocal(date: Date, timeZone: string): string {
  const p = zonedParts(date, safeTimeZone(timeZone));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${WEEKDAYS[p.weekday % 7].slice(0, 3)} ${pad(p.day)}/${pad(p.month)} às ${pad(p.hour)}:${pad(p.minute)}`;
}
