import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { FileText, Plus, Search, X } from "lucide-react";
import { getLeads, subscribeRepo } from "@/data/leadRepo";
import { matchesQuote, normalizeQuoteSearch } from "@/lib/quote-presentation";
import { listQuotes, subscribeQuotes } from "@/data/quotes";
import { QuoteCard } from "@/components/orcamentos/QuoteCard";
import { QuoteFormModal } from "@/components/orcamentos/QuoteFormModal";

export const Route = createFileRoute("/orcamentos")({
  component: QuotesPage,
  validateSearch: (search: Record<string, unknown>): QuotesSearch => {
    const out: QuotesSearch = {};
    if (search.new === "1") out.new = "1";
    if (typeof search.leadId === "string") out.leadId = search.leadId;
    if (typeof search.conversationId === "string") out.conversationId = search.conversationId;
    if (typeof search.suggestedProductId === "string")
      out.suggestedProductId = search.suggestedProductId;
    if (typeof search.suggestionReason === "string") out.suggestionReason = search.suggestionReason;
    if (search.returnTo === "atendimento") out.returnTo = "atendimento";
    return out;
  },
});

interface QuotesSearch {
  new?: "1";
  leadId?: string;
  conversationId?: string;
  suggestedProductId?: string;
  suggestionReason?: string;
  /** Tela da conversa para onde voltar após criar (padrão: Caixa de atendimento). */
  returnTo?: "atendimento";
}

function useQuotes() {
  return useSyncExternalStore(
    (cb) => subscribeQuotes(cb),
    () => listQuotes(),
    () => listQuotes(),
  );
}

function QuotesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const quotes = useQuotes();
  const [open, setOpen] = useState(false);
  const [prefillLeadId, setPrefillLeadId] = useState<string | undefined>();
  const [prefillConvId, setPrefillConvId] = useState<string | undefined>();
  const [prefillProductId, setPrefillProductId] = useState<string | undefined>();
  const [suggestionReason, setSuggestionReason] = useState<string | undefined>();
  const [returnTo, setReturnTo] = useState<"atendimento" | undefined>();
  const PAGE_SIZE = 20;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const leads = useSyncExternalStore(subscribeRepo, getLeads, getLeads);
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const filteredQuotes = quotes.filter((q) =>
    matchesQuote(
      q,
      leads.find((l) => l.id === q.leadId),
      query,
    ),
  );
  const visibleQuotes = filteredQuotes.slice(0, visibleCount);
  const suggestions = leads
    .filter(
      (lead) =>
        quotes.some((q) => q.leadId === lead.id) &&
        normalizeQuoteSearch(lead.name).includes(normalizeQuoteSearch(query)),
    )
    .slice(0, 6);
  const suggestionsOpen = showSuggestions && !!query.trim() && suggestions.length > 0;
  const chooseSuggestion = (name: string) => {
    setQuery(name);
    setVisibleCount(PAGE_SIZE);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
  };
  const openCreate = () => {
    setPrefillLeadId(undefined);
    setPrefillConvId(undefined);
    setPrefillProductId(undefined);
    setSuggestionReason(undefined);
    setReturnTo(undefined);
    setOpen(true);
  };

  // Abre o modal automaticamente quando vier de outra tela com ?new=1
  useEffect(() => {
    if (search.new === "1") {
      setPrefillLeadId(search.leadId);
      setPrefillConvId(search.conversationId);
      setPrefillProductId(search.suggestedProductId);
      setSuggestionReason(search.suggestionReason);
      setReturnTo(search.returnTo);
      setOpen(true);
      navigate({ to: "/orcamentos", search: {}, replace: true });
    }
  }, [
    search.new,
    search.leadId,
    search.conversationId,
    search.suggestedProductId,
    search.suggestionReason,
    search.returnTo,
    navigate,
  ]);

  return (
    <div className="min-w-0 flex-1 overflow-y-auto bg-background dark:bg-black text-foreground">
      <div className="@container mx-auto w-full max-w-6xl px-5 py-8 sm:px-10 lg:px-16 lg:py-10">
        <header className="mb-8 flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">Orçamentos</h1>
          <button
            onClick={openCreate}
            className="h-10 min-w-24 rounded-full border border-foreground/40 px-7 text-base font-semibold transition-colors hover:bg-foreground/10"
          >
            Criar
          </button>
        </header>
        <div
          className="relative mb-9"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setShowSuggestions(false);
          }}
        >
          <div className="flex h-12 items-center gap-3 rounded-full border border-border bg-secondary/20 px-4 focus-within:border-foreground/50">
            <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              role="combobox"
              aria-label="Pesquisar orçamentos"
              aria-expanded={suggestionsOpen}
              aria-controls="quote-suggestions"
              aria-autocomplete="list"
              aria-activedescendant={
                suggestionsOpen && activeSuggestion >= 0
                  ? `quote-suggestion-${activeSuggestion}`
                  : undefined
              }
              value={query}
              onFocus={() => setShowSuggestions(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setVisibleCount(PAGE_SIZE);
                setShowSuggestions(true);
                setActiveSuggestion(-1);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setShowSuggestions(false);
                if (suggestionsOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                  e.preventDefault();
                  setActiveSuggestion(
                    (i) =>
                      (i + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) %
                      suggestions.length,
                  );
                }
                if (suggestionsOpen && e.key === "Enter" && activeSuggestion >= 0) {
                  e.preventDefault();
                  chooseSuggestion(suggestions[activeSuggestion].name);
                }
              }}
              placeholder="Pesquisar por nome, telefone ou produto"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button
                aria-label="Limpar pesquisa"
                onClick={() => chooseSuggestion("")}
                className="rounded-full p-1 hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {suggestionsOpen && (
            <ul
              id="quote-suggestions"
              role="listbox"
              aria-label="Clientes encontrados"
              className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-border bg-background p-2 shadow-xl"
            >
              {suggestions.map((lead, index) => (
                <li
                  key={lead.id}
                  role="option"
                  aria-selected={index === activeSuggestion}
                  id={`quote-suggestion-${index}`}
                >
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => chooseSuggestion(lead.name)}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left text-sm hover:bg-secondary ${index === activeSuggestion ? "bg-secondary" : ""}`}
                  >
                    <span className="truncate font-medium">{lead.name}</span>
                    <span className="text-xs text-muted-foreground">{lead.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {quotes.length === 0 ? (
          <EmptyState onCreate={openCreate} />
        ) : (
          <>
            {filteredQuotes.length === 0 && (
              <p className="py-16 text-center text-sm text-muted-foreground" role="status">
                Nenhum orçamento encontrado. Tente outro nome, telefone ou produto.
              </p>
            )}
            <div className="grid grid-cols-1 gap-6 @min-[760px]:grid-cols-2 @min-[760px]:gap-x-12 @min-[760px]:gap-y-12">
              {visibleQuotes.map((q) => (
                <QuoteCard key={q.id} quote={q} />
              ))}
            </div>
            {visibleCount < filteredQuotes.length && (
              <div className="max-w-5xl mt-4 flex justify-center">
                <button
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-secondary hover:bg-accent text-xs font-semibold"
                >
                  Carregar mais ({filteredQuotes.length - visibleCount})
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {open && (
        <QuoteFormModal
          defaultLeadId={prefillLeadId}
          defaultConversationId={prefillConvId}
          defaultProductId={prefillProductId}
          suggestionReason={suggestionReason}
          onCancel={() => setOpen(false)}
          onCreated={(q) => {
            setOpen(false);
            // Se criado a partir de uma conversa, voltar para ela com a mensagem pronta
            if (q.conversationId && returnTo === "atendimento") {
              // O Atendimento 2.0 encontra o orçamento pendente do lead sozinho.
              navigate({ to: "/atendimento", search: { conversation: q.conversationId } });
            } else if (q.conversationId) {
              navigate({
                to: "/inbox/$conversationId",
                params: { conversationId: q.conversationId },
                search: { quote: q.id },
              });
            }
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="max-w-md mx-auto text-center py-16">
      <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
        <FileText className="h-5 w-5 text-primary" />
      </div>
      <h2 className="text-base font-semibold">Nenhum orçamento ainda</h2>
      <p className="text-sm text-muted-foreground mt-1">
        Crie um orçamento em segundos: escolha o produto, ajuste desconto e parcelas, e envie a
        mensagem pronta direto na conversa.
      </p>
      <button
        onClick={onCreate}
        className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground hover:opacity-90 text-xs font-semibold"
      >
        <Plus className="h-3.5 w-3.5" /> Criar primeiro orçamento
      </button>
    </div>
  );
}
