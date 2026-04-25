import { createFileRoute, Link } from "@tanstack/react-router";
import { dashboardSummary, sortedConversations, getLead, formatBRL, timeAgo } from "@/data/mock";
import { ChannelBadge, StatusBadge, UrgentDot } from "@/components/Badges";
import { AlertTriangle, Flame, CalendarClock, DollarSign, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Atende Ai! — Dashboard" },
      { name: "description", content: "Painel de atendimento de leads via WhatsApp, Instagram e Facebook." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const summary = dashboardSummary();
  const attention = sortedConversations()
    .filter((c) => c.awaitingReply)
    .slice(0, 5);

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="px-6 md:px-8 pt-6 pb-4 border-b border-border">
        <h1 className="text-2xl font-semibold tracking-tight">Bom dia 👋</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Quem precisa de atenção agora para não perder venda?
        </p>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-6 md:p-8">
        <KpiCard
          icon={AlertTriangle}
          label="Sem resposta"
          value={summary.noResponse}
          tone="urgent"
          hint="Responda agora"
        />
        <KpiCard
          icon={Flame}
          label="Leads quentes"
          value={summary.hot}
          tone="hot"
          hint="Pronto para fechar"
        />
        <KpiCard
          icon={CalendarClock}
          label="Follow-ups hoje"
          value={summary.followUpsToday}
          tone="warm"
          hint="Não esqueça"
        />
        <KpiCard
          icon={DollarSign}
          label="Em negociação"
          value={formatBRL(summary.negotiating)}
          tone="primary"
          hint="Valor potencial"
        />
      </section>

      <section className="px-6 md:px-8 pb-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            🔥 Quem precisa de atenção agora
          </h2>
          <Link to="/inbox" className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">
            Ver caixa completa <ChevronRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {attention.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground text-center">
              Tudo respondido. ✨
            </div>
          )}
          <ul className="divide-y divide-border">
            {attention.map((c) => {
              const lead = getLead(c.leadId)!;
              return (
                <li key={c.id}>
                  <Link
                    to="/inbox/$conversationId"
                    params={{ conversationId: c.id }}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40"
                  >
                    {c.slaBreached ? <UrgentDot /> : <span className="h-2 w-2 rounded-full bg-primary" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{lead.name}</span>
                        <ChannelBadge channel={c.channel} />
                        <StatusBadge status={lead.status} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {lead.product ?? "Sem produto"} · {lead.estimatedValue ? formatBRL(lead.estimatedValue) : "—"}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      há {timeAgo(c.lastMessageAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}

const toneStyles = {
  urgent: { bg: "bg-[var(--status-urgent)]/10", text: "text-[var(--status-urgent)]" },
  hot: { bg: "bg-[var(--status-hot)]/10", text: "text-[var(--status-hot)]" },
  warm: { bg: "bg-[var(--status-warm)]/10", text: "text-[var(--status-warm)]" },
  primary: { bg: "bg-primary/10", text: "text-primary" },
} as const;

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: typeof AlertTriangle;
  label: string;
  value: number | string;
  tone: keyof typeof toneStyles;
  hint: string;
}) {
  const s = toneStyles[tone];
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className={`h-8 w-8 rounded-md ${s.bg} ${s.text} flex items-center justify-center`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-2">{hint}</div>
    </div>
  );
}
