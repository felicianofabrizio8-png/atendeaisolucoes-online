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
  deleteQuote,
  type PaymentMethod,
  type Quote,
  type QuoteStatus,
} from "@/data/quotes";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import { SmartImage } from "@/components/SmartImage";


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

function QuoteCard({ quote }: { quote: Quote }) {
  const leads = useSyncExternalStore(subscribeRepo, getLeads, getLeads);
  const lead = leads.find((l) => l.id === quote.leadId);

  const navigate = useNavigate();
  const [waOpen, setWaOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteQuote(quote.id);
      toast.success("Orçamento excluído");
      setConfirmDelete(false);
    } catch (e) {
      console.error("DELETE_QUOTE_ERROR", e);
      toast.error("Erro ao excluir orçamento");
    } finally {
      setDeleting(false);
    }
  };

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
      <div className="rounded-lg border border-border bg-card p-3 md:p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">{quote.productName}</div>
            <div className="text-[12px] font-medium truncate">
              {lead?.name ?? "— Cliente não selecionado —"}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              {contactLine}
            </div>
            <div className="text-[11px] text-muted-foreground">
              há {timeAgo(quote.createdAt)}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className="text-right">
              <div className="text-lg md:text-base font-bold leading-tight">{formatBRL(quote.finalValue)}</div>
              {quote.installments > 1 && (
                <div className="text-[11px] text-muted-foreground">
                  {quote.installments}x {formatBRL(quote.finalValue / quote.installments)}
                </div>
              )}
            </div>
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

        <div className="flex flex-col md:flex-row md:flex-wrap items-stretch md:items-center gap-2">
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
            className="inline-flex items-center justify-center gap-1.5 text-sm md:text-xs rounded-md bg-[#25D366] text-white px-3 min-h-11 md:min-h-0 md:py-1.5 hover:opacity-90 font-semibold disabled:opacity-40 w-full md:w-auto"
          >
            <Send className="h-4 w-4 md:h-3.5 md:w-3.5" />
            {quote.sent ? "Reenviar no WhatsApp" : "Enviar no WhatsApp"}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={openConversation}
              disabled={!hasClient}
              className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 text-sm md:text-xs rounded-md bg-secondary px-3 min-h-11 md:min-h-0 md:py-1.5 hover:bg-accent font-semibold disabled:opacity-40"
            >
              <MessageCircle className="h-4 w-4 md:h-3.5 md:w-3.5" />
              <span className="md:inline">Abrir conversa</span>
            </button>
            <button
              onClick={copyMessage}
              aria-label="Copiar orçamento"
              title="Copiar orçamento"
              className="inline-flex items-center justify-center gap-1.5 text-sm md:text-xs rounded-md bg-secondary min-h-11 min-w-11 md:min-h-0 md:min-w-0 md:px-3 md:py-1.5 hover:bg-accent font-semibold"
            >
              <Copy className="h-4 w-4 md:h-3.5 md:w-3.5" />
              <span className="hidden md:inline">Copiar orçamento</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label="Excluir orçamento"
              title="Excluir orçamento"
              className="inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors min-h-11 min-w-11 md:min-h-0 md:min-w-0 md:h-7 md:w-7"
            >
              <Trash2 className="h-4 w-4 md:h-3.5 md:w-3.5" />
            </button>
          </div>
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

      <AlertDialog open={confirmDelete} onOpenChange={(o) => !deleting && setConfirmDelete(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deseja excluir este orçamento?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A conversa do cliente não será removida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Excluindo…
                </>
              ) : (
                "Excluir orçamento"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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


// ===== Modal de envio em partes =====

type BlockKey = "photos" | "base" | "inclusos" | "brindes" | "porConta" | "notes";
type BlockStatus = "pendente" | "enviando" | "enviado" | "erro";

function buildBaseText(quote: Quote): string {
  const validStr = new Date(quote.validUntil).toLocaleDateString("pt-BR");
  const lines: string[] = [];
  lines.push(`Seu orçamento de *${quote.productName}* ficou em *${formatBRL(quote.finalValue)}*.`);
  if (quote.installments > 1) {
    const parcela = quote.finalValue / quote.installments;
    lines.push(
      `Pode ser parcelado em até *${quote.installments}x de ${formatBRL(parcela)}* no ${quote.paymentMethod.toLowerCase()}.`,
    );
  } else {
    lines.push(`Forma de pagamento: *${quote.paymentMethod}* (à vista).`);
  }
  lines.push(`Proposta válida até *${validStr}*.`);
  return lines.join("\n");
}

function buildListText(title: string, items: string[], bullet = "💧"): string {
  if (items.length === 0) return "";
  return [title, ...items.map((it) => `${bullet} ${it}`)].join("\n");
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

  // Texto padrão por bloco
  const defaults = useMemo(
    () => ({
      base: buildBaseText(quote),
      inclusos: buildListText("✅ *Itens inclusos:*", quote.inclusos),
      brindes: buildListText("🎁 *Brindes:*", quote.brindes),
      porConta: buildListText("⚠️ *Por conta do cliente:*", quote.porConta, "•"),
      notes: quote.notes.trim() ? `📝 *Observações:*\n${quote.notes.trim()}` : "",
    }),
    [quote],
  );

  const available: Record<BlockKey, boolean> = {
    photos: availableImages.length > 0,
    base: true,
    inclusos: quote.inclusos.length > 0,
    brindes: quote.brindes.length > 0,
    porConta: quote.porConta.length > 0,
    notes: quote.notes.trim().length > 0,
  };

  const [texts, setTexts] = useState<Record<Exclude<BlockKey, "photos">, string>>({
    base: defaults.base,
    inclusos: defaults.inclusos,
    brindes: defaults.brindes,
    porConta: defaults.porConta,
    notes: defaults.notes,
  });

  const [selected, setSelected] = useState<Record<BlockKey, boolean>>({
    photos: available.photos,
    base: true,
    inclusos: available.inclusos,
    brindes: available.brindes,
    porConta: available.porConta,
    notes: available.notes,
  });

  const [status, setStatus] = useState<Record<BlockKey, BlockStatus>>({
    photos: "pendente",
    base: "pendente",
    inclusos: "pendente",
    brindes: "pendente",
    porConta: "pendente",
    notes: "pendente",
  });

  const [selectedImages, setSelectedImages] = useState<string[]>(availableImages);
  const [busyAll, setBusyAll] = useState(false);

  const toggleImage = (url: string) => {
    setSelectedImages((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
    );
  };

  const sendBlock = async (key: BlockKey): Promise<boolean> => {
    if (!available[key]) return false;
    if (status[key] === "enviando") return false;
    setStatus((s) => ({ ...s, [key]: "enviando" }));
    try {
      if (key === "photos") {
        if (selectedImages.length === 0) throw new Error("Selecione ao menos uma foto");
        const res = await sendQuoteWhatsApp({
          quoteId: quote.id,
          phone,
          contactName: leadName,
          leadId: quote.leadId || undefined,
          text: "",
          imageUrls: selectedImages,
        });
        setStatus((s) => ({ ...s, [key]: "enviado" }));
        onSent(res.conversationId);
        return true;
      }
      const text = texts[key].trim();
      if (!text) throw new Error("Texto vazio");
      const res = await sendQuoteWhatsApp({
        quoteId: quote.id,
        phone,
        contactName: leadName,
        leadId: quote.leadId || undefined,
        text,
      });
      setStatus((s) => ({ ...s, [key]: "enviado" }));
      onSent(res.conversationId);
      return true;
    } catch (e) {
      console.error("SEND_BLOCK_ERROR", key, e);
      setStatus((s) => ({ ...s, [key]: "erro" }));
      toast.error(e instanceof Error ? e.message : "Falha ao enviar");
      return false;
    }
  };

  const sendSelected = async () => {
    const order: BlockKey[] = ["photos", "base", "inclusos", "brindes", "porConta", "notes"];
    const toSend = order.filter((k) => selected[k] && available[k] && status[k] !== "enviado");
    if (toSend.length === 0) {
      toast.error("Selecione ao menos um bloco");
      return;
    }
    setBusyAll(true);
    let okCount = 0;
    for (const k of toSend) {
      const ok = await sendBlock(k);
      if (ok) okCount += 1;
    }
    setBusyAll(false);
    if (okCount > 0) toast.success(`${okCount} mensagem(ns) enviada(s)`);
  };

  const StatusPill = ({ s }: { s: BlockStatus }) => {
    if (s === "enviado")
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-semibold">
          <Check className="h-3 w-3" /> enviado
        </span>
      );
    if (s === "enviando")
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary px-2 py-0.5 text-[10px] font-semibold">
          <Loader2 className="h-3 w-3 animate-spin" /> enviando
        </span>
      );
    if (s === "erro")
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 text-destructive px-2 py-0.5 text-[10px] font-semibold">
          erro
        </span>
      );
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-secondary text-muted-foreground px-2 py-0.5 text-[10px] font-semibold">
        pendente
      </span>
    );
  };

  const BlockRow = ({
    blockKey,
    title,
    children,
  }: {
    blockKey: BlockKey;
    title: string;
    children: React.ReactNode;
  }) => {
    const isAvail = available[blockKey];
    const st = status[blockKey];
    return (
      <div
        className={cn(
          "rounded-md border border-border bg-background/40 p-3 space-y-2",
          !isAvail && "opacity-50",
        )}
      >
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selected[blockKey] && isAvail}
            disabled={!isAvail}
            onChange={(e) => setSelected((s) => ({ ...s, [blockKey]: e.target.checked }))}
            className="h-3.5 w-3.5 accent-primary"
          />
          <span className="text-xs font-semibold">{title}</span>
          {!isAvail && <span className="text-[10px] text-muted-foreground">(vazio)</span>}
          <div className="ml-auto flex items-center gap-2">
            <StatusPill s={st} />
            <button
              type="button"
              onClick={() => sendBlock(blockKey)}
              disabled={!isAvail || st === "enviando" || busyAll}
              className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-md bg-[#25D366] text-white px-2 py-1 hover:opacity-90 disabled:opacity-50"
            >
              {st === "enviando" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Enviar agora
            </button>
          </div>
        </div>
        {children}
      </div>
    );
  };

  const TextBlock = ({ blockKey }: { blockKey: Exclude<BlockKey, "photos"> }) => (
    <textarea
      value={texts[blockKey]}
      onChange={(e) => setTexts((t) => ({ ...t, [blockKey]: e.target.value }))}
      rows={Math.min(10, Math.max(3, texts[blockKey].split("\n").length))}
      placeholder="Texto vazio"
      className="w-full rounded-md bg-input px-3 py-2 text-xs leading-relaxed outline-none focus:ring-2 focus:ring-ring resize-y font-mono"
    />
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-stretch md:items-center justify-center md:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-2xl md:rounded-lg border-0 md:border md:border-border bg-card shadow-xl md:my-4 min-h-screen md:min-h-0 md:max-h-[calc(100vh-2rem)] overflow-y-auto safe-top safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-card p-4 border-b border-border flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Enviar pelo WhatsApp</h2>
            <p className="text-[11px] text-muted-foreground">
              Para <span className="font-semibold text-foreground">{leadName}</span> • +{phone}
            </p>
          </div>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
            Enviar por partes
          </div>

          {/* Fotos */}
          <BlockRow blockKey="photos" title="1. Fotos do produto">
            {availableImages.length > 0 ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    {selectedImages.length}/{availableImages.length} selecionadas
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
                <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5">
                  {availableImages.map((url) => {
                    const checked = selectedImages.includes(url);
                    return (
                      <button
                        key={url}
                        type="button"
                        onClick={() => toggleImage(url)}
                        className={cn(
                          "relative aspect-square rounded-md overflow-hidden border-2 transition",
                          checked
                            ? "border-primary"
                            : "border-transparent opacity-60 hover:opacity-100",
                        )}
                      >
                        <SmartImage src={url} aspectRatio="1/1" wrapperClassName="w-full h-full" />
                        {checked && (
                          <div className="absolute top-1 right-1 bg-primary rounded-full p-0.5">
                            <Check className="h-2.5 w-2.5 text-primary-foreground" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">Nenhuma foto cadastrada.</p>
            )}
          </BlockRow>

          <BlockRow blockKey="base" title="2. Mensagem principal do orçamento">
            <TextBlock blockKey="base" />
          </BlockRow>

          <BlockRow blockKey="inclusos" title="3. Itens inclusos">
            <TextBlock blockKey="inclusos" />
          </BlockRow>

          <BlockRow blockKey="brindes" title="4. Brindes">
            <TextBlock blockKey="brindes" />
          </BlockRow>

          <BlockRow blockKey="porConta" title="5. Por conta do cliente">
            <TextBlock blockKey="porConta" />
          </BlockRow>

          <BlockRow blockKey="notes" title="6. Observações">
            <TextBlock blockKey="notes" />
          </BlockRow>
        </div>

        <div className="sticky bottom-0 bg-card p-4 border-t border-border flex flex-col-reverse md:flex-row md:flex-wrap items-stretch md:items-center md:justify-end gap-2 safe-bottom">
          <button
            onClick={onClose}
            disabled={busyAll}
            className="text-sm md:text-xs rounded-md bg-secondary px-3 min-h-11 md:min-h-0 md:py-2 hover:bg-accent disabled:opacity-50"
          >
            Fechar
          </button>
          <button
            onClick={sendSelected}
            disabled={busyAll}
            className="inline-flex items-center justify-center gap-1.5 text-sm md:text-xs font-semibold rounded-md bg-[#25D366] text-white px-3 min-h-11 md:min-h-0 md:py-2 hover:opacity-90 disabled:opacity-50"
          >
            {busyAll ? (
              <Loader2 className="h-4 w-4 md:h-3.5 md:w-3.5 animate-spin" />
            ) : (
              <Send className="h-4 w-4 md:h-3.5 md:w-3.5" />
            )}
            {busyAll ? "Enviando…" : "Enviar em sequência"}
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

  // Textos multilinha (preservam quebras de linha, emojis e marcadores).
  const [inclusosText, setInclusosText] = useState("");
  const [brindesText, setBrindesText] = useState("");
  const [porContaText, setPorContaText] = useState("");
  const [observacoes, setObservacoes] = useState("");

  // Defaults da empresa (company_settings).
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);
  const [defIncluded, setDefIncluded] = useState("");
  const [defGifts, setDefGifts] = useState("");
  const [defCustomer, setDefCustomer] = useState("");
  const [editDefaultsOpen, setEditDefaultsOpen] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("company_settings")
        .select(
          "default_quote_included_items,default_quote_gifts,default_quote_customer_responsibility",
        )
        .eq("company_id", companyId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.warn("load quote defaults", error);
      }
      const inc = (data?.default_quote_included_items as string | null) ?? "";
      const gif = (data?.default_quote_gifts as string | null) ?? "";
      const cus = (data?.default_quote_customer_responsibility as string | null) ?? "";
      setDefIncluded(inc);
      setDefGifts(gif);
      setDefCustomer(cus);
      // Pré-preenche apenas se o usuário ainda não digitou nada.
      setInclusosText((prev) => (prev ? prev : inc));
      setBrindesText((prev) => (prev ? prev : gif));
      setPorContaText((prev) => (prev ? prev : cus));
      setDefaultsLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);


  const [editingMessage, setEditingMessage] = useState(false);
  const [customMessage, setCustomMessage] = useState<string | null>(null);

  const product = getProduct(productId);
  const unitPrice = product ? activePrice(product) : 0;
  const discount = Math.max(0, Math.min(Number(discountRaw.replace(/[^\d]/g, "")) || 0, unitPrice));
  const finalValue = Math.max(0, unitPrice - discount);

  const autoMessage = useMemo(() => {
    if (!product) return "";
    const base = buildQuoteMessage({
      product,
      finalValue,
      installments,
      paymentMethod,
      validUntil,
      discount,
    });
    const extra: string[] = [];
    const inc = inclusosText.trim();
    const gif = brindesText.trim();
    const cus = porContaText.trim();
    if (inc) {
      extra.push("");
      extra.push("✅ Itens inclusos:");
      extra.push(inc);
    }
    if (gif) {
      extra.push("");
      extra.push("🎁 Brindes:");
      extra.push(gif);
    }
    if (cus) {
      extra.push("");
      extra.push("⚠️ Por conta do cliente:");
      extra.push(cus);
    }
    if (observacoes.trim().length > 0) {
      extra.push("");
      extra.push("📝 Observações:");
      extra.push(observacoes.trim());
    }
    return extra.length > 0 ? `${base}\n${extra.join("\n")}` : base;
  }, [product, finalValue, installments, paymentMethod, validUntil, discount, inclusosText, brindesText, porContaText, observacoes]);


  const previewMessage = customMessage ?? autoMessage;

  const addItem = (
    list: string[],
    setList: (v: string[]) => void,
    value: string,
    reset: () => void,
  ) => {
    const v = value.trim();
    if (!v) return;
    if (list.includes(v)) {
      reset();
      return;
    }
    setList([...list, v]);
    reset();
  };


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
      const incText = inclusosText.trim();
      const gifText = brindesText.trim();
      const cusText = porContaText.trim();
      const finalObservacoes = observacoes.trim();

      // Para compatibilidade com a base (jsonb arrays), guardamos como
      // array de linhas não vazias. O texto na mensagem é preservado como
      // foi digitado (com quebras de linha, emojis e marcadores).
      const toLines = (s: string) =>
        s
          .split("\n")
          .map((l) => l.trimEnd())
          .filter((l) => l.length > 0);
      const finalInclusos = toLines(incText);
      const finalBrindes = toLines(gifText);
      const finalPorConta = toLines(cusText);

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

      // Recompõe a mensagem final preservando exatamente o texto digitado.
      const recomposedAuto = (() => {
        const base = buildQuoteMessage({
          product,
          finalValue,
          installments,
          paymentMethod,
          validUntil,
          discount,
        });
        const extra: string[] = [];
        if (incText) extra.push("", "✅ Itens inclusos:", incText);
        if (gifText) extra.push("", "🎁 Brindes:", gifText);
        if (cusText) extra.push("", "⚠️ Por conta do cliente:", cusText);
        if (finalObservacoes) extra.push("", "📝 Observações:", finalObservacoes);
        return extra.length > 0 ? `${base}\n${extra.join("\n")}` : base;
      })();
      const finalMessage = customMessage ?? recomposedAuto;

      const q = await createQuote({
        leadId: finalLeadId,
        conversationId:
          defaultConversationId && defaultLeadId === finalLeadId
            ? defaultConversationId
            : undefined,
        productId,
        discount,
        paymentMethod,
        installments,
        validUntil,
        message: finalMessage,
        inclusos: finalInclusos,
        brindes: finalBrindes,
        porConta: finalPorConta,
        notes: finalObservacoes,
      });

      onCreated(q);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar orçamento");
    } finally {
      setSubmitting(false);
    }
  };

  const saveDefaults = async (inc: string, gif: string, cus: string) => {
    if (!companyId) return;
    const { error } = await supabase
      .from("company_settings")
      .update({
        default_quote_included_items: inc,
        default_quote_gifts: gif,
        default_quote_customer_responsibility: cus,
      })
      .eq("company_id", companyId);
    if (error) {
      toast.error("Não foi possível salvar os padrões: " + error.message);
      return;
    }
    setDefIncluded(inc);
    setDefGifts(gif);
    setDefCustomer(cus);
    toast.success("Padrões da empresa atualizados");
  };

  const applyDefaultsNow = () => {
    setInclusosText(defIncluded);
    setBrindesText(defGifts);
    setPorContaText(defCustomer);
    toast.success("Textos padrão aplicados");
  };



  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-stretch md:items-center justify-center md:p-4 overflow-y-auto"
      onClick={onCancel}
    >
      <div
        className="w-full md:max-w-2xl md:rounded-lg border-0 md:border md:border-border bg-card shadow-xl md:my-4 md:my-8 min-h-screen md:min-h-0 md:max-h-[calc(100vh-2rem)] overflow-y-auto safe-top safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-card p-4 border-b border-border flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Novo orçamento</h2>
          <button onClick={onCancel} aria-label="Fechar" className="ml-auto inline-flex items-center justify-center rounded-md hover:bg-accent min-h-11 min-w-11 md:min-h-0 md:min-w-0 md:h-7 md:w-7">
            <X className="h-5 w-5 md:h-4 md:w-4" />
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
          {/* Cliente — obrigatório, sem auto-seleção */}
          <div className="md:col-span-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1 mb-1.5">
              Cliente <span className="text-destructive">*</span>
            </div>
            <div className="inline-flex rounded-md border border-border bg-input p-0.5 mb-2">
              <button
                type="button"
                onClick={() => setClientMode("existing")}
                className={cn(
                  "text-xs px-3 py-1 rounded font-semibold transition",
                  clientMode === "existing"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Cliente existente
              </button>
              <button
                type="button"
                onClick={() => setClientMode("new")}
                className={cn(
                  "text-xs px-3 py-1 rounded font-semibold transition",
                  clientMode === "new"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Novo cliente
              </button>
            </div>

            {clientMode === "existing" ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Buscar por nome, telefone ou @"
                  className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                {leads.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground text-center">
                    Nenhum cliente cadastrado ainda. Use a aba "Novo cliente".
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
                    {filteredLeads.length === 0 ? (
                      <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                        Nenhum cliente encontrado.
                      </div>
                    ) : (
                      filteredLeads.map((l) => {
                        const checked = l.id === leadId;
                        return (
                          <button
                            type="button"
                            key={l.id}
                            onClick={() => setLeadId(l.id)}
                            className={cn(
                              "w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 hover:bg-accent",
                              checked && "bg-primary/10",
                            )}
                          >
                            <div className="min-w-0">
                              <div className="font-semibold truncate">{l.name}</div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                {l.channel} •{" "}
                                {l.phone ?? (l.handle ? `@${l.handle}` : "sem contato")}
                              </div>
                            </div>
                            {checked && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
                {selectedLead && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                    <span className="text-muted-foreground">Selecionado:</span>{" "}
                    <span className="font-semibold">{selectedLead.name}</span>{" "}
                    <span className="text-muted-foreground">
                      • {selectedLead.channel} •{" "}
                      {selectedLead.phone ??
                        (selectedLead.handle ? `@${selectedLead.handle}` : "sem contato")}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nome do cliente"
                  className="md:col-span-2 w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <select
                  value={newChannel}
                  onChange={(e) => setNewChannel(e.target.value as Channel)}
                  className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                </select>
                <input
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="Telefone (ex: 5511999998888)"
                  className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                {newChannel !== "whatsapp" && (
                  <input
                    type="text"
                    value={newHandle}
                    onChange={(e) => setNewHandle(e.target.value)}
                    placeholder="@usuário"
                    className="md:col-span-2 w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                )}
                <p className="md:col-span-2 text-[11px] text-muted-foreground">
                  O cliente será cadastrado ao salvar o orçamento.
                </p>
              </div>
            )}
          </div>


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

          {/* Itens inclusos / Brindes / Por conta do cliente — textos multilinha,
              pré-preenchidos com os padrões da empresa. */}
          <div className="md:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Conteúdo do orçamento
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={applyDefaultsNow}
                  disabled={!defaultsLoaded}
                  className="inline-flex items-center gap-1 text-[11px] rounded-md bg-secondary px-2 py-1 hover:bg-accent disabled:opacity-50"
                  title="Recarrega os textos padrão da empresa neste orçamento"
                >
                  <RotateCcw className="h-3 w-3" /> Aplicar padrão
                </button>
                <button
                  type="button"
                  onClick={() => setEditDefaultsOpen(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-md bg-primary text-primary-foreground px-2 py-1 hover:opacity-90"
                >
                  <SettingsIcon className="h-3 w-3" /> Editar padrão
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <TextBlockField
                label="✅ Itens inclusos"
                placeholder={"Ex:\n• Piscina 8x4\n• Instalação\n• Filtro"}
                value={inclusosText}
                onChange={setInclusosText}
              />
              <TextBlockField
                label="🎁 Brindes"
                placeholder={"Ex:\n• Led colorido\n• Kit limpeza"}
                value={brindesText}
                onChange={setBrindesText}
              />
              <TextBlockField
                label="⚠️ Por conta do cliente"
                placeholder={"Ex:\n• Ponto de energia\n• Nivelamento do terreno"}
                value={porContaText}
                onChange={setPorContaText}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              As quebras de linha, emojis e marcadores são preservados na mensagem do WhatsApp.
            </p>
          </div>


          {/* Observações */}
          <div className="md:col-span-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Observações do orçamento
            </div>
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={3}
              placeholder="Ex: Entrega em até 7 dias. Garantia de 1 ano."
              className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-y"
            />
          </div>



          {/* Pré-visualização da mensagem */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <Sparkles className="h-3 w-3" /> Mensagem pronta
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                {customMessage !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomMessage(null);
                      setEditingMessage(false);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] rounded-md bg-secondary px-2 py-1 hover:bg-accent"
                    title="Restaurar mensagem automática"
                  >
                    <RotateCcw className="h-3 w-3" /> Restaurar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (!editingMessage && customMessage === null) {
                      setCustomMessage(autoMessage);
                    }
                    setEditingMessage((v) => !v);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-md bg-primary text-primary-foreground px-2 py-1 hover:opacity-90"
                >
                  <Pencil className="h-3 w-3" />
                  {editingMessage ? "Concluir edição" : "Editar mensagem"}
                </button>
              </div>
            </div>
            {editingMessage ? (
              <textarea
                value={customMessage ?? autoMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                rows={12}
                className="w-full rounded-md bg-input px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring resize-y"
              />
            ) : (
              <div className="rounded-md border border-border bg-background/40 p-3 text-sm whitespace-pre-wrap leading-relaxed">
                {previewMessage}
              </div>
            )}
            {customMessage !== null && !editingMessage && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Mensagem editada manualmente — será salva e enviada exatamente como exibido acima.
              </p>
            )}
          </div>
        </div>


        <div className="sticky bottom-0 bg-card p-4 border-t border-border flex flex-col-reverse md:flex-row md:items-center md:justify-end gap-2 md:flex-wrap safe-bottom">
          {!hasClient && (
            <span className="text-[11px] text-destructive md:mr-auto text-center md:text-left">
              Selecione um cliente para enviar este orçamento.
            </span>
          )}
          <div className="flex flex-col-reverse md:flex-row gap-2">
            <button
              onClick={onCancel}
              disabled={submitting}
              className="text-sm md:text-xs rounded-md bg-secondary px-3 min-h-11 md:min-h-0 md:py-2 hover:bg-accent disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              disabled={!canSubmit}
              onClick={submit}
              className="inline-flex items-center justify-center gap-1.5 text-sm md:text-xs font-semibold rounded-md px-3 min-h-11 md:min-h-0 md:py-2 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 md:h-3.5 md:w-3.5 animate-spin" />
              ) : defaultConversationId && defaultLeadId && defaultLeadId === leadId ? (
                <Send className="h-4 w-4 md:h-3.5 md:w-3.5" />
              ) : (
                <Check className="h-4 w-4 md:h-3.5 md:w-3.5" />
              )}
              {submitting
                ? "Salvando…"
                : defaultConversationId && defaultLeadId && defaultLeadId === leadId
                  ? "Salvar e enviar"
                  : "Salvar orçamento"}
            </button>
          </div>
        </div>

      </div>

      <EditDefaultsDialog
        open={editDefaultsOpen}
        onOpenChange={setEditDefaultsOpen}
        initialIncluded={defIncluded}
        initialGifts={defGifts}
        initialCustomer={defCustomer}
        onSave={async (inc, gif, cus) => {
          await saveDefaults(inc, gif, cus);
          setEditDefaultsOpen(false);
        }}
      />
    </div>
  );
}

function TextBlockField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
        {label}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        placeholder={placeholder}
        className="w-full rounded-md bg-input px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring resize-y whitespace-pre-wrap font-mono"
      />
    </div>
  );
}

function EditDefaultsDialog({
  open,
  onOpenChange,
  initialIncluded,
  initialGifts,
  initialCustomer,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialIncluded: string;
  initialGifts: string;
  initialCustomer: string;
  onSave: (inc: string, gif: string, cus: string) => Promise<void>;
}) {
  const [inc, setInc] = useState(initialIncluded);
  const [gif, setGif] = useState(initialGifts);
  const [cus, setCus] = useState(initialCustomer);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setInc(initialIncluded);
      setGif(initialGifts);
      setCus(initialCustomer);
    }
  }, [open, initialIncluded, initialGifts, initialCustomer]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar textos padrão dos orçamentos</DialogTitle>
          <DialogDescription>
            Esses textos serão usados automaticamente em todos os novos orçamentos da empresa.
            Você ainda poderá editar em cada orçamento individualmente.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 py-2">
          <TextBlockField
            label="✅ Itens inclusos"
            placeholder={"Ex:\n• Piscina 8x4\n• Instalação completa\n• Filtro"}
            value={inc}
            onChange={setInc}
          />
          <TextBlockField
            label="🎁 Brindes"
            placeholder={"Ex:\n• Led colorido\n• Kit de limpeza"}
            value={gif}
            onChange={setGif}
          />
          <TextBlockField
            label="⚠️ Por conta do cliente"
            placeholder={"Ex:\n• Ponto de energia\n• Nivelamento do terreno"}
            value={cus}
            onChange={setCus}
          />
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="text-xs rounded-md bg-secondary px-3 py-2 hover:bg-accent disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(inc, gif, cus);
              } finally {
                setSaving(false);
              }
            }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md px-3 py-2 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Salvar padrão
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function ItemListField({
  label,
  placeholder,
  accent,
  items,
  value,
  setValue,
  onAdd,
  onRemove,
}: {
  label: string;
  placeholder: string;
  accent: "primary" | "warn" | "gift";
  items: string[];
  value: string;
  setValue: (v: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const chipClass =
    accent === "primary"
      ? "bg-primary/10 text-primary border-primary/30"
      : accent === "gift"
        ? "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/30"
        : "bg-[var(--status-warm)]/10 text-[var(--status-warm)] border-[var(--status-warm)]/30";
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
        {label}
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder={placeholder}
          className="flex-1 rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 text-xs font-semibold rounded-md bg-secondary px-2.5 hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {items.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {items.map((it, i) => (
            <span
              key={`${it}-${i}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                chipClass,
              )}
            >
              {it}
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="ml-0.5 opacity-70 hover:opacity-100"
                aria-label={`Remover ${it}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

