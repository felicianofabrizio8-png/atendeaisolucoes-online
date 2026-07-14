// ============================================================================
// OpsCockpit — Centro de Operações Inteligente do Inbox.
// Reutiliza EXCLUSIVAMENTE o snapshot em memória via PriorityEngine.
// Nada de novos endpoints, nada de novas IAs, nada de novos agentes.
// ============================================================================

import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Search, Play, Star, StarOff, ChevronDown, ChevronRight, Clock,
  Zap, CheckCircle2, XCircle, Send, Calendar, Phone, Bot,
  Flame, Snowflake, ArrowRight, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo, formatBRL, type Lead } from "@/data/mock";
import { subscribeRepo, getConversationById, getLeadById } from "@/data/leadRepo";
import { subscribeQuotes } from "@/data/quotes";
import { useSyncExternalStore } from "react";
import {
  rankConversations, computeDayPanel, computeMyDay, groupByTime,
  type PrioritizedConversation, type ActionKind, type TimeBucket,
} from "@/lib/priority-engine";
import {
  useFavorites, useRecent, toggleFavorite, startFocus,
} from "@/lib/inbox-focus";
import { useCoachAlerts } from "@/hooks/useCoachAlerts";
import { getSettings, subscribeSettings } from "@/data/settings";
import { pushRecent } from "@/lib/inbox-focus";

const ACTION_META: Record<ActionKind, { label: string; icon: typeof Send; tone: string }> = {
  responder: { label: "Responder", icon: Send, tone: "text-primary" },
  enviar_orcamento: { label: "Enviar orçamento", icon: Send, tone: "text-emerald-500" },
  agendar_visita: { label: "Agendar visita", icon: Calendar, tone: "text-amber-500" },
  cobrar_retorno: { label: "Cobrar retorno", icon: Phone, tone: "text-blue-500" },
  confirmar_instalacao: { label: "Confirmar instalação", icon: CheckCircle2, tone: "text-emerald-500" },
  fechar_venda: { label: "Fechar venda", icon: Flame, tone: "text-orange-500" },
  marcar_perdido: { label: "Marcar perdido", icon: XCircle, tone: "text-red-500" },
  sem_acao: { label: "Sem próxima ação", icon: Bot, tone: "text-muted-foreground" },
};

const MY_DAY_ORDER: ActionKind[] = [
  "responder", "enviar_orcamento", "agendar_visita",
  "cobrar_retorno", "confirmar_instalacao", "fechar_venda", "marcar_perdido",
];

const TIME_LABELS: Record<TimeBucket, string> = {
  hoje: "Hoje", ontem: "Ontem", "7d": "Últimos 7 dias", "30d": "Últimos 30 dias",
  antigos: "Mais antigos", perdidos: "Perdidos", arquivados: "Arquivados",
};

function useRepoTick() {
  const [, setV] = useState(0);
  useEffect(() => {
    const u1 = subscribeRepo(() => setV((v) => v + 1));
    const u2 = subscribeQuotes(() => setV((v) => v + 1));
    return () => { u1(); u2(); };
  }, []);
}

function useSettingsSnap() {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings);
}

