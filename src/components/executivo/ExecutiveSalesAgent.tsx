// ExecutiveSalesAgent — card do Sales Intelligence Agent no Dashboard Executivo.
// READ-ONLY. Apenas visualização.

import { AlertTriangle, Briefcase, Flame, RefreshCw, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { useSalesIntelligence, type SalesPeriod, SalesIntelligenceError } from "@/lib/sales-intelligence-client";
import type {
  SalesOpportunity,
  SalesOpportunityKind,
  SalesPriority,
} from "@/lib/sales-intelligence/SalesIntelligenceTypes";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<SalesOpportunityKind, string> = {
  hot_lead: "Lead quente",
  quote_pending: "Orçamento aguardando",
  quote_at_risk: "Orçamento em risco",
  awaiting_followup: "Follow-up pendente",
  forgotten_lead: "Lead esquecido",
  no_response: "Sem resposta interna",
  reengagement: "Reengajamento",
};

const PRIORITY_META: Record<SalesPriority, { label: string; cls: string }> = {
  high: { label: "Alta", cls: "bg-rose-500/15 text-rose-400 border-rose-500/40" },
  medium: { label: "Média", cls: "bg-amber-500/15 text-amber-400 border-amber-500/40" },
  low: { label: "Baixa", cls: "bg-sky-500/15 text-sky-400 border-sky-500/40" },
};

function formatBRL(v: number | null): string | null {
  if (v == null) return null;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

interface Props {
  period: SalesPeriod;
}

export function ExecutiveSalesAgent({ period }: Props) {
  const q = useSalesIntelligence(period);
  const forbidden = q.error instanceof SalesIntelligenceError && (q.error.status === 401 || q.error.status === 403);
  if (forbidden) return null; // já tratado pelo container principal

  return (
    <section
      aria-labelledby="sales-agent-title"
      className="rounded-2xl border border-border bg-card p-5 md:p-6"
    >
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <Briefcase className="h-5 w-5" />
          </div>
          <div>
            <h2 id="sales-agent-title" className="text-base font-semibold text-foreground flex items-center gap-2">
              Sales Intelligence Agent
              <span className="text-[10px] uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                Diretor Comercial AI
              </span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Prioridades comerciais determinísticas. 100% read-only. Nunca envia mensagens.
            </p>
          </div>
        </div>
        <button
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
          aria-label="Atualizar recomendações"
        >
          <RefreshCw className={cn("h-4 w-4", q.isFetching && "animate-spin")} />
        </button>
      </header>

      {q.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : q.error ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-muted-foreground flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-500 mt-0.5" />
          <span>Falha ao carregar recomendações. Tente novamente.</span>
        </div>
      ) : q.data ? (
        <SalesContent bundle={q.data} />
      ) : null}
    </section>
  );
}

function SalesContent({ bundle }: { bundle: NonNullable<ReturnType<typeof useSalesIntelligence>["data"]> }) {
  const { totals, opportunities, bottlenecks, conversionTrend } = bundle;

  return (
    <div className="space-y-5">
      {/* Métricas resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatBox label="Escaneados" value={totals.scanned} />
        <StatBox label="Oportunidades" value={totals.opportunities} tone="primary" />
        <StatBox label="Prioridade alta" value={totals.high} tone="critical" />
        <StatBox
          label="Conversão"
          value={`${bundle.conversionTrend.currentConversionRate.toFixed(1)}%`}
          trend={conversionTrend.direction}
        />
      </div>

      {/* Bottlenecks */}
      {bottlenecks.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Gargalos comerciais
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {bottlenecks.map((b) => (
              <div
                key={b.key}
                className={cn(
                  "rounded-lg border p-3 text-sm",
                  b.severity === "critical"
                    ? "border-rose-500/40 bg-rose-500/5"
                    : b.severity === "warn"
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-border bg-muted/30",
                )}
              >
                <p className="font-medium text-foreground">{b.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{b.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tendência conversão */}
      <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm flex items-start gap-2">
        {conversionTrend.direction === "up" ? (
          <TrendingUp className="h-4 w-4 text-emerald-400 mt-0.5" />
        ) : conversionTrend.direction === "down" ? (
          <TrendingDown className="h-4 w-4 text-rose-400 mt-0.5" />
        ) : (
          <Sparkles className="h-4 w-4 text-muted-foreground mt-0.5" />
        )}
        <div className="flex-1">
          <p className="text-foreground">{conversionTrend.note}</p>
          {conversionTrend.previousConversionRate !== null && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Snapshot anterior: {conversionTrend.previousConversionRate.toFixed(1)}%
              {conversionTrend.deltaPct !== null && ` · variação ${conversionTrend.deltaPct >= 0 ? "+" : ""}${conversionTrend.deltaPct.toFixed(1)}%`}
            </p>
          )}
        </div>
      </div>

      {/* Top oportunidades */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Top oportunidades ({opportunities.length})
        </h3>
        {opportunities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma oportunidade ativa encontrada no período. Bom sinal — ou hora de gerar novos leads.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {opportunities.slice(0, 10).map((o) => (
              <OpportunityRow key={o.id} opp={o} />
            ))}
          </ul>
        )}
      </div>

      <footer className="text-[11px] text-muted-foreground text-right">
        Gerado em {new Date(bundle.generatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        {bundle.fromCache && " · cache"}
      </footer>
    </div>
  );
}

function OpportunityRow({ opp }: { opp: SalesOpportunity }) {
  const prio = PRIORITY_META[opp.priority];
  const value = formatBRL(opp.meta.estimatedValue);
  return (
    <li className="p-3 md:p-4 hover:bg-muted/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground truncate">{opp.leadName}</span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", prio.cls)}>
              {prio.label}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
              {KIND_LABEL[opp.kind]}
            </span>
            {opp.meta.temperature === "quente" && <Flame className="h-3 w-3 text-rose-400" />}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{opp.reason}</p>
          <p className="text-sm text-foreground mt-1">
            <span className="text-primary">→</span> {opp.nextAction}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-foreground tabular-nums">{opp.score}</div>
          <div className="text-[10px] uppercase text-muted-foreground">score</div>
          {value && <div className="text-xs text-muted-foreground mt-1">{value}</div>}
          <div className="text-[10px] text-muted-foreground mt-0.5">
            confiança: {opp.confidence === "high" ? "alta" : opp.confidence === "medium" ? "média" : "baixa"}
          </div>
        </div>
      </div>
    </li>
  );
}

function StatBox({
  label,
  value,
  tone,
  trend,
}: {
  label: string;
  value: string | number;
  tone?: "primary" | "critical";
  trend?: "up" | "down" | "flat" | "unknown";
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-xl font-bold mt-1 tabular-nums flex items-center gap-1",
          tone === "primary" && "text-primary",
          tone === "critical" && "text-rose-400",
        )}
      >
        {value}
        {trend === "up" && <TrendingUp className="h-4 w-4 text-emerald-400" />}
        {trend === "down" && <TrendingDown className="h-4 w-4 text-rose-400" />}
      </div>
    </div>
  );
}
