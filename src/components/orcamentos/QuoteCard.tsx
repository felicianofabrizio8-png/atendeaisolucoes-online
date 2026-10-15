import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  CalendarClock,
  Copy,
  FileText,
  Loader2,
  MessageSquareText,
  Package,
  Pencil,
  Send,
  Trash2,
  UserRound,
  Wallet,
} from "lucide-react";
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
import {
  formatQuoteMoney,
  quoteDate,
  quoteHue,
  quoteInitials,
  quoteValidity,
} from "@/lib/quote-presentation";
import "./quotes.css";

export function QuoteCard({
  quote,
  requestedAction,
  onActionHandled,
  inConversation = false,
}: {
  quote: Quote;
  requestedAction?: "send" | "edit" | "details";
  onActionHandled?: () => void;
  /** Card rendered inside the current conversation. */
  inConversation?: boolean;
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
  const status = computeQuoteStatus(quote);
  const validity = quoteValidity(quote.validUntil, status);
  const hue = { "--hue": quoteHue(quote.id) } as CSSProperties;
  const contact = quote.customerDetails?.phone1 || lead?.phone || lead?.handle || "Sem telefone";
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
  const installmentLine =
    quote.installments > 1
      ? `${quote.installments}x de ${formatBRL(quote.finalValue / quote.installments)}`
      : "à vista";
  return (
    <>
      <article
        className="lq-card"
        data-status={status}
        style={hue}
        aria-label={`Orçamento de ${customerName ?? "cliente não selecionado"}`}
      >
        <span className="lq-card-light" aria-hidden="true" />
        <header className="lq-card-head">
          <span className="lq-avatar" aria-hidden="true">
            {quoteInitials(inConversation ? quote.productName : customerName)}
          </span>
          <div className="lq-who">
            <h2 title={inConversation ? quote.productName : customerName}>
              {inConversation ? quote.productName : (customerName ?? "Sem cliente")}
            </h2>
            <p>{inConversation ? `${quote.paymentMethod} · ${installmentLine}` : contact}</p>
          </div>
          <StatusBadge status={status} />
        </header>
        <div className="lq-amount">
          <strong>{formatQuoteMoney(quote.finalValue)}</strong>
          <p>
            <b>{quote.paymentMethod}</b> · {installmentLine}
            {quote.discount > 0 && <> · {formatBRL(quote.discount)} de desconto</>}
          </p>
        </div>
        <span className="lq-validity" data-tone={validity.tone}>
          <CalendarClock aria-hidden="true" />
          {validity.label}
        </span>
        <div className="lq-card-actions">
          <button
            type="button"
            onClick={() => setWaOpen(true)}
            disabled={!canWhatsApp}
            title={canWhatsApp ? "Enviar pelo WhatsApp" : "Cliente sem telefone válido"}
            className="lq-primary"
          >
            <Send aria-hidden="true" />
            Enviar
          </button>
          <button type="button" onClick={() => setDetailsOpen(true)} className="lq-ghost">
            Detalhes
          </button>
          <span className="lq-spacer" />
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Editar orçamento"
            title="Editar"
            className="lq-icon"
          >
            <Pencil />
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="Excluir orçamento"
            title="Excluir"
            className="lq-icon"
            data-danger
          >
            <Trash2 />
          </button>
        </div>
      </article>
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent
          className="lq-black lq-sheet"
          // Read-only fields would grab focus and show as selected text.
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="lq-sheet-head" style={hue}>
            <span className="lq-panel-glow" aria-hidden="true" />
            <DialogHeader className="space-y-0 text-left">
              <div className="lq-sheet-who">
                <span className="lq-avatar" aria-hidden="true">
                  {quoteInitials(customerName)}
                </span>
                <div className="min-w-0">
                  <DialogTitle className="sr-only">Detalhes do orçamento</DialogTitle>
                  <h2 className="truncate">{customerName ?? "Sem cliente"}</h2>
                  <DialogDescription asChild>
                    <p>
                      {contact} · criado em {quoteDate(quote.createdAt)}
                    </p>
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="lq-sheet-value">
              <div>
                <strong>{formatQuoteMoney(quote.finalValue)}</strong>
                <p>
                  {quote.paymentMethod} · {installmentLine} ·{" "}
                  <span className="lq-validity" data-tone={validity.tone}>
                    {validity.label}
                  </span>
                </p>
              </div>
              <StatusBadge status={status} />
            </div>
          </div>
          <div className="lq-sheet-body">
            <section className="lq-sheet-group">
              <h3>
                <UserRound aria-hidden="true" /> Cliente
              </h3>
              <div className="lq-detail-grid">
                <DetailField label="Cliente" value={customerName ?? "Sem cliente"} />
                <DetailField label="Contato" value={contact === "Sem telefone" ? "" : contact} />
                <DetailField label="Canal" value={lead?.channel ?? ""} />
                <OptionalField label="Email" value={quote.customerDetails?.email} />
                <OptionalField label="Telefone 2" value={quote.customerDetails?.phone2} />
                <OptionalField label="Rua" value={quote.customerDetails?.street} />
                <OptionalField label="Número" value={quote.customerDetails?.number} />
                <OptionalField label="Bairro" value={quote.customerDetails?.neighborhood} />
                <OptionalField label="Cidade" value={quote.customerDetails?.city} />
                <OptionalField label="Estado" value={quote.customerDetails?.state} />
                <OptionalField label="CEP" value={quote.customerDetails?.postalCode} />
              </div>
            </section>
            <section className="lq-sheet-group">
              <h3>
                <Package aria-hidden="true" /> Proposta
              </h3>
              <div className="lq-detail-grid">
                <DetailField label="Produto" value={quote.productName} wide />
                {quote.productDescription && (
                  <DetailField label="Descrição" value={quote.productDescription} multiline wide />
                )}
                {quote.benefits && (
                  <DetailField label="Benefícios" value={quote.benefits} multiline wide />
                )}
                <ListField label="Itens inclusos" items={quote.inclusos} />
                <ListField label="Brindes" items={quote.brindes} />
                <ListField label="Por conta do cliente" items={quote.porConta} />
                {quote.notes && (
                  <DetailField label="Observações" value={quote.notes} multiline wide />
                )}
              </div>
            </section>
            <section className="lq-sheet-group">
              <h3>
                <Wallet aria-hidden="true" /> Valores e prazos
              </h3>
              <div className="lq-detail-grid">
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
                <OptionalField label="Enviado em" value={quote.sentAt && quoteDate(quote.sentAt)} />
                <OptionalField
                  label="Visualizado em"
                  value={quote.viewedAt && quoteDate(quote.viewedAt)}
                />
              </div>
            </section>
            <section className="lq-sheet-group">
              <h3>
                <MessageSquareText aria-hidden="true" /> Mensagem do orçamento
                <button type="button" onClick={copyMessage} className="lq-ghost">
                  <Copy aria-hidden="true" />
                  Copiar orçamento
                </button>
              </h3>
              <DetailField
                label="Mensagem do orçamento"
                value={quote.message}
                multiline
                wide
                className="lq-detail-message"
                hideLabel
              />
            </section>
          </div>
          <div className="lq-sheet-foot">
            <small>
              <FileText aria-hidden="true" className="mr-1 inline h-3 w-3" />
              Nº {quote.id}
            </small>
            <span className="lq-spacer" />
            <button
              type="button"
              className="lq-secondary"
              onClick={() => {
                setDetailsOpen(false);
                setEditing(true);
              }}
            >
              <Pencil aria-hidden="true" />
              Editar
            </button>
            <button
              type="button"
              className="lq-primary"
              disabled={!canWhatsApp}
              onClick={() => {
                setDetailsOpen(false);
                setWaOpen(true);
              }}
            >
              <Send aria-hidden="true" />
              Enviar pelo WhatsApp
            </button>
          </div>
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
          onDone={inConversation ? () => setWaOpen(false) : undefined}
          onSent={() => {
            /* Keep the send dialog and block progress visible. */
          }}
        />
      )}
      <AlertDialog open={confirmDelete} onOpenChange={(o) => !deleting && setConfirmDelete(o)}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Deseja excluir este orçamento?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A conversa do cliente não será removida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="rounded-full">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
  wide,
  className,
  hideLabel,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  wide?: boolean;
  className?: string;
  hideLabel?: boolean;
}) {
  const shown = value || "Não informado";
  return (
    <label className={cn("lq-detail", (wide || multiline) && "lq-detail-wide", className)}>
      <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
      {multiline ? (
        <textarea readOnly rows={Math.min(14, shown.split("\n").length + 1)} value={shown} />
      ) : (
        <input readOnly value={shown} />
      )}
    </label>
  );
}

/** Customer fields are optional: an empty one is simply not shown. */
function OptionalField({ label, value }: { label: string; value?: string | false }) {
  if (!value || !value.trim()) return null;
  return <DetailField label={label} value={value} />;
}

function ListField({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return <DetailField label={label} value={items.join("\n")} multiline wide />;
}

export const STATUS_META: Record<QuoteStatus, { label: string; className: string }> = {
  pendente: { label: "Para enviar", className: "lq-status" },
  enviado: { label: "Enviado", className: "lq-status" },
  visualizado: { label: "Visualizado", className: "lq-status" },
  aprovado: { label: "Aprovado", className: "lq-status" },
  vencido: { label: "Vencido", className: "lq-status" },
};

export function StatusBadge({ status }: { status: QuoteStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={meta.className} data-status={status}>
      {meta.label}
    </span>
  );
}
