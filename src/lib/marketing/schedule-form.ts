// Utilitários puros para o modal de agendamento do Marketing IA.
// - `parseLocalDateTime` valida e converte o valor do <input type="datetime-local">
//   (que não carrega fuso) para um `Date` interpretado no fuso local do usuário.
// - `validateScheduleForm` aplica as regras de negócio do modal (canal, mídia)
//   retornando erros estruturados para exibir toasts/destaques na UI.
//
// Mantido isolado da UI para permitir testes determinísticos.

export type ScheduleChannel = "instagram" | "facebook" | "whatsapp";

export interface ParseDateResult {
  ok: boolean;
  date?: Date;
  iso?: string;
  reason?: "empty" | "invalid_format" | "invalid_date";
}

// Aceita "YYYY-MM-DDTHH:mm" ou "YYYY-MM-DDTHH:mm:ss" (com segundos opcionais).
const LOCAL_DT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Converte o valor bruto de um <input type="datetime-local"> em um Date real
 * no fuso local do usuário (o input NÃO carrega timezone).
 *
 * Não usar `new Date(str)` direto: apesar da spec do ES2016 tratar
 * "YYYY-MM-DDTHH:mm" como horário local, comportamentos antigos e
 * strings parciais podem produzir NaN silencioso. Fazemos parsing manual
 * e construímos com `new Date(y, m-1, d, h, min, s)` — construtor local.
 */
export function parseLocalDateTime(raw: string | null | undefined): ParseDateResult {
  const value = (raw ?? "").trim();
  if (!value) return { ok: false, reason: "empty" };
  const m = LOCAL_DT_RE.exec(value);
  if (!m) return { ok: false, reason: "invalid_format" };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = m[6] ? Number(m[6]) : 0;
  if (mo < 1 || mo > 12) return { ok: false, reason: "invalid_date" };
  if (d < 1 || d > 31) return { ok: false, reason: "invalid_date" };
  if (h > 23) return { ok: false, reason: "invalid_date" };
  if (mi > 59) return { ok: false, reason: "invalid_date" };
  if (s > 59) return { ok: false, reason: "invalid_date" };
  const date = new Date(y, mo - 1, d, h, mi, s, 0);
  // Roundtrip: rejeita datas normalizadas pelo JS (ex.: 31/02 vira 03/03).
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== mi
  ) {
    return { ok: false, reason: "invalid_date" };
  }
  if (Number.isNaN(date.getTime())) return { ok: false, reason: "invalid_date" };
  return { ok: true, date, iso: date.toISOString() };
}

export type ScheduleValidationError =
  | { field: "scheduleFor"; message: string }
  | { field: "scheduleAt"; message: string; reason: "empty" | "invalid_format" | "invalid_date" }
  | { field: "media"; message: string };

export interface ScheduleValidationInput {
  scheduleFor: string | null;
  scheduleAt: string;
  channel: ScheduleChannel;
  mediaCount: number;
}

export interface ScheduleValidationOk {
  ok: true;
  iso: string;
  scheduleFor: string;
  channel: ScheduleChannel;
}

export interface ScheduleValidationFail {
  ok: false;
  errors: ScheduleValidationError[];
}

export function validateScheduleForm(
  input: ScheduleValidationInput,
): ScheduleValidationOk | ScheduleValidationFail {
  const errors: ScheduleValidationError[] = [];
  if (!input.scheduleFor) {
    errors.push({ field: "scheduleFor", message: "Selecione um conteúdo para agendar." });
  }
  const parsed = parseLocalDateTime(input.scheduleAt);
  if (!parsed.ok) {
    errors.push({
      field: "scheduleAt",
      reason: parsed.reason ?? "invalid_date",
      message: "Selecione uma data e hora válidas para agendar.",
    });
  }
  if (input.channel === "instagram" && input.mediaCount === 0) {
    errors.push({
      field: "media",
      message: "Selecione ao menos uma imagem ou vídeo antes de agendar para o Instagram.",
    });
  }
  if (errors.length > 0 || !parsed.ok || !input.scheduleFor) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    iso: parsed.iso!,
    scheduleFor: input.scheduleFor,
    channel: input.channel,
  };
}
