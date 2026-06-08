import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Search,
  Send,
  MessageCircle,
  History,
  Phone,
  Sparkles,
  AlertTriangle,
  TrendingUp,
  Users,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { getRecoveryDashboard, type RecoveryItem } from "@/lib/recovery.functions";
import { MetaTemplatesModal } from "@/components/MetaTemplatesModal";
import { recommendTemplate, type TemplateLike } from "@/lib/templateRecommend";

export const Route = createFileRoute("/inbox/recovery")({
  component: RecoveryPage,
});

function formatAgo(hours: number): string {
  if (hours < 24) return `há ${Math.floor(hours)}h`;
  const days = Math.floor(hours / 24);
  const remH = Math.floor(hours - days * 24);
  return remH > 0 ? `há ${days}d ${remH}h` : `há ${days}d`;
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    novo: "Novo",
    qualificado: "Qualificado",
    quente: "Quente",
    proposta: "Proposta",
    ganho: "Ganho",
    perdido: "Perdido",
  };
  return map[s] ?? s;
}

function statusTone(s: string): string {
  if (s === "quente") return "bg-red-500/15 text-red-600 border-red-500/30";
  if (s === "ganho") return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
  if (s === "perdido") return "bg-muted text-muted-foreground border-border";
  if (s === "proposta") return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  return "bg-primary/10 text-primary border-primary/30";
}

