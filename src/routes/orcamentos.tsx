import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Plus, Search, SearchX, X } from "lucide-react";
import { getLeads, subscribeRepo } from "@/data/leadRepo";
import { matchesQuote, normalizeQuoteSearch } from "@/lib/quote-presentation";
import { listQuotes, subscribeQuotes, type Quote } from "@/data/quotes";
import { QuoteCard } from "@/components/orcamentos/QuoteCard";
import { QuoteFormModal } from "@/components/orcamentos/QuoteFormModal";
import { QuoteSuccessModal } from "@/components/orcamentos/QuoteSuccessModal";
import {
  FILTERS,
  QuotesEmptyState,
  QuotesOverview,
  SORTS,
  sortQuotes,
  useQuoteStats,
  type QuoteFilter,
  type QuoteSort,
} from "@/components/orcamentos/QuotesOverview";
import { computeQuoteStatus } from "@/data/quotes";
import "@/components/orcamentos/quotes.css";

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

function quoteCustomerName(quote: Quote, leads: ReturnType<typeof getLeads>): string | undefined {
  const lead = leads.find((item) => item.id === quote.leadId);
  const own = quote.customerDetails
    ? `${quote.customerDetails.firstName} ${quote.customerDetails.lastName}`.trim()
    : "";
  return own || lead?.name;
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
  const [successQuote, setSuccessQuote] = useState<Quote | null>(null);
  const [requestedAction, setRequestedAction] = useState<{
    id: string;
    action: "send" | "edit" | "details";
  } | null>(null);
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
  const [filter, setFilter] = useState<QuoteFilter>("todos");
  const [sort, setSort] = useState<QuoteSort>("recentes");
  const reduceMotion = useReducedMotion();
  const tabsId = useId();
  // Recomputed when leads load, so names resolve for quotes without customer details.
  const nameOf = useCallback((quote: Quote) => quoteCustomerName(quote, leads), [leads]);
  const stats = useQuoteStats(quotes, nameOf);
  const filteredQuotes = sortQuotes(
    quotes.filter(
      (q) =>
        (filter === "todos" || computeQuoteStatus(q) === filter) &&
        matchesQuote(
          q,
          leads.find((l) => l.id === q.leadId),
          query,
        ),
    ),
    sort,
  );
  const changeFilter = (next: QuoteFilter) => {
    setFilter(next);
    setVisibleCount(PAGE_SIZE);
  };
  const visibleQuotes = filteredQuotes.slice(0, visibleCount);
  const suggestions = [
    ...new Map(
      quotes
        .map((quote) => {
          const lead = leads.find((item) => item.id === quote.leadId);
          const name = quote.customerDetails
            ? `${quote.customerDetails.firstName} ${quote.customerDetails.lastName}`.trim() ||
              lead?.name ||
              ""
            : lead?.name || "";
          const phone = quote.customerDetails?.phone1 || lead?.phone || "";
          return { name, phone };
        })
        .filter(
          (customer) =>
            customer.name &&
            normalizeQuoteSearch(customer.name).includes(normalizeQuoteSearch(query)),
        )
        .map((customer) => [normalizeQuoteSearch(customer.name), customer] as const),
    ).values(),
  ].slice(0, 6);
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
  const closeSuccess = () => {
    const createdQuote = successQuote;
    setSuccessQuote(null);
    if (!createdQuote?.conversationId) return;
    if (returnTo === "atendimento") {
      navigate({ to: "/atendimento", search: { conversation: createdQuote.conversationId } });
    } else {
      navigate({
        to: "/inbox/$conversationId",
        params: { conversationId: createdQuote.conversationId },
        search: { quote: createdQuote.id },
      });
    }
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
    <div className="lume-quotes">
      <div className="lq-shell">
        <header className="lq-header">
          <div>
            <h1>Orçamentos</h1>
            <p>Crie, envie e acompanhe suas propostas em um só lugar.</p>
          </div>
          <button type="button" onClick={openCreate} className="lq-primary">
            <Plus aria-hidden="true" />
            Criar orçamento
          </button>
        </header>
        {quotes.length === 0 ? (
          <QuotesEmptyState onCreate={openCreate} />
        ) : (
          <>
            <QuotesOverview
              stats={stats}
              filter={filter}
              onFilter={changeFilter}
              onAttention={() => {
                changeFilter("todos");
                setSort("validade");
              }}
            />
            <div className="lq-toolbar">
              <div
                className="lq-search"
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setShowSuggestions(false);
                }}
              >
                <div className="lq-search-box">
                  <Search aria-hidden="true" />
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
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label="Limpar pesquisa"
                      onClick={() => chooseSuggestion("")}
                      className="lq-icon"
                    >
                      <X />
                    </button>
                  )}
                </div>
                {suggestionsOpen && (
                  <ul
                    id="quote-suggestions"
                    role="listbox"
                    aria-label="Clientes encontrados"
                    className="lq-suggestions"
                  >
                    {suggestions.map((lead, index) => (
                      <li
                        key={normalizeQuoteSearch(lead.name)}
                        role="option"
                        aria-selected={index === activeSuggestion}
                        id={`quote-suggestion-${index}`}
                      >
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => chooseSuggestion(lead.name)}
                        >
                          <span className="truncate font-medium">{lead.name}</span>
                          <small>{lead.phone}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <label className="lq-sort">
                <span className="sr-only">Ordenar orçamentos</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as QuoteSort)}>
                  {SORTS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" />
              </label>
            </div>
            <LayoutGroup id={tabsId}>
              <div className="lq-tabs" role="tablist" aria-label="Filtrar por status">
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === item.id}
                    onClick={() => changeFilter(item.id)}
                  >
                    {filter === item.id && (
                      <motion.span
                        layoutId="lq-tab"
                        className="lq-tab-indicator"
                        transition={
                          reduceMotion
                            ? { duration: 0 }
                            : { type: "spring", stiffness: 420, damping: 34 }
                        }
                      />
                    )}
                    {item.dot && <i data-dot style={{ "--dot": item.dot } as CSSProperties} />}
                    <span>{item.label}</span>
                    <span>{stats.counts[item.id]}</span>
                  </button>
                ))}
              </div>
            </LayoutGroup>
            {filteredQuotes.length === 0 ? (
              <div className="lq-no-results" role="status">
                <SearchX aria-hidden="true" className="h-6 w-6" />
                <b>Nenhum orçamento encontrado</b>
                Tente outro nome, telefone ou produto, ou mude o filtro.
                <button
                  type="button"
                  className="lq-secondary"
                  onClick={() => {
                    chooseSuggestion("");
                    changeFilter("todos");
                  }}
                >
                  Limpar filtros
                </button>
              </div>
            ) : (
              <motion.div layout={!reduceMotion} className="lq-grid">
                <AnimatePresence initial={false} mode="popLayout">
                  {visibleQuotes.map((q, index) => (
                    <motion.div
                      key={q.id}
                      layout={!reduceMotion}
                      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduceMotion ? undefined : { opacity: 0, y: 8 }}
                      transition={{
                        duration: 0.4,
                        ease: [0.22, 1, 0.36, 1],
                        delay: reduceMotion ? 0 : Math.min(index, 8) * 0.035,
                      }}
                    >
                      <QuoteCard
                        quote={q}
                        requestedAction={
                          requestedAction?.id === q.id ? requestedAction.action : undefined
                        }
                        onActionHandled={() => setRequestedAction(null)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
            {visibleCount < filteredQuotes.length && (
              <div className="lq-more">
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="lq-secondary"
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
            setQuery("");
            setVisibleCount(PAGE_SIZE);
            setSuccessQuote(q);
          }}
        />
      )}
      {successQuote && (
        <QuoteSuccessModal
          quote={successQuote}
          canSend={(() => {
            const lead = leads.find((item) => item.id === successQuote.leadId);
            const phone = (successQuote.customerDetails?.phone1 || lead?.phone || "").replace(
              /\D/g,
              "",
            );
            return !!lead && phone.length >= 8 && phone.length <= 15;
          })()}
          onClose={closeSuccess}
          onSend={() => {
            setRequestedAction({ id: successQuote.id, action: "send" });
            setSuccessQuote(null);
          }}
          onEdit={() => {
            setRequestedAction({ id: successQuote.id, action: "edit" });
            setSuccessQuote(null);
          }}
          onView={() => {
            setRequestedAction({ id: successQuote.id, action: "details" });
            setSuccessQuote(null);
          }}
        />
      )}
    </div>
  );
}
