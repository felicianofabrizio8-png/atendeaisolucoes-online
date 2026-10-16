import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  setHours,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SegmentedTabs } from "@/components/layout/MobileSections";
import {
  daysOf,
  EMPTY_FILTERS,
  eventsOnDay,
  STATUS_KEYS,
  STATUS_LABEL,
  TYPE_HUE,
  TYPE_KEYS,
  TYPE_LABEL,
  VIEW_LABEL,
  type AgendaEvent,
  type AgendaEventType,
  type AgendaFilters,
  type AgendaPulse,
  type AgendaTag,
  type AgendaView,
  type ScopeFilter,
} from "./agenda-model";
import type { TeamMember } from "./useTeamDirectory";

/**
 * Agenda no celular — o formato de um app de calendário.
 *
 * O desktop continua com hero, barra de ferramentas e grade de horas. Aqui:
 *
 *   1. Topo enxuto: o mês em letra grande (o que precisa ser grande) e três
 *      ações redondas — hoje, filtros e novo compromisso.
 *   2. Calendário pequeno (mês ou semana) que mostra só o título dos
 *      compromissos dentro de cada dia, colorido pelo tipo.
 *   3. A lista do dia tocado logo abaixo, com hora, título e cliente.
 *   4. Filtros numa folha que sobe de baixo, com seções claras (o que, como
 *      está, de quem) em vez de um bloco de selects e chips.
 *
 * Dia, Lista, Pessoas e Linha do tempo reaproveitam as visões existentes
 * (`renderView`), então nenhum comportamento do desktop é duplicado.
 */
