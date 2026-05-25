import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Inbox as InboxIcon,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  TrendingUp,
  Radio,
  CalendarDays,
} from "lucide-react";
import { formatBRL } from "@/data/mock";
import { cn } from "@/lib/utils";
import {
  fetchReports,
  EMPTY_REPORTS,
  type ReportsData,
} from "@/services/reportsService";

export const Route = createFileRoute("/relatorios")({
  component: ReportsPage,
});

function ReportsPage() {
  const [data, setData] = useState<ReportsData>(EMPTY_REPORTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchReports()
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[relatorios] fetchReports falhou", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totalLossValue = data.lossReasons.reduce((s, r) => s + r.value, 0);
  const maxDay = data.leadsPerDay.reduce((m, d) => Math.max(m, d.count), 0);

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="h-14 px-4 md:px-6 border-b border-border flex items-center gap-3">
        <BarChart3 className="h-4 w-4 text-primary" />
        <div>
          <h1 className="text-sm font-semibold">Relatórios</h1>
          <p className="text-[11px] text-muted-foreground">
            {loading ? "Carregando dados…" : "Visão geral do desempenho da loja"}
          </p>
        </div>
      </header>

      <div className="p-4 md:p-6 space-y-6 max-w-6xl">
        {!loading && !data.hasData && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">Sem dados ainda</p>
          </div>
        )}

        {/* Funil */}
        <section>
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            Funil de leads
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              icon={InboxIcon}
              label="Leads recebidos"
              value={data.leadsReceived.toString()}
            />
            <KpiCard
              icon={MessageSquare}
              label="Leads respondidos"
              value={data.leadsResponded.toString()}
              hint={`${data.leadsReceived > 0 ? Math.round((data.leadsResponded / data.leadsReceived) * 100) : 0}% de resposta`}
            />
            <KpiCard
              icon={CheckCircle2}
              label="Vendas fechadas"
              value={data.closedCount.toString()}
              hint={`${data.conversionRate.toFixed(1)}% conversão`}
              tone="won"
            />
            <KpiCard
              icon={XCircle}
              label="Leads perdidos"
              value={data.lostCount.toString()}
              tone="lost"
            />
          </div>
        </section>

        {/* Performance */}
        <section>
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            Performance
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <KpiCard
              icon={Clock}
              label="Tempo médio de resposta"
              value={formatDuration(data.avgResponseMin)}
              hint={
                data.avgResponseMin > 0
                  ? "Da 1ª mensagem do lead à 1ª resposta"
                  : "Sem dados ainda"
              }
            />
            <KpiCard
              icon={DollarSign}
              label="Valor total vendido"
              value={formatBRL(data.totalSold)}
              hint={`${data.closedCount} ${data.closedCount === 1 ? "venda" : "vendas"}`}
              tone="won"
            />
            <KpiCard
              icon={TrendingUp}
              label="Orçamentos: Enviados / Criados"
              value={`${data.quoteSentCount} / ${data.quoteCount}`}
              hint={
                data.quoteCount > 0
                  ? `${Math.round((data.quoteSentCount / data.quoteCount) * 100)}% enviados`
                  : "Sem dados ainda"
              }
            />
          </div>
        </section>

        {/* Origem dos leads */}
        <section>
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2">
            <Radio className="h-3.5 w-3.5" /> Origem dos leads
          </h2>
          {data.sources.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">Sem dados ainda</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card divide-y divide-border">
              {data.sources.map((s) => {
                const pct =
                  data.leadsReceived > 0
                    ? (s.count / data.leadsReceived) * 100
                    : 0;
                return (
                  <div
                    key={s.source}
                    className="px-4 py-2.5 flex items-center gap-3"
                  >
                    <div className="flex-1 text-sm truncate">{s.source}</div>
                    <div className="h-1.5 w-40 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-xs tabular-nums w-20 text-right text-muted-foreground">
                      {s.count} · {pct.toFixed(0)}%
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Leads por dia */}
        <section>
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5" /> Leads por dia (últimos 14)
          </h2>
          {data.leadsPerDay.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">Sem dados ainda</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-end gap-1 h-32">
                {data.leadsPerDay.map((d) => {
                  const h = maxDay > 0 ? (d.count / maxDay) * 100 : 0;
                  return (
                    <div
                      key={d.day}
                      className="flex-1 flex flex-col items-center justify-end gap-1"
                      title={`${d.day}: ${d.count}`}
                    >
                      <div className="text-[10px] text-muted-foreground tabular-nums">
                        {d.count}
                      </div>
                      <div
                        className="w-full bg-primary/70 rounded-sm"
                        style={{ height: `${h}%`, minHeight: 2 }}
                      />
                      <div className="text-[9px] text-muted-foreground tabular-nums">
                        {d.day.slice(5)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Motivos de perda */}
        <section>
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            Motivos de perda
          </h2>
          {data.lossReasons.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhum lead marcado como perdido ainda.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-semibold">Motivo</th>
                    <th className="px-4 py-2 font-semibold w-24 text-right">
                      Leads
                    </th>
                    <th className="px-4 py-2 font-semibold w-32 text-right">
                      Valor estimado
                    </th>
                    <th className="px-4 py-2 font-semibold w-40">% do total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lossReasons.map((r, idx) => {
                    const pct =
                      data.lostCount > 0 ? (r.count / data.lostCount) * 100 : 0;
                    const isTop = idx === 0;
                    return (
                      <tr
                        key={r.reason}
                        className={cn(
                          "border-t border-border",
                          isTop && "bg-[var(--status-lost)]/5",
                        )}
                      >
                        <td className="px-4 py-2.5 text-sm">
                          <span className={cn(isTop && "font-semibold")}>
                            {r.reason}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {r.count}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {formatBRL(r.value)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden">
                              <div
                                className="h-full bg-[var(--status-lost)]"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-[11px] tabular-nums w-10 text-right text-muted-foreground">
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-secondary/20">
                    <td className="px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                      Total
                    </td>
                    <td className="px-4 py-2 text-right text-sm font-semibold tabular-nums">
                      {data.lostCount}
                    </td>
                    <td className="px-4 py-2 text-right text-sm font-semibold tabular-nums">
                      {formatBRL(totalLossValue)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: typeof InboxIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "won" | "lost";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            tone === "won" && "text-[var(--status-won)]",
            tone === "lost" && "text-[var(--status-lost)]",
            tone === "default" && "text-primary",
          )}
        />
        {label}
      </div>
      <div
        className={cn(
          "mt-2 text-2xl font-bold tabular-nums",
          tone === "won" && "text-[var(--status-won)]",
          tone === "lost" && "text-[var(--status-lost)]",
        )}
      >
        {value}
      </div>
      {hint && (
        <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>
      )}
    </div>
  );
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return "—";
  if (minutes < 1) return "< 1min";
  if (minutes < 60) return `${Math.round(minutes)}min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h < 24) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}
