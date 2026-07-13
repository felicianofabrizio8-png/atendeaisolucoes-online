// Tabela de performance de campanhas.
import { Megaphone, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { CampaignMetricsBundle, CampaignPerformance } from "@/lib/executive-ai/types";

function formatBRL(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(n);
}

function Trend({ score, avg }: { score: number; avg: number }) {
  if (avg === 0)
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus className="h-3 w-3" />
        —
      </span>
    );
  const up = score > avg * 1.1;
  const down = score < avg * 0.9;
  if (up)
    return (
      <span className="inline-flex items-center gap-1 text-emerald-500">
        <TrendingUp className="h-3 w-3" /> alta
      </span>
    );
  if (down)
    return (
      <span className="inline-flex items-center gap-1 text-rose-500">
        <TrendingDown className="h-3 w-3" /> baixa
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Minus className="h-3 w-3" /> estável
    </span>
  );
}

export function ExecutiveCampaigns({ campaigns }: { campaigns: CampaignMetricsBundle }) {
  const all: (CampaignPerformance & { status: "melhor" | "pior" })[] = [
    ...campaigns.best.map((c) => ({ ...c, status: "melhor" as const })),
    ...campaigns.worst.map((c) => ({ ...c, status: "pior" as const })),
  ];
  const avgScore =
    all.length > 0 ? all.reduce((s, c) => s + c.score, 0) / all.length : 0;

  return (
    <section aria-labelledby="exec-camp-title" className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Megaphone className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 id="exec-camp-title" className="text-base font-semibold text-foreground">Campanhas</h2>
        {campaigns.avgCostPerLead > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            CPL médio {formatBRL(campaigns.avgCostPerLead)}
          </span>
        )}
      </div>

      {all.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Volume insuficiente — nenhuma campanha atingiu o mínimo (spend ≥ R$ 50 ou 5+ leads) para classificação.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="text-left font-medium py-2 px-2">Campanha</th>
                <th className="text-right font-medium py-2 px-2">CPL</th>
                <th className="text-right font-medium py-2 px-2">Conversas</th>
                <th className="text-left font-medium py-2 px-2">Status</th>
                <th className="text-left font-medium py-2 px-2">Tendência</th>
                <th className="text-left font-medium py-2 px-2">Insight</th>
              </tr>
            </thead>
            <tbody>
              {all.map((c) => (
                <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 px-2 text-foreground truncate max-w-[220px]">{c.name}</td>
                  <td className="py-2 px-2 text-right text-foreground">
                    {formatBRL(c.costPerLead)}
                  </td>
                  <td className="py-2 px-2 text-right text-muted-foreground">
                    {formatBRL(c.costPerConversation)}
                  </td>
                  <td className="py-2 px-2">
                    <span
                      className={
                        c.status === "melhor"
                          ? "text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500"
                          : "text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500"
                      }
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-xs">
                    <Trend score={c.score} avg={avgScore} />
                  </td>
                  <td className="py-2 px-2 text-muted-foreground text-xs">
                    {c.leads} leads · score {c.score.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