export function AgendaMobile({
  view,
  focus,
  events,
  conflicts,
  pulse,
  loading,
  filters,
  people,
  customTypes,
  tags,
  manager,
  scope,
  members = [],
  hideTeamView,
  onView,
  onFocus,
  onNavigate,
  onFilters,
  onScope,
  onOpen,
  onCreate,
  onAskLume,
  onCustomize,
  renderView,
}: {
  view: AgendaView;
  focus: Date;
  events: AgendaEvent[];
  conflicts: Set<string>;
  pulse: AgendaPulse;
  loading: boolean;
  filters: AgendaFilters;
  people: string[];
  customTypes: AgendaEventType[];
  tags?: AgendaTag[];
  manager: boolean;
  scope: ScopeFilter;
  members?: TeamMember[];
  hideTeamView: boolean;
  onView: (view: AgendaView) => void;
  onFocus: (day: Date) => void;
  onNavigate: (direction: 1 | -1) => void;
  onFilters: (filters: AgendaFilters) => void;
  onScope: (scope: ScopeFilter) => void;
  onOpen: (event: AgendaEvent) => void;
  onCreate: (at: Date | null) => void;
  /** O botão flutuante da Lume já mora na tela; mantido para compatibilidade. */
  onAskLume?: () => void;
  onCustomize: () => void;
  /** Visões de detalhe (dia, lista, pessoas, linha) — as mesmas do desktop. */
  renderView: () => ReactNode;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters =
    filters.types.length +
    filters.typeIds.length +
    filters.tagIds.length +
    filters.statuses.length +
    (filters.person ? 1 : 0) +
    (filters.search ? 1 : 0);

  const tabs = (["mes", "semana", "dia", "lista", "equipe", "linha"] as AgendaView[])
    .filter((item) => !(hideTeamView && item === "equipe"))
    .map((item) => ({ id: item, label: item === "linha" ? "Linha" : VIEW_LABEL[item] }));

  const calendarMode = view === "mes" || view === "semana";

  return (
    <div className="agm">
      {/* ── Topo: mês grande + ações ── */}
      <header className="agm-head">
        <div className="min-w-0">
          <p className="ag-mono">Agenda{scope.kind === "equipe" ? " · equipe" : ""}</p>
          <div className="mt-1 flex items-center gap-1">
            <h1 className="agm-title">
              <span className="capitalize">{format(focus, "MMMM", { locale: ptBR })}</span>
              <span className="agm-title-year">{format(focus, "yyyy")}</span>
            </h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="agm-round"
            aria-label="Filtros"
            onClick={() => setFiltersOpen(true)}
            data-active={activeFilters > 0 || undefined}
          >
            <SlidersHorizontal className="h-[18px] w-[18px]" />
            {activeFilters > 0 && <span className="agm-round-badge">{activeFilters}</span>}
          </button>
          <button
            type="button"
            className="agm-round agm-round-primary"
            aria-label="Novo compromisso"
            onClick={() => onCreate(calendarMode ? setHours(startOfDay(focus), 9) : null)}
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* ── Pulso do dia: uma linha só ── */}
      <div className="agm-pulse" aria-label="Resumo">
        <Pulse value={pulse.today} label="hoje" />
        <Pulse value={pulse.week} label="na semana" />
        <Pulse value={pulse.open} label="em aberto" />
        <Pulse value={pulse.done} label="finalizados" />
      </div>

      {/* ── Visão + navegação ── */}
      <div className="agm-bar">
        <SegmentedTabs
          label="Visão da agenda"
          tabs={tabs}
          value={view}
          onChange={(id) => onView(id as AgendaView)}
          className="agm-tabs"
        />
      </div>

      <div className="agm-nav">
        <button type="button" className="agm-round agm-round-sm" aria-label="Anterior" onClick={() => onNavigate(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-[13px] font-semibold first-letter:uppercase">
          {navLabel(view, focus)}
        </p>
        <button type="button" className="agm-round agm-round-sm" aria-label="Próximo" onClick={() => onNavigate(1)}>
          <ChevronRight className="h-4 w-4" />
        </button>
        {!isToday(focus) && (
          <button type="button" className="agm-today" onClick={() => onFocus(new Date())}>
            Hoje
          </button>
        )}
      </div>

      {activeFilters > 0 && (
        <ActiveFilters
          filters={filters}
          customTypes={customTypes}
          tags={tags}
          onFilters={onFilters}
          onOpen={() => setFiltersOpen(true)}
        />
      )}

      {calendarMode ? (
        <>
          {view === "mes" ? (
            <MonthCompact focus={focus} events={events} onPick={onFocus} />
          ) : (
            <WeekStrip focus={focus} events={events} onPick={onFocus} />
          )}
          <DayAgenda
            day={focus}
            events={eventsOnDay(events, focus)}
            conflicts={conflicts}
            loading={loading}
            onOpen={onOpen}
            onCreate={() => onCreate(setHours(startOfDay(focus), 9))}
          />
        </>
      ) : (
        <section className="ag-panel overflow-hidden" aria-busy={loading}>
          {renderView()}
        </section>
      )}

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        onFilters={onFilters}
        people={people}
        customTypes={customTypes}
        tags={tags}
        manager={manager}
        scope={scope}
        members={members}
        onScope={onScope}
        resultCount={events.length}
        onCustomize={() => {
          setFiltersOpen(false);
          onCustomize();
        }}
      />
    </div>
  );
}

function navLabel(view: AgendaView, focus: Date): string {
  if (view === "mes") return format(focus, "MMMM 'de' yyyy", { locale: ptBR });
  if (view === "dia") return format(focus, "EEEE, d 'de' MMMM", { locale: ptBR });
  if (view === "lista") return `30 dias a partir de ${format(focus, "d MMM", { locale: ptBR })}`;
  const days = weekDays(focus);
  const from = days[0];
  const to = days[6];
  return from.getMonth() === to.getMonth()
    ? `${format(from, "d")} – ${format(to, "d 'de' MMMM", { locale: ptBR })}`
    : `${format(from, "d MMM", { locale: ptBR })} – ${format(to, "d MMM", { locale: ptBR })}`;
}

function Pulse({ value, label }: { value: number; label: string }) {
  return (
    <span className="agm-pulse-item">
      <strong>{value}</strong> {label}
    </span>
  );
}

function hueOf(event: AgendaEvent): CSSProperties {
  return {
    ["--ag-hue" as string]: String(event.type_hue ?? TYPE_HUE[event.appointment_type] ?? 300),
  };
}

const WEEKDAY_INITIALS = ["S", "T", "Q", "Q", "S", "S", "D"];
const WEEK = { weekStartsOn: 1 as const };

const isSameDayLocal = (a: Date, b: Date) => isSameDay(a, b);
const weekDays = (focus: Date) => daysOf(startOfWeek(focus, WEEK), endOfWeek(focus, WEEK));
const monthCells = (focus: Date) =>
  daysOf(startOfWeek(startOfMonth(focus), WEEK), endOfWeek(endOfMonth(focus), WEEK));

/** Mês compacto: número do dia e, dentro dele, só o título dos compromissos. */
function MonthCompact({
  focus,
  events,
  onPick,
}: {
  focus: Date;
  events: AgendaEvent[];
  onPick: (day: Date) => void;
}) {
  const cells = useMemo(() => monthCells(focus), [focus]);
  return (
    <div className="agm-month" role="grid" aria-label="Calendário do mês">
      {WEEKDAY_INITIALS.map((letter, i) => (
        <span key={i} className="agm-weekday" aria-hidden>
          {letter}
        </span>
      ))}
      {cells.map((day) => {
        const items = eventsOnDay(events, day);
        const selected = isSameDayLocal(day, focus);
        return (
          <button
            key={day.toISOString()}
            type="button"
            role="gridcell"
            aria-selected={selected}
            aria-label={`${format(day, "d 'de' MMMM", { locale: ptBR })}: ${items.length} compromissos`}
            className="agm-cell"
            data-outside={!isSameMonth(day, focus) || undefined}
            data-today={isToday(day) || undefined}
            data-selected={selected || undefined}
            onClick={() => onPick(day)}
          >
            <span className="agm-cell-num">{format(day, "d")}</span>
            <span className="agm-cell-events">
              {items.slice(0, 2).map((event) => (
                <span
                  key={event.id}
                  className="agm-chip"
                  data-status={event.status}
                  style={hueOf(event)}
                >
                  {event.title}
                </span>
              ))}
              {items.length > 2 && <span className="agm-more">+{items.length - 2}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Semana: sete dias numa faixa, com pontos coloridos de quantos compromissos há. */
function WeekStrip({
  focus,
  events,
  onPick,
}: {
  focus: Date;
  events: AgendaEvent[];
  onPick: (day: Date) => void;
}) {
  const days = useMemo(() => weekDays(focus), [focus]);
  const byDay = useMemo(() => days.map((day) => eventsOnDay(events, day)), [events, days]);
  return (
    <div className="agm-week" role="tablist" aria-label="Dias da semana">
      {days.map((day, index) => {
        const items = byDay[index];
        const selected = isSameDayLocal(day, focus);
        return (
          <button
            key={day.toISOString()}
            type="button"
            role="tab"
            aria-selected={selected}
            className="agm-week-day"
            data-today={isToday(day) || undefined}
            data-selected={selected || undefined}
            onClick={() => onPick(day)}
          >
            <span className="agm-week-letter">{format(day, "EEEEEE", { locale: ptBR })}</span>
            <span className="agm-week-num">{format(day, "d")}</span>
            <span className="agm-week-dots" aria-hidden>
              {items.slice(0, 3).map((event) => (
                <i key={event.id} style={hueOf(event)} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Lista do dia escolhido. */
function DayAgenda({
  day,
  events,
  conflicts,
  loading,
  onOpen,
  onCreate,
}: {
  day: Date;
  events: AgendaEvent[];
  conflicts: Set<string>;
  loading: boolean;
  onOpen: (event: AgendaEvent) => void;
  onCreate: () => void;
}) {
  return (
    <section className="agm-day" aria-label={format(day, "EEEE, d 'de' MMMM", { locale: ptBR })}>
      <div className="agm-day-head">
        <span className="agm-day-big">{format(day, "d")}</span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold capitalize">
            {isToday(day) ? "Hoje" : format(day, "EEEE", { locale: ptBR })}
          </p>
          <p className="text-xs text-[var(--ag-muted)]">
            {format(day, "MMMM", { locale: ptBR })} ·{" "}
            {events.length === 0
              ? "sem compromissos"
              : `${events.length} compromisso${events.length === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="agm-empty">
          <p>{loading ? "Carregando…" : "Dia livre."}</p>
          {!loading && (
            <button type="button" className="ag-btn" onClick={onCreate}>
              <Plus className="h-4 w-4" />
              Marcar compromisso
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {events.map((event) => {
            const start = new Date(event.scheduled_at);
            const end = event.ends_at ? new Date(event.ends_at) : null;
            const place = event.city || event.address;
            return (
              <li key={event.id}>
                <button
                  type="button"
                  className="agm-event"
                  data-status={event.status}
                  data-conflict={conflicts.has(event.id) || undefined}
                  style={hueOf(event)}
                  onClick={() => onOpen(event)}
                >
                  <span className="agm-event-time">
                    <strong>{event.all_day ? "Dia" : format(start, "HH:mm")}</strong>
                    {!event.all_day && end && <span>{format(end, "HH:mm")}</span>}
                  </span>
                  <span className="agm-event-body">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[14px] font-semibold">{event.title}</span>
                      {conflicts.has(event.id) && (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#ff8a8a]" aria-label="Conflito de horário" />
                      )}
                    </span>
                    {(event.customer_name || place) && (
                      <span className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-[var(--ag-muted)]">
                        {event.customer_name}
                        {event.customer_name && place ? " · " : ""}
                        {place && (
                          <>
                            <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                            <span className="truncate">{place}</span>
                          </>
                        )}
                      </span>
                    )}
                    <span className="agm-event-tags">
                      <span className="agm-event-type">
                        {event.type_name ?? TYPE_LABEL[event.appointment_type]?.short}
                      </span>
                      <span className="agm-event-status">{STATUS_LABEL[event.status]}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Filtros aplicados viram pílulas removíveis acima do calendário. */
function ActiveFilters({
  filters,
  customTypes,
  tags,
  onFilters,
  onOpen,
}: {
  filters: AgendaFilters;
  customTypes: AgendaEventType[];
  tags?: AgendaTag[];
  onFilters: (filters: AgendaFilters) => void;
  onOpen: () => void;
}) {
  const pills: Array<{ key: string; label: string; remove: () => void }> = [];
  if (filters.search)
    pills.push({ key: "q", label: `“${filters.search}”`, remove: () => onFilters({ ...filters, search: "" }) });
  for (const id of filters.tagIds) {
    const tag = tags?.find((item) => item.id === id);
    pills.push({ key: `t${id}`, label: tag?.name ?? "Tag", remove: () => onFilters({ ...filters, tagIds: filters.tagIds.filter((x) => x !== id) }) });
  }
  for (const id of filters.typeIds) {
    const type = customTypes.find((item) => item.id === id);
    pills.push({ key: `c${id}`, label: type?.name ?? "Tipo", remove: () => onFilters({ ...filters, typeIds: filters.typeIds.filter((x) => x !== id) }) });
  }
  for (const type of filters.types)
    pills.push({ key: `y${type}`, label: TYPE_LABEL[type].short, remove: () => onFilters({ ...filters, types: filters.types.filter((x) => x !== type) }) });
  for (const status of filters.statuses)
    pills.push({ key: `s${status}`, label: STATUS_LABEL[status], remove: () => onFilters({ ...filters, statuses: filters.statuses.filter((x) => x !== status) }) });
  if (filters.person)
    pills.push({ key: "p", label: filters.person, remove: () => onFilters({ ...filters, person: null }) });

  return (
    <div className="agm-active" aria-label="Filtros ativos">
      {pills.map((pill) => (
        <button key={pill.key} type="button" className="agm-active-pill" onClick={pill.remove}>
          {pill.label}
          <X className="h-3 w-3" aria-label="Remover" />
        </button>
      ))}
      <button type="button" className="agm-active-edit" onClick={onOpen}>
        Editar
      </button>
    </div>
  );
}

/** Folha de filtros: três perguntas simples em vez de um bloco de controles. */
function FilterSheet({
  open,
  onOpenChange,
  filters,
  onFilters,
  people,
  customTypes,
  tags,
  manager,
  scope,
  members,
  onScope,
  resultCount,
  onCustomize,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: AgendaFilters;
  onFilters: (filters: AgendaFilters) => void;
  people: string[];
  customTypes: AgendaEventType[];
  tags?: AgendaTag[];
  manager: boolean;
  scope: ScopeFilter;
  members: TeamMember[];
  onScope: (scope: ScopeFilter) => void;
  resultCount: number;
  onCustomize: () => void;
}) {
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const typeOptions: Array<{ key: string; label: string; hue: number; pressed: boolean; onToggle: () => void }> = tags
    ? tags.map((tag) => ({
        key: tag.id,
        label: tag.name,
        hue: tag.hue,
        pressed: filters.tagIds.includes(tag.id),
        onToggle: () => onFilters({ ...filters, tagIds: toggle(filters.tagIds, tag.id) }),
      }))
    : customTypes.length
      ? customTypes.map((type) => ({
          key: type.id,
          label: type.name,
          hue: type.hue,
          pressed: filters.typeIds.includes(type.id),
          onToggle: () => onFilters({ ...filters, typeIds: toggle(filters.typeIds, type.id) }),
        }))
      : TYPE_KEYS.map((type) => ({
          key: type,
          label: TYPE_LABEL[type].short,
          hue: TYPE_HUE[type],
          pressed: filters.types.includes(type),
          onToggle: () => onFilters({ ...filters, types: toggle(filters.types, type) }),
        }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        mobileFullscreen={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="lume-agenda agm-sheet max-h-[86dvh] gap-0 rounded-t-[28px] border-[var(--ag-edge)] p-0"
      >
        <SheetTitle className="sr-only">Filtros da agenda</SheetTitle>
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/20" />
        <div className="flex items-center justify-between px-5 pb-2 pr-16 pt-3">
          <h2 className="text-lg font-semibold">Filtrar agenda</h2>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pb-4">
          <label className="relative block">
            <span className="sr-only">Buscar</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ag-faint)]" />
            <input
              className="agm-search"
              placeholder="Buscar cliente, cidade, nota…"
              value={filters.search}
              onChange={(e) => onFilters({ ...filters, search: e.target.value })}
            />
          </label>

          {manager && (
            <FilterGroup title="De quem é a agenda">
              <Choice pressed={scope.kind === "minha"} onClick={() => onScope({ kind: "minha" })}>
                Minha
              </Choice>
              <Choice pressed={scope.kind === "equipe"} onClick={() => onScope({ kind: "equipe" })}>
                Equipe toda
              </Choice>
              {members.map((member) => (
                <Choice
                  key={member.id}
                  pressed={scope.kind === "pessoa" && scope.userId === member.id}
                  onClick={() => onScope({ kind: "pessoa", userId: member.id })}
                >
                  {member.name}
                </Choice>
              ))}
            </FilterGroup>
          )}

          <FilterGroup title={tags ? "Tags" : "Tipo de compromisso"}>
            {typeOptions.map((option) => (
              <Choice
                key={option.key}
                pressed={option.pressed}
                hue={option.hue}
                onClick={option.onToggle}
              >
                {option.label}
              </Choice>
            ))}
          </FilterGroup>

          <FilterGroup title="Situação">
            {STATUS_KEYS.map((status) => (
              <Choice
                key={status}
                pressed={filters.statuses.includes(status)}
                onClick={() => onFilters({ ...filters, statuses: toggle(filters.statuses, status) })}
              >
                {STATUS_LABEL[status]}
              </Choice>
            ))}
          </FilterGroup>

          {people.length > 0 && (
            <FilterGroup title="Responsável">
              {people.map((person) => (
                <Choice
                  key={person}
                  pressed={filters.person === person}
                  onClick={() =>
                    onFilters({ ...filters, person: filters.person === person ? null : person })
                  }
                >
                  {person}
                </Choice>
              ))}
            </FilterGroup>
          )}

          <button type="button" className="text-[13px] font-medium text-[var(--ag-accent)]" onClick={onCustomize}>
            Personalizar tipos e horários da agenda →
          </button>
        </div>

        <div className="agm-sheet-foot">
          <button type="button" className="ag-btn flex-1 justify-center" onClick={() => onFilters(EMPTY_FILTERS)}>
            Limpar
          </button>
          <button
            type="button"
            className="ag-btn ag-btn-primary flex-[2] justify-center"
            onClick={() => onOpenChange(false)}
          >
            Ver {resultCount} compromisso{resultCount === 1 ? "" : "s"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="ag-mono mb-2.5">{title}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function Choice({
  pressed,
  hue,
  onClick,
  children,
}: {
  pressed: boolean;
  hue?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="agm-choice"
      style={hue !== undefined ? ({ ["--ag-type" as string]: `oklch(0.7 0.08 ${hue})` } as CSSProperties) : undefined}
    >
      {hue !== undefined && <span className="ag-dot" />}
      {children}
    </button>
  );
}

