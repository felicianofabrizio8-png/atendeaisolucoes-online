import { useState, useSyncExternalStore } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Calendar,
  CheckCircle2,
  FileText,
  Hand,
  Loader2,
  MoreHorizontal,
  Send,
  Target,
  XCircle,
  Zap,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CloseSaleModal,
  MarkLostModal,
  NextActionModal,
  ScheduleVisitModal,
} from "@/components/inbox/modals/ConversationModals";
import { ManualFollowupResultDialog } from "@/components/inbox/modals/ManualFollowupResultDialog";
import { useManualFollowup } from "@/hooks/useManualFollowup";
import { useTakeOver } from "@/hooks/useTakeOver";
import {
  closeSale,
  markLost,
  saveNextAction,
  scheduleVisit,
  suggestQuoteProduct,
  type NextActionPayload,
  type VisitPayload,
} from "@/lib/inbox/conversation-actions";
import {
  computeQuoteStatus,
  listQuotes,
  markQuoteSent,
  subscribeQuotes,
  type Quote,
} from "@/data/quotes";
import { formatBRL, type Conversation, type Lead, type Message } from "@/data/mock";
import { cn } from "@/lib/utils";

type Modal = "close" | "lost" | "next" | "visit" | null;

/** A IA está conduzindo (ou pediu humano) — faz sentido oferecer "Assumir". */
function aiIsActive(conversation: Pick<Conversation, "aiStatus" | "aiHandling">): boolean {
  return (
    conversation.aiHandling === true ||
    conversation.aiStatus === "pre_atendido_ia" ||
    conversation.aiStatus === "aguardando_humano"
  );
}

/** Orçamento mais recente do lead que ainda não foi enviado. */
function usePendingQuote(leadId: string): Quote | null {
  const quotes = useSyncExternalStore(subscribeQuotes, listQuotes, listQuotes);
  return quotes.find((q) => q.leadId === leadId && computeQuoteStatus(q) === "pendente") ?? null;
}

/**
 * Ações comerciais da conversa no Atendimento 2.0.
 *
 * Só "Fechar venda" fica exposta — é a ação que encerra o ciclo. O resto é
 * contextual e mora num menu: aparece o que se aplica à conversa (orçamento
 * pendente, IA ativa, permissão de admin) em vez de uma parede de botões.
 * Regras e modais são os mesmos da Caixa de atendimento.
 */
