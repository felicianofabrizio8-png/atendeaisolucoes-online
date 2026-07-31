// Tabela de performance de campanhas.
// Mobile-first: no celular as linhas viram cards (sem rolagem horizontal).
import { Megaphone, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { CampaignMetricsBundle, CampaignPerformance } from "@/lib/executive-ai/types";
import {
  ResponsiveDataView,
  type ResponsiveColumn,
} from "@/components/layout/ResponsiveDataView";

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
        <Minus className="h-3 w-3" />—
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

type Row = CampaignPerformance & { status: "melhor" | "pior"; avgScore: number };

const columns: ReadonlyArray<ResponsiveColumn<Row>> = [
  {
    id: "name",
    header: "Campanha",
    role: "primary",
    cell: (c) => <span className="md:truncate md:max-w-[220px] md:block">{c.name}</span>,
  },
  { id: "cpl", header: "CPL", align: "right", cell: (c) => formatBRL(c.costPerLead) },
  {
    id: "conv",
    header: "Conversas",
    align: "right",
    cell: (c) => (
      <span className="text-muted-foreground">{formatBRL(c.costPerConversation)}</span>
    ),
  },
  {
    id: "status",
    header: "Status",
    role: "badge",
    cell: (c) => (
      <span
        className={
          c.status === "melhor"
            ? "text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500"
            : "text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500"
        }
      >
        {c.status}
      </span>
    ),
  },
  {
    id: "trend",
    header: "Tendência",
    cell: (c) => (
      <span className="text-xs">
        <Trend score={c.score} avg={c.avgScore} />
      </span>
    ),
  },
  {
    id: "insight",
    header: "Insight",
    cell: (c) => (
      <span className="text-xs text-muted-foreground">
        {c.leads} leads · score {c.score.toFixed(1)}
      </span>
    ),
  },
];

export function ExecutiveCampaigns({ campaigns }: { campaigns: CampaignMetricsBundle }) {
  const base: (CampaignPerformance & { status: "melhor" | "pior" })[] = [
    ...campaigns.best.map((c) => ({ ...c, status: "melhor" as const })),
    ...campaigns.worst.map((c) => ({ ...c, status: "pior" as const })),
  ];
  const avgScore = base.length > 0 ? base.reduce((s, c) => s + c.score, 0) / base.length : 0;
  const rows: Row[] = base.map((c) => ({ ...c, avgScore }));

  return (
    <section
      aria-labelledby="exec-camp-title"
      className="rounded-2xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex">
        <div className="flex min-w-0 items-center gap-2">
          <Megaphone className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <h2 id="exec-camp-title" className="truncate text-base font-semibold text-foreground">
            Campanhas
          </h2>
        </div>
        {campaigns.avgCostPerLead > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground sm:ml-auto">
            CPL médio {formatBRL(campaigns.avgCostPerLead)}
          </span>
        )}
      </div>

      <ResponsiveDataView
        label="Performance de campanhas"
        columns={columns}
        rows={rows}
        getRowKey={(c) => c.id}
        emptyState={
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Volume insuficiente — nenhuma campanha atingiu o mínimo (spend ≥ R$ 50 ou 5+ leads)
            para classificação.
          </div>
        }
      />
    </section>
  );
}
