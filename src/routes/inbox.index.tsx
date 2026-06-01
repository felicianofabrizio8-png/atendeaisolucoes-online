import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useSyncExternalStore } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { ChannelBadge, StatusBadge } from "@/components/Badges";
import { timeAgo, type Conversation, type Message, type Lead } from "@/data/mock";
import {
  getConversations,
  getLeadById,
  getMessagesFor,
  subscribeRepo,
  seedMockIntoCompany,
  loadRemote,
  getRepoMode,
} from "@/data/leadRepo";
import { seedMockProductsIntoCompany, loadProductsRemote } from "@/data/products";
import { useAuth } from "@/auth/AuthContext";
import { getSettings, subscribeSettings } from "@/data/settings";
import { cn } from "@/lib/utils";
import { Search, AlertTriangle, XCircle, Filter, X, Sparkles, Loader2, MessageCircle, Instagram, Facebook, MessageSquare } from "lucide-react";
import { QualificationInline } from "@/components/QualificationBadges";

const STATUS_FILTERS = [
  "todos",
  "quentes",
  "prontos",
  "aguardando_humano",
  "pre_ia",
  "objecao",
  "parados",
  "perdidos",
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const SOURCE_FILTERS = [
  "todos",
  "whatsapp",
  "instagram",
  "facebook",
  "comentarios",
  "directs",
  "nao-respondidos",
] as const;
type SourceFilter = (typeof SOURCE_FILTERS)[number];

export type Origin =
  | "whatsapp"
  | "instagram_direct"
  | "instagram_comment"
  | "facebook"
  | "facebook_comment"
  | "messenger"
  | "comment";

// Deriva a origem real de uma conversa. O backend grava conversation.interaction_type
// ('direct_message' | 'comment') além de lead.source e message.source_subtype.
export function getConversationOrigin(
  lead: Lead,
  lastMessage?: Message,
  conversation?: Conversation,
): Origin {
  const leadSource = (lead as unknown as { source?: string }).source;
  const interaction = conversation?.interactionType;
  const msgSubtype = (lastMessage as unknown as { sourceSubtype?: string } | undefined)?.sourceSubtype;
  const isComment = interaction === "comment" || msgSubtype === "comment";

  if (lead.channel === "instagram") {
    return isComment ? "instagram_comment" : "instagram_direct";
  }
  if (leadSource === "messenger" || (lead.channel === "facebook" && msgSubtype === "dm")) {
    return isComment ? "facebook_comment" : "messenger";
  }
  if (lead.channel === "facebook") {
    return isComment ? "facebook_comment" : "facebook";
  }
  return "whatsapp";
}

const ORIGIN_META: Record<Origin, { label: string; icon: typeof MessageCircle; color: string }> = {
  whatsapp: { label: "WhatsApp", icon: MessageCircle, color: "var(--channel-whatsapp)" },
  instagram_direct: { label: "Instagram Direct", icon: Instagram, color: "var(--channel-instagram)" },
  instagram_comment: { label: "Comentário Instagram", icon: MessageSquare, color: "var(--channel-instagram)" },
  facebook: { label: "Facebook", icon: Facebook, color: "var(--channel-facebook)" },
  facebook_comment: { label: "Comentário Facebook", icon: MessageSquare, color: "var(--channel-facebook)" },
  messenger: { label: "Messenger", icon: MessageSquare, color: "var(--channel-facebook)" },
  comment: { label: "Comentário", icon: MessageSquare, color: "var(--status-warm)" },
};

export function OriginBadge({ origin, className }: { origin: Origin; className?: string }) {
  const meta = ORIGIN_META[origin];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        className,
      )}
      style={{ color: meta.color }}
    >
      <Icon className="h-2.5 w-2.5" />
      {meta.label}
    </span>
  );
}

const searchSchema = z.object({
  status: fallback(z.enum(STATUS_FILTERS), "todos").default("todos"),
  source: fallback(z.enum(SOURCE_FILTERS), "todos").default("todos"),
  lossReason: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/inbox/")({
  validateSearch: zodValidator(searchSchema),
  component: InboxPage,
});

function useSettings() {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings);
}

function useRepoVersion() {
  return useSyncExternalStore(
    subscribeRepo,
    () => 0,
    () => 0,
  );
}

function isSlaBreached(c: Conversation, slaMinutes: number): boolean {
  if (!c.awaitingReply) return false;
  const ageMin = (Date.now() - new Date(c.lastMessageAt).getTime()) / 60_000;
  return ageMin >= slaMinutes;
}

