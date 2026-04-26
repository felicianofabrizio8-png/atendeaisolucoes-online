import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useSyncExternalStore } from "react";
import {
  BarChart3,
  Inbox as InboxIcon,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  TrendingUp,
} from "lucide-react";
import { conversations, formatBRL } from "@/data/mock";
import { listQuotes, subscribeQuotes } from "@/data/quotes";
import {
  getLeadsSnapshot,
  getMessagesSnapshot,
  subscribeLeadStore,
} from "@/data/leadStore";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/relatorios")({
  component: ReportsPage,
});

function useQuotes() {
  return useSyncExternalStore(subscribeQuotes, listQuotes, listQuotes);
}

function useLeadStore() {
  // Inscreve em mutações de leads/mensagens. O snapshot é uma referência estável
  // entre mutações (rebuild só ocorre dentro do notify()), evitando loops em useSyncExternalStore.
  const leads = useSyncExternalStore(
    subscribeLeadStore,
    getLeadsSnapshot,
    getLeadsSnapshot,
  );
  const messages = useSyncExternalStore(
    subscribeLeadStore,
    getMessagesSnapshot,
    getMessagesSnapshot,
  );
  return { leads, messages };
}

function ReportsPage() {
  const quotes = useQuotes();
  const { leads, messages } = useLeadStore();

  const stats = useMemo(() => {
    const received = conversations.length;
    const closed = leads.filter((l) => l.status === "fechado");
    const lost = leads.filter((l) => l.status === "perdido");

    // Lead respondido = tem ao menos uma mensagem do agente em alguma conversa do lead
    const leadConvIds = new Map<string, string[]>();
    for (const c of conversations) {
      const arr = leadConvIds.get(c.leadId) ?? [];
      arr.push(c.id);
      leadConvIds.set(c.leadId, arr);
    }
    const respondedLeadIds = new Set<string>();
    for (const [leadId, convIds] of leadConvIds) {
      const hasAgent = messages.some(
        (m) => convIds.includes(m.conversationId) && m.role === "agent",
      );
      if (hasAgent) respondedLeadIds.add(leadId);
    }
    const responded = respondedLeadIds.size;

    // Tempo médio de resposta: para cada conversa, primeira msg do lead → primeira resposta do agente depois dela
    const responseTimesMin: number[] = [];
    for (const c of conversations) {
      const conv = messages
        .filter((m) => m.conversationId === c.id)
        .sort((a, b) => +new Date(a.at) - +new Date(b.at));
      const firstLead = conv.find((m) => m.role === "lead");
      if (!firstLead) continue;
      const firstAgent = conv.find(
        (m) => m.role === "agent" && +new Date(m.at) > +new Date(firstLead.at),
      );
      if (!firstAgent) continue;
      const diffMin =
        (+new Date(firstAgent.at) - +new Date(firstLead.at)) / 60_000;
      responseTimesMin.push(diffMin);
    }
    const avgResponseMin =
      responseTimesMin.length > 0
        ? responseTimesMin.reduce((s, n) => s + n, 0) / responseTimesMin.length
        : 0;

    // Valor total vendido: prioriza closedValue; usa estimatedValue como fallback
    const totalSold = closed.reduce(
      (s, l) => s + (l.closedValue ?? l.estimatedValue ?? 0),
      0,
    );

    // Taxa de conversão (sobre leads recebidos)
    const conversionRate = received > 0 ? (closed.length / received) * 100 : 0;

    // Motivos de perda agregados
    const lossMap = new Map<string, { count: number; value: number }>();
    for (const l of lost) {
      const reason = l.lossReason ?? "Não informado";
      const cur = lossMap.get(reason) ?? { count: 0, value: 0 };
      cur.count += 1;
      cur.value += l.estimatedValue ?? 0;
      lossMap.set(reason, cur);
    }
    const lossReasons = [...lossMap.entries()]
      .map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => b.count - a.count);

    return {
      received,
      responded,
      closedCount: closed.length,
      lostCount: lost.length,
      avgResponseMin,
      totalSold,
      conversionRate,
      lossReasons,
      quoteCount: quotes.length,
      quoteSentCount: quotes.filter((q) => q.sent).length,
    };
  }, [quotes, leads, messages]);

  const totalLossValue = stats.lossReasons.reduce((s, r) => s + r.value, 0);

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="h-14 px-6 border-b border-border flex items-center gap-3">
        <BarChart3 className="h-4 w-4 text-primary" />
        <div>
          <h1 className="text-sm font-semibold">Relatórios</h1>
          <p className="text-[11px] text-muted-foreground">
            Visão geral do desempenho da loja
          </p>
        </div>
      </header>

      <div className="p-6 space-y-6 max-w-6xl">
        {/* Funil de leads */}
        <section>
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            Funil de leads
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              icon={InboxIcon}
              label="Leads recebidos"
              value={stats.received.toString()}
              tone="default"
            />
            <KpiCard
              icon={MessageSquare}
              label="Leads respondidos"
              value={stats.responded.toString()}
              hint={`${stats.received > 0 ? Math.round((stats.responded / stats.received) * 100) : 0}% de resposta`}
              tone="default"
            />
            <KpiCard
              icon={CheckCircle2}
              label="Vendas fechadas"
              value={stats.closedCount.toString()}
              hint={`${stats.conversionRate.toFixed(1)}% conversão`}
              tone="won"
            />
            <KpiCard
              icon={XCircle}
              label="Leads perdidos"
              value={stats.lostCount.toString()}
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
              value={formatDuration(stats.avgResponseMin)}
              hint={
                stats.avgResponseMin > 0
                  ? "Da 1ª mensagem do lead à 1ª resposta"
                  : "Sem dados ainda"
              }
            />
            <KpiCard
              icon={DollarSign}
              label="Valor total vendido"
              value={formatBRL(stats.totalSold)}
              hint={`${stats.closedCount} ${stats.closedCount === 1 ? "venda" : "vendas"}`}
              tone="won"
            />
            <KpiCard
              icon={TrendingUp}
              label="Orçamentos: Enviados / Criados"
              value={`${stats.quoteSentCount} / ${stats.quoteCount}`}
              hint={
                stats.quoteCount > 0
                  ? `${Math.round((stats.quoteSentCount / stats.quoteCount) * 100)}% enviados na conversa`
                  : "Nenhum orçamento criado ainda"
              }
            />
          </div>
        </section>

        {/* Motivos de perda */}
        <section>
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            Motivos de perda
          </h2>
          {stats.lossReasons.length === 0 ? (
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
                    <th className="px-4 py-2 font-semibold w-24 text-right">Leads</th>
                    <th className="px-4 py-2 font-semibold w-32 text-right">
                      Valor estimado
                    </th>
                    <th className="px-4 py-2 font-semibold w-40">% do total</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.lossReasons.map((r) => {
                    const pct =
                      stats.lostCount > 0 ? (r.count / stats.lostCount) * 100 : 0;
                    return (
                      <tr key={r.reason} className="border-t border-border">
                        <td className="px-4 py-2.5 text-sm">{r.reason}</td>
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
                            <span className="text-[11px] tabular-nums text-muted-foreground w-10 text-right">
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
                      {stats.lostCount}
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
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
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
