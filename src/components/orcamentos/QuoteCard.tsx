// Extraído de src/routes/orcamentos.tsx (Sprint 7 — Fase 7.2).
// Movimento literal: JSX, estados, efeitos, queries, mutations, cálculos e
// validações permanecem idênticos ao original.

import { useState, useSyncExternalStore } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Send, Check, MessageCircle, Copy, Loader2, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { formatBRL, timeAgo } from "@/data/mock";
import { getLeads, getConversations, subscribeRepo } from "@/data/leadRepo";
import { computeQuoteStatus, deleteQuote } from "@/data/quotes";
import { cn } from "@/lib/utils";
import type { Channel } from "@/data/mock";
import type { Quote, QuoteStatus } from "@/data/quotes";
import { SendWhatsAppModal, Chip } from "./SendWhatsAppModal";

export function QuoteCard({ quote }: { quote: Quote }) {
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


export const STATUS_META: Record<
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
