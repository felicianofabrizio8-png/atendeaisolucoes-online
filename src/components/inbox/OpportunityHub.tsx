import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Flame, AlertTriangle, ChevronDown, ChevronUp, Sparkles, Loader2, X, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { getConversations, getLeadById, getMessagesFor } from "@/data/leadRepo";
import { quotesForLead, computeQuoteStatus } from "@/data/quotes";
import { computeOpportunityScore, TIER_META, type OpportunityScore } from "@/lib/opportunity-score";
import { computeWindow, closesToday } from "@/lib/whatsapp-window";
import type { Conversation, Lead, Message } from "@/data/mock";

type FilterKey = "todos" | "quentes" | "fecha_hoje" | "orcamento" | "sem_retorno";

interface OppItem {
  conv: Conversation;
  lead: Lead;
  last?: Message;
  messages: Message[];
  score: OpportunityScore;
  hasPendingQuote: boolean;
  closesToday: boolean;
  awaitingTeam: boolean;
}

function buildOpportunities(now: number, includeAll = false): OppItem[] {
  const out: OppItem[] = [];
  for (const c of getConversations()) {
    const lead = getLeadById(c.leadId);
    if (!lead) continue;
    if (!includeAll && (lead.status === "perdido" || lead.status === "fechado")) continue;
    const msgs = getMessagesFor(c.id);
    const quotes = quotesForLead(lead.id);
    const score = computeOpportunityScore({ conv: c, lead, messages: msgs, quotes, now });
    const hasPendingQuote = quotes.some((q) => {
      const s = computeQuoteStatus(q);
      return s === "enviado" || s === "visualizado" || s === "pendente";
    });
    const w = computeWindow(c, lead, msgs, now);
    out.push({
      conv: c,
      lead,
      last: msgs[msgs.length - 1],
      messages: msgs,
      score,
      hasPendingQuote,
      closesToday: closesToday(w, now),
      awaitingTeam: c.awaitingReply,
    });
  }
  return out.sort((a, b) => b.score.score - a.score.score);
}

function applyFilter(items: OppItem[], filter: FilterKey): OppItem[] {
  switch (filter) {
    case "todos": return items;
    case "quentes": return items.filter((i) => i.score.tier === "quente");
    case "fecha_hoje": return items.filter((i) => i.closesToday);
    case "orcamento": return items.filter((i) => i.hasPendingQuote);
    case "sem_retorno": return items.filter((i) => i.awaitingTeam);
  }
}

function normalize(str: unknown): string {
  if (str == null) return "";
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesSearch(item: OppItem, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const lead = item.lead;
  const fields = [
    normalize(lead.name),
    normalize(lead.handle),
    normalize(lead.phone),
    normalize(lead.product),
    normalize(item.last?.text),
    ...(lead.tags ?? []).map((t) => normalize(t)),
  ];
  if (fields.some((f) => f && f.includes(q))) return true;
  // Telefone: comparar apenas dígitos quando a busca contém dígitos
  const queryDigits = query.replace(/\D+/g, "");
  if (queryDigits.length >= 3) {
    const phoneDigits = (lead.phone ?? "").replace(/\D+/g, "");
    if (phoneDigits.includes(queryDigits)) return true;
  }
  return false;
}

function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function formatAgo(iso: string, now: number): string {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 60) return `${m} min atrás`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} ${h === 1 ? "hora" : "horas"} atrás`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "dia" : "dias"} atrás`;
}

