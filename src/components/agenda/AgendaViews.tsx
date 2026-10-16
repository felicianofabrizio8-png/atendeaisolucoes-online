import { useEffect, useRef, useState, type CSSProperties } from "react";
import { addMinutes, format, isSameMonth, isToday, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle } from "lucide-react";
import {
  eventsOnDay,
  layoutDay,
  STATUS_LABEL,
  teamLoad,
  TYPE_HUE,
  TYPE_LABEL,
  type AgendaEvent,
} from "./agenda-model";

const HOUR_PX = 56;
const SNAP_MIN = 15;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function hueStyle(event: AgendaEvent): CSSProperties {
  return {
    ["--ag-hue" as string]: String(event.type_hue ?? TYPE_HUE[event.appointment_type] ?? 300),
  };
}

function describe(event: AgendaEvent): string {
  return [
    format(new Date(event.scheduled_at), "HH:mm"),
    event.title,
    event.type_name ?? TYPE_LABEL[event.appointment_type]?.label,
    STATUS_LABEL[event.status],
    event.customer_name,
  ]
    .filter(Boolean)
    .join(" · ");
}

interface ViewProps {
  events: AgendaEvent[];
  conflicts: Set<string>;
  onOpen: (event: AgendaEvent) => void;
}

/** Dia e semana: grade de horas com arrastar para remarcar e clique para criar. */
export function TimeGridView({
  days,
  events,
  conflicts,
  onOpen,
  onCreateAt,
  onMove,
  startHour = 7,
}: ViewProps & {
  days: Date[];
  onCreateAt: (at: Date) => void;
  onMove: (event: AgendaEvent, at: Date) => void;
  /** Hora em que a grade abre rolada (preferência de cada pessoa). */
  startHour?: number;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  // Abre no começo do expediente em vez da madrugada.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = HOUR_PX * startHour - 8;
  }, [startHour]);

  const timeAt = (day: Date, clientY: number, column: HTMLElement) => {
    const offset = clientY - column.getBoundingClientRect().top;
    const minutes = Math.max(0, Math.min(24 * 60 - SNAP_MIN, (offset / HOUR_PX) * 60));
    return addMinutes(startOfDay(day), Math.round(minutes / SNAP_MIN) * SNAP_MIN);
  };

  return (
    <div ref={scroller} className="ag-grid-scroll">
      <div className="ag-grid" style={{ ["--ag-days" as string]: String(days.length) }}>
        <div className="ag-grid-head" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className="ag-grid-head ag-day-head"
            data-today={isToday(day)}
          >
            <p className="ag-mono">{format(day, "EEE", { locale: ptBR })}</p>
            <span className="ag-day-num mt-1">{format(day, "d")}</span>
          </div>
        ))}

        <div className="ag-hours">
          {HOURS.map((hour) => (
            <div key={hour} className="ag-hour-label ag-mono">
              {hour === 0 ? "" : `${String(hour).padStart(2, "0")}h`}
            </div>
          ))}
        </div>

        {days.map((day) => {
          const key = day.toISOString();
          return (
            <div
              key={key}
              className="ag-day-col"
              data-today={isToday(day)}
              data-drop={dropDay === key}
              style={{ height: HOUR_PX * 24 }}
              onClick={(e) => {
                if (e.target === e.currentTarget)
                  onCreateAt(timeAt(day, e.clientY, e.currentTarget));
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setDropDay(key);
              }}
              onDragLeave={() => setDropDay((current) => (current === key ? null : current))}
              onDrop={(e) => {
                e.preventDefault();
                setDropDay(null);
                const event = events.find((item) => item.id === dragId);
                setDragId(null);
                if (event) onMove(event, timeAt(day, e.clientY, e.currentTarget));
              }}
            >
              {isToday(day) && (
                <div
                  className="ag-now"
                  style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX }}
                />
              )}
              {layoutDay(events, day).map(({ event, top, height, column, columns }) => (
                <button
                  key={event.id}
                  type="button"
                  draggable
                  title={describe(event)}
                  aria-label={describe(event)}
                  className="ag-event absolute px-2.5 py-1.5"
                  data-status={event.status}
                  data-conflict={conflicts.has(event.id)}
                  data-dragging={dragId === event.id}
                  style={{
                    ...hueStyle(event),
                    top: (top / 60) * HOUR_PX + 1,
                    height: Math.max(22, (height / 60) * HOUR_PX - 3),
                    left: `calc(${(100 / columns) * column}% + 3px)`,
                    width: `calc(${100 / columns}% - 6px)`,
                  }}
                  onDragStart={(e) => {
                    setDragId(event.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropDay(null);
                  }}
                  onClick={() => onOpen(event)}
                >
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-white/80">
                    {format(new Date(event.scheduled_at), "HH:mm")}
                    {conflicts.has(event.id) && (
                      <AlertTriangle className="h-3 w-3 text-[#ff8a8a]" />
                    )}
                  </span>
                  <span className="block truncate text-[12.5px] font-semibold leading-tight">
                    {event.title}
                  </span>
                  {height >= 45 && event.customer_name && (
                    <span className="block truncate text-[11px] text-white/65">
                      {event.customer_name}
                    </span>
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Mês: um olhar sobre a carga de cada dia. Clicar no dia abre a visão do dia. */
export function MonthView({
  days,
  focus,
  events,
  conflicts,
  onOpen,
  onOpenDay,
}: ViewProps & { days: Date[]; focus: Date; onOpenDay: (day: Date) => void }) {
  const weekdays = days.slice(0, 7);
  return (
    <div>
      <div className="ag-month border-b border-[var(--ag-edge)]">
        {weekdays.map((day) => (
          <p key={day.toISOString()} className="ag-mono px-2 py-2.5">
            {format(day, "EEE", { locale: ptBR })}
          </p>
        ))}
      </div>
      <div className="ag-month">
        {days.map((day) => {
          const items = eventsOnDay(events, day);
          return (
            <div
              key={day.toISOString()}
              role="button"
              tabIndex={0}
              className="ag-month-cell cursor-pointer"
              data-today={isToday(day)}
              data-outside={!isSameMonth(day, focus)}
              aria-label={`${format(day, "d 'de' MMMM", { locale: ptBR })}: ${items.length} compromissos`}
              onClick={() => onOpenDay(day)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpenDay(day);
              }}
            >
              <span className="ag-day-num !h-7 !min-w-7 text-[13px]">{format(day, "d")}</span>
              <div className="mt-1 space-y-1">
                {items.slice(0, 3).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className="ag-event block w-full truncate py-0.5 pl-2.5 pr-1.5 text-[11px] font-medium max-md:hidden"
                    data-status={event.status}
                    data-conflict={conflicts.has(event.id)}
                    style={hueStyle(event)}
                    title={describe(event)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(event);
                    }}
                  >
                    {format(new Date(event.scheduled_at), "HH:mm")} {event.title}
                  </button>
                ))}
                {items.length > 3 && (
                  <p className="text-[11px] text-[var(--ag-muted)] max-md:hidden">
                    + {items.length - 3} compromissos
                  </p>
                )}
                {items.length > 0 && (
                  <span className="hidden text-[11px] font-semibold text-[var(--ag-accent)] max-md:block">
                    {items.length}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Linha do tempo: cada dia é uma faixa, cada compromisso uma risca de luz no horário. */
export function TimelineView({ days, events, conflicts, onOpen }: ViewProps & { days: Date[] }) {
  const START = 6;
  const END = 22;
  const span = (END - START) * 60;
  const position = (event: AgendaEvent) => {
    const at = new Date(event.scheduled_at);
    const minutes = at.getHours() * 60 + at.getMinutes() - START * 60;
    return Math.max(0, Math.min(100, (minutes / span) * 100));
  };
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        <div className="flex border-b border-[var(--ag-edge)] pl-[120px]">
          {Array.from({ length: END - START + 1 }, (_, i) => START + i).map((hour) => (
            <p key={hour} className="ag-mono flex-1 py-2.5">
              {String(hour).padStart(2, "0")}h
            </p>
          ))}
        </div>
        {days.map((day) => {
          const items = eventsOnDay(events, day);
          return (
            <div key={day.toISOString()} className="flex items-stretch">
              <div className="flex w-[120px] shrink-0 flex-col justify-center border-b border-r border-[var(--ag-edge)] px-3">
                <p className="ag-mono">{format(day, "EEEE", { locale: ptBR })}</p>
                <p
                  className={
                    isToday(day) ? "font-semibold text-[var(--ag-accent)]" : "font-semibold"
                  }
                >
                  {format(day, "d MMM", { locale: ptBR })}
                </p>
              </div>
              <div className="ag-lane flex-1">
                {items.map((event, index) => (
                  <button
                    key={event.id}
                    type="button"
                    className="ag-event ag-streak"
                    data-status={event.status}
                    data-conflict={conflicts.has(event.id)}
                    title={describe(event)}
                    aria-label={describe(event)}
                    style={{
                      ...hueStyle(event),
                      left: `calc(${position(event)}% - 17px)`,
                      top: items.length > 1 && index % 2 ? 26 : 8,
                      height: items.length > 1 ? 30 : 40,
                      maxWidth: "34%",
                    }}
                    onClick={() => onOpen(event)}
                  >
                    {format(new Date(event.scheduled_at), "HH:mm")}
                    <span className="truncate font-medium">{event.title}</span>
                  </button>
                ))}
                {items.length === 0 && (
                  <p className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--ag-faint)]">
                    Livre
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Equipe: pessoas × dias, com a carga de horas da semana de cada um. */
export function TeamView({
  days,
  events,
  conflicts,
  onOpen,
  weeklyHours = 44,
}: ViewProps & { days: Date[]; weeklyHours?: number }) {
  const rows = teamLoad(events, days);
  if (!rows.length)
    return (
      <p className="p-10 text-center text-sm text-[var(--ag-muted)]">
        Ninguém com compromisso nesta semana. Preencha técnico ou responsável nos compromissos para
        ver a carga de cada pessoa.
      </p>
    );
  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[880px]"
        style={{ gridTemplateColumns: `200px repeat(${days.length}, minmax(0, 1fr))` }}
      >
        <div className="border-b border-[var(--ag-edge)]" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className="ag-day-head border-b border-[var(--ag-edge)]"
            data-today={isToday(day)}
          >
            <p className="ag-mono">{format(day, "EEE", { locale: ptBR })}</p>
            <span className="ag-day-num mt-1 !h-7 !min-w-7 text-[13px]">{format(day, "d")}</span>
          </div>
        ))}
        {rows.map((row) => {
          const hours = row.minutes / 60;
          const load = Math.min(1, hours / weeklyHours);
          return (
            <div key={row.person} className="contents">
              <div className="border-b border-r border-[var(--ag-edge)] p-3">
                <p className="truncate text-sm font-semibold" title={row.person}>
                  {row.person}
                </p>
                <p className="mt-0.5 text-[11.5px] text-[var(--ag-muted)]">
                  {hours.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h na semana
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-[rgb(255_255_255/0.08)]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${load * 100}%`,
                      background:
                        load > 0.9 ? "#ff6b6b" : load > 0.7 ? "#ffb547" : "var(--ag-accent)",
                    }}
                  />
                </div>
              </div>
              {row.byDay.map((items, index) => (
                <div
                  key={index}
                  className="min-h-[76px] space-y-1 border-b border-l border-[var(--ag-edge)] p-1.5"
                  data-today={isToday(days[index])}
                >
                  {items.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      className="ag-event block w-full truncate py-1 pl-2.5 pr-1.5 text-[11px] font-medium"
                      data-status={event.status}
                      data-conflict={conflicts.has(event.id)}
                      style={hueStyle(event)}
                      title={describe(event)}
                      onClick={() => onOpen(event)}
                    >
                      {format(new Date(event.scheduled_at), "HH:mm")} {event.title}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
