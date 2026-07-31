import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  FileText,
  Plus,
  X,
  Send,
  Check,
  Calendar as CalendarIcon,
  CreditCard,
  Percent,
  Package as PackageIcon,
  Sparkles,
  MessageCircle,
  Copy,
  Loader2,
  Pencil,
  RotateCcw,
  Trash2,
  Settings as SettingsIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { formatBRL, timeAgo, type Channel } from "@/data/mock";
import { products, getProduct, activePrice } from "@/data/products";
import { getLeads, getConversations, subscribeRepo, createLead } from "@/data/leadRepo";
import {
  createQuote,
  listQuotes,
  subscribeQuotes,
  buildQuoteMessage,
  computeQuoteStatus,
  sendQuoteWhatsApp,
  QuoteSendError,
  deleteQuote,
  type PaymentMethod,
  type Quote,
  type QuoteStatus,
} from "@/data/quotes";
import { newQuoteSendAttemptId, friendlyQuoteSendMessage } from "@/lib/quote-send/errors";
import { qsCode, qsDebug } from "@/lib/quote-send/diagnostics";

import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import { SmartImage } from "@/components/SmartImage";
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
    return out;
  },
});

interface QuotesSearch {
  new?: "1";
  leadId?: string;
  conversationId?: string;
  suggestedProductId?: string;
  suggestionReason?: string;
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
  const PAGE_SIZE = 20;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visibleQuotes = quotes.slice(0, visibleCount);

  // Abre o modal automaticamente quando vier de outra tela com ?new=1
  useEffect(() => {
    if (search.new === "1") {
      setPrefillLeadId(search.leadId);
      setPrefillConvId(search.conversationId);
      setPrefillProductId(search.suggestedProductId);
      setSuggestionReason(search.suggestionReason);
      setOpen(true);
      navigate({ to: "/orcamentos", search: {}, replace: true });
    }
  }, [
    search.new,
    search.leadId,
    search.conversationId,
    search.suggestedProductId,
    search.suggestionReason,
    navigate,
  ]);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="sticky top-0 z-20 bg-background h-14 px-4 md:px-6 border-b border-border flex items-center gap-3 safe-top">
        <FileText className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold">Orçamentos</h1>
          <p className="text-[11px] text-muted-foreground truncate">
            {quotes.length} orçamento{quotes.length === 1 ? "" : "s"} criado
            {quotes.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          onClick={() => {
            setPrefillLeadId(undefined);
            setPrefillConvId(undefined);
            setOpen(true);
          }}
          aria-label="Novo orçamento"
          className="inline-flex items-center justify-center gap-1.5 h-11 w-11 md:h-9 md:w-auto md:px-3 rounded-md bg-primary text-primary-foreground hover:opacity-90 text-xs font-semibold shrink-0"
        >
          <Plus className="h-4 w-4 md:h-3.5 md:w-3.5" />
          <span className="hidden md:inline">Novo orçamento</span>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {quotes.length === 0 ? (
          <EmptyState onCreate={() => setOpen(true)} />
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 max-w-5xl">
              {visibleQuotes.map((q) => (
                <QuoteCard key={q.id} quote={q} />
              ))}
            </div>
            {visibleCount < quotes.length && (
              <div className="max-w-5xl mt-4 flex justify-center">
                <button
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-secondary hover:bg-accent text-xs font-semibold"
                >
                  Carregar mais ({quotes.length - visibleCount})
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
            if (q.conversationId) {
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