function matchesSource(origin: Origin, awaitingReply: boolean, filter: SourceFilter): boolean {
  switch (filter) {
    case "todos": return true;
    case "whatsapp": return origin === "whatsapp";
    case "instagram": return origin === "instagram_direct" || origin === "instagram_comment";
    case "facebook": return origin === "facebook" || origin === "messenger" || origin === "facebook_comment";
    case "comentarios": return origin === "instagram_comment" || origin === "facebook_comment" || origin === "comment";
    case "directs": return origin === "instagram_direct" || origin === "messenger";
    case "nao-respondidos": return awaitingReply;
  }
}

function buildSortedItems(
  slaMinutes: number,
  statusFilter: StatusFilter,
  sourceFilter: SourceFilter,
  lossReasonFilter: string,
) {
  const now = Date.now();
  return [...getConversations()]
    .map((c) => {
      const lead = getLeadById(c.leadId);
      const msgs = getMessagesFor(c.id);
      const last = msgs[msgs.length - 1];
      const origin: Origin = lead ? getConversationOrigin(lead, last, c) : "whatsapp";
      const breached = isSlaBreached(c, slaMinutes);
      const ageMin = (now - new Date(c.lastMessageAt).getTime()) / 60_000;
      let score = 0;
      if (breached) score += 100_000 + ageMin;
      else if (c.awaitingReply) score += 5_000 - ageMin / 1000;
      if (lead?.status === "quente") score += 300;
      if (lead?.status === "novo") score += 100;
      score += -ageMin / 1000;
      return { conv: c, lead, last, origin, breached, ageMin, score };
    })
    .filter(({ lead, breached, origin, conv }) => {
      if (statusFilter === "quentes" && lead?.status !== "quente") return false;
      if (statusFilter === "parados" && !breached) return false;
      if (statusFilter === "perdidos" && lead?.status !== "perdido") return false;
      if (lossReasonFilter) {
        if (lead?.status !== "perdido" || lead.lossReason !== lossReasonFilter) {
          return false;
        }
      }
      if (!matchesSource(origin, conv.awaitingReply, sourceFilter)) return false;
      return true;
    })
    .sort((a, b) => b.score - a.score);
}

