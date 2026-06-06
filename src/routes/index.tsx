import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  formatBRL,
  timeAgo,
  type Channel,
  type Conversation,
  type Lead,
  type Message,
} from "@/data/mock";
import {
  getConversations,
  getLeads,
  getMessagesFor,
  subscribeRepo,
} from "@/data/leadRepo";
import { listQuotes, subscribeQuotes, type Quote } from "@/data/quotes";
import { ChannelBadge } from "@/components/Badges";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth/AuthContext";
import {
  AlertTriangle,
  CalendarClock,
  DollarSign,
  Flame,
  Inbox,
  ChevronRight,
  Send,
  CheckCircle2,
  MessageSquare,
  ArrowDownLeft,
  ArrowUpRight,
  FileText,
  CalendarDays,
  Clock,
  UserRound,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Atende Ai! — Dashboard" },
      {
        name: "description",
        content:
          "Painel de atendimento de leads via WhatsApp, Instagram e Facebook.",
      },
    ],
  }),
  component: DashboardPage,
});

type Period = "hoje" | "7d" | "30d";
type ChannelFilter = "todos" | Channel;

type Visit = {
  id: string;
  title: string;
  scheduled_at: string;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  lead_id: string | null;
};

function startOfPeriod(period: Period): number {
  const now = new Date();
  if (period === "hoje") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const days = period === "7d" ? 7 : 30;
  return now.getTime() - days * 24 * 60 * 60 * 1000;
}

const ACTIVE_STATUSES: Lead["status"][] = [
  "novo",
  "aguardando",
  "morno",
  "quente",
];