export function OpportunityHub({
  collapsed: controlledCollapsed,
  onToggle,
}: {
  collapsed?: boolean;
  onToggle?: (next: boolean) => void;
} = {}) {
  const navigate = useNavigate();
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = controlledCollapsed ?? internalCollapsed;
  const setCollapsed = (next: boolean) => {
    if (onToggle) onToggle(next);
    else setInternalCollapsed(next);
  };
  const [filter, setFilter] = useState<FilterKey>("todos");
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebounce(searchQuery, 300);
  const [compact, setCompact] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("opp-hub-compact") === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("opp-hub-compact", compact ? "1" : "0");
  }, [compact]);

  const now = Date.now();
  const all = useMemo(() => buildOpportunities(now), [now]);
  const hasSearch = debouncedQuery.trim().length > 0;
  // Quando há busca, incluímos também leads fechados/perdidos para localizar
  // qualquer cliente pelo nome, telefone ou tag.
  const searchPool = useMemo(
    () => (hasSearch ? buildOpportunities(now, true) : all),
    [hasSearch, now, all],
  );

  const alerts = useMemo(() => {
    const hotAwaiting = all.filter((i) => i.score.tier === "quente" && i.awaitingTeam).length;
    const closingSoon = all.filter((i) => {
      const w = computeWindow(i.conv, i.lead, i.messages, now);
      return w.state === "closing_soon";
    }).length;
    const pendingQuotes = all.filter((i) => i.hasPendingQuote && i.awaitingTeam).length;
    return { hotAwaiting, closingSoon, pendingQuotes };
  }, [all, now]);

  const counts = useMemo(() => ({
    todos: all.length,
    quentes: all.filter((i) => i.score.tier === "quente").length,
    fecha_hoje: all.filter((i) => i.closesToday).length,
    orcamento: all.filter((i) => i.hasPendingQuote).length,
    sem_retorno: all.filter((i) => i.awaitingTeam).length,
  }), [all]);

  const filteredByFilter = hasSearch ? searchPool : applyFilter(all, filter);
  const filtered = useMemo(() => {
    if (!debouncedQuery.trim()) return filteredByFilter;
    return filteredByFilter.filter((it) => matchesSearch(it, debouncedQuery));
  }, [filteredByFilter, debouncedQuery]);

  if (all.length === 0) return null;

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "quentes", label: "🟢 Quentes" },
    { key: "fecha_hoje", label: "📅 Fecha hoje" },
    { key: "orcamento", label: "💰 Orçamento s/ resposta" },
    { key: "sem_retorno", label: "⏳ Sem retorno" },
  ];


  return (
    <section className="mx-3 md:mx-6 my-3 rounded-lg border border-border bg-card/40 overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-gradient-to-r from-amber-500/10 to-transparent">
        <div className="flex items-center gap-2 min-w-0">
          <Flame className="h-4 w-4 text-amber-500 shrink-0" />
          <h2 className="text-sm font-semibold">Central de Oportunidades</h2>
          <span className="text-[10px] text-muted-foreground tabular-nums hidden sm:inline">
            · {all.length} conversas analisadas
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCompact(!compact)}
            className={cn(
              "hidden sm:inline-flex items-center gap-1 text-[11px] font-medium border rounded-md px-2 py-1 transition-colors",
              compact
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:text-foreground",
            )}
            title="Alternar modo compacto"
          >
            {compact ? "Modo confortável" : "Modo compacto"}
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="text-muted-foreground hover:text-foreground p-1 rounded"
            aria-label={collapsed ? "Expandir" : "Recolher"}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {!collapsed && (
        <div className="px-3 py-3 space-y-3">
          {(alerts.hotAwaiting + alerts.closingSoon + alerts.pendingQuotes) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {alerts.hotAwaiting > 0 && (
                <AlertChip
                  tone="urgent"
                  text={`${alerts.hotAwaiting} lead${alerts.hotAwaiting === 1 ? "" : "s"} quente${alerts.hotAwaiting === 1 ? "" : "s"} sem resposta`}
                  onClick={() => setFilter("quentes")}
                />
              )}
              {alerts.closingSoon > 0 && (
                <AlertChip
                  tone="warn"
                  text={`${alerts.closingSoon} conversa${alerts.closingSoon === 1 ? "" : "s"} fecha${alerts.closingSoon === 1 ? "" : "m"} em menos de 3h`}
                  onClick={() => setFilter("fecha_hoje")}
                />
              )}
              {alerts.pendingQuotes > 0 && (
                <AlertChip
                  tone="info"
                  text={`${alerts.pendingQuotes} cliente${alerts.pendingQuotes === 1 ? "" : "s"} aguardando orçamento`}
                  onClick={() => setFilter("orcamento")}
                />
              )}
            </div>
          )}

          {/* Search bar — sticky on scroll */}
          <div className="sticky top-0 z-10 -mx-3 px-3 py-2 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/70 border-b border-border space-y-2">
            <div className="flex flex-col md:flex-row md:items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Pesquisar cliente, telefone, produto ou mensagem..."
                  className="w-full h-10 rounded-md bg-input pl-9 pr-20 text-sm outline-none focus:ring-2 focus:ring-ring border border-border shadow-sm"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                    aria-label="Limpar pesquisa"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {hasSearch && (
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {filtered.length} resultado{filtered.length === 1 ? "" : "s"}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {FILTERS.map((f) => {
                const active = filter === f.key;
                const count = (counts as Record<string, number>)[f.key];
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-medium border transition-colors",
                      active
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-background text-foreground/80 border-border hover:text-foreground hover:bg-accent",
                    )}
                  >
                    {f.label}
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-[10px] font-bold tabular-nums min-w-[16px] text-center",
                        active ? "bg-primary-foreground/20" : "bg-secondary",
                        count === 0 && "opacity-40",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              {hasSearch ? "Nenhum resultado encontrado para esta pesquisa." : "Nenhuma oportunidade nesta categoria."}
            </p>
          ) : (
            <ul
              className={cn(
                "grid gap-2",
                compact
                  ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
                  : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
              )}
            >
              {filtered.map((it) => (
                <OpportunityCard
                  key={it.conv.id}
                  item={it}
                  now={now}
                  compact={compact}
                  onOpen={() =>
                    navigate({ to: "/inbox/$conversationId", params: { conversationId: it.conv.id } })
                  }
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function AlertChip({
  tone,
  text,
  onClick,
}: {
  tone: "urgent" | "warn" | "info";
  text: string;
  onClick?: () => void;
}) {
  const cls =
    tone === "urgent"
      ? "bg-[var(--status-urgent)]/10 text-[var(--status-urgent)] border-[var(--status-urgent)]/40"
      : tone === "warn"
        ? "bg-amber-500/10 text-amber-500 border-amber-500/40"
        : "bg-primary/10 text-primary border-primary/40";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold hover:opacity-90",
        cls,
      )}
    >
      <AlertTriangle className="h-3 w-3" />
      {text}
    </button>
  );
}

function OpportunityCard({
  item,
  now,
  onOpen,
}: {
  item: OppItem;
  now: number;
  onOpen: () => void;
}) {
  const { lead, last, score, conv, messages } = item;
  const tier = TIER_META[score.tier];
  const nextAction = lead.nextAction?.label
    ?? (conv.awaitingReply ? "Retornar contato" : "Aguardar cliente");

  return (
    <li className="rounded-md border border-border bg-background p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            className="text-sm font-semibold truncate hover:underline text-left"
          >
            {lead.name}
          </button>
          {lead.product && (
            <p className="text-[11px] text-muted-foreground truncate">{lead.product}</p>
          )}
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold shrink-0",
            tier.cls,
          )}
          title={score.reasons.join(" · ") || tier.label}
        >
          {tier.emoji} {score.score}/100
        </span>
      </div>

      <dl className="text-[11px] text-muted-foreground space-y-0.5">
        <div className="flex gap-1">
          <dt className="font-medium text-foreground/80">Última interação:</dt>
          <dd>{formatAgo(conv.lastMessageAt, now)}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="font-medium text-foreground/80">Status:</dt>
          <dd className="capitalize">
            {score.tier === "quente" ? "Lead quente"
              : score.tier === "morno" ? "Lead morno"
              : "Lead frio"}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt className="font-medium text-foreground/80">Próxima ação:</dt>
          <dd className="truncate">{nextAction}</dd>
        </div>
        {last?.text && (
          <p className="mt-1 line-clamp-2 italic">
            "{last.text}"
          </p>
        )}
      </dl>

      <div className="flex items-center gap-1.5 pt-1 border-t border-border">
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 h-7 rounded-md bg-secondary text-[11px] font-semibold hover:bg-accent"
        >
          Abrir conversa
        </button>
        <SuggestButton conv={conv} lead={lead} messages={messages} />
      </div>
    </li>
  );
}

function SuggestButton({
  conv,
  lead,
  messages,
}: {
  conv: Conversation;
  lead: Lead;
  messages: Message[];
}) {
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const onSuggest = async () => {
    setLoading(true);
    setSuggestion(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sessão expirada");

      const res = await fetch("/api/ai/suggest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          leadName: lead.name,
          channel: lead.channel,
          product: lead.product,
          tags: lead.tags,
          conversationId: conv.id,
          leadId: lead.id,
          messages: messages.slice(-20).map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error ?? "Erro ao gerar sugestão";
        if (res.status === 429) toast.error("Limite de IA atingido. Tente em alguns minutos.");
        else if (res.status === 402) toast.error("Créditos esgotados. Recarregue no workspace.");
        else toast.error(msg);
        return;
      }
      setSuggestion(data.suggestedReply ?? data.fallbackMessage ?? "Sem sugestão disponível.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao consultar IA");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onSuggest}
        disabled={loading}
        title="Sugerir mensagem com IA (não envia automaticamente)"
        className="h-7 px-2 inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary border border-primary/30 text-[11px] font-semibold hover:bg-primary/20 disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        Sugerir
      </button>
      {suggestion && (
        <div className="absolute right-0 bottom-full mb-2 w-72 rounded-md border border-border bg-popover shadow-lg p-2.5 z-20 text-left">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              Sugestão da IA
            </span>
            <button
              type="button"
              onClick={() => setSuggestion(null)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Fechar"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <p className="text-xs whitespace-pre-wrap">{suggestion}</p>
          <div className="flex gap-1.5 mt-2">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(suggestion).catch(() => undefined);
                toast.success("Sugestão copiada");
              }}
              className="flex-1 h-7 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90"
            >
              Copiar
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground italic">
            Não envia automaticamente — revise antes de enviar.
          </p>
        </div>
      )}
    </div>
  );
}
