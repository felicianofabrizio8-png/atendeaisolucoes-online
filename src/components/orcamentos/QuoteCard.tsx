import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Copy, Loader2, Pencil, Trash2 } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatBRL } from "@/data/mock";
import { getLeads, subscribeRepo } from "@/data/leadRepo";
import { computeQuoteStatus, deleteQuote, type Quote, type QuoteStatus } from "@/data/quotes";
import { cn } from "@/lib/utils";
import { SendWhatsAppModal } from "./SendWhatsAppModal";
import { QuoteFormModal } from "./QuoteFormModal";
import { quoteDate, quoteGlow } from "@/lib/quote-presentation";

export function QuoteCard({
  quote,
  requestedAction,
  onActionHandled,
}: {
  quote: Quote;
  requestedAction?: "send" | "edit" | "details";
  onActionHandled?: () => void;
}) {
  const leads = useSyncExternalStore(subscribeRepo, getLeads, getLeads);
  const lead = leads.find((l) => l.id === quote.leadId);
  const customerName = quote.customerDetails
    ? `${quote.customerDetails.firstName} ${quote.customerDetails.lastName}`.trim() || lead?.name
    : lead?.name;
  const [waOpen, setWaOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const phone = (quote.customerDetails?.phone1 || lead?.phone || "").replace(/\D/g, "");
  const canWhatsApp = !!lead && phone.length >= 8 && phone.length <= 15;
  useEffect(() => {
    if (!requestedAction) return;
    if (requestedAction === "send" && canWhatsApp) setWaOpen(true);
    if (requestedAction === "edit") setEditing(true);
    if (requestedAction === "details") setDetailsOpen(true);
    onActionHandled?.();
  }, [requestedAction, canWhatsApp, onActionHandled]);
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteQuote(quote.id);
      toast.success("Orçamento excluído");
      setConfirmDelete(false);
    } catch {
      toast.error("Erro ao excluir orçamento");
    } finally {
      setDeleting(false);
    }
  };
  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(quote.message);
      toast.success("Orçamento copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };
  const button =
    "inline-flex items-center justify-center rounded-full border border-foreground/40 hover:bg-foreground/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";
  return (
    <>
      <article
        className="relative isolate flex min-h-[248px] min-w-0 flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card/60 p-5 shadow-sm shadow-black/20 transition-shadow duration-200 hover:shadow-md hover:shadow-black/25 sm:min-h-[272px] sm:p-6 xl:min-h-[288px] xl:p-7"
        aria-label={`Orçamento de ${customerName ?? "cliente não selecionado"}`}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-9 -right-3 -z-10 h-24 w-44 -rotate-12 rounded-full blur-[14px]"
          style={{ background: quoteGlow(quote.id) }}
        />
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="h-10 w-10 shrink-0 rounded-full bg-foreground sm:h-11 sm:w-11"
            />
            <div className="min-w-0">
              <h2
                className="truncate text-base font-bold leading-tight sm:text-lg"
                title={customerName}
              >
                {customerName ?? "Sem cliente"}
              </h2>
              <p className="truncate text-sm font-semibold text-muted-foreground sm:text-base">
                {quote.customerDetails?.phone1 || lead?.phone || lead?.handle || "Sem telefone"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-1">
            <span className="text-[10px] font-medium text-muted-foreground sm:text-xs">
              Val. {quoteDate(quote.validUntil).replace(/\/(\d{2})(\d{2})$/, "/$2")}
            </span>
            <button
              onClick={() => setDetailsOpen(true)}
              className={cn(
                button,
                "min-h-8 px-3.5 text-[11px] font-semibold sm:min-h-9 sm:px-4 sm:text-xs",
              )}
            >
              Detalhes
            </button>
          </div>
        </div>
        <div className="mt-10 flex flex-wrap items-end justify-between gap-3 sm:mt-12">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setWaOpen(true)}
              disabled={!canWhatsApp}
              title={canWhatsApp ? "Enviar pelo WhatsApp" : "Cliente sem telefone válido"}
              className={cn(
                button,
                "h-9 min-w-24 px-5 text-sm font-semibold sm:h-10 sm:min-w-28 sm:px-6",
              )}
            >
              Enviar
            </button>
            <button
              onClick={() => setEditing(true)}
              aria-label="Editar orçamento"
              className={cn(button, "h-9 w-9 sm:h-10 sm:w-10")}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              aria-label="Excluir orçamento"
              className={cn(
                button,
                "h-9 w-9 border-red-600/70 text-red-500 hover:bg-red-500/10 sm:h-10 sm:w-10",
              )}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <p className="ml-auto text-right text-[clamp(1.7rem,3vw,2.5rem)] font-bold leading-none tracking-tight">
            {new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: "BRL",
              minimumFractionDigits: quote.finalValue % 1 ? 2 : 0,
              maximumFractionDigits: 2,
            })
              .format(quote.finalValue)
              .replace(/\s/g, "")}
          </p>
        </div>
      </article>
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Detalhes do orçamento</DialogTitle>
            <DialogDescription>
              Confira os dados e copie a proposta para compartilhar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DetailField label="Cliente" value={customerName ?? "Sem cliente"} />
            <DetailField
              label="Contato"
              value={quote.customerDetails?.phone1 || lead?.phone || lead?.handle || "—"}
            />
            {quote.customerDetails && (
              <>
                <DetailField label="Email" value={quote.customerDetails.email} />
                <DetailField label="Telefone 2" value={quote.customerDetails.phone2} />
                <DetailField label="Rua" value={quote.customerDetails.street} />
                <DetailField label="Cidade" value={quote.customerDetails.city} />
                <DetailField label="Bairro" value={quote.customerDetails.neighborhood} />
                <DetailField label="Estado" value={quote.customerDetails.state} />
                <DetailField label="CEP" value={quote.customerDetails.postalCode} />
              </>
            )}
            <DetailField label="Canal" value={lead?.channel ?? "—"} />
            <DetailField label="Produto" value={quote.productName} />
            {quote.productDescription && (
              <DetailField label="Descrição" value={quote.productDescription} multiline />
            )}
            {quote.benefits && <DetailField label="Benefícios" value={quote.benefits} multiline />}
            <DetailField label="Preço original" value={formatBRL(quote.unitPrice)} />
            <DetailField label="Desconto" value={formatBRL(quote.discount)} />
            <DetailField label="Valor final" value={formatBRL(quote.finalValue)} />
            <DetailField label="Pagamento" value={quote.paymentMethod} />
            <DetailField
              label="Parcelamento"
              value={`${quote.installments}x de ${formatBRL(quote.finalValue / quote.installments)}`}
            />
            <DetailField label="Validade" value={quoteDate(quote.validUntil)} />
            <DetailField label="Criado em" value={quoteDate(quote.createdAt)} />
            <div className="space-y-2 text-xs">
              <p className="text-muted-foreground">Status</p>
              <StatusBadge status={computeQuoteStatus(quote)} />
            </div>
            <DetailField label="Enviado em" value={quoteDate(quote.sentAt ?? "")} />
            <DetailField label="Visualizado em" value={quoteDate(quote.viewedAt ?? "")} />
            <DetailField label="Itens inclusos" value={quote.inclusos.join("\n")} multiline />
            <DetailField label="Brindes" value={quote.brindes.join("\n")} multiline />
            <DetailField label="Por conta do cliente" value={quote.porConta.join("\n")} multiline />
            <DetailField label="Observações" value={quote.notes} multiline />
            <div className="sm:col-span-2">
              <DetailField label="Mensagem do orçamento" value={quote.message} multiline />
            </div>
            <div className="sm:col-span-2">
              <DetailField label="Número do orçamento" value={quote.id} />
            </div>
          </div>
          <button
            onClick={copyMessage}
            className={cn(button, "min-h-11 gap-2 px-5 text-sm font-semibold")}
          >
            <Copy className="h-4 w-4" />
            Copiar orçamento
          </button>
        </DialogContent>
      </Dialog>
      {editing && (
        <QuoteFormModal
          quote={quote}
          defaultLeadId={quote.leadId}
          defaultConversationId={quote.conversationId}
          defaultProductId={quote.productId}
          onCancel={() => setEditing(false)}
          onCreated={() => {
            setEditing(false);
            toast.success("Orçamento atualizado");
          }}
        />
      )}
      {waOpen && lead && (
        <SendWhatsAppModal
          quote={quote}
          leadName={customerName || lead.name}
          phone={phone}
          onClose={() => setWaOpen(false)}
          onSent={() => {
            /* Keep the send dialog and block progress visible. */
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
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Excluir orçamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DetailField({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  const className =
    "w-full rounded-xl border border-border bg-secondary/30 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring";
  return (
    <label className="flex min-w-0 flex-col gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {multiline ? (
        <textarea readOnly rows={4} value={value || "Não informado"} className={className} />
      ) : (
        <input readOnly value={value || "Não informado"} className={className} />
      )}
    </label>
  );
}

export const STATUS_META: Record<QuoteStatus, { label: string; className: string }> = {
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

export function StatusBadge({ status }: { status: QuoteStatus }) {
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
