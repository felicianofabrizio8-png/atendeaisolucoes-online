import {
  addDays,
  addMinutes,
  addMonths,
  addWeeks,
  differenceInMinutes,
  endOfDay,
  endOfMonth,
  endOfWeek,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";

/**
 * Núcleo da Agenda: tipos, rótulos e cálculos de visão. Sem React e sem Supabase,
 * para a tela, a IA Lume e os testes usarem as mesmas regras.
 */

export type VisitStatus =
  | "agendada"
  | "confirmada"
  | "em_andamento"
  | "concluida"
  | "remarcada"
  | "cancelada";

export type AppointmentType =
  | "visita_tecnica"
  | "loja"
  | "retorno_comercial"
  | "pos_venda"
  | "instalacao"
  | "manutencao";

/** Linha da tabela `visits` — a fonte da Agenda, também lida por follow-up e recuperação. */
export interface AgendaEvent {
  id: string;
  title: string;
  address: string | null;
  scheduled_at: string;
  status: VisitStatus;
  notes: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  product: string | null;
  lead_id: string | null;
  quote_id: string | null;
  appointment_type: AppointmentType;
  city: string | null;
  salesperson: string | null;
  technician: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export const AGENDA_SELECT =
  "id,title,address,scheduled_at,status,notes,customer_name,customer_phone,product,lead_id,quote_id,appointment_type,city,salesperson,technician,created_at,updated_at";

export const STATUS_LABEL: Record<VisitStatus, string> = {
  agendada: "Agendado",
  confirmada: "Confirmado",
  em_andamento: "Em andamento",
  concluida: "Finalizado",
  remarcada: "Reagendar",
  cancelada: "Cancelado",
};

export const STATUS_KEYS = Object.keys(STATUS_LABEL) as VisitStatus[];

/** Compromissos que ainda pedem ação de alguém. */
export const OPEN_STATUSES: ReadonlySet<VisitStatus> = new Set([
  "agendada",
  "confirmada",
  "em_andamento",
  "remarcada",
]);

export const TYPE_LABEL: Record<AppointmentType, { label: string; short: string }> = {
  visita_tecnica: { label: "Visita técnica", short: "Visita" },
  loja: { label: "Cliente vem na loja", short: "Na loja" },
  retorno_comercial: { label: "Retorno comercial", short: "Retorno" },
  pos_venda: { label: "Pós-venda", short: "Pós-venda" },
  instalacao: { label: "Instalação", short: "Instalação" },
  manutencao: { label: "Manutenção", short: "Manutenção" },
};

export const TYPE_KEYS = Object.keys(TYPE_LABEL) as AppointmentType[];

/** Matiz de cada tipo na luz da Agenda (OKLCH h). */
export const TYPE_HUE: Record<AppointmentType, number> = {
  visita_tecnica: 300,
  loja: 230,
  retorno_comercial: 275,
  pos_venda: 170,
  instalacao: 135,
  manutencao: 345,
};

export type AgendaView = "dia" | "semana" | "mes" | "linha" | "lista";

export const VIEW_LABEL: Record<AgendaView, string> = {
  dia: "Dia",
  semana: "Semana",
  mes: "Mês",
  linha: "Linha do tempo",
  lista: "Lista",
};

/** `visits` não guarda fim: a duração vem do tipo até existir duração própria. */
export const DEFAULT_DURATION_MIN = 60;

export function eventStart(event: Pick<AgendaEvent, "scheduled_at">): Date {
  return new Date(event.scheduled_at);
}

export function eventEnd(event: Pick<AgendaEvent, "scheduled_at">): Date {
  return addMinutes(eventStart(event), DEFAULT_DURATION_MIN);
}

const WEEK = { weekStartsOn: 1 as const };

/** Intervalo carregado e exibido por visão, a partir da data em foco. */
export function viewRange(view: AgendaView, focus: Date): { from: Date; to: Date } {
  switch (view) {
    case "dia":
      return { from: startOfDay(focus), to: endOfDay(focus) };
    case "semana":
    case "linha":
      return { from: startOfWeek(focus, WEEK), to: endOfWeek(focus, WEEK) };
    case "mes":
      // A grade do mês mostra semanas inteiras, inclusive dias dos meses vizinhos.
      return {
        from: startOfWeek(startOfMonth(focus), WEEK),
        to: endOfWeek(endOfMonth(focus), WEEK),
      };
    case "lista":
      return { from: startOfDay(focus), to: endOfDay(addDays(focus, 29)) };
  }
}

export function shiftFocus(view: AgendaView, focus: Date, direction: 1 | -1): Date {
  switch (view) {
    case "dia":
      return addDays(focus, direction);
    case "semana":
    case "linha":
      return addWeeks(focus, direction);
    case "mes":
      return addMonths(focus, direction);
    case "lista":
      return addDays(focus, 30 * direction);
  }
}

export function daysOf(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  for (let day = startOfDay(from); day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

export function eventsOnDay<T extends Pick<AgendaEvent, "scheduled_at">>(
  events: readonly T[],
  day: Date,
): T[] {
  return events
    .filter((event) => isSameDay(eventStart(event), day))
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
}

export interface PlacedEvent<T> {
  event: T;
  /** Minutos desde 00:00 do dia. */
  top: number;
  height: number;
  /** Coluna dentro do grupo de eventos sobrepostos, e quantas colunas o grupo tem. */
  column: number;
  columns: number;
}

/**
 * Posiciona os eventos de um dia na grade de horas. Eventos que se sobrepõem dividem
 * a largura, como numa agenda de papel; os demais ocupam a coluna inteira.
 */
export function layoutDay<T extends Pick<AgendaEvent, "id" | "scheduled_at">>(
  events: readonly T[],
  day: Date,
): PlacedEvent<T>[] {
  const dayStart = startOfDay(day);
  const sorted = eventsOnDay(events, day);
  const placed: PlacedEvent<T>[] = [];
  let group: PlacedEvent<T>[] = [];
  let groupEnd = -1;
  const columnEnds: number[] = [];

  const closeGroup = () => {
    const columns = Math.max(1, ...group.map((item) => item.column + 1));
    for (const item of group) item.columns = columns;
    placed.push(...group);
    group = [];
    columnEnds.length = 0;
  };

  for (const event of sorted) {
    const top = differenceInMinutes(eventStart(event), dayStart);
    const height = Math.min(DEFAULT_DURATION_MIN, 24 * 60 - top);
    const end = top + height;
    if (group.length && top >= groupEnd) closeGroup();
    let column = columnEnds.findIndex((columnEnd) => columnEnd <= top);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = end;
    group.push({ event, top, height, column, columns: 1 });
    groupEnd = Math.max(groupEnd, end);
  }
  if (group.length) closeGroup();
  return placed;
}

/** Pares de compromissos da mesma pessoa no mesmo horário. */
export function findConflicts<T extends AgendaEvent>(events: readonly T[]): Set<string> {
  const conflicts = new Set<string>();
  const active = events.filter((event) => event.status !== "cancelada");
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];
      const people = [a.technician, a.salesperson].filter(Boolean);
      const shared = [b.technician, b.salesperson].some(
        (person) => person && people.includes(person),
      );
      if (!shared) continue;
      if (eventStart(a) < eventEnd(b) && eventStart(b) < eventEnd(a)) {
        conflicts.add(a.id);
        conflicts.add(b.id);
      }
    }
  }
  return conflicts;
}

export interface AgendaFilters {
  search: string;
  types: AppointmentType[];
  statuses: VisitStatus[];
  person: string | null;
}

export const EMPTY_FILTERS: AgendaFilters = { search: "", types: [], statuses: [], person: null };

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function applyFilters<T extends AgendaEvent>(
  events: readonly T[],
  filters: AgendaFilters,
): T[] {
  const query = normalize(filters.search.trim());
  return events.filter((event) => {
    if (filters.types.length && !filters.types.includes(event.appointment_type)) return false;
    if (filters.statuses.length && !filters.statuses.includes(event.status)) return false;
    if (
      filters.person &&
      event.technician !== filters.person &&
      event.salesperson !== filters.person
    )
      return false;
    if (!query) return true;
    return normalize(
      [event.title, event.customer_name, event.city, event.address, event.product, event.notes]
        .filter(Boolean)
        .join(" "),
    ).includes(query);
  });
}

/** Pessoas citadas nos compromissos, para o filtro "Equipe". */
export function peopleOf(events: readonly AgendaEvent[]): string[] {
  const names = new Set<string>();
  for (const event of events) {
    if (event.technician?.trim()) names.add(event.technician.trim());
    if (event.salesperson?.trim()) names.add(event.salesperson.trim());
  }
  return [...names].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export interface AgendaPulse {
  today: number;
  week: number;
  open: number;
  done: number;
  next: AgendaEvent | null;
}

export function pulseOf(events: readonly AgendaEvent[], now = new Date()): AgendaPulse {
  const week = { from: startOfWeek(now, WEEK), to: endOfWeek(now, WEEK) };
  const upcoming = events
    .filter((event) => OPEN_STATUSES.has(event.status) && eventEnd(event) > now)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  return {
    today: events.filter(
      (event) => isSameDay(eventStart(event), now) && event.status !== "cancelada",
    ).length,
    week: events.filter((event) => {
      const start = eventStart(event);
      return start >= week.from && start <= week.to && event.status !== "cancelada";
    }).length,
    open: events.filter((event) => OPEN_STATUSES.has(event.status)).length,
    done: events.filter((event) => event.status === "concluida").length,
    next: upcoming[0] ?? null,
  };
}
