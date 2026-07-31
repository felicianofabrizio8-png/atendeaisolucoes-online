// Fila Inteligente de Recuperação (Sprint 6 · Fase 6.1).
//
// Lista os leads em risco ordenados pelo Recovery Score, com explicação de
// prioridade e ação sugerida. Nada é enviado a partir desta tela: as ações
// levam o vendedor para a conversa, onde as regras de janela já valem.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { getRecoveryEngine } from "@/lib/recovery-engine.functions";
import { RecoveryCards } from "@/components/recovery/RecoveryCards";
import { RecoveryQueueCard } from "@/components/recovery/RecoveryQueueCard";
import { RecoveryDetailSheet } from "@/components/recovery/RecoveryDetailSheet";
import { STATE_LABEL, type RecoveryQueueItem } from "@/lib/recovery";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/inbox/recovery-queue")({
  component: RecoveryQueuePage,
  head: () => ({
    meta: [
      { title: "Fila Inteligente de Recuperação | Atende Aí" },
      {
        name: "description",
        content:
          "Priorize os leads com maior chance de recuperação: score explicado, janela do WhatsApp e ação sugerida para cada cliente parado.",
      },
      { property: "og:title", content: "Fila Inteligente de Recuperação | Atende Aí" },
      {
        property: "og:description",
        content:
          "Score de recuperação, chance estimada e próxima ação para cada lead parado no atendimento.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Filter = "todos" | "urgentes" | "janela_aberta" | "template";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "todos", label: "Todos" },
  { id: "urgentes", label: "Prioridade alta" },
  { id: "janela_aberta", label: "Janela aberta" },
  { id: "template", label: "Exigem template" },
];

function RecoveryQueuePage() {
  const navigate = useNavigate();
  const fetchEngine = useServerFn(getRecoveryEngine);
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["recovery-engine"],
    queryFn: () => fetchEngine(),
    staleTime: 60_000,
  });

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [detail, setDetail] = useState<RecoveryQueueItem | null>(null);

  const queue = data?.queue ?? [];

  const filtered = useMemo(() => {
    const q = search
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return queue.filter((item) => {
      if (filter === "urgentes" && item.tier !== "muito_alta" && item.tier !== "alta") {
        return false;
      }
      if (
        filter === "janela_aberta" &&
        item.window.state !== "open" &&
        item.window.state !== "closing_soon"
      ) {
        return false;
      }
      if (filter === "template" && !item.action.requiresTemplate) return false;
      if (!q) return true;
      const hay = [item.leadName, item.product, STATE_LABEL[item.state]]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return hay.includes(q);
    });
  }, [queue, search, filter]);

  const openConversation = (item: RecoveryQueueItem) => {
    setDetail(null);
    navigate({ to: "/inbox/$conversationId", params: { conversationId: item.conversationId } });
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="border-b border-border px-3 md:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            to="/inbox"
            aria-label="Voltar para a caixa de entrada"
            className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-accent shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-none truncate">
              Fila Inteligente de Recuperação
            </h1>
            <p className="mt-1 text-[11px] md:text-xs text-muted-foreground truncate">
              Quem contatar primeiro, por quê e com qual abordagem.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="h-9 px-3 text-xs rounded-md border border-border hover:bg-accent inline-flex items-center gap-1.5 shrink-0"
        >
          {isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">Atualizar</span>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="px-3 md:px-6 py-3 space-y-3">
          <RecoveryCards
            cards={
              data?.cards ?? {
                recoveredToday: 0,
                windowOpen: 0,
                windowClosed: 0,
                highPriority: 0,
                recovered: 0,
                pending: 0,
                lost: 0,
                pipelineValue: 0,
              }
            }
            loading={isLoading}
          />

          {data && data.approvedTemplates === 0 && data.cards.windowClosed > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex gap-2 text-xs text-amber-700 dark:text-amber-400">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              <p>
                Há leads com a janela de 24h fechada e nenhum template aprovado cadastrado.
                Sem template aprovado não é possível reabrir a conversa pelo WhatsApp.
              </p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar cliente ou produto"
                aria-label="Buscar na fila de recuperação"
                className="w-full h-11 sm:h-10 pl-9 pr-3 rounded-md bg-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="tablist">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    "h-11 sm:h-10 px-3 text-xs rounded-md border whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring",
                    filter === f.id
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : "border-border hover:bg-accent",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculando prioridades...
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-12 text-sm text-muted-foreground">
              Nenhum lead nesta condição — sua fila está em dia.
            </p>
          ) : (
            <div className="space-y-2 pb-6">
              {filtered.map((item) => (
                <RecoveryQueueCard
                  key={item.conversationId}
                  item={item}
                  onOpenDetails={setDetail}
                  onOpenConversation={openConversation}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <RecoveryDetailSheet
        item={detail}
        onOpenChange={(open) => !open && setDetail(null)}
        onOpenConversation={openConversation}
      />
    </div>
  );
}
