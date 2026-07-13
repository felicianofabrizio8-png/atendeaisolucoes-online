// Painel "Atenção do CEO": lista insights agrupados por prioridade.
import { AlertTriangle, AlertCircle, Info, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExecutiveInsight } from "@/lib/executive-ai/types";

type Priority = "high" | "medium" | "low";

function priorityOf(i: ExecutiveInsight): Priority {
  if (i.level === "critical") return "high";
  if (i.level === "warn") return "medium";
  return "low";
}

const priorityMeta: Record<
  Priority,
  { label: string; icon: typeof AlertTriangle; color: string; ring: string }
> = {
  high: {
    label: "Prioridade Alta",
    icon: AlertTriangle,
    color: "text-rose-500",
    ring: "border-rose-500/30 bg-rose-500/5",
  },
  medium: {
    label: "Prioridade Média",
    icon: AlertCircle,
    color: "text-amber-500",
    ring: "border-amber-500/30 bg-amber-500/5",
  },
  low: {
    label: "Prioridade Baixa",
    icon: Info,
    color: "text-sky-500",
    ring: "border-sky-500/30 bg-sky-500/5",
  },
};

export function ExecutiveInsights({
  insights,
  generatedAt,
}: {
  insights: ExecutiveInsight[];
  generatedAt: string;
}) {
  const groups: Record<Priority, ExecutiveInsight[]> = { high: [], medium: [], low: [] };
  for (const i of insights) groups[priorityOf(i)].push(i);

  const date = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(generatedAt));

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Atenção do CEO</h2>
          <p className="text-xs text-muted-foreground">
            {insights.length} insight{insights.length === 1 ? "" : "s"} · atualizado {date}
          </p>
        </div>
      </div>

      {insights.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Tudo tranquilo por aqui. Nenhum insight crítico no momento.
        </div>
      ) : (
        <div className="space-y-5">
          {(["high", "medium", "low"] as Priority[]).map((p) => {
            const list = groups[p];
            if (list.length === 0) return null;
            const meta = priorityMeta[p];
            const Icon = meta.icon;
            return (
              <div key={p}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={cn("h-4 w-4", meta.color)} />
                  <h3 className={cn("text-xs uppercase tracking-wide font-semibold", meta.color)}>
                    {meta.label}
                  </h3>
                  <span className="text-xs text-muted-foreground">({list.length})</span>
                </div>
                <div className="space-y-2">
                  {list.map((ins) => (
                    <InsightCard key={ins.id} insight={ins} priority={p} date={date} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function InsightCard({
  insight,
  priority,
  date,
}: {
  insight: ExecutiveInsight;
  priority: Priority;
  date: string;
}) {
  const meta = priorityMeta[priority];
  const Icon = meta.icon;
  return (
    <details
      className={cn(
        "group rounded-lg border p-3 transition-colors",
        meta.ring,
        "hover:border-primary/40",
      )}
    >
      <summary className="flex items-start gap-3 cursor-pointer list-none">
        <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", meta.color)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">{insight.title}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {insight.category.replace("_", " ")}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              confiança: {insight.confidence}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2 group-open:line-clamp-none">
            {insight.description}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="mt-3 pl-7 space-y-2 text-xs">
        {insight.recommendation && (
          <div>
            <span className="text-muted-foreground">Recomendação: </span>
            <span className="text-foreground">{insight.recommendation}</span>
          </div>
        )}
        {insight.evidence?.metrics?.length > 0 && (
          <div>
            <span className="text-muted-foreground">Origem: </span>
            <span className="text-foreground">{insight.evidence.metrics.join(", ")}</span>
          </div>
        )}
        {insight.evidence?.reason && (
          <div className="text-muted-foreground italic">{insight.evidence.reason}</div>
        )}
        <div className="text-[10px] text-muted-foreground">Data: {date}</div>
      </div>
    </details>
  );
}
