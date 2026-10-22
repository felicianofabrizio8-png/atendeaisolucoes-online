import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, FlaskConical, PanelRight, Sparkles } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useAtendimentoData, type AtendimentoContact } from "@/hooks/useAtendimentoData";
import { useAtendimentoFollowup } from "@/hooks/useAtendimentoFollowup";
import { computeStats, STAT_DEFINITIONS } from "@/lib/atendimento/stats";
import { StatCarousel, StatStrip } from "@/components/atendimento/StatCarousel";
import { ConversationRail, type RailSort } from "@/components/atendimento/ConversationRail";
import { computeAttention, type Attention } from "@/lib/atendimento/attention";
import { ChatThread } from "@/components/atendimento/ChatThread";
import { InsightPanel } from "@/components/atendimento/InsightPanel";
import { useHideMobileNav } from "@/components/layout/MobileBottomNav";

export const Route = createFileRoute("/atendimento")({
  component: AtendimentoPage,
  // `?conversation=<id>` abre direto uma conversa (ex.: volta de /orcamentos).
  validateSearch: (search: Record<string, unknown>): { conversation?: string } =>
    typeof search.conversation === "string" ? { conversation: search.conversation } : {},
});

/** Conversa pedida pela URL. Lido do `location` para funcionar fora do router (testes). */
function requestedConversationId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("conversation");
}

/**
 * Abaixo de `xl` as três colunas não cabem lado a lado com a sidebar, então a tela vira
 * navegação em dois níveis (lista → conversa) e o painel Info/IA passa a ser
 * uma gaveta. O breakpoint precisa ser o mesmo do grid para os dois não
 * discordarem sobre em qual modo a tela está.
 *
 * Devolve `null` enquanto ainda não mediu. Esse terceiro estado importa: o
 * HTML vem do servidor, onde não existe `matchMedia`, e chutar "desktop" no
 * primeiro render faria a tela abrir uma conversa sozinha no celular — o
 * usuário cairia direto no chat sem nunca ver a lista.
 */
function useIsCompact(): boolean | null {
  const [compact, setCompact] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279px)");
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return compact;
}

const SORT_KEY = "lume.chat.sort";

function readSort(): RailSort {
  try {
    return window.localStorage.getItem(SORT_KEY) === "prioridade" ? "prioridade" : "recentes";
  } catch {
    return "recentes";
  }
}

