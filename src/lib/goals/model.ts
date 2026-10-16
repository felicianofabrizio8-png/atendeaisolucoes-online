// src/lib/goals/model.ts
/**
 * Metas — regras puras. Tela e rotina diária usam este módulo, então o
 * "esperado até hoje", as semanas e o selo têm uma única definição.
 * Datas sempre como "YYYY-MM-DD" no fuso America/Sao_Paulo.
 */

export type GoalMetric =
  | "receita_fechada"
  | "vendas_fechadas"
  | "leads_novos"
  | "taxa_conversao"
  | "orcamentos_criados"
  | "orcamentos_enviados"
  | "conversas_respondidas"
  | "tempo_primeira_resposta"
  | "compromissos_concluidos";
export type GoalMeasure = "automatica" | "manual";
export type GoalScope = "empresa" | "pessoa" | "grupo";
export type GoalRecurrence = "semanal" | "mensal" | null;
export type GoalStatus = "concluida" | "no_ritmo" | "em_risco" | "atrasada" | "sem_dados" | "encerrada";

export interface MetricInfo {
  label: string;
  kind: "brl" | "count" | "pct" | "min";
  lowerIsBetter: boolean;
  /** Depende da migração da Agenda (visits.owner_id). */
  needsAgenda: boolean;
}

export const METRICS: Record<GoalMetric, MetricInfo> = {
  receita_fechada: { label: "Receita fechada", kind: "brl", lowerIsBetter: false, needsAgenda: false },
  vendas_fechadas: { label: "Vendas fechadas", kind: "count", lowerIsBetter: false, needsAgenda: false },
  leads_novos: { label: "Leads novos", kind: "count", lowerIsBetter: false, needsAgenda: false },
  taxa_conversao: { label: "Taxa de conversão", kind: "pct", lowerIsBetter: false, needsAgenda: false },
  orcamentos_criados: { label: "Orçamentos criados", kind: "count", lowerIsBetter: false, needsAgenda: false },
  orcamentos_enviados: { label: "Orçamentos enviados", kind: "count", lowerIsBetter: false, needsAgenda: false },
  conversas_respondidas: { label: "Conversas respondidas", kind: "count", lowerIsBetter: false, needsAgenda: false },
  tempo_primeira_resposta: { label: "Tempo médio de 1ª resposta", kind: "min", lowerIsBetter: true, needsAgenda: false },
  compromissos_concluidos: { label: "Compromissos concluídos", kind: "count", lowerIsBetter: false, needsAgenda: true },
};

export const STATUS_LABEL: Record<GoalStatus, string> = {
  concluida: "Concluída",
  no_ritmo: "No ritmo",
  em_risco: "Em risco",
  atrasada: "Atrasada",
  sem_dados: "Sem dados",
  encerrada: "Encerrada",
};

export interface Goal {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  hue: number;
  measure: GoalMeasure;
  metric: GoalMetric | null;
  target: number;
  unit: string | null;
  lowerIsBetter: boolean;
  scope: GoalScope;
  startsOn: string;
  endsOn: string | null;
  recurrence: GoalRecurrence;
  stageId: string | null;
  archivedAt: string | null;
  memberIds: string[];
}

export interface GoalPeriod {
  startsOn: string;
  endsOn: string;
}

export interface GoalWeekRaw {
  startsOn: string;
  endsOn: string;
  /** null = semana ainda não começou. */
  actual: number | null;
}

export interface GoalWeek extends GoalWeekRaw {
  expected: number;
  status: GoalStatus | null;
}

export interface GoalProgressRaw {
  goalId: string;
  periodId: string;
  periodStart: string;
  periodEnd: string;
  value: number | null;
  weeks: GoalWeekRaw[];
  contributions: Array<{ userId: string; value: number }>;
}

export interface GoalProgress extends GoalProgressRaw {
  expected: number;
  status: GoalStatus;
  /** 0–100, sobre o alvo (invertido para "menor é melhor"). */
  pct: number;
}

export interface GoalDraft {
  name: string;
  description: string;
  hue: number;
  measure: GoalMeasure;
  metric: GoalMetric | null;
  target: number;
  unit: string;
  scope: GoalScope;
  memberIds: string[];
  deadline: "unico" | "recorrente";
  startsOn: string;
  endsOn: string;
  recurrence: "semanal" | "mensal";
  stageId: string | null;
}

const DAY = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromTime = (time: number) => new Date(time).toISOString().slice(0, 10);

export function daysBetween(a: string, b: string): number {
  return Math.round((toTime(b) - toTime(a)) / DAY) + 1;
}

export function todayInSaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function expectedToDate(
  target: number,
  period: GoalPeriod,
  today: string,
  lowerIsBetter: boolean,
): number {
  if (lowerIsBetter) return target;
  if (today < period.startsOn) return 0;
  if (today >= period.endsOn) return target;
  const elapsed = daysBetween(period.startsOn, today);
  const total = daysBetween(period.startsOn, period.endsOn);
  return Math.round(((target * elapsed) / total) * 100) / 100;
}

