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
  // Campos da Agenda Lume (migração 20261015120000); ausentes antes de publicar.
  created_by?: string | null;
  updated_by?: string | null;
  ends_at?: string | null;
  all_day?: boolean;
  event_type_id?: string | null;
  recurrence_rule?: string | null;
  custom_fields?: Record<string, unknown>;
  source?: EventSource;
  /** Calculado na tela: cor do tipo da empresa, quando o evento tem um. */
  type_hue?: number;
  type_name?: string;
  // Hierarquia (migração 20261016120000): dono, alcance, toda a equipe, tags e participantes.
  owner_id?: string | null;
  scope?: EventScope;
  everyone?: boolean;
  tag_ids?: string[];
  participant_ids?: string[];
}

export type EventSource = "tela" | "lume" | "atendimento" | "google" | "sistema";

export const SOURCE_LABEL: Record<EventSource, string> = {
  tela: "pela Agenda",
  lume: "pela Lume",
  atendimento: "pelo Atendimento",
  google: "pelo Google Agenda",
  sistema: "pelo sistema",
};

export const AGENDA_SELECT =
  "id,title,address,scheduled_at,status,notes,customer_name,customer_phone,product,lead_id,quote_id,appointment_type,city,salesperson,technician,created_at,updated_at";

export const AGENDA_SELECT_EXTENDED = `${AGENDA_SELECT},created_by,updated_by,ends_at,all_day,event_type_id,recurrence_rule,custom_fields,source`;

export const AGENDA_SELECT_HIERARCHY = `${AGENDA_SELECT_EXTENDED},owner_id,scope,everyone,agenda_event_tags(tag_id),agenda_event_participants(user_id)`;

export type EventScope = "pessoal" | "equipe";

/** Tag da empresa (owner_id vazio) ou pessoal (só a dona vê). */
export interface AgendaTag {
  id: string;
  name: string;
  hue: number;
  owner_id: string | null;
}

export type ScopeFilter =
  | { kind: "minha" }
  | { kind: "equipe" }
  | { kind: "pessoa"; userId: string };

/** Minha agenda: os meus, os de equipe em que participo e os de toda a equipe. */
export function matchesScope(event: AgendaEvent, filter: ScopeFilter, me: string): boolean {
  const involves = (user: string) =>
    event.owner_id === user || (event.participant_ids ?? []).includes(user);
  if (filter.kind === "equipe") return true;
  if (filter.kind === "pessoa") return involves(filter.userId);
  return involves(me) || (event.scope === "equipe" && !!event.everyone);
}

/** Sem a migração de hierarquia (scope ausente), todos editam, como antes. */
export function canEditEvent(event: AgendaEvent, me: string, manager: boolean): boolean {
  if (!event.scope) return true;
  return manager || (event.scope === "pessoal" && event.owner_id === me);
}

/** Tipo de evento criado pela empresa (genérico: serve para qualquer ramo). */
export interface AgendaEventType {
  id: string;
  name: string;
  hue: number;
  icon: string;
  kind: "compromisso" | "visita" | "reuniao" | "tarefa" | "lembrete" | "bloqueio";
  default_duration_min: number;
  requires_customer: boolean;
  requires_address: boolean;
  checklist_template: string[];
  fields: Array<{ key: string; label: string; type: "text" | "number" | "date" | "boolean" }>;
  legacy_type: AppointmentType | null;
  position: number;
  active: boolean;
}

export const KIND_LABEL: Record<AgendaEventType["kind"], string> = {
  compromisso: "Compromisso",
  visita: "Visita",
  reuniao: "Reunião",
  tarefa: "Tarefa",
  lembrete: "Lembrete",
  bloqueio: "Bloqueio (folga, feriado)",
};

/**
 * Tipos sugeridos para uma empresa que ainda não criou os seus: genéricos de propósito.
 * Os tipos legados continuam existindo; estes são só o ponto de partida.
 */
export const STARTER_TYPES: Array<
  Pick<
    AgendaEventType,
    | "name"
    | "hue"
    | "icon"
    | "kind"
    | "default_duration_min"
    | "requires_customer"
    | "requires_address"
  > & { checklist_template: string[]; legacy_type: AppointmentType | null }
