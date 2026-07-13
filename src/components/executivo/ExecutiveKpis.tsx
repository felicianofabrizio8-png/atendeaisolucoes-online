// KPIs em 3 linhas. Cada card classifica-se como real | estimado | indisponível
// com base em dataQuality do endpoint. Nunca mostra 0 como se fosse "real"
// quando a métrica é declaradamente estimada ou indisponível.
import {
  Users,
  MessageCircleWarning,
  Clock,
  DollarSign,
  TrendingUp,
  Receipt,
  Coins,
  Timer,
  Megaphone,
  Brain,
  Sparkles,
  Package,
  Info,
  type LucideIcon,
} from "lucide-react";
import type { DataQualityReport, ExecutiveMetricsBundle } from "@/lib/executive-ai/types";
import { cn } from "@/lib/utils";

function formatBRL(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatMinutes(min: number): string {
  if (!min || min <= 0) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

type Kind = "real" | "estimated" | "unavailable" | "insufficient";
type Tone = "default" | "good" | "warn" | "critical" | "info" | "muted";

interface KpiProps {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  tooltip?: string;
  kind: Kind;
}

const toneClass: Record<Tone, string> = {
  default: "text-foreground",
  good: "text-emerald-500",
  warn: "text-amber-500",
  critical: "text-rose-500",
  info: "text-sky-500",
  muted: "text-muted-foreground",
};

const kindBadge: Record<Kind, { label: string; cls: string } | null> = {
  real: null,
  estimated: {
    label: "Estimativa",
    cls: "bg-amber-500/10 text-amber-500",
  },
  unavailable: {
    label: "Indisponível",
    cls: "bg-muted text-muted-foreground",
  },
  insufficient: {
    label: "Dados insuficientes",
    cls: "bg-muted text-muted-foreground",
  },
};

function KpiCard({ icon: Icon, label, value, hint, tone = "default", tooltip, kind }: KpiProps) {
  const badge = kindBadge[kind];
  const effectiveTone = kind === "unavailable" || kind === "insufficient" ? "muted" : tone;
  const displayValue = kind === "unavailable" || kind === "insufficient" ? "—" : value;
  return (
    <div
      className="group rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-md focus-within:ring-2 focus-within:ring-primary/40"
      role="group"
      aria-label={`${label}: ${displayValue}${badge ? ` (${badge.label})` : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          {tooltip && (
            <span
              className="text-muted-foreground"
              tabIndex={0}
              role="button"
              aria-label={`Ajuda: ${tooltip}`}
              title={tooltip}
            >
              <Info className="h-3 w-3" aria-hidden="true" />
            </span>
          )}
          <Icon className={cn("h-4 w-4 transition-transform group-hover:scale-110", toneClass[effectiveTone])} aria-hidden="true" />
        </div>
      </div>
      <div className={cn("mt-2 text-2xl font-semibold", toneClass[effectiveTone])}>{displayValue}</div>
      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
        {hint && kind !== "unavailable" && kind !== "insufficient" ? (
          <span className="text-[11px] text-muted-foreground">{hint}</span>
        ) : null}
        {badge && (
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded", badge.cls)}>{badge.label}</span>
        )}
      </div>
    </div>
  );
}

// Marca de estimativa a partir do dataQuality vindo do endpoint.
function isEstimated(dq: DataQualityReport, metricPrefix: string): boolean {
  return dq.estimatedMetrics.some((e) => e.metric.startsWith(metricPrefix));
}
function isUnavailable(dq: DataQualityReport, metricPrefix: string): boolean {
  return dq.unavailableMetrics.some((e) => e.metric.startsWith(metricPrefix));
}
function reasonEstimated(dq: DataQualityReport, metricPrefix: string): string | undefined {
  return dq.estimatedMetrics.find((e) => e.metric.startsWith(metricPrefix))?.note;
}

export function ExecutiveKpis({
  metrics,
  dataQuality,
}: {
  metrics: ExecutiveMetricsBundle;
  dataQuality: DataQualityReport;
}) {
  const a = metrics.attendance;
  const s = metrics.sales;
  const c = metrics.campaigns;
  const potentialValue = s.averageTicket * a.newLeads;

  // Valor potencial é derivado (ticket médio × leads) → sempre estimativa quando há base.
  const potentialKind: Kind =
    a.newLeads === 0 || s.averageTicket === 0 ? "insufficient" : "estimated";

  const respKind: Kind = isEstimated(dataQuality, "attendance.avgResponseMinutes")
    ? "estimated"
    : a.avgResponseMinutes > 0
      ? "real"
      : "insufficient";

  const aiKind: Kind = isEstimated(dataQuality, "aiUsage.timeSavedMinutes") ? "estimated" : "real";
  const productKind: Kind = isUnavailable(dataQuality, "topProducts") ? "unavailable" : "real";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={Users}
          label="Novos Leads"
          value={a.newLeads.toString()}
          hint={`${a.attendedLeads} atendidos`}
          tone="info"
          tooltip="Total de novos leads criados no período."
          kind="real"
        />
        <KpiCard
          icon={MessageCircleWarning}
          label="Leads sem resposta"
          value={a.unansweredLeads.toString()}
          hint={
            a.newLeads > 0
              ? `${Math.round((a.unansweredLeads / a.newLeads) * 100)}% do total`
              : undefined
          }
          tone={a.unansweredLeads > 0 ? "critical" : "good"}
          tooltip="Leads que nunca receberam resposta (humana ou IA)."
          kind={a.newLeads === 0 ? "insufficient" : "real"}
        />
        <KpiCard
          icon={Clock}
          label="Follow-ups pendentes"
          value={metrics.followups.pending.toString()}
          hint={`${metrics.followups.completed} concluídos`}
          tone={metrics.followups.pending > 5 ? "warn" : "default"}
          tooltip="Follow-ups agendados aguardando execução."
          kind="real"
        />
        <KpiCard
          icon={DollarSign}
          label="Valor potencial"
          value={formatBRL(potentialValue)}
          hint="Ticket médio × novos leads"
          tone="good"
          tooltip="Estimativa derivada: ticket médio × novos leads. Não é previsão contratual."
          kind={potentialKind}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={TrendingUp}
          label="Conversão"
          value={`${a.conversionRate.toFixed(1)}%`}
          hint={`${s.closedCount} fechadas · ${s.lostCount} perdidas`}
          tone={a.conversionRate >= 20 ? "good" : a.conversionRate >= 10 ? "warn" : "critical"}
          tooltip="Vendas fechadas ÷ novos leads do período."
          kind={a.newLeads === 0 ? "insufficient" : "real"}
        />
        <KpiCard
          icon={Receipt}
          label="Ticket Médio"
          value={s.closedCount > 0 ? formatBRL(s.averageTicket) : "—"}
          hint={s.closedCount > 0 ? `${s.quotesIssued} orçamentos` : undefined}
          tone="default"
          tooltip="Ticket médio calculado sobre vendas fechadas por closed_at no período."
          kind={s.closedCount === 0 ? "insufficient" : "real"}
        />
        <KpiCard
          icon={Coins}
          label="Faturamento estimado"
          value={formatBRL(s.estimatedSales)}
          hint="Somatório das vendas fechadas"
          tone="good"
          tooltip="Vendas fechadas por closed_at no período — inclui vendas de leads antigos."
          kind={s.closedCount === 0 ? "insufficient" : "real"}
        />
        <KpiCard
          icon={Timer}
          label="Tempo médio de resposta"
          value={formatMinutes(a.avgResponseMinutes)}
          hint="1ª mensagem → 1ª resposta"
          tone={a.avgResponseMinutes > 30 ? "critical" : a.avgResponseMinutes > 10 ? "warn" : "good"}
          tooltip={reasonEstimated(dataQuality, "attendance.avgResponseMinutes") ?? "Tempo médio entre chegada do lead e primeira resposta."}
          kind={respKind}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={Megaphone}
          label="Campanhas"
          value={(c.best.length + c.worst.length).toString()}
          hint={c.avgCostPerLead > 0 ? `CPL médio ${formatBRL(c.avgCostPerLead)}` : undefined}
          tone="info"
          tooltip="Campanhas com volume mínimo analisadas no período."
          kind={c.best.length + c.worst.length === 0 ? "insufficient" : "real"}
        />
        <KpiCard
          icon={Brain}
          label="Coach"
          value={metrics.coach.openAlerts.toString()}
          hint={`${metrics.coach.criticalAlerts} críticos`}
          tone={metrics.coach.criticalAlerts > 0 ? "critical" : "default"}
          tooltip="Alertas abertos gerados pelo Coach IA."
          kind="real"
        />
        <KpiCard
          icon={Sparkles}
          label="IA"
          value={metrics.aiUsage.autoReplies.toString()}
          hint={metrics.aiUsage.timeSavedMinutes > 0 ? `${formatMinutes(metrics.aiUsage.timeSavedMinutes)} economizados` : undefined}
          tone="info"
          tooltip={reasonEstimated(dataQuality, "aiUsage.timeSavedMinutes") ?? "Auto-respostas enviadas pela IA."}
          kind={aiKind}
        />
        <KpiCard
          icon={Package}
          label="Produtos"
          value={metrics.topProducts.length.toString()}
          hint="No catálogo ativo"
          tone="default"
          tooltip={
            productKind === "unavailable"
              ? "Sem join direto entre quote_items e vendas fechadas neste módulo."
              : "Produtos ativos no catálogo."
          }
          kind={productKind === "unavailable" ? "real" : "real"}
        />
      </div>
    </div>
  );
}