function DashboardPage() {
  useSyncExternalStore(subscribeRepo, () => 0, () => 0);
  useSyncExternalStore(subscribeQuotes, () => 0, () => 0);

  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;

  const [period, setPeriod] = useState<Period>("hoje");
  const [channel, setChannel] = useState<ChannelFilter>("todos");
  const [visits, setVisits] = useState<Visit[]>([]);
  // forces "há X min" recálc a cada 60s
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(
          "id,title,scheduled_at,status,customer_name,customer_phone,lead_id",
        )
        .eq("company_id", companyId)
        .order("scheduled_at", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.warn("[dashboard] falha ao carregar visitas", error.message);
        return;
      }
      setVisits((data ?? []) as Visit[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const allLeads = getLeads();
  const allConversations = getConversations();
  const allQuotes = listQuotes();

  // Filtros
  const since = startOfPeriod(period);
  const matchesChannel = <T extends { channel?: Channel }>(item: T) =>
    channel === "todos" || item.channel === channel;

  const leadsFiltered = useMemo(
    () =>
      allLeads.filter(
        (l) =>
          (channel === "todos" || l.channel === channel) &&
          new Date(l.createdAt).getTime() >= since,
      ),
    [allLeads, channel, since],
  );

  const conversationsFiltered = useMemo(
    () => allConversations.filter(matchesChannel),
    [allConversations, channel],
  );

  // --- KPI ---
  const startToday = startOfPeriod("hoje");

  const leadsNewInRange = leadsFiltered.length;
  const noResponseNow = conversationsFiltered.filter(
    (c) => c.awaitingReply,
  ).length;

  const now = Date.now();
  const lateFollowUps = allLeads.filter(
    (l) =>
      (channel === "todos" || l.channel === channel) &&
      l.nextAction &&
      new Date(l.nextAction.dueAt).getTime() < now &&
      !["fechado", "perdido"].includes(l.status),
  );

  const negotiatingValue = allLeads
    .filter(
      (l) =>
        (channel === "todos" || l.channel === channel) &&
        ACTIVE_STATUSES.includes(l.status),
    )
    .reduce((s, l) => s + (l.estimatedValue ?? 0), 0);

  // --- Atenção agora ---
  const leadById = new Map(allLeads.map((l) => [l.id, l]));
  const noResponseConvs = conversationsFiltered
    .filter((c) => c.awaitingReply)
    .sort(
      (a, b) =>
        new Date(a.lastMessageAt).getTime() -
        new Date(b.lastMessageAt).getTime(),
    )
    .slice(0, 5);

  const overdueFollowUps = lateFollowUps
    .slice()
    .sort(
      (a, b) =>
        new Date(a.nextAction!.dueAt).getTime() -
        new Date(b.nextAction!.dueAt).getTime(),
    )
    .slice(0, 5);

  const leadsWithQuoteIds = new Set(allQuotes.map((q) => q.leadId));
  const waitingQuote = allLeads
    .filter(
      (l) =>
        (channel === "todos" || l.channel === channel) &&
        ACTIVE_STATUSES.includes(l.status) &&
        !leadsWithQuoteIds.has(l.id),
    )
    .slice(0, 5);

  // --- Movimento de hoje ---
  // mensagens: precisamos varrer as conversas (getMessagesFor)
  let receivedToday = 0;
  let sentToday = 0;
  for (const c of conversationsFiltered) {
    const msgs = getMessagesFor(c.id);
    for (const m of msgs) {
      const t = new Date(m.at).getTime();
      if (t < startToday) continue;
      if (m.role === "lead") receivedToday += 1;
      else if (m.role === "agent") sentToday += 1;
    }
  }
  const quotesSentToday = allQuotes.filter(
    (q) =>
      q.sent &&
      q.sentAt &&
      new Date(q.sentAt).getTime() >= startToday &&
      (channel === "todos" ||
        leadById.get(q.leadId)?.channel === channel),
  ).length;
  const closedToday = allLeads.filter(
    (l) =>
      l.status === "fechado" &&
      l.closedAt &&
      new Date(l.closedAt).getTime() >= startToday &&
      (channel === "todos" || l.channel === channel),
  ).length;

  // --- Próximas ações ---
  const upcomingVisits = visits
    .filter((v) => {
      const t = new Date(v.scheduled_at).getTime();
      return (
        t >= now - 60 * 60 * 1000 &&
        !["cancelada", "concluida"].includes(v.status)
      );
    })
    .slice(0, 4);

  const upcomingFollowUps = allLeads
    .filter(
      (l) =>
        (channel === "todos" || l.channel === channel) &&
        l.nextAction &&
        new Date(l.nextAction.dueAt).getTime() >= now &&
        !["fechado", "perdido"].includes(l.status),
    )
    .sort(
      (a, b) =>
        new Date(a.nextAction!.dueAt).getTime() -
        new Date(b.nextAction!.dueAt).getTime(),
    )
    .slice(0, 4);

  // “clientes para retornar”: leads aguardando + sem msg agente nas últimas 24h
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const toReturn = allLeads
    .filter((l) => {
      if (channel !== "todos" && l.channel !== channel) return false;
      if (!ACTIVE_STATUSES.includes(l.status)) return false;
      const conv = allConversations.find((c) => c.leadId === l.id);
      if (!conv) return false;
      return new Date(conv.lastMessageAt).getTime() < dayAgo;
    })
    .slice(0, 4);

  // --- Gráfico de leads por dia (últimos 14 dias) ---
  const chartData = useMemo(() => {
    const days = 14;
    const buckets: { day: string; count: number; label: string }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      buckets.push({
        day: d.toISOString().slice(0, 10),
        count: 0,
        label: d.toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
        }),
      });
    }
    const idx = new Map(buckets.map((b, i) => [b.day, i]));
    for (const l of allLeads) {
      if (channel !== "todos" && l.channel !== channel) continue;
      const key = new Date(l.createdAt).toISOString().slice(0, 10);
      const i = idx.get(key);
      if (i !== undefined) buckets[i].count += 1;
    }
    return buckets;
  }, [allLeads, channel]);

  const maxChart = Math.max(1, ...chartData.map((b) => b.count));

  const findConvIdByLead = (leadId: string) =>
    allConversations.find((c) => c.leadId === leadId)?.id;

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden safe-bottom">
      <header className="px-4 md:px-8 pt-4 md:pt-6 pb-3 md:pb-4 border-b border-border">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
              Bom dia 👋
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">
              Resumo do dia. Foque em quem está esperando.
            </p>
          </div>
        </div>
        <div className="mt-3 -mx-4 md:mx-0 px-4 md:px-0 flex items-center gap-2 overflow-x-auto scrollbar-none md:flex-wrap">
          <Segmented
            value={period}
            onChange={setPeriod}
            options={[
              { value: "hoje", label: "Hoje" },
              { value: "7d", label: "7 dias" },
              { value: "30d", label: "30 dias" },
            ]}
          />
          <Segmented
            value={channel}
            onChange={setChannel}
            options={[
              { value: "todos", label: "Todos" },
              { value: "whatsapp", label: "WhatsApp" },
              { value: "instagram", label: "Instagram" },
              { value: "facebook", label: "Facebook" },
            ]}
          />
        </div>
      </header>


      {/* KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 md:p-8">
        <KpiCard
          icon={Flame}
          label="Leads novos"
          sub={
            period === "hoje"
              ? "hoje"
              : period === "7d"
                ? "últimos 7 dias"
                : "últimos 30 dias"
          }
          value={leadsNewInRange}
          tone="hot"
        />
        <KpiCard
          icon={AlertTriangle}
          label="Sem resposta"
          sub="agora"
          value={noResponseNow}
          tone={noResponseNow > 0 ? "urgent" : "muted"}
        />
        <KpiCard
          icon={CalendarClock}
          label="Follow-ups"
          sub="atrasados"
          value={lateFollowUps.length}
          tone={lateFollowUps.length > 0 ? "warm" : "muted"}
        />
        <KpiCard
          icon={DollarSign}
          label="Em negociação"
          sub="valor potencial"
          value={formatBRL(negotiatingValue)}
          tone="primary"
        />
      </section>

      {/* Comercial IA */}
      {(() => {
        const inPeriod = (iso: string | null | undefined) =>
          !!iso && new Date(iso).getTime() >= since;
        const convsCh = allConversations.filter(matchesChannel);
        const hotNow = convsCh.filter((c) => {
          const lead = leadById.get(c.leadId);
          return c.leadTemperature === "quente" || lead?.status === "quente";
        }).length;
        const readyNow = convsCh.filter((c) => c.leadReadyToClose).length;
        const preIa = convsCh.filter(
          (c) => c.aiStatus === "pre_atendido_ia" || (c.autoReplyCount ?? 0) > 0,
        ).length;
        const takeovers = convsCh.filter(
          (c) =>
            c.aiStatus === "assumido_humano" ||
            (c.humanTakeoverAt && inPeriod(c.humanTakeoverAt)),
        ).length;

        // Tempo médio até resposta no período (lead → próximo agent)
        let gapSum = 0;
        let gapCount = 0;
        for (const c of convsCh) {
          const msgs = getMessagesFor(c.id);
          for (let i = 0; i < msgs.length - 1; i++) {
            const m = msgs[i];
            const n = msgs[i + 1];
            if (m.role === "lead" && n.role === "agent") {
              const t = new Date(m.at).getTime();
              if (t < since) continue;
              const dt = (new Date(n.at).getTime() - t) / 60000;
              if (dt >= 0 && dt < 60 * 24) {
                gapSum += dt;
                gapCount += 1;
              }
            }
          }
        }
        const avgResp = gapCount > 0 ? Math.round(gapSum / gapCount) : null;

        // Vendas recuperadas: fechado no período E IA atuou
        const recovered = allLeads.filter((l) => {
          if (channel !== "todos" && l.channel !== channel) return false;
          if (l.status !== "fechado") return false;
          if (!inPeriod(l.closedAt)) return false;
          const conv = allConversations.find((c) => c.leadId === l.id);
          return !!conv && ((conv.autoReplyCount ?? 0) > 0 || conv.aiStatus === "assumido_humano");
        });
        const recoveredCount = recovered.length;
        const recoveredValue = recovered.reduce((s, l) => s + (l.closedValue ?? 0), 0);

        return (
          <section className="px-4 md:px-8 pb-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">🤖</span>
              <h2 className="text-sm font-semibold uppercase tracking-wide">Comercial IA</h2>
              <span className="text-[10px] text-muted-foreground hidden md:inline">
                · pré-atendimento, qualificação e recuperação
              </span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              <KpiCard icon={Flame}        label="Leads quentes"      sub="agora"      value={hotNow}        tone={hotNow > 0 ? "hot" : "muted"} />
              <KpiCard icon={CheckCircle2} label="Prontos p/ fechar"  sub="agora"      value={readyNow}      tone={readyNow > 0 ? "good" : "muted"} />
              <KpiCard icon={MessageSquare} label="Pré-atendidos IA"   sub="conversas" value={preIa}         tone={preIa > 0 ? "primary" : "muted"} />
              <KpiCard icon={UserRound}    label="IA → humano"        sub="handoffs"   value={takeovers}     tone={takeovers > 0 ? "warm" : "muted"} />
              <KpiCard icon={Clock}        label="Resp. média"        sub="min (lead→agente)" value={avgResp !== null ? `${avgResp}m` : "—"} tone={avgResp !== null && avgResp <= 15 ? "good" : avgResp !== null ? "warm" : "muted"} />
              <KpiCard icon={DollarSign}   label="Vendas recuperadas" sub={`${recoveredCount} fechad${recoveredCount === 1 ? "o" : "os"}`} value={formatBRL(recoveredValue)} tone={recoveredCount > 0 ? "good" : "muted"} />
            </div>
          </section>
        );
      })()}



      {/* 3 blocos */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 px-4 md:px-8 pb-6">
        {/* Atenção agora */}
        <Block
          title="Atenção agora"
          empty={
            noResponseConvs.length === 0 &&
            overdueFollowUps.length === 0 &&
            waitingQuote.length === 0
          }
        >
          <SubSection
            label="Sem resposta"
            count={noResponseConvs.length}
            tone="urgent"
          >
            {noResponseConvs.map((c) => {
              const lead = leadById.get(c.leadId);
              if (!lead) return null;
              return (
                <RowLink
                  key={c.id}
                  to="/inbox/$conversationId"
                  params={{ conversationId: c.id }}
                  primary={lead.name}
                  secondary={
                    <span className="inline-flex items-center gap-1.5">
                      <ChannelBadge channel={c.channel} />
                      <span>há {timeAgo(c.lastMessageAt)}</span>
                    </span>
                  }
                  dotTone={c.slaBreached ? "urgent" : "warn"}
                />
              );
            })}
          </SubSection>

          <SubSection
            label="Follow-ups vencidos"
            count={overdueFollowUps.length}
            tone="warm"
          >
            {overdueFollowUps.map((l) => {
              const convId = findConvIdByLead(l.id);
              const target = convId ? (
                <RowLink
                  key={l.id}
                  to="/inbox/$conversationId"
                  params={{ conversationId: convId }}
                  primary={l.name}
                  secondary={l.nextAction?.label ?? "Follow-up"}
                  dotTone="warn"
                />
              ) : (
                <Row
                  key={l.id}
                  primary={l.name}
                  secondary={l.nextAction?.label ?? "Follow-up"}
                  dotTone="warn"
                />
              );
              return target;
            })}
          </SubSection>

          <SubSection
            label="Aguardando orçamento"
            count={waitingQuote.length}
            tone="hot"
          >
            {waitingQuote.map((l) => (
              <RowLink
                key={l.id}
                to="/orcamentos"
                primary={l.name}
                secondary={l.product ?? "Sem produto definido"}
                dotTone="hot"
              />
            ))}
          </SubSection>
        </Block>

        {/* Movimento de hoje */}
        <Block title="Movimento de hoje">
          <Stat
            icon={ArrowDownLeft}
            label="Mensagens recebidas"
            value={receivedToday}
          />
          <Stat
            icon={ArrowUpRight}
            label="Mensagens enviadas"
            value={sentToday}
          />
          <Stat
            icon={FileText}
            label="Orçamentos enviados"
            value={quotesSentToday}
          />
          <Stat
            icon={CheckCircle2}
            label="Vendas fechadas"
            value={closedToday}
            tone="good"
          />

          {/* mini chart leads/dia */}
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Leads por dia (14d)
              </span>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {chartData.reduce((s, b) => s + b.count, 0)} total
              </span>
            </div>
            <div className="flex items-end gap-0.5 h-16">
              {chartData.map((b) => (
                <div
                  key={b.day}
                  className="flex-1 flex items-end"
                  title={`${b.label}: ${b.count}`}
                >
                  <div
                    className="w-full rounded-sm bg-primary/70 hover:bg-primary transition-colors"
                    style={{
                      height: `${(b.count / maxChart) * 100}%`,
                      minHeight: b.count > 0 ? 2 : 0,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </Block>

        {/* Próximas ações */}
        <Block
          title="Próximas ações"
          empty={
            upcomingVisits.length === 0 &&
            upcomingFollowUps.length === 0 &&
            toReturn.length === 0
          }
        >
          <SubSection
            label="Visitas agendadas"
            count={upcomingVisits.length}
            tone="good"
          >
            {upcomingVisits.map((v) => (
              <RowLink
                key={v.id}
                to="/agenda"
                primary={v.customer_name ?? v.title}
                secondary={
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {new Date(v.scheduled_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                }
                dotTone="good"
              />
            ))}
          </SubSection>

          <SubSection
            label="Próximos follow-ups"
            count={upcomingFollowUps.length}
            tone="warm"
          >
            {upcomingFollowUps.map((l) => {
              const convId = findConvIdByLead(l.id);
              return convId ? (
                <RowLink
                  key={l.id}
                  to="/inbox/$conversationId"
                  params={{ conversationId: convId }}
                  primary={l.name}
                  secondary={
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(l.nextAction!.dueAt).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  }
                  dotTone="warn"
                />
              ) : (
                <Row
                  key={l.id}
                  primary={l.name}
                  secondary={l.nextAction!.label}
                  dotTone="warn"
                />
              );
            })}
          </SubSection>

          <SubSection
            label="Clientes para retornar"
            count={toReturn.length}
            tone="warm"
          >
            {toReturn.map((l) => {
              const convId = findConvIdByLead(l.id);
              return convId ? (
                <RowLink
                  key={l.id}
                  to="/inbox/$conversationId"
                  params={{ conversationId: convId }}
                  primary={l.name}
                  secondary="Sem contato há +24h"
                  dotTone="warn"
                />
              ) : null;
            })}
          </SubSection>
        </Block>
      </section>
    </div>
  );
}

// ---------- UI Atoms ----------

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex shrink-0 items-center rounded-md border border-border bg-card p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "px-3 min-h-[36px] md:min-h-0 md:py-1 rounded-[5px] transition-colors text-xs",
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const toneStyles = {
  urgent: { bg: "bg-[var(--status-urgent)]/10", text: "text-[var(--status-urgent)]" },
  hot: { bg: "bg-[var(--status-hot)]/10", text: "text-[var(--status-hot)]" },
  warm: { bg: "bg-[var(--status-warm)]/10", text: "text-[var(--status-warm)]" },
  primary: { bg: "bg-primary/10", text: "text-primary" },
  good: { bg: "bg-[var(--status-won)]/15", text: "text-[var(--status-won-foreground)]" },
  muted: { bg: "bg-muted", text: "text-muted-foreground" },
} as const;

function KpiCard({
  icon: Icon,
  label,
  sub,
  value,
  tone,
}: {
  icon: typeof AlertTriangle;
  label: string;
  sub: string;
  value: number | string;
  tone: keyof typeof toneStyles;
}) {
  const s = toneStyles[tone];
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className={`h-8 w-8 rounded-md ${s.bg} ${s.text} flex items-center justify-center`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-foreground/80 mt-0.5">{label}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">
        {sub}
      </div>
    </div>
  );
}

function Block({
  title,
  children,
  empty,
}: {
  title: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-4 flex-1 space-y-4">
        {empty ? (
          <div className="text-xs text-muted-foreground text-center py-8 flex flex-col items-center gap-2">
            <Inbox className="h-6 w-6 opacity-40" />
            Nenhum dado encontrado ainda
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

const subToneText = {
  urgent: "text-[var(--status-urgent)]",
  hot: "text-[var(--status-hot)]",
  warm: "text-[var(--status-warm)]",
  good: "text-[var(--status-won-foreground)]",
} as const;

function SubSection({
  label,
  count,
  tone,
  children,
}: {
  label: string;
  count: number;
  tone: keyof typeof subToneText;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "text-[10px] font-semibold tabular-nums",
            count > 0 ? subToneText[tone] : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      </div>
      {count === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <ul className="space-y-1">{children}</ul>
      )}
    </div>
  );
}

const dotColors = {
  urgent: "bg-[var(--status-urgent)]",
  warn: "bg-[var(--status-warm)]",
  hot: "bg-[var(--status-hot)]",
  good: "bg-[var(--status-won)]",
} as const;

function RowLink({
  to,
  params,
  primary,
  secondary,
  dotTone,
}: {
  to: string;
  params?: Record<string, string>;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  dotTone: keyof typeof dotColors;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LinkAny = Link as any;
  return (
    <li>
      <LinkAny
        to={to}
        params={params}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 -mx-2 hover:bg-accent/40 group"
      >
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColors[dotTone])} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{primary}</div>
          {secondary && (
            <div className="text-[11px] text-muted-foreground truncate">
              {secondary}
            </div>
          )}
        </div>
        <ChevronRight className="h-3 w-3 text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity" />
      </LinkAny>
    </li>
  );
}

function Row({
  primary,
  secondary,
  dotTone,
}: {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  dotTone: keyof typeof dotColors;
}) {
  return (
    <li className="flex items-center gap-2 px-2 py-1.5 -mx-2">
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColors[dotTone])} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{primary}</div>
        {secondary && (
          <div className="text-[11px] text-muted-foreground truncate">
            {secondary}
          </div>
        )}
      </div>
    </li>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = "muted",
}: {
  icon: typeof MessageSquare;
  label: string;
  value: number;
  tone?: keyof typeof toneStyles;
}) {
  const s = toneStyles[tone];
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "h-7 w-7 rounded-md flex items-center justify-center shrink-0",
          s.bg,
          s.text,
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 text-xs">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
