// src/components/goals/GoalListView.tsx
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  formatGoalValue,
  METRICS,
  STATUS_LABEL,
  type Goal,
  type GoalProgress,
  type GoalStatus,
} from "@/lib/goals/model";
import { StatusBadge } from "./GoalCard";

const FILTERS: GoalStatus[] = ["no_ritmo", "em_risco", "atrasada", "concluida", "sem_dados"];
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function GoalListView({
  goals,
  progress,
  members,
  onOpen,
}: {
  goals: Goal[];
  progress: Map<string, GoalProgress>;
  members: Array<{ id: string; name: string }>;
  onOpen: (goal: Goal) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<GoalStatus | null>(null);
  const [person, setPerson] = useState("");
  const rows = useMemo(
    () =>
      goals.filter((goal) => {
        if (query && !fold(goal.name).includes(fold(query))) return false;
        if (status && progress.get(goal.id)?.status !== status) return false;
        if (person && !goal.memberIds.includes(person)) return false;
        return true;
      }),
    [goals, progress, query, status, person],
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-56">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            aria-label="Buscar metas"
            className="h-10 w-full rounded-full border border-border bg-transparent pl-9 pr-3 text-sm"
            placeholder="Buscar metas"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {members.length > 0 && (
          <select
            aria-label="Pessoa"
            className="h-10 rounded-full border border-border bg-transparent px-3 text-sm"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
          >
            <option value="">Todas as pessoas</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            className="gl-filter"
            onClick={() => setStatus(status === s ? null : s)}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <ul className="divide-y divide-border rounded-2xl border border-border">
        {rows.map((goal) => {
          const p = progress.get(goal.id);
          return (
            <li key={goal.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
                onClick={() => onOpen(goal)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{goal.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {goal.measure === "automatica" && goal.metric
                      ? METRICS[goal.metric].label
                      : `À mão · ${goal.unit}`}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm tabular-nums">
                  {formatGoalValue(p?.value ?? null, goal)}
                  <span className="block text-xs text-muted-foreground">
                    de {formatGoalValue(goal.target, goal)}
                  </span>
                </span>
                <StatusBadge status={p?.status ?? "sem_dados"} />
              </button>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhuma meta com esse filtro.
          </li>
        )}
      </ul>
    </div>
  );
}
