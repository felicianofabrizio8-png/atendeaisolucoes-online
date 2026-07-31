// SPRINT 4 · FASE 5 — Filtros do painel de desempenho.
// Mobile: abre em drawer (Sheet). Desktop: painel inline.
import { useState } from "react";
import { Filter, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { COACH_LEARNING_STATUSES, STATUS_LABEL_PT } from "@/lib/coach-learnings/schema";
import { COACH_LEARNING_HEALTH_CODES, HEALTH_PRESENTATION } from "@/lib/coach-learnings/performance/health";
import {
  PERFORMANCE_SORTS,
  PERIOD_PRESETS,
  PERIOD_LABEL_PT,
  SORT_LABEL_PT,
  type PeriodPreset,
  type PerformanceSort,
} from "@/lib/coach-learnings/performance/types";

export interface PerformanceFilterState {
  search: string;
  status: string;
  health: string;
  strategy: string;
  minSamples: number | null;
  minUsage: number | null;
  minConfidence: number | null;
  minSuccess: number | null;
  minPriority: number | null;
  onlyNegative: boolean;
  onlyUnused: boolean;
  onlyNoFeedback: boolean;
  period: PeriodPreset;
  sort: PerformanceSort;
}

export const EMPTY_FILTERS: PerformanceFilterState = {
  search: "",
  status: "all",
  health: "all",
  strategy: "all",
  minSamples: null,
  minUsage: null,
  minConfidence: null,
  minSuccess: null,
  minPriority: null,
  onlyNegative: false,
  onlyUnused: false,
  onlyNoFeedback: false,
  period: "30d",
  sort: "priority",
};

export function activeFilterCount(f: PerformanceFilterState): number {
  let n = 0;
  if (f.search.trim()) n++;
  if (f.status !== "all") n++;
  if (f.health !== "all") n++;
  if (f.strategy !== "all") n++;
  if (f.minSamples !== null) n++;
  if (f.minUsage !== null) n++;
  if (f.minConfidence !== null) n++;
  if (f.minSuccess !== null) n++;
  if (f.minPriority !== null) n++;
  if (f.onlyNegative) n++;
  if (f.onlyUnused) n++;
  if (f.onlyNoFeedback) n++;
  if (f.period !== EMPTY_FILTERS.period) n++;
  return n;
}

interface FieldsProps {
  value: PerformanceFilterState;
  onChange: (patch: Partial<PerformanceFilterState>) => void;
}

const selectClass =
  "w-full min-h-11 rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function numberValue(v: number | null): string {
  return v === null ? "" : String(v);
}

