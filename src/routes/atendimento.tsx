import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, FlaskConical, PanelRight } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { Message } from "@/data/mock";
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
  const { contacts, isSimulated } = useAtendimentoData();
  const compact = useIsCompact();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statFilter, setStatFilter] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /** Mensagens digitadas nesta sessão, por conversa (eco local, não enviado). */
  const [localEcho, setLocalEcho] = useState<Record<string, Message[]>>({});

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
  const selected: AtendimentoContact | undefined = base
    ? {
        ...base,
        messages: [...base.messages, ...(localEcho[base.conversation.id] ?? [])],
      }
    : undefined;

  const send = () => {
    const text = draft.trim();
    if (!text || !selected) return;
    const message: Message = {
      id: `local-${Date.now()}`,
      conversationId: selected.conversation.id,
      role: "agent",
      text,
      at: new Date().toISOString(),
      deliveryStatus: "sent",
    };
    setLocalEcho((prev) => ({
      ...prev,
      [message.conversationId]: [...(prev[message.conversationId] ?? []), message],
    }));
    setDraft("");
    toast.info("Prévia da interface", {
      description: "A mensagem aparece no histórico, mas não é enviada ao cliente nesta tela.",
    });
  };

  const activeStat = stats.find((s) => s.key === statFilter);

  const applySuggestion = (text: string) => {
    setDraft(text);
    toast.success("Sugestão carregada no campo de mensagem");
  };

  return (
    // h-full (e não 100dvh): o AppShell já limita a altura da viewport e
    // reserva o espaço da navegação inferior no mobile.
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5 lg:px-6">
        {selectedId && (
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary lg:hidden"
            aria-label="Voltar para a lista"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-sm font-bold leading-none">Atendimento</h1>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {contacts.length} conversas · {stats.find((s) => s.key === "aguardando")?.count ?? 0} aguardando resposta
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isSimulated && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[10px] font-bold text-muted-foreground"
              title="Nenhuma conversa real encontrada nesta empresa. A tela está usando clientes simulados só para visualização — nada é gravado no banco."
            >
              <FlaskConical className="h-3 w-3" />
              <span className="hidden sm:inline">Clientes simulados</span>
            </span>
          )}
          {selected && (
            <Sheet>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-[11px] font-bold lg:hidden"
                >
                  <PanelRight className="h-3.5 w-3.5" />
                  Info / IA
                </button>
              </SheetTrigger>
              {/* pt-12: o botão de fechar da gaveta mora no canto superior
                  direito e brigaria com o alternador Info/IA. */}
              <SheetContent side="right" className="w-[88vw] max-w-[420px] overflow-hidden p-4 pt-12">
                <SheetTitle className="sr-only">Informações e IA da conversa</SheetTitle>
                <InsightPanel contact={selected} onUseSuggestion={applySuggestion} />
              </SheetContent>
            </Sheet>
          )}
        </div>
      </header>

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
            />
          </div>
        </aside>

        {/* Coluna 2 — conversa */}
        <main className={cn("min-h-0", selectedId ? "block" : "hidden lg:block")}>
          {selected ? (
            <ChatThread
              contact={selected}
              draft={draft}
              onDraftChange={setDraft}
              onSend={send}
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
