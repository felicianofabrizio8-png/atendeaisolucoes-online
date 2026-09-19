import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo, type Message } from "@/data/mock";
import { refetchConversationMessages } from "@/data/leadRepo";
import { sendManualText } from "@/lib/inbox/manual-send";
import { getConversationOrigin } from "@/routes/inbox.index";
import { ContactAvatar } from "./ContactAvatar";
import { CustomerTierBadge } from "./CustomerTierBadge";
import { RichText } from "./RichText";
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

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ChatThread({
  contact,
  onBack,
  actions,
}: {
  contact: AtendimentoContact;
  onBack?: () => void;
  actions?: React.ReactNode;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const sendAttemptRef = useRef(0);
  const activeConversationIdRef = useRef(contact.conversation.id);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  activeConversationIdRef.current = contact.conversation.id;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [contact.conversation.id, contact.messages.length]);

  useEffect(() => {
    sendAttemptRef.current += 1;
    setText("");
    setSendError(null);
    sendingRef.current = false;
    setSending(false);
  }, [contact.conversation.id]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sendingRef.current) return;

    const conversationId = contact.conversation.id;
    const attemptId = ++sendAttemptRef.current;
    const isCurrentAttempt = () =>
      activeConversationIdRef.current === conversationId &&
      sendAttemptRef.current === attemptId;

    sendingRef.current = true;
    setSending(true);
    setSendError(null);

    const lastMessage = contact.messages[contact.messages.length - 1];
    const origin = getConversationOrigin(contact.lead, lastMessage, contact.conversation);

    try {
      const result = await sendManualText({
        conversationId,
        leadId: contact.lead.id,
        channel: contact.lead.channel,
        origin,
        text: trimmed,
      });

      if (!result.ok) {
        if (isCurrentAttempt()) setSendError(result.error);
        return;
      }

      if (result.delivery === "sent") {
        await refetchConversationMessages(conversationId);
      }

      if (isCurrentAttempt()) setText("");
    } catch (error) {
      if (isCurrentAttempt()) {
        setSendError(error instanceof Error ? error.message : "Falha ao enviar mensagem");
      }
    } finally {
      if (isCurrentAttempt()) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  };

  const { lead, conversation, messages, history, hue } = contact;
  let lastDay = "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 px-5 py-4">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Voltar para a lista"
            className="-ml-1 shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:hidden"
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
            {lead.channel === "whatsapp" ? "WhatsApp" : lead.channel === "instagram" ? "Instagram" : "Facebook"}
            {conversation.detectedCity ? ` · ${conversation.detectedCity}/${conversation.detectedState ?? ""}` : ""}
            {` · ativo ${timeAgo(conversation.lastMessageAt)} atrás`}
          </p>
        </div>
        {actions}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        <div className="mx-auto flex max-w-[680px] flex-col gap-2">
          {messages.map((message: Message) => {
            const day = dayLabel(message.at);
            const showDay = day !== lastDay;
            lastDay = day;

            if (message.role === "system") {
              return (
                <div key={message.id} className="my-2 self-center rounded-full bg-secondary/70 px-3 py-1 text-[11px] text-muted-foreground">
                  <RichText text={message.text} />
                </div>
              );
            }

            const mine = message.role === "agent";
            return (
              <div key={message.id} className="contents">
                {showDay && (
                  <div className="my-3 self-center rounded-full bg-secondary/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {day}
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[78%] rounded-3xl px-4 py-2.5 text-sm leading-relaxed",
                    mine
                      ? "self-end rounded-br-lg border border-primary/30 bg-primary/20 text-foreground"
                      : "self-start rounded-bl-lg border border-border bg-secondary/50 text-foreground",
                  )}
                >
                  <RichText text={message.text} />
                  <span className="mt-1 block text-right text-[10px] text-muted-foreground">
                    {hhmm(message.at)}
                    {mine && message.deliveryStatus === "read" ? " · lida" : ""}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="px-5 pb-5">
        <div className="mx-auto flex max-w-[680px] items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5">
          <input
            aria-label="Mensagem"
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={sending}
            placeholder="Mandar mensagem"
            className="h-10 flex-1 bg-transparent text-[15px] outline-none placeholder:font-semibold placeholder:text-muted-foreground disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            aria-label={sending ? "Enviando..." : "Enviar"}
            className="rounded-full bg-primary p-2.5 text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        {sending && <p className="mx-auto mt-2 max-w-[680px] text-xs text-muted-foreground">Enviando...</p>}
        {sendError && <p role="alert" className="mx-auto mt-2 max-w-[680px] text-xs text-destructive">{sendError}</p>}
      </form>
    </div>
  );
}
