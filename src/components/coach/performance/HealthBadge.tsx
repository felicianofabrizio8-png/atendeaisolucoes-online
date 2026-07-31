// SPRINT 4 · FASE 5 — Badge de saúde do aprendizado.
// Nunca depende apenas de cor: sempre exibe ícone + rótulo textual.
import { cn } from "@/lib/utils";
import { HEALTH_PRESENTATION, type CoachLearningHealth } from "@/lib/coach-learnings/performance/health";

export interface HealthBadgeProps {
  code: string;
  className?: string;
  compact?: boolean;
}

export function HealthBadge({ code, className, compact }: HealthBadgeProps) {
  const preset =
    HEALTH_PRESENTATION[code as CoachLearningHealth] ?? HEALTH_PRESENTATION.no_evidence;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        preset.className,
        className,
      )}
      title={preset.hint}
      aria-label={`Saúde: ${preset.label}. ${preset.hint}`}
      data-testid={`health-${code}`}
    >
      <span aria-hidden="true">{preset.icon}</span>
      {!compact && <span>{preset.label}</span>}
    </span>
  );
}
