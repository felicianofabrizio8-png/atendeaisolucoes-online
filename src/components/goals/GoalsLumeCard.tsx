import type { Goal } from "@/lib/goals/model";
import type { GoalInsight } from "@/lib/goals/api";

export function GoalsLumeCard({
  insights,
}: {
  insights: GoalInsight[];
  tips: GoalInsight[];
  goals: Goal[];
  canManage: boolean;
  onApply: (i: GoalInsight) => void;
  onDismiss: (i: GoalInsight) => void;
}) {
  const summary = insights.find((i) => i.kind === "resumo");
  return summary ? (
    <section aria-label="Lume" className="gl-panel">
      <p>{summary.body}</p>
    </section>
  ) : null;
}
