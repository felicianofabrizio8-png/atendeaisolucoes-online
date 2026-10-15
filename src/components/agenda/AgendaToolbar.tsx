import { endOfWeek, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import {
  STATUS_KEYS,
  STATUS_LABEL,
  TYPE_HUE,
  TYPE_KEYS,
  TYPE_LABEL,
  VIEW_LABEL,
  EMPTY_FILTERS,
  type AgendaEventType,
  type AgendaFilters,
  type AgendaView,
} from "./agenda-model";

const VIEWS: AgendaView[] = ["dia", "semana", "mes", "linha", "equipe", "lista"];

function periodLabel(view: AgendaView, focus: Date): string {
  if (view === "dia") return format(focus, "EEEE, d 'de' MMMM", { locale: ptBR });
  if (view === "mes") return format(focus, "MMMM 'de' yyyy", { locale: ptBR });
  if (view === "lista") return `A partir de ${format(focus, "d 'de' MMMM", { locale: ptBR })}`;
  const from = startOfWeek(focus, { weekStartsOn: 1 });
  const to = endOfWeek(focus, { weekStartsOn: 1 });
  return from.getMonth() === to.getMonth()
    ? `${format(from, "d")} – ${format(to, "d 'de' MMMM", { locale: ptBR })}`
    : `${format(from, "d MMM", { locale: ptBR })} – ${format(to, "d MMM", { locale: ptBR })}`;
}

export function AgendaToolbar({
  view,
  focus,
  filters,
  people,
  onView,
  onNavigate,
  onToday,
  onFilters,
  onCustomize,
  customTypes = [],
}: {
  view: AgendaView;
  focus: Date;
  filters: AgendaFilters;
  people: string[];
  /** Tipos ativos da empresa; sem eles, os filtros mostram os tipos de sempre. */
  customTypes?: AgendaEventType[];
  onView: (view: AgendaView) => void;
  onNavigate: (direction: 1 | -1) => void;
  onToday: () => void;
  onFilters: (filters: AgendaFilters) => void;
  onCustomize: () => void;
}) {
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  const active =
    filters.types.length +
    filters.typeIds.length +
    filters.statuses.length +
    (filters.person ? 1 : 0) +
    (filters.search ? 1 : 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="ag-icon-btn"
            aria-label="Período anterior"
            onClick={() => onNavigate(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="ag-icon-btn"
            aria-label="Próximo período"
            onClick={() => onNavigate(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" className="ag-btn !py-1.5" onClick={onToday}>
            Hoje
          </button>
        </div>
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight first-letter:uppercase">
          {periodLabel(view, focus)}
        </h2>
        <button
          type="button"
          className="ag-icon-btn"
          aria-label="Personalizar agenda"
          title="Personalizar"
          onClick={onCustomize}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
        <div className="ag-pills" role="tablist" aria-label="Visão da agenda">
          {VIEWS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={view === item}
              className="ag-pill"
              onClick={() => onView(item)}
            >
              {VIEW_LABEL[item]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <span className="sr-only">Buscar na agenda</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ag-faint)]" />
          <input
            className="ag-input w-[220px]"
            placeholder="Buscar cliente, cidade, nota…"
            value={filters.search}
            onChange={(e) => onFilters({ ...filters, search: e.target.value })}
          />
        </label>
        <div className="flex flex-wrap gap-1.5" aria-label="Filtrar por tipo">
          {customTypes.length
            ? customTypes.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  className="ag-chip"
                  aria-pressed={filters.typeIds.includes(type.id)}
                  style={{ ["--ag-type" as string]: `oklch(0.7 0.08 ${type.hue})` }}
                  onClick={() =>
                    onFilters({ ...filters, typeIds: toggle(filters.typeIds, type.id) })
                  }
                >
                  <span className="ag-dot" />
                  {type.name}
                </button>
              ))
            : TYPE_KEYS.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="ag-chip"
                  aria-pressed={filters.types.includes(type)}
                  style={{ ["--ag-type" as string]: `oklch(0.7 0.08 ${TYPE_HUE[type]})` }}
                  onClick={() => onFilters({ ...filters, types: toggle(filters.types, type) })}
                >
                  <span className="ag-dot" />
                  {TYPE_LABEL[type].short}
                </button>
              ))}
        </div>
        <select
          aria-label="Filtrar por status"
          className="ag-input !pl-3 w-auto"
          value={filters.statuses[0] ?? ""}
          onChange={(e) =>
            onFilters({ ...filters, statuses: e.target.value ? [e.target.value as never] : [] })
          }
        >
          <option value="">Todos os status</option>
          {STATUS_KEYS.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </select>
        {people.length > 0 && (
          <select
            aria-label="Filtrar por pessoa da equipe"
            className="ag-input !pl-3 w-auto"
            value={filters.person ?? ""}
            onChange={(e) => onFilters({ ...filters, person: e.target.value || null })}
          >
            <option value="">Toda a equipe</option>
            {people.map((person) => (
              <option key={person} value={person}>
                {person}
              </option>
            ))}
          </select>
        )}
        {active > 0 && (
          <button
            type="button"
            className="ag-chip hover:text-[var(--ag-ink)]"
            onClick={() => onFilters(EMPTY_FILTERS)}
          >
            <X className="h-3 w-3" />
            Limpar filtros ({active})
          </button>
        )}
      </div>
    </div>
  );
}