/** Relógio de minuto: espera, janela e prioridade andam sem recarregar. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function AtendimentoPage() {
  const [forceSimulated, setForceSimulated] = useState(false);
  const { contacts, isSimulated, status, error } = useAtendimentoData({ forceSimulated });
  const atendimentoFollowup = useAtendimentoFollowup({ enabled: !isSimulated });
  const compact = useIsCompact();
  // Celular: o botão do topo é a estrela da Lume e abre direto no chat com a IA.
  const isPhone = useIsMobile();
  const [selectedId, setSelectedId] = useState<string | null>(requestedConversationId);
  // Conversa aberta: o rodapé é do composer, a barra inferior desce.
  useHideMobileNav(!!selectedId);
  const [query, setQuery] = useState("");
  const [statFilter, setStatFilter] = useState<string | null>(null);
  // Ordem da fila: "Recentes" (como sempre foi) ou "Prioridade" (fila inteligente).
  const [sort, setSortState] = useState<RailSort>("recentes");
  useEffect(() => setSortState(readSort()), []);
  const setSort = (next: RailSort) => {
    setSortState(next);
    try {
      window.localStorage.setItem(SORT_KEY, next);
    } catch {
      // Sem armazenamento: vale até recarregar.
    }
  };
  const now = useMinuteClock();
  // O texto do composer mora aqui, e não dentro do ChatThread, só para o
  // painel de IA conseguir carregar uma sugestão nele ("Usar no chat").
  const [draft, setDraft] = useState("");

  const stats = useMemo(
    () => computeStats(contacts, now, atendimentoFollowup.byConversation),
    [atendimentoFollowup.byConversation, contacts, now],
  );

  const attention = useMemo(() => {
    const map = new Map<string, Attention>();
    for (const c of contacts) {
      map.set(
        c.conversation.id,
        computeAttention(
          { ...c, followup: atendimentoFollowup.byConversation.get(c.conversation.id) },
          now,
        ),
      );
    }
    return map;
  }, [atendimentoFollowup.byConversation, contacts, now]);

  const visible = useMemo(() => {
    const def = STAT_DEFINITIONS.find((d) => d.key === statFilter);
    const q = query.trim().toLowerCase();

    const filtered = contacts.filter((c) => {
      if (
        def &&
        !def.match(
          { ...c, followup: atendimentoFollowup.byConversation.get(c.conversation.id) },
          now,
        )
      )
        return false;
      if (!q) return true;
      const haystack = [
        c.lead.name,
        c.lead.phone,
        c.lead.handle,
        c.lead.product,
        c.conversation.detectedCity,
        c.conversation.detectedState,
        ...c.lead.tags,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
    if (sort !== "prioridade") return filtered;
    // Mesma pontuação do mapa acima (sort do JS é estável nos empates).
    const score = (c: AtendimentoContact) => attention.get(c.conversation.id)?.score ?? 0;
    return [...filtered].sort((a, b) => score(b) - score(a));
  }, [atendimentoFollowup.byConversation, attention, contacts, statFilter, query, sort, now]);

  // Alt+↑/↓ troca de conversa sem tirar a mão do teclado (inclusive digitando).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      if (visible.length === 0) return;
      event.preventDefault();
      const index = visible.findIndex((c) => c.conversation.id === selectedId);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = index === -1 ? 0 : Math.min(visible.length - 1, Math.max(0, index + step));
      setSelectedId(visible[next].conversation.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId]);

  // No desktop mantemos sempre uma conversa aberta — painel de atendimento
  // vazio não serve para nada. No compacto a lista é a primeira tela, então
  // seleção automática sequestraria o botão "voltar".
  useEffect(() => {
    if (compact !== false || visible.length === 0) return;
    if (!selectedId || !visible.some((c) => c.conversation.id === selectedId)) {
      setSelectedId(visible[0].conversation.id);
    }
  }, [compact, visible, selectedId]);

  const base =
    contacts.find((c) => c.conversation.id === selectedId) ??
    (compact === false ? visible[0] : undefined);
  const selected: AtendimentoContact | undefined = base;

  const activeStat = stats.find((s) => s.key === statFilter);

  const applySuggestion = (text: string) => {
    setDraft(text);
    toast.success("Sugestão carregada no campo de mensagem");
  };

  return (
    // h-full (e não 100dvh): o AppShell já limita a altura da viewport e
    // reserva o espaço da navegação inferior no mobile.
    <div className="lume-atendimento flex h-full min-h-0 flex-1 flex-col bg-background">
      {/* Sem faixa de cabeçalho: ela custava uma linha inteira da altura para
          repetir a contagem que o cartão já mostra. O que ela carregava de
          útil foi para onde pertence — voltar e Info/IA no topo da conversa,
          o seletor de dados de exemplo junto da fila que ele afeta. */}
      <div className="at-workspace grid min-h-0 min-w-0 flex-1 grid-cols-1 xl:grid-cols-[clamp(240px,20vw,300px)_minmax(0,1fr)_clamp(260px,22vw,340px)]">
        {/* Coluna 1 — métrica giratória + fila */}
        <aside
          className={cn(
            "at-queue min-h-0 min-w-0 flex-col gap-3 border-border p-3 xl:flex xl:border-r xl:gap-4 xl:p-4",
            selectedId ? "hidden" : "flex",
          )}
        >
          <div className="min-h-0 flex-1">
            <ConversationRail
              contacts={visible}
              selectedId={selectedId}
              onSelect={setSelectedId}
              query={query}
              onQueryChange={setQuery}
              activeFilterLabel={activeStat ? `${activeStat.label}: ${activeStat.count}` : null}
              onClearFilter={() => setStatFilter(null)}
              followupByConversation={atendimentoFollowup.byConversation}
              attention={attention}
              sort={sort}
              onSortChange={setSort}
              metrics={
                <>
                  <StatCarousel
                    stats={stats}
                    activeKey={statFilter}
                    onSelect={setStatFilter}
                    className="max-md:hidden"
                  />
                  {/* Celular: o cartão giratório não cabe; as filas viram pílulas. */}
                  <StatStrip
                    stats={stats}
                    activeKey={statFilter}
                    onSelect={setStatFilter}
                    className="md:hidden"
                  />
                </>
              }
              statusChip={
                // Só é interruptor quando existe base real para alternar; com
                // a empresa vazia o rótulo é apenas informativo.
                <button
                  type="button"
                  disabled={isSimulated && !forceSimulated}
                  onClick={() => setForceSimulated((v) => !v)}
                  title={
                    isSimulated && !forceSimulated
                      ? "Nenhuma conversa real encontrada nesta empresa. A tela está usando clientes simulados só para visualização — nada é gravado no banco."
                      : forceSimulated
                        ? "Voltar para as conversas reais da empresa"
                        : "Ver a tela com clientes de exemplo, sem expor dados reais"
                  }
                  aria-label={isSimulated ? "Clientes simulados" : "Ver exemplos"}
                  className={cn(
                    "at-demo-toggle",
                    !(isSimulated && !forceSimulated) && "hover:text-foreground",
                  )}
                  data-on={isSimulated || undefined}
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                  {/* Ligado vira etiqueta; desligado é só o ícone, sem poluir a fila. */}
                  {isSimulated && <span>Simulados</span>}
                </button>
              }
            />
          </div>
        </aside>

        {/* Coluna 2 — conversa */}
        <main
          className={cn(
            "at-conversation min-h-0 min-w-0",
            selectedId ? "block" : "hidden xl:block",
          )}
        >
          {/* Os três estados vêm da `main` e existem para a tela nunca ficar
              em branco sem explicação: carregando, falha e vazio de verdade.
              Vazio é vazio — a fila simulada só aparece pelo botão "Ver
              exemplos", nunca como preenchimento automático. */}
          {status === "loading" ? (
            <div className="p-6 text-sm text-muted-foreground">Carregando conversas...</div>
          ) : status === "error" ? (
            <div
              className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"
              role="alert"
            >
              <p className="text-sm font-medium">Não foi possível carregar as conversas.</p>
              <p className="text-xs text-muted-foreground">
                {error ?? "Tente novamente mais tarde."}
              </p>
            </div>
          ) : status === "empty" ? (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              Nenhuma conversa disponível.
            </div>
          ) : selected ? (
            <ChatThread
              contact={selected}
              draft={draft}
              onDraftChange={setDraft}
              simulated={isSimulated}
              onFollowupUpdated={atendimentoFollowup.refresh}
              onBack={() => setSelectedId(null)}
              actions={
                // Só no modo compacto: no desktop o painel já está na coluna 3
                // e uma segunda instância duplicaria as assinaturas do Coach.
                compact !== false && (
                  <Sheet>
                    <SheetTrigger asChild>
                      <button
                        type="button"
                        className="at-lume-star inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2.5 py-1.5 text-[11px] font-bold transition-colors hover:bg-secondary max-sm:h-10 max-sm:w-10 max-sm:justify-center max-sm:px-0 xl:hidden"
                      >
                        <PanelRight className="h-3.5 w-3.5 max-sm:hidden" />
                        <Sparkles className="h-[18px] w-[18px] sm:hidden" />
                        <span className="max-sm:sr-only">Info / Lume</span>
                      </button>
                    </SheetTrigger>
                    {/* pt-12: o botão de fechar da gaveta mora no canto superior
                      direito e brigaria com o alternador Info/IA. */}
                    <SheetContent
                      side="right"
                      className="lume-atendimento at-insight-sheet w-[88vw] max-w-[420px] overflow-hidden p-4 pt-12"
                    >
                      <SheetTitle className="sr-only">Informações e IA da conversa</SheetTitle>
                      <InsightPanel
                        contact={selected}
                        onUseSuggestion={applySuggestion}
                        simulated={isSimulated}
                        initialTab={isPhone ? "ia" : "info"}
                        followup={atendimentoFollowup.byConversation.get(selected.conversation.id)}
                        composerHasDraft={draft.trim().length > 0}
                      />
                    </SheetContent>
                  </Sheet>
                )
              }
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Selecione uma conversa.
            </div>
          )}
        </main>

        {/* Coluna 3 — Info / IA */}
        <aside className="at-sidebar hidden min-h-0 min-w-0 border-l border-border p-4 xl:block">
          {selected && compact === false && (
            <InsightPanel
              contact={selected}
              onUseSuggestion={applySuggestion}
              simulated={isSimulated}
              followup={atendimentoFollowup.byConversation.get(selected.conversation.id)}
              composerHasDraft={draft.trim().length > 0}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
