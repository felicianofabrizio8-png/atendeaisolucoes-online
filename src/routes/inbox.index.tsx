import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useSyncExternalStore } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { ChannelBadge, StatusBadge } from "@/components/Badges";
import { timeAgo, type Conversation } from "@/data/mock";
import {
  getConversations,
  getLeadById,
  getMessagesFor,
  subscribeRepo,
  seedMockIntoCompany,
  loadRemote,
  getRepoMode,
} from "@/data/leadRepo";
import { useAuth } from "@/auth/AuthContext";
import { getSettings, subscribeSettings } from "@/data/settings";
import { cn } from "@/lib/utils";
import { Search, AlertTriangle, XCircle, Filter, X, Sparkles, Loader2 } from "lucide-react";

const STATUS_FILTERS = ["todos", "quentes", "parados", "perdidos"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const searchSchema = z.object({
  status: fallback(z.enum(STATUS_FILTERS), "todos").default("todos"),
  lossReason: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/inbox/")({
  validateSearch: zodValidator(searchSchema),
  component: InboxPage,
});

function useSettings() {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings);
}

// Subscribe to lead store mutations so the list re-renders when messages are
// appended, leads are closed/lost etc. We don't read the snapshot — we just
// Subscribe to repo mutations so the list re-renders when messages are
// appended, leads are closed/lost etc.
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

function buildSortedItems(
  slaMinutes: number,
  statusFilter: StatusFilter,
  lossReasonFilter: string,
) {
  const now = Date.now();
  return [...getConversations()]
    .map((c) => {
      const lead = getLeadById(c.leadId);
      const breached = isSlaBreached(c, slaMinutes);
      const ageMin = (now - new Date(c.lastMessageAt).getTime()) / 60_000;
      // Score: atrasados (SLA estourado) vão pro topo, mais atrasados primeiro.
      let score = 0;
      if (breached) score += 100_000 + ageMin; // atraso pesa proporcional ao tempo
      else if (c.awaitingReply) score += 5_000 - ageMin / 1000;
      if (lead?.status === "quente") score += 300;
      if (lead?.status === "novo") score += 100;
      score += -ageMin / 1000; // desempate por recência
      return { conv: c, lead, breached, ageMin, score };
    })
    .filter(({ lead, breached }) => {
      // Filtro por status
      if (statusFilter === "quentes" && lead?.status !== "quente") return false;
      if (statusFilter === "parados" && !breached) return false;
      if (statusFilter === "perdidos" && lead?.status !== "perdido") return false;
      // Filtro por motivo (combina com status — só leads perdidos com o motivo escolhido)
      if (lossReasonFilter) {
        if (lead?.status !== "perdido" || lead.lossReason !== lossReasonFilter) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => b.score - a.score);
}

function InboxPage() {
  const navigate = useNavigate();
  const settings = useSettings();
  useRepoVersion();
  const { profile } = useAuth();
  const { status: statusFilter, lossReason: lossReasonFilter } = Route.useSearch();
  const [seeding, setSeeding] = useState(false);

  const items = buildSortedItems(settings.slaMinutes, statusFilter, lossReasonFilter);
  const awaitingCount = items.filter((i) => i.conv.awaitingReply).length;

  // Contagens por status — ignora o filtro de status atual mas respeita motivo.
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
      await loadRemote(profile.company_id);
    } catch (e) {
      console.error("seed failed", e);
    } finally {
      setSeeding(false);
    }
  };

  const isRemote = getRepoMode() === "remote";
  const isEmpty = items.length === 0 && statusCounts.todos === 0;
  const showSeed = isRemote && isEmpty && !!profile;

  // Filtro por motivo só aparece quando o usuário está vendo Todos ou Perdidos.
  const showLossReasonFilter =
    (statusFilter === "todos" || statusFilter === "perdidos") &&
    availableLossReasons.length > 0;

  const setStatus = (next: StatusFilter) => {
    navigate({
      to: "/inbox",
      search: {
        status: next,
        // Se sair de "perdidos"/"todos", limpa motivo para evitar combinação inválida.
        lossReason:
          next === "perdidos" || next === "todos" ? lossReasonFilter : "",
      },
    });
  };

  const statusTabs: { key: StatusFilter; label: string; count: number }[] = [
    { key: "todos", label: "Todos", count: statusCounts.todos },
    { key: "quentes", label: "Quentes", count: statusCounts.quentes },
    { key: "parados", label: "Parados", count: statusCounts.parados },
    { key: "perdidos", label: "Perdidos", count: statusCounts.perdidos },
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="flex flex-col gap-2 border-b border-border px-6 py-3">
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
                    search: { status: statusFilter, lossReason: e.target.value },
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
                      search: { status: statusFilter, lossReason: "" },
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
          {(statusFilter !== "todos" || lossReasonFilter) && (
            <button
              type="button"
              onClick={() =>
                navigate({
                  to: "/inbox",
                  search: { status: "todos", lossReason: "" },
                })
              }
              className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </header>


      <div className="flex-1 overflow-y-auto">
        <ul className="divide-y divide-border">
          {items.map(({ conv: c, breached, ageMin }) => {
            const lead = getLead(c.leadId)!;
            const msgs = getMessages(c.id);
            const last = msgs[msgs.length - 1];

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
                    "w-full text-left px-6 py-3.5 hover:bg-accent/50 transition-colors flex gap-3 items-start relative",
                    breached &&
                      "bg-[var(--status-urgent)]/10 border-l-4 border-[var(--status-urgent)] pl-5",
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
                      <ChannelBadge channel={c.channel} />
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
                      {lead.tags.map((t) => (
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