function normalize(s: unknown): string {
  if (s == null) return "";
  return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function matchesQuery(it: PrioritizedConversation, q: string): boolean {
  if (!q) return true;
  const query = normalize(q);
  const fields = [
    it.lead.name, it.lead.phone, it.lead.handle, it.lead.product,
    it.conv.detectedCity, it.conv.detectedState, it.conv.detectedInterest,
    it.conv.detectedIntent, it.last?.text,
    ...it.lead.tags,
    ...it.quotes.map((q) => q.productName),
    it.lead.nextAction?.label,
    it.lead.lossReason,
  ].map(normalize).join(" ");
  return fields.includes(query);
}

export function OpsCockpit() {
  const navigate = useNavigate();
  useRepoTick();
  const settings = useSettingsSnap();
  const favorites = useFavorites();
  const recentIds = useRecent();
  const { alertsByConv } = useCoachAlerts();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    antigos: true, perdidos: true, arquivados: true,
  });

  const ranked = useMemo(
    () => rankConversations({
      slaMinutes: settings.slaMinutes,
      coachByConv: alertsByConv,
      favorites,
      includeClosed: false,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.slaMinutes, alertsByConv, favorites],
  );

  const filtered = query ? ranked.filter((it) => matchesQuery(it, query)) : ranked;
  const dayStats = useMemo(() => computeDayPanel(ranked), [ranked]);
  const myDay = useMemo(() => computeMyDay(ranked), [ranked]);
  const buckets = useMemo(() => groupByTime(filtered), [filtered]);

  const fazerAgora = filtered.slice(0, 8);
  const favoritos = filtered.filter((it) => it.isFavorite);
  const recentes = recentIds
    .map((id) => {
      const conv = getConversationById(id);
      const lead = conv ? getLeadById(conv.leadId) : undefined;
      return conv && lead ? { conv, lead } : null;
    })
    .filter((x): x is { conv: NonNullable<ReturnType<typeof getConversationById>>; lead: Lead } => !!x)
    .slice(0, 10);

  const open = (id: string) => {
    pushRecent(id);
    navigate({ to: "/inbox/$conversationId", params: { conversationId: id } });
  };

  const iniciarAtendimento = () => {
    if (fazerAgora.length === 0) return;
    const queue = fazerAgora.map((it) => it.conv.id);
    startFocus(queue);
    open(queue[0]);
  };

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      {/* Header — status geral + Modo Foco */}
      <header className="border-b border-border bg-gradient-to-b from-background to-background/60 px-4 md:px-6 py-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Central de Operações
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ranked.length} conversas ativas · {dayStats.pendentes} aguardando · SLA {settings.slaMinutes}m
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SearchBar value={query} onChange={setQuery} />
            <button
              type="button"
              onClick={iniciarAtendimento}
              disabled={fazerAgora.length === 0}
              className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50 shadow-sm"
            >
              <Play className="h-4 w-4 fill-current" />
              Iniciar Atendimento
            </button>
          </div>
        </div>

        {/* Painel do Dia */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          <Kpi label="Atendidos" value={dayStats.atendidosHoje} tone="text-emerald-500" />
          <Kpi label="Pendentes" value={dayStats.pendentes} tone="text-primary" />
          <Kpi label="Em negociação" value={dayStats.emNegociacao} tone="text-amber-500" />
          <Kpi label="Orçamentos" value={dayStats.orcamentosEnviados} tone="text-blue-500" />
          <Kpi label="Visitas" value={dayStats.visitasAgendadas} tone="text-purple-500" />
          <Kpi label="Vendas" value={dayStats.vendasFechadas} tone="text-emerald-500" />
          <Kpi label="Perdidos" value={dayStats.perdidos} tone="text-red-500" />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 md:px-6 py-5 space-y-6">

          {/* Continuar de onde parei */}
          {recentes.length > 0 && (
            <Section
              title="Continuar de onde parei"
              subtitle="Últimos clientes acessados"
              icon={<Clock className="h-4 w-4" />}
            >
              <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
                {recentes.map(({ conv, lead }) => (
                  <button
                    key={conv.id}
                    onClick={() => open(conv.id)}
                    className="shrink-0 min-w-[180px] max-w-[220px] text-left rounded-lg border border-border bg-card hover:bg-accent px-3 py-2 transition-colors"
                  >
                    <div className="text-sm font-medium truncate">{lead.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {timeAgo(conv.lastMessageAt)} · {lead.channel}
                    </div>
                  </button>
                ))}
              </div>
            </Section>
          )}

          {/* Fazer agora */}
          <Section
            title="Fazer agora"
            subtitle="Fila inteligente ordenada pelo PriorityEngine"
            icon={<Zap className="h-4 w-4 text-primary" />}
            badge={fazerAgora.length}
          >
            {fazerAgora.length === 0 ? (
              <EmptyState message="Nada urgente no momento. Bom trabalho! 🎉" />
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {fazerAgora.map((it) => (
                  <PriorityCard key={it.conv.id} item={it} onOpen={() => open(it.conv.id)} />
                ))}
              </div>
            )}
          </Section>

          {/* Favoritos */}
          {favoritos.length > 0 && (
            <Section
              title="Favoritos"
              subtitle="Clientes fixados no topo"
              icon={<Star className="h-4 w-4 text-amber-500 fill-amber-500" />}
              badge={favoritos.length}
            >
              <div className="grid gap-2 md:grid-cols-2">
                {favoritos.map((it) => (
                  <PriorityCard key={it.conv.id} item={it} onOpen={() => open(it.conv.id)} />
                ))}
              </div>
            </Section>
          )}

          {/* Meu Dia */}
          <Section
            title="Meu dia"
            subtitle="Tarefas agrupadas por tipo de ação"
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          >
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {MY_DAY_ORDER.map((k) => {
                const items = myDay[k];
                if (items.length === 0) return null;
                const meta = ACTION_META[k];
                const Icon = meta.icon;
                return (
                  <details key={k} className="group rounded-lg border border-border bg-card overflow-hidden">
                    <summary className="cursor-pointer list-none px-3 py-2 flex items-center justify-between hover:bg-accent">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Icon className={cn("h-4 w-4", meta.tone)} />
                        {meta.label}
                      </span>
                      <span className="text-[11px] rounded-full bg-secondary px-2 py-0.5 tabular-nums font-semibold">
                        {items.length}
                      </span>
                    </summary>
                    <ul className="divide-y divide-border">
                      {items.slice(0, 5).map((it) => (
                        <li key={it.conv.id}>
                          <button
                            onClick={() => open(it.conv.id)}
                            className="w-full text-left px-3 py-2 hover:bg-accent flex items-center justify-between gap-2"
                          >
                            <span className="text-sm truncate">{it.lead.name}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(it.conv.lastMessageAt)}</span>
                          </button>
                        </li>
                      ))}
                      {items.length > 5 && (
                        <li className="px-3 py-1.5 text-[11px] text-muted-foreground">+ {items.length - 5} outros</li>
                      )}
                    </ul>
                  </details>
                );
              })}
            </div>
          </Section>

          {/* Fila geral por tempo */}
          <Section
            title="Fila geral"
            subtitle="Todas as conversas agrupadas por tempo"
            icon={<ArrowRight className="h-4 w-4" />}
          >
            <div className="space-y-2">
              {(["hoje", "ontem", "7d", "30d", "antigos", "perdidos"] as TimeBucket[]).map((b) => {
                const list = buckets[b];
                if (list.length === 0) return null;
                const isCollapsed = collapsed[b] ?? false;
                return (
                  <div key={b} className="rounded-lg border border-border bg-card overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setCollapsed((s) => ({ ...s, [b]: !isCollapsed }))}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                    >
                      {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      <span className="text-sm font-semibold">{TIME_LABELS[b]}</span>
                      <span className="text-[11px] rounded-full bg-secondary px-2 py-0.5 tabular-nums font-semibold">
                        {list.length}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <ul className="divide-y divide-border">
                        {list.slice(0, 25).map((it) => (
                          <PriorityRow key={it.conv.id} item={it} onOpen={() => open(it.conv.id)} />
                        ))}
                        {list.length > 25 && (
                          <li className="px-3 py-1.5 text-[11px] text-muted-foreground">
                            + {list.length - 25} conversas neste grupo
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
}

// ---------- Componentes locais ----------------------------------------------

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-full md:w-72">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Nome, telefone, cidade, produto, tag…"
        className="w-full h-10 rounded-md bg-input pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className={cn("text-xl font-bold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

function Section({
  title, subtitle, icon, badge, children,
}: {
  title: string; subtitle?: string; icon?: React.ReactNode; badge?: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="flex items-center gap-2 mb-2">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
        {typeof badge === "number" && (
          <span className="text-[10px] font-bold rounded-full bg-secondary px-1.5 py-0.5 tabular-nums">{badge}</span>
        )}
        {subtitle && <span className="text-[11px] text-muted-foreground truncate">· {subtitle}</span>}
      </header>
      {children}
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">{message}</div>;
}

function TierPill({ score }: { score: number }) {
  const tier = score >= 800 ? "quente" : score >= 400 ? "morno" : "frio";
  const cls =
    tier === "quente" ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/40"
    : tier === "morno" ? "bg-amber-500/15 text-amber-500 border-amber-500/40"
    : "bg-blue-500/15 text-blue-500 border-blue-500/40";
  const Icon = tier === "quente" ? Flame : tier === "morno" ? Zap : Snowflake;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tabular-nums", cls)}>
      <Icon className="h-3 w-3" />
      {score}
    </span>
  );
}

function FavoriteToggle({ id, active }: { id: string; active: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); toggleFavorite(id); }}
      className="p-1 rounded hover:bg-accent"
      aria-label={active ? "Remover dos favoritos" : "Fixar cliente"}
      title={active ? "Remover dos favoritos" : "Fixar cliente"}
    >
      {active
        ? <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
        : <StarOff className="h-4 w-4 text-muted-foreground" />}
    </button>
  );
}

function PriorityCard({ item, onOpen }: { item: PrioritizedConversation; onOpen: () => void }) {
  const meta = ACTION_META[item.action.kind];
  const Icon = meta.icon;
  const timeLeft = item.timeLeftMinutes;
  return (
    <button
      onClick={onOpen}
      className="text-left rounded-lg border border-border bg-card hover:bg-accent transition-colors p-3 flex flex-col gap-2 relative"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate">{item.lead.name}</span>
            <span className="text-[10px] uppercase text-muted-foreground">{item.lead.channel}</span>
          </div>
          <div className={cn("mt-0.5 text-xs flex items-center gap-1.5", meta.tone)}>
            <Icon className="h-3 w-3" />
            <span className="font-medium">{item.action.label}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <TierPill score={item.score} />
          <FavoriteToggle id={item.conv.id} active={item.isFavorite} />
        </div>
      </div>

      {item.reasons[0] && (
        <div className="text-[11px] text-muted-foreground line-clamp-1">
          Motivo: {item.reasons[0]}
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{timeAgo(item.conv.lastMessageAt)}</span>
        {timeLeft !== null && (
          <span className={cn(timeLeft < 0 && "text-[var(--status-urgent)] font-semibold")}>
            {timeLeft < 0 ? `Vencido há ${Math.abs(timeLeft)}m` : `Em ${timeLeft}m`}
          </span>
        )}
        {item.lead.estimatedValue ? <span>{formatBRL(item.lead.estimatedValue)}</span> : null}
      </div>
    </button>
  );
}

function PriorityRow({ item, onOpen }: { item: PrioritizedConversation; onOpen: () => void }) {
  const meta = ACTION_META[item.action.kind];
  return (
    <li>
      <button onClick={onOpen} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent text-left">
        <FavoriteToggle id={item.conv.id} active={item.isFavorite} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{item.lead.name}</span>
            <span className="text-[10px] text-muted-foreground uppercase">{item.lead.channel}</span>
          </div>
          <div className={cn("text-[11px] truncate", meta.tone)}>{item.action.label}</div>
        </div>
        <TierPill score={item.score} />
        <span className="text-[10px] text-muted-foreground w-14 text-right tabular-nums">
          {timeAgo(item.conv.lastMessageAt)}
        </span>
      </button>
    </li>
  );
}
