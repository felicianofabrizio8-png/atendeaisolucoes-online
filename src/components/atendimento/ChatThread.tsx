import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ArrowLeft, Hand, Loader2, Lock, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { timeAgo, type Message } from "@/data/mock";
import { refetchConversationMessages } from "@/data/leadRepo";
import { sendManualText } from "@/lib/inbox/manual-send";
import { suggestAiReply } from "@/lib/atendimento/ai-suggest";
import { replyExternalId, withInlineQuote } from "@/lib/inbox/conversation-actions";
import { clearDraft, readDraft, saveDraft } from "@/lib/inbox/mobile-session";
import { MessagesContext, ReplyComposeContext } from "@/lib/inbox/contexts";
import { getConversationOrigin } from "@/routes/inbox.index";
import { useAuth } from "@/auth/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useConversationThread } from "@/hooks/useConversationThread";
import { MessageBubble } from "@/components/inbox/message/MessageBubble";
import { WhatsappWindowAlert } from "@/components/WhatsappWindowAlert";
import { MetaTemplatesModal } from "@/components/MetaTemplatesModal";
import { ContactAvatar } from "./ContactAvatar";
import { CustomerTierBadge } from "./CustomerTierBadge";
import { ConversationActions } from "./ConversationActions";
import { useTakeOver } from "@/hooks/useTakeOver";
import { ThreadComposer } from "./ThreadComposer";
import type { AtendimentoContact } from "@/hooks/useAtendimentoData";

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Hoje";
  if (sameDay(date, yesterday)) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

/** Chave que casa a bolha otimista com a mensagem confirmada pelo banco. */
function confirmedKey(m: Message): string {
  return `${m.conversationId}\n${m.text.trim()}\n${m.at.slice(0, 19)}`;
}

type SendFailure = { message: string; requiresTemplate: boolean };

