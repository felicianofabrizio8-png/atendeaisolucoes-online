import { useEffect, useRef, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import { timeAgo, type Message } from "@/data/mock";
import { refetchConversationMessages } from "@/data/leadRepo";
import { sendManualText } from "@/lib/inbox/manual-send";
import { getConversationOrigin } from "@/routes/inbox.index";
import { ContactAvatar } from "./ContactAvatar";
import { CustomerTierBadge } from "./CustomerTierBadge";
import { RichText } from "./RichText";
import type { AtendimentoContact } from "@/hooks/useAtendimentoData";

export function ChatThread({ contact }: { contact: AtendimentoContact }) {
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

  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex items-center gap-3 border-b border-border px-5 py-4"><ContactAvatar name={contact.lead.name} hue={contact.hue} size={48} /><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate text-base font-bold">{contact.lead.name}</h2><CustomerTierBadge history={contact.history} size="sm" /></div><p className="truncate text-xs text-muted-foreground">{contact.lead.channel} · {timeAgo(contact.conversation.lastMessageAt)} atrás</p></div></header>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4"><div className="mx-auto flex max-w-[680px] flex-col gap-2">{contact.messages.map((message: Message) => <div key={message.id} className={cn("max-w-[78%] rounded-3xl px-4 py-2.5 text-sm leading-relaxed", message.role === "agent" ? "self-end rounded-br-lg bg-secondary" : message.role === "system" ? "self-center rounded-full bg-secondary/70 text-xs text-muted-foreground" : "self-start rounded-bl-lg border border-border")}><RichText text={message.text} /></div>)}<div ref={bottom} /></div></div>
    <form onSubmit={handleSubmit} className="border-t border-border px-5 py-3">
      <div className="mx-auto flex max-w-[680px] items-end gap-2">
        <textarea
          aria-label="Mensagem"
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={sending}
          rows={2}
          placeholder="Digite uma mensagem..."
          className="min-h-11 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Enviando..." : "Enviar"}
        </button>
      </div>
      {sendError && <p role="alert" className="mx-auto mt-2 max-w-[680px] text-xs text-destructive">{sendError}</p>}
    </form>
  </div>;
}
