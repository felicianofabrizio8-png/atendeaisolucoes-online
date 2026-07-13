// Cabeçalho do Dashboard Executivo.
import { RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SnapshotPeriod } from "@/lib/executive-snapshot";

interface Props {
  displayName: string;
  generatedAt?: string;
  isFetching: boolean;
  onRefresh: () => void;
  period: SnapshotPeriod;
  onPeriodChange: (p: SnapshotPeriod) => void;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

const PERIODS: { value: SnapshotPeriod; label: string }[] = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
];

export function ExecutiveHeader({
  displayName,
  generatedAt,
  isFetching,
  onRefresh,
  period,
  onPeriodChange,
}: Props) {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(now);
  const updatedStr = generatedAt
    ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(
        new Date(generatedAt),
      )
    : "—";

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5 md:p-6 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Executive Intelligence
          </div>
          <h1 className="mt-1 text-2xl md:text-3xl font-semibold text-foreground">
            {greeting()}, {displayName}
          </h1>
          <p className="text-sm text-muted-foreground capitalize">Hoje é {dateStr}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Última atualização: <span className="text-foreground font-medium">{updatedStr}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div
            className="inline-flex rounded-lg border border-border bg-background p-0.5"
            role="group"
            aria-label="Período de análise"
          >
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => onPeriodChange(p.value)}
                aria-pressed={period === p.value}
                aria-label={`Ver últimos ${p.label}`}
                className={cn(
                  "px-3 py-1.5 text-xs rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  period === p.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={onRefresh}
            disabled={isFetching}
            aria-label={isFetching ? "Atualizando dados" : "Atualizar agora"}
            className={cn(
              "inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium",
              "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
              aria-hidden="true"
            />
            Atualizar Agora
          </button>
        </div>
      </div>
    </div>
  );
}