function InboxPage() {
  const navigate = useNavigate();
  const settings = useSettings();
  useRepoVersion();
  const { profile } = useAuth();
  const { status: statusFilter, source: sourceFilter, lossReason: lossReasonFilter } = Route.useSearch();
  const [seeding, setSeeding] = useState(false);

  const items = buildSortedItems(settings.slaMinutes, statusFilter, sourceFilter, lossReasonFilter);
  const awaitingCount = items.filter((i) => i.conv.awaitingReply).length;

  const statusCounts = useMemo(() => {
    const counts = { todos: 0, quentes: 0, parados: 0, perdidos: 0 };
    for (const c of getConversations()) {
      const lead = getLeadById(c.leadId);
      const breached = isSlaBreached(c, settings.slaMinutes);
      if (lossReasonFilter) {
        if (lead?.status !== "perdido" || lead.lossReason !== lossReasonFilter) {
          continue;
        }
      }
      counts.todos += 1;
      if (lead?.status === "quente") counts.quentes += 1;
      if (breached) counts.parados += 1;
      if (lead?.status === "perdido") counts.perdidos += 1;
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.slaMinutes, lossReasonFilter, items]);

  const sourceCounts = useMemo(() => {
    const counts: Record<SourceFilter, number> = {
      todos: 0, whatsapp: 0, instagram: 0, facebook: 0,
      comentarios: 0, directs: 0, "nao-respondidos": 0,
    };
    for (const c of getConversations()) {
      const lead = getLeadById(c.leadId);
      if (!lead) continue;
      const msgs = getMessagesFor(c.id);
      const last = msgs[msgs.length - 1];
      const origin = getConversationOrigin(lead, last, c);
      counts.todos += 1;
      if (matchesSource(origin, c.awaitingReply, "whatsapp")) counts.whatsapp += 1;
      if (matchesSource(origin, c.awaitingReply, "instagram")) counts.instagram += 1;
      if (matchesSource(origin, c.awaitingReply, "facebook")) counts.facebook += 1;
      if (matchesSource(origin, c.awaitingReply, "comentarios")) counts.comentarios += 1;
      if (matchesSource(origin, c.awaitingReply, "directs")) counts.directs += 1;
      if (matchesSource(origin, c.awaitingReply, "nao-respondidos")) counts["nao-respondidos"] += 1;
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const breachedCount = statusCounts.parados;

  const availableLossReasons = useMemo(() => {
    const set = new Set<string>();
    for (const c of getConversations()) {
      const lead = getLeadById(c.leadId);
      if (lead?.status === "perdido" && lead.lossReason) {
        set.add(lead.lossReason);
      }
    }
    return [...set].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const handleSeed = async () => {
    if (!profile) return;
    setSeeding(true);
    try {
      await seedMockIntoCompany(profile.company_id);
      await seedMockProductsIntoCompany(profile.company_id);
      await loadRemote(profile.company_id);
      await loadProductsRemote(profile.company_id);
    } catch (e) {
      console.error("seed failed", e);
    } finally {
      setSeeding(false);
    }
  };

  const isRemote = getRepoMode() === "remote";
  const isEmpty = items.length === 0 && statusCounts.todos === 0;
  const showSeed = isRemote && isEmpty && !!profile;

  const showLossReasonFilter =
    (statusFilter === "todos" || statusFilter === "perdidos") &&
    availableLossReasons.length > 0;

  const setStatus = (next: StatusFilter) => {
    navigate({
      to: "/inbox",
      search: {
        status: next,
        source: sourceFilter,
        lossReason:
          next === "perdidos" || next === "todos" ? lossReasonFilter : "",
      },
    });
  };

  const setSource = (next: SourceFilter) => {
    navigate({
      to: "/inbox",
      search: { status: statusFilter, source: next, lossReason: lossReasonFilter },
    });
  };

  const statusTabs: { key: StatusFilter; label: string; count: number }[] = [
    { key: "todos", label: "Todos", count: statusCounts.todos },
    { key: "quentes", label: "Quentes", count: statusCounts.quentes },
    { key: "parados", label: "Parados", count: statusCounts.parados },
    { key: "perdidos", label: "Perdidos", count: statusCounts.perdidos },
  ];

  const sourceTabs: { key: SourceFilter; label: string; count: number }[] = [
    { key: "todos", label: "Todos", count: sourceCounts.todos },
    { key: "whatsapp", label: "WhatsApp", count: sourceCounts.whatsapp },
    { key: "instagram", label: "Instagram", count: sourceCounts.instagram },
    { key: "facebook", label: "Facebook", count: sourceCounts.facebook },
    { key: "comentarios", label: "Comentários", count: sourceCounts.comentarios },
    { key: "directs", label: "Directs", count: sourceCounts.directs },
    { key: "nao-respondidos", label: "Não respondidos", count: sourceCounts["nao-respondidos"] },
  ];

  const hasAnyFilter =
    statusFilter !== "todos" || sourceFilter !== "todos" || !!lossReasonFilter;

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="flex flex-col gap-2 border-b border-border px-4 md:px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-base font-semibold leading-none">Caixa de atendimento</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {awaitingCount} aguardando resposta
              {breachedCount > 0 && (
                <>
                  {" · "}
                  <span className="text-[var(--status-urgent)] font-semibold">
                    {breachedCount} atrasado{breachedCount === 1 ? "" : "s"}
                  </span>
                </>
              )}
              {" · "}SLA {settings.slaMinutes} min
            </p>
          </div>
          <div className="relative w-72 hidden md:block">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Buscar por nome, telefone, tag…"
              className="w-full h-9 rounded-md bg-input pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center rounded-md bg-secondary p-0.5 text-xs">
            {statusTabs.map((tab) => {
              const active = statusFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatus(tab.key)}
                  className={cn(
                    "px-3 h-7 rounded font-medium transition-colors flex items-center gap-1.5",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                    tab.key === "parados" && active && "text-[var(--status-urgent)]",
                    tab.key === "perdidos" && active && "text-[var(--status-lost)]",
                  )}
                >
                  {tab.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[10px] font-bold tabular-nums min-w-[18px] text-center",
                      active ? "bg-secondary" : "bg-background/60",
                      tab.count === 0 && "opacity-40",
                      tab.key === "parados" && tab.count > 0 && "text-[var(--status-urgent)]",
                      tab.key === "perdidos" && tab.count > 0 && active && "text-[var(--status-lost)]",
                    )}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
          {showLossReasonFilter && (
            <div className="relative">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <select
                value={lossReasonFilter}
                onChange={(e) =>
                  navigate({
                    to: "/inbox",
                    search: { status: statusFilter, source: sourceFilter, lossReason: e.target.value },
                  })
                }
                className={cn(
                  "h-7 rounded-md bg-input pl-8 pr-7 text-xs outline-none focus:ring-2 focus:ring-ring appearance-none cursor-pointer",
                  lossReasonFilter && "ring-1 ring-[var(--status-lost)]/40",
                )}
              >
                <option value="">Todos os motivos…</option>
                {availableLossReasons.map((r) => (
                  <option key={r} value={r}>
                    ❌ {r}
                  </option>
                ))}
              </select>
              {lossReasonFilter && (
                <button
                  type="button"
                  onClick={() =>
                    navigate({
                      to: "/inbox",
                      search: { status: statusFilter, source: sourceFilter, lossReason: "" },
                    })
                  }
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-accent"
                  aria-label="Limpar filtro"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          {hasAnyFilter && (
            <button
              type="button"
              onClick={() =>
                navigate({
                  to: "/inbox",
                  search: { status: "todos", source: "todos", lossReason: "" },
                })
              }
              className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Limpar filtros
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {sourceTabs.map((tab) => {
            const active = sourceFilter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSource(tab.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-medium border transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground/40",
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] font-bold tabular-nums min-w-[16px] text-center",
                    active ? "bg-primary-foreground/20" : "bg-secondary",
                    tab.count === 0 && "opacity-40",
                  )}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </header>


      <div className="flex-1 overflow-y-auto">
        {showSeed && (
          <div className="mx-6 my-4 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4 flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold">Sua caixa está vazia</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Carregue dados de exemplo para explorar o app, ou conecte seus canais
                (WhatsApp, Instagram, Facebook) — em breve.
              </p>
              <button
                onClick={handleSeed}
                disabled={seeding}
                className="mt-3 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-60"
              >
                {seeding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Carregar dados de exemplo
              </button>
            </div>
          </div>
        )}
        <ul className="divide-y divide-border">
          {items.map(({ conv: c, last, origin, breached, ageMin }) => {
            const lead = getLeadById(c.leadId)!;

            return (
              <li key={c.id}>
                <button
                  onClick={() =>
                    navigate({
                      to: "/inbox/$conversationId",
                      params: { conversationId: c.id },
                    })
                  }
                  className={cn(
                    "w-full text-left px-4 md:px-6 py-3.5 hover:bg-accent/50 transition-colors flex gap-3 items-start relative",
                    breached &&
                      "bg-[var(--status-urgent)]/10 border-l-4 border-[var(--status-urgent)] pl-3 md:pl-5",
                  )}
                >
                  <div className="flex flex-col items-center pt-1 gap-1.5 w-6">
                    {breached ? (
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--status-urgent)] opacity-75" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--status-urgent)]" />
                      </span>
                    ) : c.awaitingReply ? (
                      <span className="h-2 w-2 rounded-full bg-primary" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-transparent" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          "font-medium truncate",
                          breached && "text-[var(--status-urgent)]",
                        )}
                      >
                        {lead.name}
                      </span>
                      <OriginBadge origin={origin} />
                      {origin !== "whatsapp" && <ChannelBadge channel={c.channel} />}
                      {!(lead.status === "perdido" && lead.lossReason) && (
                        <StatusBadge status={lead.status} />
                      )}
                      {breached && (
                        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-[var(--status-urgent)] text-white">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          Cliente aguardando
                        </span>
                      )}
                      {lead.status === "perdido" && lead.lossReason && (
                        <span
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-[var(--status-lost)]/15 text-[var(--status-lost)] border border-[var(--status-lost)]/30 max-w-[240px]"
                          title={`Motivo da perda: ${lead.lossReason}`}
                        >
                          <XCircle className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">
                            Perdido <span className="opacity-60">•</span> {lead.lossReason}
                          </span>
                        </span>
                      )}
                      {!breached && !lead.nextAction && lead.status !== "perdido" && (
                        <span className="text-[10px] uppercase tracking-wide text-[var(--status-warm)]">
                          ⚠ sem próxima ação
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground truncate">
                      {last?.role === "agent" && (
                        <span className="text-foreground/60">Você: </span>
                      )}
                      {last?.text ?? "—"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {lead.tags.map((t: string) => (
                        <span
                          key={t}
                          className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        breached
                          ? "text-[var(--status-urgent)] font-bold"
                          : "text-muted-foreground",
                      )}
                    >
                      {timeAgo(c.lastMessageAt)}
                    </span>
                    {breached && (
                      <span className="text-[10px] font-semibold text-[var(--status-urgent)]">
                        +{Math.max(1, Math.round(ageMin - settings.slaMinutes))}min do SLA
                      </span>
                    )}
                    {c.unread > 0 && (
                      <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1.5 min-w-[18px] text-center">
                        {c.unread}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="p-6 text-center">
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
            Ver no dashboard →
          </Link>
        </div>
      </div>
    </div>
  );
}
