import { useSyncExternalStore, type CSSProperties } from "react";
import { Check, Pencil, Send } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getLeads, subscribeRepo } from "@/data/leadRepo";
import { formatBRL } from "@/data/mock";
import { formatQuoteMoney, quoteHue, quoteInitials } from "@/lib/quote-presentation";
import type { Quote } from "@/data/quotes";
import "./quotes.css";

export function QuoteSuccessModal({
  quote,
  onClose,
  onSend,
  canSend,
  onEdit,
  onView,
}: {
  quote: Quote;
  onClose: () => void;
  onSend: () => void;
  canSend: boolean;
  onEdit: () => void;
  onView: () => void;
}) {
  const leads = useSyncExternalStore(subscribeRepo, getLeads, getLeads);
  const lead = leads.find((item) => item.id === quote.leadId);
  const customerName = quote.customerDetails
    ? `${quote.customerDetails.firstName} ${quote.customerDetails.lastName}`.trim() || lead?.name
    : lead?.name;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="lq-black lq-success">
        <span className="lq-panel-glow" aria-hidden="true" />
        <span className="lq-success-check" aria-hidden="true">
          <Check strokeWidth={2.5} />
        </span>
        <DialogTitle asChild>
          <h2>Orçamento criado com sucesso!</h2>
        </DialogTitle>
        <DialogDescription className="lq-success-sub">
          Envie agora pelo WhatsApp ou revise os detalhes antes.
        </DialogDescription>
        <div className="lq-success-card" style={{ "--hue": quoteHue(quote.id) } as CSSProperties}>
          <span className="lq-avatar" aria-hidden="true">
            {quoteInitials(customerName)}
          </span>
          <div>
            <b>{customerName ?? "Sem cliente"}</b>
            <small>
              {quote.paymentMethod}
              {quote.installments > 1
                ? ` · ${quote.installments}x de ${formatBRL(quote.finalValue / quote.installments)}`
                : " · à vista"}
            </small>
          </div>
          <strong>{formatQuoteMoney(quote.finalValue)}</strong>
        </div>
        <div className="lq-success-actions">
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            title={canSend ? "Enviar pelo WhatsApp" : "Cliente sem telefone válido para WhatsApp"}
            className="lq-primary"
          >
            <Send aria-hidden="true" />
            Enviar
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label="Editar orçamento"
            title="Editar"
            className="lq-icon"
          >
            <Pencil />
          </button>
          <span className="lq-spacer" />
          <button type="button" onClick={onView} className="lq-secondary">
            Visualizar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
