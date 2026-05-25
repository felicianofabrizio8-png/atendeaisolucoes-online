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
} from "lucide-react";
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
  type PaymentMethod,
  type Quote,
  type QuoteStatus,
} from "@/data/quotes";
import { useAuth } from "@/auth/AuthContext";
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
      <header className="h-14 px-4 md:px-6 border-b border-border flex items-center gap-3">
        <FileText className="h-4 w-4 text-primary" />
        <div className="flex-1">
          <h1 className="text-sm font-semibold">Orçamentos</h1>
          <p className="text-[11px] text-muted-foreground">
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
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground hover:opacity-90 text-xs font-semibold"
        >
          <Plus className="h-3.5 w-3.5" /> Novo orçamento
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
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
  useSyncExternalStore(
    subscribeRepo,
    () => Date.now(),
    () => 0,
  );
  const lead = getLeads().find((l) => l.id === quote.leadId);
  const navigate = useNavigate();
  const [waOpen, setWaOpen] = useState(false);

  const targetConversationId =
    quote.conversationId ?? getConversations().find((c) => c.leadId === quote.leadId)?.id;

  const status = computeQuoteStatus(quote);
  const phone = lead?.phone?.replace(/\D/g, "") ?? "";
  const canWhatsApp = !!lead && phone.length >= 8 && phone.length <= 15;
  const hasClient = !!lead;

  const openConversation = () => {
    if (!hasClient) {
      toast.error("Selecione um cliente para abrir a conversa.");
      return;
    }
    if (!targetConversationId) {
      toast.message("Sem conversa ativa", {
        description: "Envie pelo WhatsApp para criar a conversa.",
      });
      return;
    }
    navigate({
      to: "/inbox/$conversationId",
      params: { conversationId: targetConversationId },
      search: { quote: quote.id },
    });
  };

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(quote.message);
      toast.success("Orçamento copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const channelLabel: Record<Channel, string> = {
    whatsapp: "WhatsApp",
    instagram: "Instagram",
    facebook: "Facebook",
  };
  const contactLine = lead
    ? lead.phone
      ? `${channelLabel[lead.channel]} • ${lead.phone}`
      : lead.handle
        ? `${channelLabel[lead.channel]} • @${lead.handle}`
        : channelLabel[lead.channel]
    : "Sem cliente vinculado";

  return (
    <>
      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{quote.productName}</div>
            <div className="text-[12px] font-medium truncate">
              {lead?.name ?? "— Cliente não selecionado —"}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              {contactLine} • criado há {timeAgo(quote.createdAt)}
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
          <StatusBadge status={status} />
        </div>

        {!hasClient && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            Selecione um cliente para enviar este orçamento.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              if (!hasClient) {
                toast.error("Selecione um cliente para enviar este orçamento.");
                return;
              }
              if (!canWhatsApp) {
                toast.error("Cliente sem telefone válido");
                return;
              }
              setWaOpen(true);
            }}
            disabled={!canWhatsApp}
            className="inline-flex items-center gap-1.5 text-xs rounded-md bg-[#25D366] text-white px-3 py-1.5 hover:opacity-90 font-semibold disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
            {quote.sent ? "Reenviar no WhatsApp" : "Enviar no WhatsApp"}
          </button>
          <button
            onClick={openConversation}
            disabled={!hasClient}
            className="inline-flex items-center gap-1.5 text-xs rounded-md bg-secondary px-3 py-1.5 hover:bg-accent font-semibold disabled:opacity-40"
          >
            <MessageCircle className="h-3.5 w-3.5" /> Abrir conversa
          </button>
          <button
            onClick={copyMessage}
            className="inline-flex items-center gap-1.5 text-xs rounded-md bg-secondary px-3 py-1.5 hover:bg-accent font-semibold"
          >
            <Copy className="h-3.5 w-3.5" /> Copiar orçamento
          </button>
        </div>
      </div>

      {waOpen && lead && (
        <SendWhatsAppModal
          quote={quote}
          leadName={lead.name}
          phone={phone}
          onClose={() => setWaOpen(false)}
          onSent={(conversationId) => {
            setWaOpen(false);
            const targetId = conversationId ?? targetConversationId;
            if (targetId) {
              navigate({
                to: "/inbox/$conversationId",
                params: { conversationId: targetId },
                search: { quote: quote.id },
              });
            }
          }}
        />
      )}
    </>
  );
}