export function ConversationActions({
  lead,
  conversation,
  messages,
  companyId,
  isAdmin,
  closed,
  disabled,
  onSystemMessage,
  onClosed,
  onSendText,
}: {
  lead: Lead;
  conversation: Conversation;
  messages: Message[];
  companyId: string | null;
  isAdmin: boolean;
  closed: boolean;
  /** Clientes de exemplo: nada aqui pode gravar no banco. */
  disabled: boolean;
  onSystemMessage: (text: string) => void;
  onClosed: () => void;
  /** Envia pelo mesmo fluxo do composer; `true` quando o envio foi aceito. */
  onSendText: (text: string) => Promise<boolean>;
}) {
  const navigate = useNavigate();
  const [modal, setModal] = useState<Modal>(null);
  const { takeOver, takingOver } = useTakeOver(conversation.id);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const followup = useManualFollowup(conversation.id);
  const pendingQuote = usePendingQuote(lead.id);
  const locked = closed || disabled;

  const confirmClose = (value: number) => {
    setModal(null);
    onSystemMessage(closeSale(lead.id, value));
    onClosed();
  };

  const confirmLost = (reason: string, notes?: string) => {
    setModal(null);
    onSystemMessage(markLost(lead.id, reason, notes));
    onClosed();
    toast.success("Lead marcado como perdido");
  };

  const confirmNextAction = async (payload: NextActionPayload) => {
    try {
      onSystemMessage(await saveNextAction(lead.id, payload));
      setModal(null);
      toast.success("Próxima ação criada");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao salvar próxima ação");
    }
  };

  const confirmVisit = async (payload: VisitPayload) => {
    if (!companyId) return;
    try {
      onSystemMessage(await scheduleVisit({ companyId, lead, payload }));
      setModal(null);
      toast.success("Visita agendada");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao agendar visita");
    }
  };

  const sendPendingQuote = async () => {
    if (!pendingQuote || quoteBusy) return;
    setQuoteBusy(true);
    try {
      if (!(await onSendText(pendingQuote.message))) return;
      void markQuoteSent(pendingQuote.id, { conversationId: conversation.id });
      onSystemMessage(
        `📄 Orçamento enviado — ${pendingQuote.productName} • ${formatBRL(pendingQuote.finalValue)}`,
      );
    } finally {
      setQuoteBusy(false);
    }
  };

  const createQuote = async () => {
    if (quoteBusy) return;
    setQuoteBusy(true);
    const suggestion = await suggestQuoteProduct({ lead, messages });
    setQuoteBusy(false);
    navigate({
      to: "/orcamentos",
      search: {
        new: "1",
        leadId: lead.id,
        conversationId: conversation.id,
        returnTo: "atendimento",
        ...(suggestion
          ? { suggestedProductId: suggestion.productId, suggestionReason: suggestion.reason }
          : {}),
      },
    });
  };

  const showTakeOver = !disabled && aiIsActive(conversation);

  return (
    <>
      {!locked && (
        <button
          type="button"
          onClick={() => setModal("close")}
          aria-label="Fechar venda"
          title="Fechar venda"
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--status-won)]/40 px-2.5 py-1.5 text-[11px] font-bold text-[var(--status-won)] transition-colors hover:bg-[var(--status-won)]/10"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Fechar venda</span>
        </button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Mais ações"
            title="Mais ações"
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
              (quoteBusy || takingOver || followup.running) && "text-foreground",
            )}
          >
            {quoteBusy || takingOver || followup.running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Venda
          </DropdownMenuLabel>
          {pendingQuote && (
            <DropdownMenuItem
              disabled={locked || quoteBusy}
              onSelect={() => void sendPendingQuote()}
            >
              <Send className="h-4 w-4" />
              <span className="min-w-0 flex-1 truncate">
                Enviar orçamento · {formatBRL(pendingQuote.finalValue)}
              </span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={locked || quoteBusy} onSelect={() => void createQuote()}>
            <FileText className="h-4 w-4" />
            Criar orçamento
          </DropdownMenuItem>
          <DropdownMenuItem disabled={locked || !companyId} onSelect={() => setModal("visit")}>
            <Calendar className="h-4 w-4" />
            Agendar visita
          </DropdownMenuItem>
          <DropdownMenuItem disabled={locked} onSelect={() => setModal("next")}>
            <Target className="h-4 w-4" />
            Definir próxima ação
          </DropdownMenuItem>

          {(showTakeOver || isAdmin) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Atendimento
              </DropdownMenuLabel>
            </>
          )}
          {showTakeOver && (
            <DropdownMenuItem disabled={takingOver} onSelect={() => void takeOver()}>
              <Hand className="h-4 w-4" />
              Assumir atendimento
            </DropdownMenuItem>
          )}
          {isAdmin && (
            <DropdownMenuItem
              disabled={locked || followup.running}
              onSelect={() => void followup.run()}
              title="Executa o motor de follow-up agora, ignorando os tempos configurados"
            >
              <Zap className="h-4 w-4" />
              Executar follow-up agora
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={locked || !isAdmin}
            onSelect={() => setModal("lost")}
            title={!isAdmin ? "Apenas administradores podem marcar como perdido" : undefined}
            className="text-destructive focus:text-destructive"
          >
            <XCircle className="h-4 w-4" />
            Marcar como perdido
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {modal === "close" && (
        <CloseSaleModal
          defaultValue={lead.estimatedValue}
          leadName={lead.name}
          onCancel={() => setModal(null)}
          onConfirm={confirmClose}
        />
      )}
      {modal === "lost" && (
        <MarkLostModal
          leadName={lead.name}
          onCancel={() => setModal(null)}
          onConfirm={confirmLost}
        />
      )}
      {modal === "next" && (
        <NextActionModal
          leadName={lead.name}
          onCancel={() => setModal(null)}
          onConfirm={confirmNextAction}
        />
      )}
      {modal === "visit" && (
        <ScheduleVisitModal
          leadName={lead.name}
          onCancel={() => setModal(null)}
          onConfirm={confirmVisit}
        />
      )}
      <ManualFollowupResultDialog
        result={followup.result}
        error={followup.error}
        onClose={followup.clear}
      />
    </>
  );
}