export function ChatThread({
  contact,
  onBack,
  actions,
  draft,
  onDraftChange,
  simulated = false,
  onFollowupUpdated,
}: {
  contact: AtendimentoContact;
  onBack?: () => void;
  actions?: React.ReactNode;
  /**
   * Torna o campo controlado. Existe para o painel de IA conseguir carregar
   * uma sugestão no composer ("Usar no chat"); sem isso o texto ficaria preso
   * dentro deste componente e o painel não teria como escrever nele.
   * Omitido, o componente gerencia o próprio estado.
   */
  draft?: string;
  onDraftChange?: (value: string) => void;
  /** Clientes de exemplo: mostra a conversa, mas nada é enviado nem gravado. */
  simulated?: boolean;
  onFollowupUpdated?: () => void | Promise<void>;
}) {
  const { lead, conversation, history, hue } = contact;
  const conversationId = conversation.id;
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const { isAdmin } = useIsAdmin();

  const scrollerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);
  const sendAttemptRef = useRef(0);
  const suggestAttemptRef = useRef(0);
  const activeConversationIdRef = useRef(conversationId);
  const [internalText, setInternalText] = useState("");
  const controlled = draft !== undefined && onDraftChange !== undefined;
  const text = controlled ? draft : internalText;
  const setText = controlled ? onDraftChange : setInternalText;
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [sendFailure, setSendFailure] = useState<SendFailure | null>(null);
  const [simulatedNotice, setSimulatedNotice] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const { takeOver, takingOver } = useTakeOver(conversationId);
  // Bolhas otimistas e mensagens de sistema locais ("Venda fechada"). O
  // realtime do leadRepo entrega as definitivas em `contact.messages`.
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  // Encerrada nesta sessão, antes do realtime refletir o novo status do lead.
  const [closedHere, setClosedHere] = useState(false);

  activeConversationIdRef.current = conversationId;

  const messages = useMemo(() => {
    const repo = contact.messages;
    const ids = new Set(repo.map((m) => m.id));
    const confirmed = new Set(repo.filter((m) => m.role === "agent").map(confirmedKey));
    const extras = localMessages.filter(
      (m) => !ids.has(m.id) && !(m.role === "agent" && confirmed.has(confirmedKey(m))),
    );
    return [...repo, ...extras]
      .filter((m) => !(m.deletedAt && m.deletedFor === "me"))
      .sort((a, b) => +new Date(a.at) - +new Date(b.at));
  }, [contact.messages, localMessages]);

  const thread = useConversationThread(conversationId, messages, { enabled: !simulated });

  const closed =
    closedHere || lead.status === "fechado" || lead.status === "perdido" || !!lead.closedAt;
  const locked = closed || simulated;

  // Troca de conversa: zera o estado efêmero e recupera o rascunho dela.
  useEffect(() => {
    sendAttemptRef.current += 1;
    suggestAttemptRef.current += 1;
    setText(simulated ? "" : readDraft(conversationId));
    setSendFailure(null);
    setSuggestError(null);
    setSimulatedNotice(false);
    setReplyingTo(null);
    setLocalMessages([]);
    setClosedHere(false);
    sendingRef.current = false;
    setSending(false);
    setSuggesting(false);
    // `setText` fica fora das deps de propósito: quando o campo é controlado
    // ele é o `onDraftChange` do pai, cuja identidade muda a cada render.
    // Incluí-lo faria este reset disparar a cada render do pai e apagar o que
    // o atendente está digitando. O efeito existe só para a troca de conversa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Rascunho por conversa: voltar para a lista ou abrir o painel não perde texto.
  useEffect(() => {
    if (simulated) return;
    const t = setTimeout(() => saveDraft(conversationId, text), 250);
    return () => clearTimeout(t);
  }, [conversationId, text, simulated]);

  // Rola para o fim ao abrir e quando chega mensagem nova — não quando o
  // histórico antigo é inserido no topo.
  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversationId, lastMessageId]);

  // "Carregar anteriores" mantém a leitura no mesmo ponto após inserir no topo.
  const olderAnchorRef = useRef<number | null>(null);
  const firstMessageId = messages[0]?.id;
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || olderAnchorRef.current === null) return;
    el.scrollTop = el.scrollHeight - olderAnchorRef.current;
    olderAnchorRef.current = null;
  }, [firstMessageId]);

  const loadOlder = () => {
    const el = scrollerRef.current;
    if (el) olderAnchorRef.current = el.scrollHeight - el.scrollTop;
    void thread.loadOlder();
  };

  const replyCompose = useMemo(
    () => ({
      start: (m: Message) => {
        setReplyingTo(m);
        requestAnimationFrame(() => textareaRef.current?.focus());
      },
    }),
    [],
  );

  const pushSystemMessage = useCallback(
    (body: string) => {
      setLocalMessages((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          conversationId,
          role: "system",
          text: body,
          at: new Date().toISOString(),
        },
      ]);
    },
    [conversationId],
  );

  /**
   * Envia texto pelo adapter compartilhado com a Caixa de atendimento.
   * Devolve `true` quando o transporte aceitou (real ou simulado).
   */
  const sendText = useCallback(
    async (raw: string): Promise<boolean> => {
      const typed = raw.trim();
      if (!typed || sendingRef.current || locked) return false;

      const attemptId = ++sendAttemptRef.current;
      const isCurrentAttempt = () =>
        activeConversationIdRef.current === conversationId && sendAttemptRef.current === attemptId;

      // Citação: reply nativo quando a mensagem tem id externo; senão, a
      // citação vai prefixada no texto (mesma regra da Caixa de atendimento).
      const quoted = replyingTo;
      const quotedExternalId = quoted ? replyExternalId(quoted) : null;
      const body = quoted && !quotedExternalId ? withInlineQuote(typed, quoted) : typed;

      sendingRef.current = true;
      setSending(true);
      setSendFailure(null);
      setSimulatedNotice(false);

      const optimistic: Message = {
        id: `local-${Date.now()}`,
        conversationId,
        role: "agent",
        text: body,
        at: new Date().toISOString(),
      };
      setLocalMessages((prev) => [...prev, optimistic]);
      const dropOptimistic = () =>
        setLocalMessages((prev) => prev.filter((m) => m.id !== optimistic.id));

      const lastIncoming = [...messages].reverse().find((m) => m.role === "lead");
      const origin = getConversationOrigin(
        lead,
        lastIncoming ?? messages[messages.length - 1],
        conversation,
      );

      try {
        const result = await sendManualText({
          conversationId,
          leadId: lead.id,
          channel: lead.channel,
          origin,
          text: body,
          ...(lead.channel === "whatsapp" && quoted && quotedExternalId
            ? { replyToMessageId: quoted.id }
            : {}),
        });

        if (!result.ok) {
          dropOptimistic();
          if (isCurrentAttempt()) {
            setSendFailure({ message: result.error, requiresTemplate: !!result.requiresTemplate });
          }
          toast.error(
            result.requiresTemplate ? "Fora da janela de 24h" : "Falha ao enviar mensagem",
            { description: result.error },
          );
          return false;
        }

        if (result.delivery === "sent" && result.messageId) {
          // A bolha passa a carregar o id gravado no banco e só sai quando o
          // leadRepo tiver a mesma mensagem. Sem isso, num navegador em que o
          // realtime não entrega, a mensagem enviada sumia da tela.
          const confirmedId = result.messageId;
          setLocalMessages((prev) =>
            prev.map((m) => (m.id === optimistic.id ? { ...m, id: confirmedId } : m)),
          );
          await refetchConversationMessages(conversationId);
        } else {
          dropOptimistic();
          // Ambiente em simulação: o servidor confirmou, mas nada saiu para a Meta.
          if (isCurrentAttempt()) setSimulatedNotice(true);
          toast.info("Envio simulado", {
            description:
              "Este ambiente está em modo de simulação — a mensagem não chegou ao cliente.",
          });
        }

        if (isCurrentAttempt()) setReplyingTo(null);
        clearDraft(conversationId);
        return true;
      } catch (error) {
        dropOptimistic();
        const message = error instanceof Error ? error.message : "Falha ao enviar mensagem";
        if (isCurrentAttempt()) setSendFailure({ message, requiresTemplate: false });
        toast.error("Falha ao enviar mensagem", { description: message });
        return false;
      } finally {
        if (isCurrentAttempt()) {
          sendingRef.current = false;
          setSending(false);
        }
      }
    },
    [conversation, conversationId, lead, locked, messages, replyingTo],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (suggesting) return;
    const typed = text;
    if (await sendText(typed)) {
      // Só limpa se o atendente não começou outra mensagem enquanto enviava.
      if (activeConversationIdRef.current === conversationId) setText("");
    }
  };

  const handleSuggest = async () => {
    if (sending || suggesting || lead.channel !== "whatsapp" || locked) return;

    const attemptId = ++suggestAttemptRef.current;
    const isCurrentAttempt = () =>
      activeConversationIdRef.current === conversationId && suggestAttemptRef.current === attemptId;

    setSuggesting(true);
    setSuggestError(null);

    try {
      const result = await suggestAiReply(conversationId);
      if (!isCurrentAttempt()) return;
      if (!result.ok) {
        setSuggestError(result.error);
        return;
      }
      if (result.kind === "reply") {
        setText(result.message);
        return;
      }
      if (result.kind === "handoff") {
        setSuggestError("A IA indicou atendimento humano para esta conversa.");
        return;
      }
      setSuggestError("A IA não gerou uma sugestão para esta mensagem.");
    } catch (error) {
      if (!isCurrentAttempt()) return;
      setSuggestError(error instanceof Error ? error.message : "Falha ao gerar sugestão");
    } finally {
      if (isCurrentAttempt()) setSuggesting(false);
    }
  };

  let lastDay = "";
  const channelLabel =
    lead.channel === "whatsapp"
      ? "WhatsApp"
      : lead.channel === "instagram"
        ? "Instagram"
        : "Facebook";
  const placeholder = simulated
    ? "Clientes de exemplo — envio desativado"
    : closed
      ? "Conversa encerrada."
      : conversation.interactionType === "comment"
        ? "Resposta ao comentário…"
        : "Mandar mensagem";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-x-hidden">
      <header className="flex items-center gap-3 px-4 py-3 sm:px-5">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Voltar para a lista"
            className="-ml-1 shrink-0 rounded-full p-2 min-h-[44px] min-w-[44px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <ContactAvatar name={lead.name} hue={hue} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[17px] font-bold leading-tight">{lead.name}</h2>
            <CustomerTierBadge history={history} size="sm" />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {channelLabel}
            {conversation.detectedCity
              ? ` · ${conversation.detectedCity}/${conversation.detectedState ?? ""}`
              : ""}
            {` · ativo ${timeAgo(conversation.lastMessageAt)} atrás`}
            {closed ? " · encerrada" : ""}
          </p>
        </div>
        {!simulated && (
          <ConversationActions
            lead={lead}
            conversation={conversation}
            messages={messages}
            companyId={companyId}
            isAdmin={isAdmin}
            closed={closed}
            disabled={simulated}
            onSystemMessage={pushSystemMessage}
            onClosed={() => setClosedHere(true)}
            onSendText={sendText}
            onFollowupUpdated={onFollowupUpdated}
          />
        )}
        {actions}
      </header>

      {/* IA pediu humano: é a única faixa que merece interromper a leitura. */}
      {!simulated && conversation.aiStatus === "aguardando_humano" && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 sm:mx-5">
          <Hand className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="min-w-0 flex-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
            A IA pediu atendimento humano nesta conversa.
          </p>
          <button
            type="button"
            onClick={() => void takeOver()}
            disabled={takingOver}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-600 px-3 py-1 text-[11px] font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
          >
            {takingOver && <Loader2 className="h-3 w-3 animate-spin" />}
            Assumir
          </button>
        </div>
      )}

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 sm:px-5">
        <MessagesContext.Provider value={messages}>
          <ReplyComposeContext.Provider value={replyCompose}>
            <div className="mx-auto flex max-w-[680px] flex-col gap-2">
              {thread.status === "error" ? (
                <div
                  role="alert"
                  className="my-2 flex items-center justify-between gap-3 self-center rounded-2xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  <span>Não foi possível carregar o histórico. {thread.error}</span>
                  <button
                    type="button"
                    onClick={thread.retry}
                    className="inline-flex shrink-0 items-center gap-1 font-semibold underline-offset-2 hover:underline"
                  >
                    <RotateCw className="h-3 w-3" /> Tentar de novo
                  </button>
                </div>
              ) : thread.status === "loading" ? (
                <div className="my-2 flex items-center gap-2 self-center text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Carregando histórico…
                </div>
              ) : thread.hasMoreOlder && messages.length > 0 ? (
                <button
                  type="button"
                  onClick={loadOlder}
                  disabled={thread.loadingOlder}
                  className="my-2 inline-flex items-center gap-1.5 self-center rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-60"
                >
                  {thread.loadingOlder && <Loader2 className="h-3 w-3 animate-spin" />}
                  Carregar mensagens anteriores
                </button>
              ) : messages.length > 0 ? (
                <span className="my-2 self-center text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  Início da conversa
                </span>
              ) : null}

              {messages.map((message) => {
                const day = dayLabel(message.at);
                const showDay = day !== lastDay;
                lastDay = day;
                return (
                  <div key={message.id} className="contents">
                    {showDay && (
                      <div className="my-3 self-center rounded-full bg-secondary/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {day}
                      </div>
                    )}
                    {message.role === "system" ? (
                      <div className="my-2 self-center rounded-full bg-secondary/70 px-3 py-1 text-[11px] text-muted-foreground">
                        {message.text}
                      </div>
                    ) : (
                      <MessageBubble m={message} canManage={!locked} appearance="atendimento" />
                    )}
                  </div>
                );
              })}
            </div>
          </ReplyComposeContext.Provider>
        </MessagesContext.Provider>
      </div>

      {lead.channel === "whatsapp" && !locked && (
        <div className="mx-auto w-full max-w-[704px]">
          <WhatsappWindowAlert
            conversation={conversation}
            lead={lead}
            messages={messages}
            onSendNow={() => textareaRef.current?.focus()}
            onOpenTemplates={() => setTemplatesOpen(true)}
          />
        </div>
      )}

      <div className="mx-auto w-full max-w-[680px] px-4 sm:px-0">
        {suggestError && (
          <p role="alert" className="mb-2 text-xs text-destructive">
            {suggestError}
          </p>
        )}
        {sendFailure && (
          <div
            role="alert"
            className="mb-2 flex flex-wrap items-center gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {sendFailure.requiresTemplate && <Lock className="h-3.5 w-3.5 shrink-0" />}
            <span className="min-w-0 flex-1">{sendFailure.message}</span>
            {sendFailure.requiresTemplate && (
              <button
                type="button"
                onClick={() => setTemplatesOpen(true)}
                className="shrink-0 rounded-full bg-destructive px-2.5 py-1 text-[11px] font-bold text-destructive-foreground hover:opacity-90"
              >
                Enviar template aprovado
              </button>
            )}
          </div>
        )}
        {simulatedNotice && (
          <p role="status" className="mb-2 text-xs text-muted-foreground">
            Envio simulado neste ambiente — a mensagem não chegou ao cliente.
          </p>
        )}
        {sending && <p className="mb-2 text-xs text-muted-foreground">Enviando...</p>}
      </div>

      <ThreadComposer
        key={conversationId}
        conversationId={conversationId}
        channel={lead.channel}
        leadId={lead.id}
        companyId={companyId}
        text={text}
        onTextChange={setText}
        onSubmit={handleSubmit}
        onSendText={(t) => void sendText(t)}
        locked={locked}
        placeholder={placeholder}
        sending={sending}
        suggesting={suggesting}
        canSuggest={lead.channel === "whatsapp"}
        onSuggest={() => void handleSuggest()}
        replyingTo={replyingTo}
        replyAuthor={replyingTo?.role === "agent" ? "Você" : lead.name}
        onCancelReply={() => setReplyingTo(null)}
        textareaRef={textareaRef}
      />

      {!simulated && (
        <MetaTemplatesModal
          open={templatesOpen}
          conversationId={conversationId}
          onClose={() => setTemplatesOpen(false)}
          onSent={() => {
            setSendFailure(null);
            void refetchConversationMessages(conversationId);
          }}
        />
      )}
    </div>
  );
}
