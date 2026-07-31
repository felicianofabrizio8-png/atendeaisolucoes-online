// SPRINT 4 · FASE 5 — Cards de resumo do painel de desempenho.
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatPercent,
  percentAriaLabel,
  PERIOD_LABEL_PT,
  type PeriodPreset,
  type PerformanceSummary,
} from "@/lib/coach-learnings/performance/types";

interface MetricCardProps {
  label: string;
  value: string;
  hint: string;
  /** Indica se a métrica é do período selecionado (temporal) ou acumulada. */
  scope: "acumulado" | "período";
  ariaValue?: string;
  testId?: string;
  emphasis?: boolean;
}

function MetricCard({ label, value, hint, scope, ariaValue, testId, emphasis }: MetricCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-3 min-w-0",
        emphasis && "border-primary/40",
      )}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span title={hint} aria-label={hint} tabIndex={0} className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </span>
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums" aria-label={ariaValue}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground">{scope}</div>
    </div>
  );
}

export interface PerformanceSummaryCardsProps {
  summary: PerformanceSummary | null;
  period: PeriodPreset;
  isLoading?: boolean;
}

export function PerformanceSummaryCards({
  summary,
  period,
  isLoading,
}: PerformanceSummaryCardsProps) {
  if (isLoading) {
    return (
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
        data-testid="summary-loading"
        aria-busy="true"
      >
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-[86px] animate-pulse rounded-lg border border-border bg-muted/50" />
        ))}
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        Sem dados de resumo para exibir.
      </div>
    );
  }

  const periodo = PERIOD_LABEL_PT[period].toLowerCase();

  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
      data-testid="performance-summary"
    >
      <MetricCard
        testId="card-active"
        label="Ativos"
        value={String(summary.active)}
        scope="acumulado"
        hint="Aprendizados em uso pelo Coach neste momento."
      />
      <MetricCard
        testId="card-paused"
        label="Pausados"
        value={String(summary.paused)}
        scope="acumulado"
        hint="Aprendizados inativos: editáveis, mas fora das sugestões."
      />
      <MetricCard
        testId="card-archived"
        label="Arquivados"
        value={String(summary.archived)}
        scope="acumulado"
        hint="Aprendizados arquivados. Nunca são usados pelo Coach."
      />
      <MetricCard
        testId="card-usage"
        label="Utilizações"
        value={String(summary.totalUsage)}
        scope="acumulado"
        hint="Somatório de aplicações confirmadas dos aprendizados (usage_count)."
      />
      <MetricCard
        testId="card-feedback"
        label="Feedbacks"
        value={String(summary.feedbackTotal)}
        scope="período"
        hint={`Avaliações 👍/👎 registradas em ${periodo}. Retries idempotentes não geram novo evento.`}
      />
      <MetricCard
        testId="card-positive-rate"
        label="Taxa positiva"
        value={formatPercent(summary.positiveRate)}
        ariaValue={percentAriaLabel(summary.positiveRate)}
        scope="período"
        emphasis
        hint={`Positivos ÷ total de feedbacks válidos em ${periodo}. Não considera uso sem avaliação. Exibe “—” quando não há feedback no período.`}
      />
      <MetricCard
        testId="card-low-confidence"
        label="Baixa confiança"
        value={String(summary.lowConfidence)}
        scope="acumulado"
        hint="Aprendizados não arquivados com confiança abaixo de 0,35."
      />
      <MetricCard
        testId="card-contextual"
        label="Seleção contextual"
        value={formatPercent(summary.contextualShare)}
        ariaValue={percentAriaLabel(summary.contextualShare)}
        scope="período"
        hint={`Proporção de recuperações com estratégia contextual_v1 em ${periodo}.`}
      />
      <MetricCard
        testId="card-fallback"
        label="Fallback estático"
        value={formatPercent(summary.fallbackShare)}
        ariaValue={percentAriaLabel(summary.fallbackShare)}
        scope="período"
        hint={`Proporção de recuperações que caíram no fallback estático em ${periodo}.`}
      />
      <MetricCard
        testId="card-never-used"
        label="Nunca usados"
        value={String(summary.neverUsed)}
        scope="acumulado"
        hint="Aprendizados que nunca foram recuperados nem aplicados."
      />
    </div>
  );
}
