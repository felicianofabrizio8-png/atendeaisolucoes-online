// src/components/goals/GoalCard.tsx
import type { CSSProperties, ReactNode } from "react";
import { CalendarClock, Users } from "lucide-react";
import { formatGoalValue, STATUS_LABEL, type Goal, type GoalProgress } from "@/lib/goals/model";
import { WaveProgress } from "./WaveProgress";

export function StatusBadge({ status }: { status: GoalProgress["status"] }) {
  return (
    <span className="gl-badge" data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function GoalCard({
  goal,
  progress,
  members,
  onOpen,
  variant = "compact",
  footer,
}: {
  goal: Goal;
  progress?: GoalProgress;
  members: Array<{ id: string; name: string }>;
  onOpen?: (goal: Goal) => void;
  variant?: "highlight" | "compact";
  footer?: ReactNode;
}) {
  const status = progress?.status ?? "sem_dados";
  const value = formatGoalValue(progress?.value ?? null, goal);
  const target = formatGoalValue(goal.target, goal);
  const names = goal.memberIds.map((id) => members.find((m) => m.id === id)?.name ?? "ex-membro");
  return (
    <article
      className="gl-card"
      data-variant={variant}
      style={{ "--gl-hue": goal.hue } as CSSProperties}
    >
      <button
        type="button"
        className="gl-card-open"
        onClick={() => onOpen?.(goal)}
        aria-label={`Abrir ${goal.name}`}
      />
      <header className="flex items-start justify-between gap-2">
        <h3 className="gl-card-title">{goal.name}</h3>
        <StatusBadge status={status} />
      </header>
      <p className="gl-card-value">
        <strong>{value}</strong> <span>de {target}</span>
      </p>
      <WaveProgress
        pct={progress?.pct ?? 0}
        status={status}
        size={variant === "highlight" ? "lg" : "sm"}
        label={`${Math.round(progress?.pct ?? 0)}% · ${value} de ${target}`}
      />
      <p className="gl-card-meta">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden />
        {progress ? `até ${progress.periodEnd.split("-").reverse().slice(0, 2).join("/")}` : "—"}
        {names.length > 0 && (
          <>
            <Users className="ml-2 h-3.5 w-3.5" aria-hidden />
            <span className="truncate">{names.join(", ")}</span>
          </>
        )}
      </p>
      {footer}
    </article>
  );
}
