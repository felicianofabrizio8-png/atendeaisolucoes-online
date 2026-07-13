// Painel do Coach IA: agrega insights por categoria + contadores.
import { Brain, UserX, FileWarning, Clock, Lightbulb } from "lucide-react";
import type { ExecutiveDashboardBundle } from "@/lib/executive-ai/types";

const CARDS = [
  {
    key: "forgotten",
    label: "Clientes esquecidos",
    icon: UserX,
    tone: "text-rose-500 bg-rose-500/10",
    match: (cat: string) => cat === "forgotten_client",
  },
  {
    key: "quotes",
    label: "Orçamentos sem retorno",
    icon: FileWarning,
    tone: "text-amber-500 bg-amber-500/10",
    match: (cat: string) => cat === "commercial",
  },
  {
    key: "delay",
    label: "Demora no atendimento",
    icon: Clock,
    tone: "text-orange-500 bg-orange-500/10",
    match: (cat: string) => cat === "bottleneck" || cat === "operational",
  },
  {
    key: "opps",
    label: "Oportunidades",
    icon: Lightbulb,
    tone: "text-emerald-500 bg-emerald-500/10",
    match: (cat: string) => cat === "opportunity" || cat === "trending_product",
  },
] as const;

export function ExecutiveCoach({ bundle }: { bundle: ExecutiveDashboardBundle }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Brain className="h-4 w-4 text-primary" />
        <h2 className="text-base font-semibold text-foreground">Coach IA</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {bundle.metrics.coach.openAlerts} alertas · {bundle.metrics.coach.criticalAlerts} críticos
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {CARDS.map((c) => {
          const items = bundle.insights.filter((i) => c.match(i.category));
          const Icon = c.icon;
          return (
            <div key={c.key} className="rounded-xl border border-border p-4 bg-background/50">
              <div
                className={`inline-flex items-center justify-center h-8 w-8 rounded-lg ${c.tone}`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="mt-3 text-2xl font-semibold text-foreground">{items.length}</div>
              <div className="text-[11px] text-muted-foreground">{c.label}</div>
              {items[0] && (
                <div
                  className="mt-2 text-xs text-muted-foreground line-clamp-2"
                  title={items[0].title}
                >
                  {items[0].title}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
