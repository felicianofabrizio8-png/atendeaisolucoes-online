// Barra de filtros das proposals.
// Fase 3.1b · Sub-rodada (d):
//   · Validação de intervalo de datas (dateFrom > dateTo → erro visível).
//   · Contador "N de Total" mostrando efeito dos filtros.
//   · Confidence exibida como percentual auxiliar.
//   · Todos os selects/inputs continuam totalmente acessíveis via label.
import { useMemo } from "react";
import {
  COACH_CATEGORY_LABEL,
  COACH_TYPE_LABEL,
  type CoachRuleCategory,
  type CoachRuleType,
} from "@/lib/coach-rules/coach-rules.repository";
import { DEFAULT_FILTERS, PROPOSAL_STATUS_LABEL } from "./constants";
import type { ProposalFilters, ProposalRow } from "./types";

export function ProposalFilterBar({
  filters,
  onChange,
  proposals,
  filteredCount,
}: {
  filters: ProposalFilters;
  onChange: (f: ProposalFilters) => void;
  proposals: ProposalRow[];
  filteredCount?: number;
}) {
  const statuses = useMemo(
    () => Array.from(new Set(proposals.map((p) => p.status))).sort(),
    [proposals],
  );
  const categories = useMemo(
    () => Array.from(new Set(proposals.map((p) => p.category))).sort(),
    [proposals],
  );
  const ruleTypes = useMemo(
    () => Array.from(new Set(proposals.map((p) => p.rule_type))).sort(),
    [proposals],
  );

  const update = <K extends keyof ProposalFilters>(k: K, v: ProposalFilters[K]) =>
    onChange({ ...filters, [k]: v });

  const invalidRange =
    filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo ? true : false;
  const shown = typeof filteredCount === "number" ? filteredCount : proposals.length;
  const total = proposals.length;
  const confidencePct = Math.round((filters.minConfidence ?? 0) * 100);

  return (
    <div className="rounded-md border border-border p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-sm" data-testid="proposals-header">
          Proposals ({shown}
          {shown !== total ? ` de ${total}` : ""})
        </h3>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="text-[11px] text-primary hover:underline"
        >
          Limpar filtros
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <FilterSelect
          label="Categoria"
          value={filters.category}
          options={categories.map((c) => ({
            value: c,
            label: COACH_CATEGORY_LABEL[c as CoachRuleCategory] ?? c,
          }))}
          onChange={(v) => update("category", v)}
        />
        <FilterSelect
          label="Tipo"
          value={filters.ruleType}
          options={ruleTypes.map((t) => ({
            value: t,
            label: COACH_TYPE_LABEL[t as CoachRuleType] ?? t,
          }))}
          onChange={(v) => update("ruleType", v)}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          options={statuses.map((s) => ({ value: s, label: PROPOSAL_STATUS_LABEL[s] ?? s }))}
          onChange={(v) => update("status", v)}
        />
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">
            Confidence min <span className="opacity-70">({confidencePct}%)</span>
          </span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={filters.minConfidence}
            onChange={(e) => update("minConfidence", Number(e.target.value) || 0)}
            className="h-8 rounded border border-border bg-background px-2 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Usuário (autor)</span>
          <input
            type="text"
            value={filters.ownerUser}
            onChange={(e) => update("ownerUser", e.target.value)}
            placeholder="uuid parcial"
            className="h-8 rounded border border-border bg-background px-2 text-xs font-mono"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">De</span>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => update("dateFrom", e.target.value)}
            aria-invalid={invalidRange || undefined}
            className="h-8 rounded border border-border bg-background px-2 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Até</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => update("dateTo", e.target.value)}
            aria-invalid={invalidRange || undefined}
            className="h-8 rounded border border-border bg-background px-2 text-xs"
          />
        </label>
      </div>
      {invalidRange && (
        <p
          role="alert"
          data-testid="proposals-date-range-error"
          className="text-[11px] text-destructive"
        >
          Intervalo inválido: a data inicial é posterior à final.
        </p>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded border border-border bg-background px-2 text-xs"
      >
        <option value="">Todos</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
