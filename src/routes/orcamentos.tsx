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
} from "lucide-react";
import { formatBRL, timeAgo } from "@/data/mock";
import { products, getProduct, activePrice } from "@/data/products";
import { getLeads, getConversations, subscribeRepo } from "@/data/leadRepo";
import {
  createQuote,
  listQuotes,
  subscribeQuotes,
  buildQuoteMessage,
  type PaymentMethod,
  type Quote,
} from "@/data/quotes";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/orcamentos")({
  component: QuotesPage,
  validateSearch: (search: Record<string, unknown>): QuotesSearch => {
    const out: QuotesSearch = {};
    if (search.new === "1") out.new = "1";
    if (typeof search.leadId === "string") out.leadId = search.leadId;
    if (typeof search.conversationId === "string") out.conversationId = search.conversationId;
    if (typeof search.suggestedProductId === "string")
      out.suggestedProductId = search.suggestedProductId;
    if (typeof search.suggestionReason === "string")
      out.suggestionReason = search.suggestionReason;
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

const PAYMENT_METHODS: PaymentMethod[] = [
  "Pix",
  "Cartão de crédito",
  "Boleto",
  "Transferência",
  "Dinheiro",
];

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
      <header className="h-14 px-6 border-b border-border flex items-center gap-3">
        <FileText className="h-4 w-4 text-primary" />
        <div className="flex-1">
          <h1 className="text-sm font-semibold">Orçamentos</h1>
          <p className="text-[11px] text-muted-foreground">
            {quotes.length} orçamento{quotes.length === 1 ? "" : "s"} criado{quotes.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          onClick={() => {
            setPrefillLeadId(undefined);
            setPrefillConvId(undefined);
            setOpen(true);
          }}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground hover:opacity-90 text-xs font-semibold"
        >
          <Plus className="h-3.5 w-3.5" /> Novo orçamento
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {quotes.length === 0 ? (
          <EmptyState onCreate={() => setOpen(true)} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 max-w-5xl">
            {quotes.map((q) => (
              <QuoteCard key={q.id} quote={q} />
            ))}
          </div>
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

function QuoteCard({ quote }: { quote: Quote }) {
  useSyncExternalStore(subscribeRepo, () => Date.now(), () => 0);
  const lead = getLeads().find((l) => l.id === quote.leadId);
  const navigate = useNavigate();
  // Resolve a conversa: a vinculada ao orçamento, ou a primeira conversa do lead.
  const targetConversationId =
    quote.conversationId ?? getConversations().find((c) => c.leadId === quote.leadId)?.id;

  const sendInConversation = () => {
    if (!targetConversationId) return;
    navigate({
      to: "/inbox/$conversationId",
      params: { conversationId: targetConversationId },
      search: { quote: quote.id },
    });
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{quote.productName}</div>
          <div className="text-[11px] text-muted-foreground">
            Para {lead?.name ?? "—"} • criado há {timeAgo(quote.createdAt)}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-bold">{formatBRL(quote.finalValue)}</div>
          {quote.installments > 1 && (
            <div className="text-[11px] text-muted-foreground">
              {quote.installments}x de {formatBRL(quote.finalValue / quote.installments)}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <Chip>{quote.paymentMethod}</Chip>
        {quote.discount > 0 && <Chip>Desc. {formatBRL(quote.discount)}</Chip>}
        <Chip>Válido até {new Date(quote.validUntil).toLocaleDateString("pt-BR")}</Chip>
        {quote.sent ? (
          <span className="inline-flex items-center gap-1 rounded bg-[var(--status-won)]/15 text-[var(--status-won)] px-1.5 py-0.5 font-semibold">
            <Check className="h-3 w-3" /> Enviado
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded bg-[var(--status-warm)]/15 text-[var(--status-warm)] px-1.5 py-0.5 font-semibold">
            Pendente envio
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {targetConversationId ? (
          <button
            onClick={sendInConversation}
            className="inline-flex items-center gap-1.5 text-xs rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:opacity-90 font-semibold"
          >
            <Send className="h-3.5 w-3.5" />
            {quote.sent ? "Reenviar na conversa" : "Enviar na conversa"}
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            Lead sem conversa ativa — abra uma conversa para enviar.
          </span>
        )}
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-secondary px-1.5 py-0.5">{children}</span>;
}

// ===== Form modal =====

interface QuoteFormModalProps {
  defaultLeadId?: string;
  defaultConversationId?: string;
  defaultProductId?: string;
  suggestionReason?: string;
  onCancel: () => void;
  onCreated: (q: Quote) => void;
}

function todayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function QuoteFormModal({
  defaultLeadId,
  defaultConversationId,
  defaultProductId,
  suggestionReason,
  onCancel,
  onCreated,
}: QuoteFormModalProps) {
  useSyncExternalStore(subscribeRepo, () => Date.now(), () => 0);
  const leads = getLeads();
  const [leadId, setLeadId] = useState(defaultLeadId ?? leads[0]?.id ?? "");
  const [productId, setProductId] = useState(
    defaultProductId && getProduct(defaultProductId) ? defaultProductId : products[0]?.id ?? "",
  );
  // O aviso "sugerido pela IA" some assim que o usuário troca o produto
  const [showSuggestion, setShowSuggestion] = useState(
    !!defaultProductId && !!suggestionReason,
  );
  const [discountRaw, setDiscountRaw] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Pix");
  const [installments, setInstallments] = useState(1);
  const [validUntil, setValidUntil] = useState(todayPlusDays(7));

  const product = getProduct(productId);
  const unitPrice = product ? activePrice(product) : 0;
  const discount = Math.max(0, Math.min(Number(discountRaw.replace(/[^\d]/g, "")) || 0, unitPrice));
  const finalValue = Math.max(0, unitPrice - discount);

  const previewMessage = useMemo(() => {
    if (!product) return "";
    return buildQuoteMessage({
      product,
      finalValue,
      installments,
      paymentMethod,
      validUntil,
      discount,
    });
  }, [product, finalValue, installments, paymentMethod, validUntil, discount]);

  const canSubmit = !!product && !!leadId && finalValue > 0 && installments >= 1;

  const submit = async () => {
    if (!canSubmit) return;
    const q = await createQuote({
      leadId,
      conversationId: defaultConversationId,
      productId,
      discount,
      paymentMethod,
      installments,
      validUntil,
    });
    onCreated(q);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Novo orçamento</h2>
          <button onClick={onCancel} className="ml-auto p-1 rounded hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {defaultProductId && product && (
          <div className="px-4 pt-3">
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 flex items-center gap-2 text-xs">
              <PackageIcon className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-muted-foreground">Produto selecionado:</span>
              <span className="font-semibold truncate">{product.name}</span>
              <span className="ml-auto text-[11px] text-muted-foreground shrink-0">
                Você pode trocar abaixo
              </span>
            </div>
          </div>
        )}

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Lead */}
          <Field label="Cliente / Lead">
            <select
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              disabled={!!defaultLeadId}
              className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-70"
            >
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>

          {/* Produto */}
          <Field label="Produto" icon={PackageIcon}>
            <select
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                setShowSuggestion(false);
              }}
              className={cn(
                "w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring",
                showSuggestion && "ring-2 ring-primary/40",
              )}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {formatBRL(activePrice(p))}
                </option>
              ))}
            </select>
            {showSuggestion && suggestionReason && (
              <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-primary">
                <Sparkles className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  Sugerido pela IA: {suggestionReason}{" "}
                  <button
                    type="button"
                    onClick={() => setShowSuggestion(false)}
                    className="underline text-muted-foreground hover:text-foreground"
                  >
                    trocar
                  </button>
                </span>
              </div>
            )}
          </Field>

          {/* Preço base */}
          <Field label="Preço do produto">
            <div className="rounded-md bg-input/60 px-3 py-2 text-sm">{formatBRL(unitPrice)}</div>
          </Field>

          {/* Desconto */}
          <Field label="Desconto (R$)" icon={Percent}>
            <input
              inputMode="numeric"
              value={discountRaw}
              onChange={(e) => setDiscountRaw(e.target.value.replace(/[^\d]/g, ""))}
              className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="0"
            />
          </Field>

          {/* Forma de pagamento */}
          <Field label="Forma de pagamento" icon={CreditCard}>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>

          {/* Parcelas */}
          <Field label="Parcelas">
            <select
              value={installments}
              onChange={(e) => setInstallments(Number(e.target.value))}
              className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              {[1, 2, 3, 4, 6, 10, 12, 18, 24].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "À vista" : `${n}x`}
                </option>
              ))}
            </select>
          </Field>

          {/* Validade */}
          <Field label="Válido até" icon={CalendarIcon}>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          {/* Valor final destacado */}
          <div className="md:col-span-2 rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Valor final
              </div>
              <div className="text-2xl font-bold text-primary">{formatBRL(finalValue)}</div>
              {installments > 1 && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {installments}x de {formatBRL(finalValue / installments)}
                </div>
              )}
            </div>
            {discount > 0 && (
              <div className="text-right">
                <div className="text-[11px] text-muted-foreground line-through">
                  {formatBRL(unitPrice)}
                </div>
                <div className="text-xs text-[var(--status-won)] font-semibold">
                  −{formatBRL(discount)}
                </div>
              </div>
            )}
          </div>

          {/* Pré-visualização da mensagem */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
              <Sparkles className="h-3 w-3" /> Mensagem pronta
            </div>
            <div className="rounded-md border border-border bg-background/40 p-3 text-sm whitespace-pre-wrap leading-relaxed">
              {previewMessage}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs rounded-md bg-secondary px-3 py-2 hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            disabled={!canSubmit}
            onClick={submit}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-semibold rounded-md px-3 py-2 disabled:opacity-40",
              defaultConversationId
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-primary text-primary-foreground hover:opacity-90",
            )}
          >
            {defaultConversationId ? (
              <>
                <Send className="h-3.5 w-3.5" /> Salvar e enviar na conversa
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" /> Salvar orçamento
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: typeof PackageIcon;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1 mb-1">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </span>
      {children}
    </label>
  );
}