const STATUS_META: Record<
  QuoteStatus,
  { label: string; className: string }
> = {
  pendente: {
    label: "Pendente envio",
    className: "bg-[var(--status-warm)]/15 text-[var(--status-warm)]",
  },
  enviado: { label: "Enviado", className: "bg-primary/15 text-primary" },
  visualizado: { label: "Visualizado", className: "bg-blue-500/15 text-blue-500" },
  aprovado: {
    label: "Aprovado",
    className: "bg-[var(--status-won)]/15 text-[var(--status-won)]",
  },
  vencido: {
    label: "Vencido",
    className: "bg-destructive/15 text-destructive",
  },
};

function StatusBadge({ status }: { status: QuoteStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold",
        meta.className,
      )}
    >
      {status === "enviado" || status === "visualizado" || status === "aprovado" ? (
        <Check className="h-3 w-3" />
      ) : null}
      {meta.label}
    </span>
  );
}

function buildWhatsAppMessage(args: {
  name: string;
  productName: string;
  finalValue: number;
  validUntil: string;
}): string {
  const validStr = new Date(args.validUntil).toLocaleDateString("pt-BR");
  return [
    `Olá ${args.name} 👋`,
    "",
    "Segue seu orçamento:",
    `🏊 ${args.productName}`,
    `💰 ${formatBRL(args.finalValue)}`,
    `📅 válido até ${validStr}`,
    "",
    "Posso te ajudar com alguma dúvida? 😊",
  ].join("\n");
}

