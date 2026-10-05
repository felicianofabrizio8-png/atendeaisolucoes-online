// Validade das respostas rápidas (informação com prazo: entrega, promoção, agenda).
// `valid_until` é o último dia em que a informação vale; sem data, não vence.

export type QuickReplyValidityState = "none" | "valid" | "expiring" | "expired";

export interface QuickReplyValidity {
  state: QuickReplyValidityState;
  /** Dias até o último dia de validade (0 = vence hoje; negativo = já venceu). */
  daysLeft: number | null;
}

/** A partir de quantos dias do vencimento a equipe é avisada. */
export const QUICK_REPLY_EXPIRING_DAYS = 3;
const DEFAULT_TIME_ZONE = "America/Sao_Paulo";
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Data de hoje (AAAA-MM-DD) no fuso informado. */
export function todayIsoDate(now: Date = new Date(), timeZone: string = DEFAULT_TIME_ZONE): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function dayNumber(isoDate: string): number | null {
  const match = ISO_DATE.exec(isoDate.trim());
  if (!match) return null;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000);
}

export function quickReplyValidity(
  validUntil: string | null | undefined,
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE,
): QuickReplyValidity {
  if (!validUntil) return { state: "none", daysLeft: null };
  const last = dayNumber(String(validUntil).slice(0, 10));
  const today = dayNumber(todayIsoDate(now, timeZone));
  // Data ilegível: trata como vencida, para a IA não usar informação de prazo duvidoso.
  if (last === null || today === null) return { state: "expired", daysLeft: null };
  const daysLeft = last - today;
  if (daysLeft < 0) return { state: "expired", daysLeft };
  return { state: daysLeft <= QUICK_REPLY_EXPIRING_DAYS ? "expiring" : "valid", daysLeft };
}

export function isQuickReplyExpired(validUntil: string | null | undefined, now: Date = new Date()): boolean {
  return quickReplyValidity(validUntil, now).state === "expired";
}

/** Texto curto do aviso para a equipe; null quando não há o que avisar. */
export function quickReplyValidityLabel(validity: QuickReplyValidity): string | null {
  if (validity.state === "expired") return "Vencida";
  if (validity.state !== "expiring") return null;
  if (validity.daysLeft === 0) return "Vence hoje";
  return validity.daysLeft === 1 ? "Vence amanhã" : `Vence em ${validity.daysLeft} dias`;
}