function RecoveryPage() {
  const fetchDashboard = useServerFn(getRecoveryDashboard);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["recovery-dashboard"],
    queryFn: () => fetchDashboard(),
    staleTime: 30_000,
  });

  const [templates, setTemplates] = useState<TemplateLike[]>([]);
  const [search, setSearch] = useState("");
  const [modalState, setModalState] = useState<{
    conversationId: string;
    suggestedName?: string;
  } | null>(null);
  const [historyFor, setHistoryFor] = useState<RecoveryItem | null>(null);

  // Carrega lista de templates Meta (usa endpoint existente)
  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;
      const res = await fetch("/api/whatsapp/templates/list", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = await res.json();
      setTemplates(json.templates ?? []);
    })();
  }, []);

  const items = data?.items ?? [];
  const metrics = data?.metrics;

  const filtered = useMemo(() => {
    const q = search
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (!q) return items;
    return items.filter((i) => {
      const hay = [i.name, i.phone, i.product, i.lastMessageText]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return hay.includes(q);
    });
  }, [items, search]);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="flex flex-col gap-2 border-b border-border px-3 md:px-6 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Link
              to="/inbox"
              className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent shrink-0"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="text-base font-semibold leading-none truncate">
                Recuperação de Leads — Fora da Janela 24h
              </h1>
              <p className="mt-1 text-[11px] md:text-xs text-muted-foreground truncate">
                Reabra conversas WhatsApp usando templates oficiais da Meta.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="h-9 px-3 text-xs rounded-md border border-border hover:bg-accent inline-flex items-center gap-1.5"
          >
            {isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Atualizar
          </button>
        </div>
      </header>

      {/* Indicadores */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-2 px-3 md:px-6 py-3 border-b border-border">
        <MetricCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Fora da janela 24h"
          value={metrics?.outOfWindowCount ?? 0}
          tone="amber"
        />
        <MetricCard
          icon={<Send className="h-4 w-4" />}
          label="Templates hoje"
          value={metrics?.templatesSentToday ?? 0}
          tone="primary"
        />
        <MetricCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Taxa de resposta"
          value={`${Math.round((metrics?.responseRate ?? 0) * 100)}%`}
          tone="emerald"
        />
        <MetricCard
          icon={<Users className="h-4 w-4" />}
          label="Leads reativados"
          value={metrics?.reactivatedLeads ?? 0}
          tone="primary"
        />
        <MetricCard
          icon={<Sparkles className="h-4 w-4" />}
          label="Vendas recuperadas"
          value={metrics?.recoveredSales ?? 0}
          tone="emerald"
        />
      </section>

      {/* Busca */}
      <div className="px-3 md:px-6 py-3 border-b border-border">
        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Pesquisar cliente, telefone ou produto"
            className="w-full h-10 pl-9 pr-3 rounded-md bg-input text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto p-3 md:p-6 space-y-2">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando conversas...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            Nenhum cliente fora da janela 24h.
          </div>
        ) : (
          filtered.map((item) => {
            const suggestion = recommendTemplate(
              {
                leadStatus: item.leadStatus,
                hasQuote: item.hasQuote,
                hasVisit: item.hasVisit,
                daysSinceLastInbound: item.hoursSince / 24,
                product: item.product,
              },
              templates,
            );
            return (
              <article
                key={item.conversationId}
                className="rounded-lg border border-border bg-card p-3 md:p-4 space-y-3 hover:border-primary/40 transition-colors"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-sm truncate">{item.name}</h3>
                      <span
                        className={cn(
                          "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border",
                          statusTone(item.leadStatus),
                        )}
                      >
                        {statusLabel(item.leadStatus)}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-600 border-amber-500/30">
                        Fora 24h
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                      {item.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {item.phone}
                        </span>
                      )}
                      {item.product && <span>· {item.product}</span>}
                      <span>· {formatAgo(item.hoursSince)}</span>
                    </div>
                  </div>
                </div>

                {item.lastMessageText && (
                  <p className="text-xs text-muted-foreground line-clamp-2 italic">
                    "{item.lastMessageText}"
                  </p>
                )}

                {suggestion && (
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <Sparkles className="h-3 w-3 text-primary" />
                    <span className="text-muted-foreground">Sugerido:</span>
                    <span className="font-mono font-medium text-primary">
                      {suggestion.name}
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      setModalState({
                        conversationId: item.conversationId,
                        suggestedName: suggestion?.name,
                      })
                    }
                    className="h-8 px-3 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-1.5"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Enviar template
                  </button>
                  <Link
                    to="/inbox/$conversationId"
                    params={{ conversationId: item.conversationId }}
                    className="h-8 px-3 text-xs rounded-md border border-border hover:bg-accent inline-flex items-center gap-1.5"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    Abrir conversa
                  </Link>
                  <button
                    type="button"
                    onClick={() => setHistoryFor(item)}
                    className="h-8 px-3 text-xs rounded-md border border-border hover:bg-accent inline-flex items-center gap-1.5"
                  >
                    <History className="h-3.5 w-3.5" />
                    Ver histórico
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      {modalState && (
        <MetaTemplatesModal
          open={true}
          conversationId={modalState.conversationId}
          suggestedTemplateName={modalState.suggestedName}
          onClose={() => setModalState(null)}
          onSent={() => {
            setModalState(null);
            refetch();
          }}
        />
      )}

      {historyFor && (
        <HistoryDrawer item={historyFor} onClose={() => setHistoryFor(null)} />
      )}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: "primary" | "amber" | "emerald";
}) {
  const toneCls =
    tone === "amber"
      ? "text-amber-600"
      : tone === "emerald"
        ? "text-emerald-600"
        : "text-primary";
  return (
    <div className="rounded-lg border border-border bg-card p-3 flex flex-col gap-1">
      <div className={cn("inline-flex items-center gap-1.5 text-[11px]", toneCls)}>
        {icon}
        <span className="font-medium">{label}</span>
      </div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function HistoryDrawer({
  item,
  onClose,
}: {
  item: RecoveryItem;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<
    Array<{ id: string; text: string; at: string; role: string }>
  >([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("messages")
        .select("id, text, at, role")
        .eq("conversation_id", item.conversationId)
        .order("at", { ascending: false })
        .limit(10);
      setMessages(((data as any[]) ?? []).reverse());
      setLoading(false);
    })();
  }, [item.conversationId]);

  return (
    <div className="fixed inset-0 z-[999] flex justify-end bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md bg-background border-l border-border flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{item.name}</h3>
            <p className="text-[11px] text-muted-foreground">Últimas mensagens</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 text-xs rounded-md border border-border hover:bg-accent"
          >
            Fechar
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground p-3 text-center">
              Sem mensagens.
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "rounded-md p-2.5 text-xs",
                  m.role === "lead"
                    ? "bg-muted/50"
                    : "bg-primary/10 text-foreground",
                )}
              >
                <div className="text-[10px] uppercase text-muted-foreground mb-1">
                  {m.role === "lead" ? "Cliente" : "Atendimento"} ·{" "}
                  {new Date(m.at).toLocaleString("pt-BR")}
                </div>
                <p className="whitespace-pre-wrap">{m.text}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