function SendWhatsAppModal({
  quote,
  leadName,
  phone,
  onClose,
  onSent,
}: {
  quote: Quote;
  leadName: string;
  phone: string;
  onClose: () => void;
  onSent: (conversationId?: string) => void;
}) {
  const product = getProduct(quote.productId);
  const availableImages = product?.images ?? [];
  const [text, setText] = useState(() =>
    buildWhatsAppMessage({
      name: leadName.split(" ")[0] ?? leadName,
      productName: quote.productName,
      finalValue: quote.finalValue,
      validUntil: quote.validUntil,
    }),
  );
  const [selectedImages, setSelectedImages] = useState<string[]>(availableImages);
  const [sending, setSending] = useState(false);

  const toggleImage = (url: string) => {
    setSelectedImages((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
    );
  };

  const submit = async () => {
    if (!text.trim()) {
      toast.error("Mensagem vazia");
      return;
    }
    setSending(true);
    try {
      const res = await sendQuoteWhatsApp({
        quoteId: quote.id,
        phone,
        contactName: leadName,
        leadId: quote.leadId || undefined,
        text,
        imageUrls: selectedImages.length > 0 ? selectedImages : undefined,
      });
      toast.success("Orçamento enviado pelo WhatsApp");
      onSent(res.conversationId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-card shadow-xl my-4 max-h-[calc(100vh-2rem)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Enviar pelo WhatsApp</h2>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-[11px] text-muted-foreground">
            Para <span className="font-semibold text-foreground">{leadName}</span> • +{phone}
          </div>

          {availableImages.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                  Fotos do produto ({selectedImages.length}/{availableImages.length})
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedImages(
                      selectedImages.length === availableImages.length ? [] : availableImages,
                    )
                  }
                  className="text-[11px] text-primary hover:underline"
                >
                  {selectedImages.length === availableImages.length
                    ? "Desmarcar todas"
                    : "Selecionar todas"}
                </button>
              </div>

              {/* Carrossel das fotos selecionadas — ordem de envio */}
              {selectedImages.length > 0 && (
                <div className="mb-2 -mx-1 px-1 overflow-x-auto snap-x snap-mandatory flex gap-2 pb-1 scrollbar-thin">
                  {selectedImages.map((url, i) => (
                    <div
                      key={`sel-${url}`}
                      className="relative shrink-0 snap-start w-32 h-32 rounded-md overflow-hidden border border-border bg-muted"
                    >
                      <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
                      <span className="absolute top-1 left-1 text-[9px] font-semibold bg-primary text-primary-foreground rounded px-1.5 py-0.5">
                        {i + 1}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Grade de seleção rápida — toque/clique alterna */}
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                {availableImages.map((url) => {
                  const checked = selectedImages.includes(url);
                  return (
                    <button
                      key={url}
                      type="button"
                      onClick={() => toggleImage(url)}
                      className={cn(
                        "relative aspect-square rounded-md overflow-hidden border-2 transition touch-manipulation",
                        checked
                          ? "border-primary"
                          : "border-transparent opacity-60 hover:opacity-100",
                      )}
                    >
                      <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
                      {checked && (
                        <div className="absolute top-1 right-1 bg-primary rounded-full p-0.5">
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                As fotos serão enviadas primeiro (na ordem mostrada), depois a mensagem.
              </p>
            </div>
          )}


          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            className="w-full rounded-md bg-input px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          <p className="text-[11px] text-muted-foreground">
            Será enviado via Meta Cloud API.
          </p>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={sending}
            className="text-xs rounded-md bg-secondary px-3 py-2 hover:bg-accent disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={sending}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-[#25D366] text-white px-3 py-2 hover:opacity-90 disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {sending
              ? "Enviando…"
              : selectedImages.length > 0
                ? `Enviar ${selectedImages.length} foto(s) + mensagem`
                : "Enviar agora"}
          </button>
        </div>
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
  const leads = useSyncExternalStore(subscribeRepo, getLeads, getLeads);
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  // Cliente — NUNCA pré-seleciona automaticamente (a menos que venha via deep link).
  const [clientMode, setClientMode] = useState<"existing" | "new">(
    defaultLeadId ? "existing" : "existing",
  );
  const [leadId, setLeadId] = useState<string>(defaultLeadId ?? "");
  const [clientSearch, setClientSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newChannel, setNewChannel] = useState<Channel>("whatsapp");
  const [newPhone, setNewPhone] = useState("");
  const [newHandle, setNewHandle] = useState("");
  const [creatingClient, setCreatingClient] = useState(false);

  const selectedLead = leadId ? leads.find((l) => l.id === leadId) : undefined;

  const filteredLeads = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    const sorted = [...leads].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return sorted.slice(0, 50);
    return sorted
      .filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          (l.phone ?? "").toLowerCase().includes(q) ||
          (l.handle ?? "").toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [leads, clientSearch]);

  const [productId, setProductId] = useState(
    defaultProductId && getProduct(defaultProductId) ? defaultProductId : (products[0]?.id ?? ""),
  );
  // O aviso "sugerido pela IA" some assim que o usuário troca o produto
  const [showSuggestion, setShowSuggestion] = useState(!!defaultProductId && !!suggestionReason);
  const [discountRaw, setDiscountRaw] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Pix");
  const [installments, setInstallments] = useState(1);
  const [validUntil, setValidUntil] = useState(todayPlusDays(7));
  const [submitting, setSubmitting] = useState(false);

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

  const newClientValid =
    clientMode === "new" &&
    newName.trim().length >= 2 &&
    (newChannel === "whatsapp"
      ? newPhone.replace(/\D/g, "").length >= 8
      : newHandle.trim().length >= 2 || newPhone.replace(/\D/g, "").length >= 8);

  const hasClient = clientMode === "existing" ? !!leadId : newClientValid;
  const canSubmit = !!product && hasClient && finalValue > 0 && installments >= 1 && !submitting;

  const submit = async () => {
    if (!canSubmit || !product) return;
    setSubmitting(true);
    try {
      let finalLeadId = leadId;
      if (clientMode === "new") {
        const created = await createLead(
          {
            name: newName.trim(),
            channel: newChannel,
            phone: newPhone.trim() ? newPhone.trim() : undefined,
            handle: newHandle.trim() ? newHandle.trim() : undefined,
          },
          companyId,
        );
        finalLeadId = created.id;
        toast.success(`Cliente "${created.name}" criado`);
      }
      const q = await createQuote({
        leadId: finalLeadId,
        // Só vincula conversa quando o cliente do deep link é o mesmo escolhido.
        conversationId:
          defaultConversationId && defaultLeadId === finalLeadId
            ? defaultConversationId
            : undefined,
        productId,
        discount,
        paymentMethod,
        installments,
        validUntil,
      });
      onCreated(q);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar orçamento");
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-xl my-4 md:my-8 max-h-[calc(100vh-2rem)] overflow-y-auto"
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
