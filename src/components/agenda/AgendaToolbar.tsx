import { endOfWeek, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import {
  STATUS_KEYS,
  STATUS_LABEL,
  VIEW_LABEL,
  EMPTY_FILTERS,
  type AgendaEventType,
  type AgendaTag,
  type ScopeFilter,
  type AgendaFilters,
  type AgendaView,
} from "./agenda-model";
import type { TeamMember } from "./useTeamDirectory";

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
  tags,
  manager = false,
  scope,
  members = [],
  onScope,
  hideTeamView = false,
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
  /** Com hierarquia: filtros por tag no lugar dos tipos. */
  tags?: AgendaTag[];
  /** Gestor da agenda ou admin: escolhe de quem é a agenda exibida. */
  manager?: boolean;
  scope?: ScopeFilter;
  members?: TeamMember[];
  onScope?: (scope: ScopeFilter) => void;
  /** Funcionário não vê a visão Pessoas (agenda de todos). */
  hideTeamView?: boolean;
}) {
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  const active =
    filters.types.length +
    filters.typeIds.length +
    filters.tagIds.length +
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
        {manager && scope && onScope && (
          <div className="ag-pills ag-scroll-row max-md:w-full" role="tablist" aria-label="De quem">
            <button
              type="button"
              role="tab"
              aria-selected={scope.kind === "minha"}
              className="ag-pill"
              onClick={() => onScope({ kind: "minha" })}
            >
              Minha agenda
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope.kind === "equipe"}
              className="ag-pill"
              onClick={() => onScope({ kind: "equipe" })}
            >
              Equipe
            </button>
            {members.length > 0 && (
              <select
                aria-label="Agenda de uma pessoa"
                className="ag-pill bg-transparent outline-none"
                value={scope.kind === "pessoa" ? scope.userId : ""}
                onChange={(e) =>
                  onScope(
                    e.target.value
                      ? { kind: "pessoa", userId: e.target.value }
                      : { kind: "equipe" },
                  )
                }
              >
                <option value="">Pessoa…</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        <div
          className="ag-pills ag-scroll-row max-md:w-full max-md:justify-between"
          role="tablist"
          aria-label="Visão da agenda"
        >
          {VIEWS.filter((item) => !(hideTeamView && item === "equipe")).map((item) => (
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
        <label className="relative max-md:w-full">
          <span className="sr-only">Buscar na agenda</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ag-faint)]" />
          <input
            className="ag-input w-[220px] max-md:w-full"
            placeholder="Buscar cliente, cidade, nota…"
            value={filters.search}
            onChange={(e) => onFilters({ ...filters, search: e.target.value })}
          />
        </label>
        <div
          className="ag-chip-row flex flex-wrap gap-1.5 max-md:-mx-4 max-md:w-[calc(100%+2rem)] max-md:px-4"
          aria-label="Filtrar por tipo"
        >
          {tags
            ? tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className="ag-chip"
                  aria-pressed={filters.tagIds.includes(tag.id)}
                  style={{ ["--ag-type" as string]: `oklch(0.7 0.08 ${tag.hue})` }}
                  onClick={() => onFilters({ ...filters, tagIds: toggle(filters.tagIds, tag.id) })}
                >
                  <span className="ag-dot" />
                  {tag.name}
                </button>
              ))
            : customTypes.length
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
              : // Sem tags da empresa, não há filtro por tipo: os tipos fixos de
                // instalação não valem para toda empresa.
                null}
        </div>
        <select
          aria-label="Filtrar por status"
          className="ag-input !pl-3 w-auto max-md:min-w-0 max-md:flex-1"
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
            className="ag-input !pl-3 w-auto max-md:min-w-0 max-md:flex-1"
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
