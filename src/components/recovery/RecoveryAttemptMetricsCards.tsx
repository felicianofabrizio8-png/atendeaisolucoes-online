// Métricas operacionais da execução assistida (Fase 6.3.1).
// Componente PURAMENTE apresentacional: recebe números já agregados a partir
// de tentativas reais. Não calcula nada e não conhece Recovery Score.

import { cn } from "@/lib/utils";
import type { RecoveryAttemptMetrics } from "@/lib/recovery-exec/metrics";
import type { MetricPeriod } from "@/lib/recovery-attempts.functions";
import {
  CheckCircle2,
  Clock,
  MessageSquareReply,
  Send,
  TriangleAlert,
  XCircle,
} from "lucide-react";

export interface RecoveryAttemptMetricsCardsProps {
  metrics: RecoveryAttemptMetrics | null;
  period: MetricPeriod;
  onPeriodChange: (period: MetricPeriod) => void;
  loading?: boolean;
  error?: boolean;
  empty?: boolean;
  className?: string;
}

const PERIOD_LABEL: Record<MetricPeriod, string> = {
  hoje: "Hoje",
  "7d": "7 dias",
  "30d": "30 dias",
  "90d": "90 dias",
};

const TONE = {
  primary: "text-primary",
  amber: "text-amber-600 dark:text-amber-500",
  emerald: "text-emerald-600 dark:text-emerald-500",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
} as const;

export function RecoveryAttemptMetricsCards({
  metrics,
  period,
  onPeriodChange,
  loading = false,
  error = false,
  empty = false,
  className,
}: RecoveryAttemptMetricsCardsProps) {
  const m = metrics;

  const entries: Array<{
    key: string;
    icon: React.ReactNode;
    label: string;
    value: string | number;
    tone: keyof typeof TONE;
  }> = [
    { key: "today", icon: <Clock className="h-4 w-4" />, label: "Tentativas hoje", value: m?.today ?? 0, tone: "primary" },
    { key: "sent", icon: <Send className="h-4 w-4" />, label: "Enviadas", value: m?.sent ?? 0, tone: "primary" },
    { key: "failed", icon: <TriangleAlert className="h-4 w-4" />, label: "Falhas", value: m?.failed ?? 0, tone: "destructive" },
    { key: "waiting", icon: <Clock className="h-4 w-4" />, label: "Aguardando resposta", value: m?.waitingReply ?? 0, tone: "amber" },
    { key: "replied", icon: <MessageSquareReply className="h-4 w-4" />, label: "Responderam", value: m?.replied ?? 0, tone: "emerald" },
    { key: "recovered", icon: <CheckCircle2 className="h-4 w-4" />, label: "Recuperadas", value: m?.recovered ?? 0, tone: "emerald" },
    { key: "not_recovered", icon: <XCircle className="h-4 w-4" />, label: "Não recuperadas", value: m?.notRecovered ?? 0, tone: "muted" },
    { key: "reply_rate", icon: <MessageSquareReply className="h-4 w-4" />, label: "Taxa de resposta", value: `${m?.replyRate ?? 0}%`, tone: "primary" },
    { key: "recovery_rate", icon: <CheckCircle2 className="h-4 w-4" />, label: "Taxa de recuperação", value: `${m?.recoveryRate ?? 0}%`, tone: "emerald" },
  ];

  return (
    <section
      aria-label="Métricas de tentativas de recuperação"
      className={cn("space-y-2", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Tentativas de recuperação
        </h2>
        <div className="flex gap-1 overflow-x-auto" role="group" aria-label="Período das métricas">
          {(Object.keys(PERIOD_LABEL) as MetricPeriod[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => onPeriodChange(p)}
              className={cn(
                "h-9 sm:h-8 px-2.5 text-xs rounded-md border whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring",
                period === p
                  ? "border-primary bg-primary/10 text-primary font-semibold"
                  : "border-border hover:bg-accent",
              )}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
          Não foi possível carregar as métricas agora. Tente atualizar em instantes.
        </p>
      ) : empty && !loading ? (
        <p className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
          Nenhuma tentativa de recuperação neste período ainda.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {entries.map((e) => (
            <div
              key={e.key}
              className="rounded-lg border border-border bg-card p-2.5 min-w-0"
              data-testid={`attempt-metric-${e.key}`}
            >
              <div className={cn("flex items-center gap-1.5", TONE[e.tone])}>
                {e.icon}
                <span className="text-[11px] font-medium text-muted-foreground truncate">
                  {e.label}
                </span>
              </div>
              <p className="mt-1 text-lg font-bold tabular-nums">
                {loading ? <span className="inline-block h-5 w-8 rounded bg-muted animate-pulse" /> : e.value}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
