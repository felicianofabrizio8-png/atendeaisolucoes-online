// KPIs em 3 linhas para o Dashboard Executivo.
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
  type LucideIcon,
} from "lucide-react";
import type { ExecutiveMetricsBundle } from "@/lib/executive-ai/types";
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

interface KpiProps {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "critical" | "info";
  tooltip?: string;
}

const toneClass: Record<NonNullable<KpiProps["tone"]>, string> = {
  default: "text-foreground",
  good: "text-emerald-500",
  warn: "text-amber-500",
  critical: "text-rose-500",
  info: "text-sky-500",
};

function KpiCard({ icon: Icon, label, value, hint, tone = "default", tooltip }: KpiProps) {
  return (
    <div
      title={tooltip}
      className="group rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className={cn("h-4 w-4 transition-transform group-hover:scale-110", toneClass[tone])} />
      </div>
      <div className={cn("mt-2 text-2xl font-semibold", toneClass[tone])}>{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function ExecutiveKpis({ metrics }: { metrics: ExecutiveMetricsBundle }) {
  const a = metrics.attendance;
  const s = metrics.sales;
  const c = metrics.campaigns;
  const potentialValue = s.averageTicket * a.newLeads;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={Users}
          label="Novos Leads"
          value={a.newLeads.toString()}
          hint={`${a.attendedLeads} atendidos`}
          tone="info"
          tooltip="Total de novos leads no período."
        />
        <KpiCard
          icon={MessageCircleWarning}
          label="Leads sem resposta"
          value={a.unansweredLeads.toString()}
          hint={
            a.newLeads > 0
              ? `${Math.round((a.unansweredLeads / a.newLeads) * 100)}% do total`
              : "—"
          }
          tone={a.unansweredLeads > 0 ? "critical" : "good"}
          tooltip="Leads que nunca receberam resposta."
        />
        <KpiCard
          icon={Clock}
          label="Follow-ups pendentes"
          value={metrics.followups.pending.toString()}
          hint={`${metrics.followups.completed} concluídos`}
          tone={metrics.followups.pending > 5 ? "warn" : "default"}
          tooltip="Follow-ups agendados aguardando execução."
        />
        <KpiCard
          icon={DollarSign}
          label="Valor potencial"
          value={formatBRL(potentialValue)}
          hint="Ticket médio × novos leads"
          tone="good"
          tooltip="Estimativa: ticket médio multiplicado pelos novos leads."
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={TrendingUp}
          label="Conversão"
          value={`${a.conversionRate.toFixed(1)}%`}
          hint={`${s.closedCount} fechadas / ${s.lostCount} perdidas`}
          tone={a.conversionRate >= 20 ? "good" : a.conversionRate >= 10 ? "warn" : "critical"}
          tooltip="Vendas fechadas ÷ novos leads no período."
        />
        <KpiCard
          icon={Receipt}
          label="Ticket Médio"
          value={formatBRL(s.averageTicket)}
          hint={`${s.quotesIssued} orçamentos`}
          tone="default"
          tooltip="Ticket médio das vendas fechadas."
        />
        <KpiCard
          icon={Coins}
          label="Faturamento estimado"
          value={formatBRL(s.estimatedSales)}
          hint="Vendas fechadas no período"
          tone="good"
          tooltip="Soma dos valores das vendas fechadas."
        />
        <KpiCard
          icon={Timer}
          label="Tempo médio de resposta"
          value={formatMinutes(a.avgResponseMinutes)}
          hint="1ª mensagem → 1ª resposta"
          tone={a.avgResponseMinutes > 30 ? "critical" : a.avgResponseMinutes > 10 ? "warn" : "good"}
          tooltip="Tempo entre a chegada do lead e a primeira resposta."
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={Megaphone}
          label="Campanhas"
          value={(c.best.length + c.worst.length).toString()}
          hint={`CPL médio ${formatBRL(c.avgCostPerLead)}`}
          tone="info"
          tooltip="Total de campanhas analisadas no período."
        />
        <KpiCard
          icon={Brain}
          label="Coach"
          value={metrics.coach.openAlerts.toString()}
          hint={`${metrics.coach.criticalAlerts} críticos`}
          tone={metrics.coach.criticalAlerts > 0 ? "critical" : "default"}
          tooltip="Alertas abertos do Coach IA."
        />
        <KpiCard
          icon={Sparkles}
          label="IA"
          value={metrics.aiUsage.autoReplies.toString()}
          hint={`${formatMinutes(metrics.aiUsage.timeSavedMinutes)} economizados`}
          tone="info"
          tooltip="Auto-respostas enviadas pela IA."
        />
        <KpiCard
          icon={Package}
          label="Produtos"
          value={metrics.topProducts.length.toString()}
          hint="No catálogo ativo"
          tone="default"
          tooltip="Produtos disponíveis no catálogo."
        />
      </div>
    </div>
  );
}
