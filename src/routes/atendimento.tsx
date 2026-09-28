import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, FlaskConical, PanelRight } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useAtendimentoData, type AtendimentoContact } from "@/hooks/useAtendimentoData";
import { computeStats, STAT_DEFINITIONS } from "@/lib/atendimento/stats";
import { StatCarousel } from "@/components/atendimento/StatCarousel";
import { ConversationRail } from "@/components/atendimento/ConversationRail";
import { ChatThread } from "@/components/atendimento/ChatThread";
import { InsightPanel } from "@/components/atendimento/InsightPanel";

export const Route = createFileRoute("/atendimento")({
  component: AtendimentoPage,
});

/**
 * Abaixo de `lg` as três colunas não cabem lado a lado, então a tela vira
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
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return compact;
}

function AtendimentoPage() {
  const [forceSimulated, setForceSimulated] = useState(false);
  const { contacts, isSimulated, status, error } = useAtendimentoData({ forceSimulated });
  const compact = useIsCompact();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statFilter, setStatFilter] = useState<string | null>(null);
  // O texto do composer mora aqui, e não dentro do ChatThread, só para o
  // painel de IA conseguir carregar uma sugestão nele ("Usar no chat").
  const [draft, setDraft] = useState("");

  const stats = useMemo(() => computeStats(contacts), [contacts]);

  const visible = useMemo(() => {
    const def = STAT_DEFINITIONS.find((d) => d.key === statFilter);
    const now = Date.now();
    const q = query.trim().toLowerCase();

    return contacts.filter((c) => {
      if (def && !def.match(c, now)) return false;
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
  }, [contacts, statFilter, query]);

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
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      {/* Sem faixa de cabeçalho: ela custava uma linha inteira da altura para
          repetir a contagem que o cartão já mostra. O que ela carregava de
          útil foi para onde pertence — voltar e Info/IA no topo da conversa,
          o seletor de dados de exemplo junto da fila que ele afeta. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[clamp(280px,24vw,340px)_minmax(0,1fr)_clamp(300px,26vw,380px)]">
        {/* Coluna 1 — métrica giratória + fila */}
        <aside
          className={cn(
            "min-h-0 flex-col gap-4 border-border p-4 lg:flex lg:border-r",
            selectedId ? "hidden" : "flex",
          )}
        >
          <StatCarousel stats={stats} activeKey={statFilter} onSelect={setStatFilter} />
          <div className="min-h-0 flex-1">
            <ConversationRail
              contacts={visible}
              selectedId={selectedId}
              onSelect={setSelectedId}
              query={query}
              onQueryChange={setQuery}
              activeFilterLabel={activeStat ? `${activeStat.label}: ${activeStat.count}` : null}
              onClearFilter={() => setStatFilter(null)}
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
                  className={cn(
                    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-[10px] font-bold text-muted-foreground transition-colors disabled:cursor-default",
                    !(isSimulated && !forceSimulated) && "hover:text-foreground",
                  )}
                >
                  <FlaskConical className="h-3 w-3" />
                  {isSimulated ? "Clientes simulados" : "Ver exemplos"}
                </button>
              }
            />
          </div>
        </aside>

        {/* Coluna 2 — conversa */}
        <main className={cn("min-h-0", selectedId ? "block" : "hidden lg:block")}>
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
              onBack={() => setSelectedId(null)}
              actions={
                <Sheet>
                  <SheetTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2.5 py-1.5 text-[11px] font-bold transition-colors hover:bg-secondary lg:hidden"
                    >
                      <PanelRight className="h-3.5 w-3.5" />
                      Info / IA
                    </button>
                  </SheetTrigger>
                  {/* pt-12: o botão de fechar da gaveta mora no canto superior
                      direito e brigaria com o alternador Info/IA. */}
                  <SheetContent
                    side="right"
                    className="w-[88vw] max-w-[420px] overflow-hidden p-4 pt-12"
                  >
                    <SheetTitle className="sr-only">Informações e IA da conversa</SheetTitle>
                    <InsightPanel contact={selected} onUseSuggestion={applySuggestion} />
                  </SheetContent>
                </Sheet>
              }
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Selecione uma conversa.
            </div>
          )}
        </main>

        {/* Coluna 3 — Info / IA */}
        <aside className="hidden min-h-0 border-l border-border p-4 lg:block">
          {selected && <InsightPanel contact={selected} onUseSuggestion={applySuggestion} />}
        </aside>
      </div>
    </div>
  );
}
