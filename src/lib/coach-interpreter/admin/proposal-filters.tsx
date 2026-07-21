// Barra de filtros das proposals: categoria, tipo, status, confidence,
// autor, datas.
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
}: {
  filters: ProposalFilters;
  onChange: (f: ProposalFilters) => void;
  proposals: ProposalRow[];
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

  return (
    <div className="rounded-md border border-border p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Proposals ({proposals.length})</h3>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="text-[11px] text-primary hover:underline"
        >
          Limpar filtros
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
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
          <span className="text-muted-foreground">Confidence min</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={filters.minConfidence}
            onChange={(e) => update("minConfidence", Number(e.target.value) || 0)}
            className="h-7 rounded border border-border bg-background px-2 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Usuário (autor)</span>
          <input
            type="text"
            value={filters.ownerUser}
            onChange={(e) => update("ownerUser", e.target.value)}
            placeholder="uuid parcial"
            className="h-7 rounded border border-border bg-background px-2 text-xs font-mono"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">De</span>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => update("dateFrom", e.target.value)}
            className="h-7 rounded border border-border bg-background px-2 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Até</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => update("dateTo", e.target.value)}
            className="h-7 rounded border border-border bg-background px-2 text-xs"
          />
        </label>
      </div>
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
        className="h-7 rounded border border-border bg-background px-2 text-xs"
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