function FilterFields({ value, onChange }: FieldsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Status</span>
        <select
          className={selectClass}
          value={value.status}
          data-testid="filter-status"
          onChange={(e) => onChange({ status: e.target.value })}
        >
          <option value="all">Ativos e pausados</option>
          {COACH_LEARNING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL_PT[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Saúde</span>
        <select
          className={selectClass}
          value={value.health}
          data-testid="filter-health"
          onChange={(e) => onChange({ health: e.target.value })}
        >
          <option value="all">Todas</option>
          {COACH_LEARNING_HEALTH_CODES.map((h) => (
            <option key={h} value={h}>
              {HEALTH_PRESENTATION[h].label}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Estratégia de seleção</span>
        <select
          className={selectClass}
          value={value.strategy}
          data-testid="filter-strategy"
          onChange={(e) => onChange({ strategy: e.target.value })}
        >
          <option value="all">Todas</option>
          <option value="contextual_v1">Contextual (contextual_v1)</option>
          <option value="static_fallback">Fallback estático</option>
        </select>
      </label>

      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Período</span>
        <select
          className={selectClass}
          value={value.period}
          data-testid="filter-period"
          onChange={(e) => onChange({ period: e.target.value as PeriodPreset })}
        >
          {PERIOD_PRESETS.map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABEL_PT[p]}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Confiança mínima (0–1)</span>
        <input
          type="number"
          step="0.05"
          min="0"
          max="1"
          inputMode="decimal"
          className={selectClass}
          data-testid="filter-min-confidence"
          value={numberValue(value.minConfidence)}
          onChange={(e) =>
            onChange({ minConfidence: e.target.value === "" ? null : Number(e.target.value) })
          }
        />
      </label>

      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Taxa de sucesso mínima (0–1)</span>
        <input
          type="number"
          step="0.05"
          min="0"
          max="1"
          inputMode="decimal"
          className={selectClass}
          data-testid="filter-min-success"
          value={numberValue(value.minSuccess)}
          onChange={(e) =>
            onChange({ minSuccess: e.target.value === "" ? null : Number(e.target.value) })
          }
        />
      </label>

      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Amostras mínimas</span>
        <input
          type="number"
          min="0"
          inputMode="numeric"
          className={selectClass}
          data-testid="filter-min-samples"
          value={numberValue(value.minSamples)}
          onChange={(e) =>
            onChange({ minSamples: e.target.value === "" ? null : Number(e.target.value) })
          }
        />
      </label>

      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Uso mínimo</span>
        <input
          type="number"
          min="0"
          inputMode="numeric"
          className={selectClass}
          data-testid="filter-min-usage"
          value={numberValue(value.minUsage)}
          onChange={(e) =>
            onChange({ minUsage: e.target.value === "" ? null : Number(e.target.value) })
          }
        />
      </label>

      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Prioridade mínima</span>
        <input
          type="number"
          min="0"
          max="100"
          inputMode="numeric"
          className={selectClass}
          data-testid="filter-min-priority"
          value={numberValue(value.minPriority)}
          onChange={(e) =>
            onChange({ minPriority: e.target.value === "" ? null : Number(e.target.value) })
          }
        />
      </label>

      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Ordenar por</span>
        <select
          className={selectClass}
          value={value.sort}
          data-testid="filter-sort"
          onChange={(e) => onChange({ sort: e.target.value as PerformanceSort })}
        >
          {PERFORMANCE_SORTS.map((s) => (
            <option key={s} value={s}>
              {SORT_LABEL_PT[s]}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="grid gap-2 text-xs sm:col-span-2">
        <legend className="text-muted-foreground">Recortes rápidos</legend>
        <div className="flex flex-wrap gap-3">
          <label className="inline-flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              data-testid="filter-only-negative"
              checked={value.onlyNegative}
              onChange={(e) => onChange({ onlyNegative: e.target.checked })}
            />
            Com feedback negativo
          </label>
          <label className="inline-flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              data-testid="filter-only-unused"
              checked={value.onlyUnused}
              onChange={(e) => onChange({ onlyUnused: e.target.checked })}
            />
            Sem uso
          </label>
          <label className="inline-flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              data-testid="filter-only-no-feedback"
              checked={value.onlyNoFeedback}
              onChange={(e) => onChange({ onlyNoFeedback: e.target.checked })}
            />
            Sem feedback
          </label>
        </div>
      </fieldset>
    </div>
  );
}

export interface PerformanceFiltersProps {
  value: PerformanceFilterState;
  onChange: (patch: Partial<PerformanceFilterState>) => void;
  onClear: () => void;
}

export function PerformanceFilters({ value, onChange, onClear }: PerformanceFiltersProps) {
  const [open, setOpen] = useState(false);
  const count = activeFilterCount(value);

  return (
    <section aria-label="Filtros" className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="relative flex-1 min-w-0">
          <span className="sr-only">Buscar aprendizados</span>
          <input
            type="search"
            placeholder="Buscar por título, regra ou produto…"
            className="w-full min-h-11 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="filter-search"
            value={value.search}
            onChange={(e) => onChange({ search: e.target.value })}
          />
        </label>

        {/* Mobile: filtros em drawer */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="min-h-11 lg:hidden" data-testid="open-filters">
              <Filter className="h-4 w-4" aria-hidden="true" />
              <span>Filtros{count > 0 ? ` (${count})` : ""}</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Filtros e ordenação</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-4">
              <FilterFields value={value} onChange={onChange} />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 min-h-11" onClick={onClear}>
                  Limpar
                </Button>
                <Button className="flex-1 min-h-11" onClick={() => setOpen(false)}>
                  Aplicar
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {count > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 hidden lg:inline-flex"
            onClick={onClear}
            data-testid="clear-filters"
          >
            <X className="h-4 w-4" aria-hidden="true" /> Limpar ({count})
          </Button>
        )}
      </div>

      {/* Desktop: painel inline */}
      <div className="hidden lg:block rounded-lg border border-border bg-card p-3">
        <FilterFields value={value} onChange={onChange} />
      </div>
    </section>
  );
}