> = [
  {
    name: "Atendimento ao cliente",
    hue: 300,
    icon: "user",
    kind: "compromisso",
    default_duration_min: 60,
    requires_customer: true,
    requires_address: false,
    checklist_template: [],
    legacy_type: "retorno_comercial",
  },
  {
    name: "Visita externa",
    hue: 230,
    icon: "map-pin",
    kind: "visita",
    default_duration_min: 90,
    requires_customer: true,
    requires_address: true,
    checklist_template: ["Confirmar endereço", "Registrar chegada", "Relatório da visita"],
    legacy_type: "visita_tecnica",
  },
  {
    name: "Reunião",
    hue: 275,
    icon: "users",
    kind: "reuniao",
    default_duration_min: 45,
    requires_customer: false,
    requires_address: false,
    checklist_template: ["Pauta enviada"],
    legacy_type: null,
  },
  {
    name: "Tarefa",
    hue: 135,
    icon: "check-square",
    kind: "tarefa",
    default_duration_min: 30,
    requires_customer: false,
    requires_address: false,
    checklist_template: [],
    legacy_type: null,
  },
  {
    name: "Lembrete",
    hue: 60,
    icon: "bell",
    kind: "lembrete",
    default_duration_min: 15,
    requires_customer: false,
    requires_address: false,
    checklist_template: [],
    legacy_type: null,
  },
  {
    name: "Folga / bloqueio",
    hue: 0,
    icon: "ban",
    kind: "bloqueio",
    default_duration_min: 480,
    requires_customer: false,
    requires_address: false,
    checklist_template: [],
    legacy_type: null,
  },
];

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

export type AgendaView = "dia" | "semana" | "mes" | "linha" | "equipe" | "lista";

/** Preferências de visão de cada pessoa (ficam no navegador). */
export interface AgendaPreferences {
  dayStartHour: number;
  hideWeekends: boolean;
}

export const DEFAULT_PREFERENCES: AgendaPreferences = { dayStartHour: 7, hideWeekends: false };

export const VIEW_LABEL: Record<AgendaView, string> = {
  dia: "Dia",
  semana: "Semana",
  mes: "Mês",
  linha: "Linha do tempo",
  equipe: "Equipe",
  lista: "Lista",
};

/** Sem `ends_at` (eventos antigos), o compromisso dura uma hora. */
export const DEFAULT_DURATION_MIN = 60;

export function eventStart(event: Pick<AgendaEvent, "scheduled_at">): Date {
  return new Date(event.scheduled_at);
}

export function eventEnd(event: Pick<AgendaEvent, "scheduled_at" | "ends_at">): Date {
  if (event.ends_at) {
    const end = new Date(event.ends_at);
    if (end > eventStart(event)) return end;
  }
  return addMinutes(eventStart(event), DEFAULT_DURATION_MIN);
}

export function eventDurationMin(event: Pick<AgendaEvent, "scheduled_at" | "ends_at">): number {
  return Math.max(15, differenceInMinutes(eventEnd(event), eventStart(event)));
}

const WEEK = { weekStartsOn: 1 as const };

/** Intervalo carregado e exibido por visão, a partir da data em foco. */
export function viewRange(view: AgendaView, focus: Date): { from: Date; to: Date } {
  switch (view) {
    case "dia":
      return { from: startOfDay(focus), to: endOfDay(focus) };
    case "semana":
    case "linha":
    case "equipe":
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
    case "equipe":
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
export function layoutDay<T extends Pick<AgendaEvent, "id" | "scheduled_at" | "ends_at">>(
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
    const height = Math.min(eventDurationMin(event), 24 * 60 - top);
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
  /** Tipos criados pela empresa. */
  typeIds: string[];
  statuses: VisitStatus[];
  person: string | null;
}

export const EMPTY_FILTERS: AgendaFilters = {
  search: "",
  types: [],
  typeIds: [],
  statuses: [],
  person: null,
};

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
    if (filters.typeIds.length && !filters.typeIds.includes(event.event_type_id ?? ""))
      return false;
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

export interface TeamRow<T> {
  person: string;
  /** Minutos agendados no intervalo (sem cancelados). */
  minutes: number;
  byDay: T[][];
}

/**
 * Carga da equipe: uma linha por pessoa (técnico ou responsável), com os compromissos de
 * cada dia e o total de horas. "Sem responsável" agrupa o que ninguém pegou ainda.
 */
export function teamLoad<T extends AgendaEvent>(
  events: readonly T[],
  days: readonly Date[],
): TeamRow<T>[] {
  const rows = new Map<string, TeamRow<T>>();
  const row = (person: string) => {
    let current = rows.get(person);
    if (!current) {
      current = { person, minutes: 0, byDay: days.map(() => []) };
      rows.set(person, current);
    }
    return current;
  };
  for (const event of events) {
    const people = [
      ...new Set([event.technician, event.salesperson].map((name) => name?.trim()).filter(Boolean)),
    ] as string[];
    const index = days.findIndex((day) => isSameDay(day, eventStart(event)));
    if (index < 0) continue;
    for (const person of people.length ? people : [UNASSIGNED]) {
      const target = row(person);
      target.byDay[index].push(event);
      if (event.status !== "cancelada") target.minutes += eventDurationMin(event);
    }
  }
  return [...rows.values()].sort((a, b) =>
    a.person === UNASSIGNED
      ? 1
      : b.person === UNASSIGNED
        ? -1
        : b.minutes - a.minutes || a.person.localeCompare(b.person, "pt-BR"),
  );
}

export const UNASSIGNED = "Sem responsável";