export function goalStatus(input: {
  value: number | null;
  expected: number;
  target: number;
  lowerIsBetter: boolean;
  period: GoalPeriod;
  today: string;
}): GoalStatus {
  const { value, expected, target, lowerIsBetter, period, today } = input;
  const ended = today > period.endsOn;
  const hasData = value !== null && (lowerIsBetter || value > 0);
  if (!hasData) {
    if (lowerIsBetter) return "sem_dados";
    const third = daysBetween(period.startsOn, period.endsOn) / 3;
    if (!ended && daysBetween(period.startsOn, today) <= third) return "sem_dados";
    return ended ? "encerrada" : "atrasada";
  }
  const v = value as number;
  if (lowerIsBetter) {
    if (ended) return v <= target ? "concluida" : "encerrada";
    if (v <= target) return "no_ritmo";
    if (v <= target / 0.7 && v <= target * 1.3) return "em_risco";
    return "atrasada";
  }
  if (v >= target) return "concluida";
  if (ended) return "encerrada";
  if (expected <= 0) return "no_ritmo";
  const ratio = v / expected;
  if (ratio >= 0.9) return "no_ritmo";
  if (ratio >= 0.7) return "em_risco";
  return "atrasada";
}

export function splitWeeks(period: GoalPeriod, target: number, lowerIsBetter: boolean) {
  const total = daysBetween(period.startsOn, period.endsOn);
  const weeks: Array<{ startsOn: string; endsOn: string; expected: number }> = [];
  let cursor = toTime(period.startsOn);
  const end = toTime(period.endsOn);
  while (cursor <= end) {
    const weekday = (new Date(cursor).getUTCDay() + 6) % 7; // 0 = segunda
    const weekEnd = Math.min(cursor + (6 - weekday) * DAY, end);
    const days = Math.round((weekEnd - cursor) / DAY) + 1;
    weeks.push({
      startsOn: fromTime(cursor),
      endsOn: fromTime(weekEnd),
      expected: lowerIsBetter ? target : Math.round(((target * days) / total) * 100) / 100,
    });
    cursor = weekEnd + DAY;
  }
  return weeks;
}

export function buildProgress(goal: Goal, raw: GoalProgressRaw, today: string): GoalProgress {
  const period = { startsOn: raw.periodStart, endsOn: raw.periodEnd };
  const expected = expectedToDate(goal.target, period, today, goal.lowerIsBetter);
  const status = goalStatus({ value: raw.value, expected, target: goal.target, lowerIsBetter: goal.lowerIsBetter, period, today });
  const planned = splitWeeks(period, goal.target, goal.lowerIsBetter);
  const weeks: GoalWeek[] = planned.map((week) => {
    const actual = raw.weeks.find((w) => w.startsOn === week.startsOn)?.actual ?? null;
    const weekPeriod = { startsOn: week.startsOn, endsOn: week.endsOn };
    return {
      ...week,
      actual,
      status:
        actual === null
          ? null
          : goalStatus({
              value: actual,
              expected: expectedToDate(week.expected, weekPeriod, today, goal.lowerIsBetter),
              target: week.expected,
              lowerIsBetter: goal.lowerIsBetter,
              period: weekPeriod,
              today,
            }),
    };
  });
  const value = raw.value ?? 0;
  const pct = goal.lowerIsBetter
    ? raw.value === null
      ? 0
      : Math.min(100, (goal.target / Math.max(value, 0.0001)) * 100)
    : Math.min(100, (value / goal.target) * 100);
  return { ...raw, expected, status, pct: Math.round(pct * 100) / 100, weeks };
}

export function validateGoalDraft(draft: GoalDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("Dê um nome para a meta.");
  if (draft.name.trim().length > 120) errors.push("O nome pode ter até 120 caracteres.");
  if (!(draft.target > 0)) errors.push("O alvo precisa ser maior que zero.");
  if (draft.measure === "automatica" && !draft.metric) errors.push("Escolha o que o sistema vai medir.");
  if (draft.measure === "manual" && !draft.unit.trim()) errors.push("Diga a unidade (ex.: visitas).");
  if (draft.measure === "manual" && draft.unit.trim().length > 24) errors.push("A unidade pode ter até 24 caracteres.");
  if (draft.scope === "pessoa" && draft.memberIds.length !== 1) errors.push("Escolha a pessoa da meta.");
  if (draft.scope === "grupo" && draft.memberIds.length < 2) errors.push("Um grupo precisa de pelo menos 2 pessoas.");
  if (!draft.startsOn) errors.push("Escolha a data de início.");
  if (draft.deadline === "unico") {
    if (!draft.endsOn) errors.push("Escolha a data de fim.");
    else if (draft.endsOn < draft.startsOn) errors.push("A data de fim precisa ser depois do início.");
  }
  return errors;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function formatGoalValue(
  value: number | null,
  goal: Pick<Goal, "measure" | "metric" | "unit">,
): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (goal.measure === "manual") return `${dec.format(value)} ${goal.unit ?? ""}`.trim();
  const kind = goal.metric ? METRICS[goal.metric].kind : "count";
  if (kind === "brl") return brl.format(value).replace(/ /g, " ");
  if (kind === "pct") return `${dec.format(value)}%`;
  if (kind === "min") return `${dec.format(value)} min`;
  return dec.format(value);
}
