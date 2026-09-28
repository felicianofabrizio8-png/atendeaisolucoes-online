import { describe, expect, it } from "vitest";
import {
  isNationalHoliday,
  nextBusinessSlot,
  startOfZonedDay,
  zonedParts,
  type BusinessCalendar,
} from "../calendar";
import {
  computeNextFollowupAt,
  delayHoursFor,
  maxAttemptsFor,
  parseClientDeadline,
  validateSuggestedDate,
} from "../next-contact";

const TZ = "America/Sao_Paulo";
const CAL: BusinessCalendar = {
  timeZone: TZ,
  start: "09:00",
  end: "18:00",
  days: [1, 2, 3, 4, 5],
  businessHoursOnly: true,
};
/** Hora de Brasília (UTC-3) → instante. */
const brt = (y: number, mo: number, d: number, h = 0, m = 0) =>
  new Date(Date.UTC(y, mo - 1, d, h + 3, m));
const local = (d: Date) => {
  const p = zonedParts(d, TZ);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

const SETTINGS = {
  hotDelayHours: 4,
  quoteDelayHours: 24,
  visitDelayHours: 24,
  silenceDelayHours: 48,
  minHoursBetween: 24,
};

describe("calendário", () => {
  it("feriados nacionais fixos e Sexta-feira Santa", () => {
    expect(isNationalHoliday(2026, 12, 25)).toBe(true);
    expect(isNationalHoliday(2026, 11, 20)).toBe(true);
    expect(isNationalHoliday(2026, 4, 3)).toBe(true); // Páscoa 2026 = 05/04
    expect(isNationalHoliday(2027, 3, 26)).toBe(true); // Páscoa 2027 = 28/03
    expect(isNationalHoliday(2026, 4, 6)).toBe(false);
  });

  it("próximo horário útil: noite → dia seguinte 09:00; sexta à noite → segunda", () => {
    expect(local(nextBusinessSlot(brt(2026, 7, 15, 20), CAL))).toBe("2026-07-16 09:00");
    expect(local(nextBusinessSlot(brt(2026, 7, 17, 19), CAL))).toBe("2026-07-20 09:00");
    expect(local(nextBusinessSlot(brt(2026, 7, 15, 6), CAL))).toBe("2026-07-15 09:00");
    // já dentro do expediente: mantém
    expect(local(nextBusinessSlot(brt(2026, 7, 15, 11, 20), CAL))).toBe("2026-07-15 11:20");
    // pula feriado (07/09/2026 é segunda) e fim de semana
    expect(local(nextBusinessSlot(brt(2026, 9, 4, 19), CAL))).toBe("2026-09-08 09:00");
  });

  it("espalhamento não passa do fim do expediente", () => {
    const at = nextBusinessSlot(brt(2026, 7, 15, 17, 50), CAL, 35);
    expect(local(at) <= "2026-07-15 17:59").toBe(true);
  });

  it("início do dia no fuso da empresa", () => {
    expect(startOfZonedDay(new Date("2026-07-15T01:00:00Z"), TZ).toISOString()).toBe(
      "2026-07-14T03:00:00.000Z",
    );
  });
});

describe("prazo explícito do cliente", () => {
  const wed = brt(2026, 7, 15, 10); // quarta
  const day = (d: Date | undefined) => (d ? local(d).slice(0, 10) : null);

  it.each([
    ["Me chama amanhã", "2026-07-16"],
    ["pode me chamar depois de amanhã", "2026-07-17"],
    ["Semana que vem eu te respondo", "2026-07-20"],
    ["fala comigo na próxima semana", "2026-07-20"],
    ["mês que vem eu fecho", "2026-08-01"],
    ["na sexta te dou retorno", "2026-07-17"],
    ["só a partir de segunda-feira", "2026-07-20"],
    ["daqui a 3 dias", "2026-07-18"],
    ["em duas semanas", "2026-07-29"],
    ["depois do dia 20 eu vejo", "2026-07-21"],
    ["no dia 10", "2026-08-10"],
  ])("%s → %s", (text, expected) => {
    expect(day(parseClientDeadline(text, wed, TZ)?.date)).toBe(expected);
  });

  it("não inventa prazo", () => {
    expect(parseClientDeadline("a segunda opção é melhor", wed, TZ)).toBeNull();
    expect(parseClientDeadline("vou pensar e te falo", wed, TZ)).toBeNull();
    expect(parseClientDeadline("quanto custa?", wed, TZ)).toBeNull();
  });
});

describe("sugestão da IA — validação determinística", () => {
  const now = brt(2026, 7, 15, 10);
  const leadTexts = ["Assim que o salário cair eu te chamo, lá pelo dia 5"];

  it("aceita data real no horizonte com evidência literal do cliente", () => {
    const d = validateSuggestedDate(
      { date: "2026-08-05", evidence: "assim que o salário cair" },
      { now, timeZone: TZ, leadTexts },
    );
    expect(d && local(d)).toBe("2026-08-05 00:00");
  });

  it.each([
    [{ date: "2026-08-05", evidence: "ele disse que paga dia 5" }, "evidência inventada"],
    [{ date: "2026-02-30", evidence: "salário cair" }, "data inexistente"],
    [{ date: "2026-07-01", evidence: "salário cair" }, "no passado"],
    [{ date: "2026-12-31", evidence: "salário cair" }, "além do horizonte"],
    [{ date: "05/08/2026", evidence: "salário cair" }, "formato inválido"],
    [null, "sem sugestão"],
  ])("recusa %o (%s)", (suggestion: unknown, _why: string) => {
    expect(validateSuggestedDate(suggestion as never, { now, timeZone: TZ, leadTexts })).toBeNull();
  });
});

describe("política de próxima tentativa", () => {
  it("1ª tentativa usa o atraso configurado; as seguintes, a política por motivo", () => {
    expect(delayHoursFor("quote_no_reply", 0, SETTINGS)).toBe(24);
    expect(delayHoursFor("quote_no_reply", 1, SETTINGS)).toBe(72);
    expect(delayHoursFor("quote_no_reply", 2, SETTINGS)).toBe(168);
    expect(delayHoursFor("hot_lead_idle", 0, SETTINGS)).toBe(4);
    expect(delayHoursFor("hot_lead_idle", 1, SETTINGS)).toBe(24);
    expect(delayHoursFor("lead_silent", 0, SETTINGS)).toBe(48);
    expect(delayHoursFor("lead_silent", 1, SETTINGS)).toBe(120);
    // intervalo mínimo da empresa é piso a partir da 2ª
    expect(delayHoursFor("hot_lead_idle", 1, { ...SETTINGS, minHoursBetween: 48 })).toBe(48);
  });

  it("limite de tentativas é por negociação, entre 1 e 5", () => {
    expect(maxAttemptsFor({ maxPerLead: 3 })).toBe(3);
    expect(maxAttemptsFor({ maxPerLead: 10 })).toBe(5);
    expect(maxAttemptsFor({ maxPerLead: 0 })).toBe(1);
  });

  const base = {
    settings: SETTINGS,
    calendar: CAL,
    jitterMinutes: 0,
    seed: "quote:q1",
  };

  it("sem prazo: referência + atraso, ajustado ao horário útil", () => {
    // orçamento enviado quinta 17:00 → +24h = sexta 17:00 (dentro)
    const r = computeNextFollowupAt({
      ...base,
      reason: "quote_no_reply",
      attemptsDone: 0,
      anchor: brt(2026, 7, 16, 17),
      now: brt(2026, 7, 16, 18),
    });
    expect(r.source).toBe("policy");
    expect(local(r.at)).toBe("2026-07-17 17:00");
    // lead quente às 16:00 de sexta → +4h cai 20:00 → segunda 09:00
    const hot = computeNextFollowupAt({
      ...base,
      reason: "hot_lead_idle",
      attemptsDone: 0,
      anchor: brt(2026, 7, 17, 16),
      now: brt(2026, 7, 17, 17),
    });
    expect(local(hot.at)).toBe("2026-07-20 09:00");
  });

  it("prazo do cliente tem prioridade sobre a política", () => {
    const r = computeNextFollowupAt({
      ...base,
      reason: "quote_no_reply",
      attemptsDone: 0,
      anchor: brt(2026, 7, 15, 10),
      now: brt(2026, 7, 15, 11),
      deadline: { date: brt(2026, 7, 20), source: "client_deadline" },
    });
    expect(r).toMatchObject({ source: "client_deadline" });
    expect(local(r.at)).toBe("2026-07-20 09:00");
  });

  it("prazo que já passou = contato no próximo horário útil", () => {
    const r = computeNextFollowupAt({
      ...base,
      reason: "lead_silent",
      attemptsDone: 0,
      anchor: brt(2026, 7, 10, 10),
      now: brt(2026, 7, 15, 11),
      deadline: { date: brt(2026, 7, 13), source: "client_deadline" },
    });
    expect(local(r.at)).toBe("2026-07-15 11:00");
  });

  it("prazo só vale para a 1ª tentativa; depois, política", () => {
    const r = computeNextFollowupAt({
      ...base,
      reason: "quote_no_reply",
      attemptsDone: 1,
      anchor: brt(2026, 7, 20, 9),
      now: brt(2026, 7, 20, 9),
      deadline: { date: brt(2026, 8, 30), source: "client_deadline" },
    });
    expect(r.source).toBe("policy");
    expect(local(r.at)).toBe("2026-07-23 09:00"); // +72h
  });
});
