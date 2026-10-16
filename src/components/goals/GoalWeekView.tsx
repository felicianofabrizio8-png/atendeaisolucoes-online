// src/components/goals/GoalWeekView.tsx
import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatGoalValue, type Goal, type GoalProgress, type GoalWeek } from "@/lib/goals/model";

const short = (date: string) => date.split("-").reverse().slice(0, 2).join("/");

function Cell({ goal, week }: { goal: Goal; week: GoalWeek }) {
  const actual =
    week.actual === null
      ? "—"
      : `${formatGoalValue(week.actual, goal)} / ${formatGoalValue(week.expected, goal)}`;
  return (
    <div className="gl-week-cell" data-status={week.status ?? "futura"}>
      <span className="gl-week-range">
        {short(week.startsOn)}–{short(week.endsOn)}
      </span>
      <strong>{actual}</strong>
    </div>
  );
}

export function GoalWeekView({
  goals,
  progress,
  onOpen,
}: {
  goals: Goal[];
  progress: Map<string, GoalProgress>;
  onOpen: (goal: Goal) => void;
}) {
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState(goals[0]?.id ?? "");
  if (!goals.length) return <p className="gl-empty">Nenhuma meta para mostrar.</p>;

  if (isMobile) {
    const goal = goals.find((x) => x.id === selected) ?? goals[0];
    const weeks = progress.get(goal.id)?.weeks ?? [];
    return (
      <div className="space-y-3">
        <select
          className="h-11 w-full rounded-2xl border border-border bg-transparent px-4 text-sm"
          value={goal.id}
          onChange={(e) => setSelected(e.target.value)}
          aria-label="Meta"
        >
          {goals.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <div className="gl-week-strip">
          {weeks.map((w) => (
            <Cell key={w.startsOn} goal={goal} week={w} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" role="table" aria-label="Metas por semana">
      {goals.map((goal) => (
        <div key={goal.id} role="row" className="gl-week-row">
          <button
            type="button"
            role="rowheader"
            className="gl-week-name"
            onClick={() => onOpen(goal)}
          >
            {goal.name}
          </button>
          <div className="gl-week-strip">
            {(progress.get(goal.id)?.weeks ?? []).map((w) => (
              <Cell key={w.startsOn} goal={goal} week={w} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
