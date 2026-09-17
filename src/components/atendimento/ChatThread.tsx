import { useEffect, useRef } from "react";
import { Paperclip, Send, Smile } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo, type Message } from "@/data/mock";
import { ContactAvatar } from "./ContactAvatar";
import { CustomerTierBadge } from "./CustomerTierBadge";
import type { AtendimentoContact } from "@/hooks/useAtendimentoData";

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return "Hoje";
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ChatThread({
  contact,
  draft,
  onDraftChange,
  onSend,
}: {
  contact: AtendimentoContact;
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const { lead, conversation, messages, history, hue } = contact;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [conversation.id, messages.length]);

  let lastDay = "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 px-5 py-4">
        <ContactAvatar name={lead.name} hue={hue} size={52} />
        <div className="min-w-0">
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
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        <div className="mx-auto flex max-w-[680px] flex-col gap-2">
          {messages.map((m: Message) => {
            const day = dayLabel(m.at);
            const showDay = day !== lastDay;
            lastDay = day;
            const mine = m.role === "agent";

            if (m.role === "system") {
              return (
                <div key={m.id} className="my-2 self-center rounded-full bg-secondary/70 px-3 py-1 text-[11px] text-muted-foreground">
                  {m.text}
                </div>
              );
            }

            return (
              <div key={m.id} className="contents">
                {showDay && (
                  <div className="my-3 self-center rounded-full bg-secondary/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {day}
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[78%] rounded-3xl px-4 py-2.5 text-sm leading-relaxed",
                    mine
                      ? "self-end bg-secondary text-foreground rounded-br-lg"
                      : "self-start border border-border bg-transparent text-foreground rounded-bl-lg",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  <span className="mt-1 block text-right text-[10px] text-muted-foreground">
                    {hhmm(m.at)}
                    {mine && m.deliveryStatus === "read" ? " · lida" : ""}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="px-5 pb-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
          className="mx-auto flex max-w-[680px] items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 focus-within:ring-2 focus-within:ring-ring"
        >
          <button type="button" className="rounded-full p-2 text-muted-foreground hover:bg-secondary" aria-label="Anexar arquivo">
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Mandar mensagem"
            className="h-10 flex-1 bg-transparent text-[15px] outline-none placeholder:font-semibold placeholder:text-muted-foreground"
          />
          <button type="button" className="rounded-full p-2 text-muted-foreground hover:bg-secondary" aria-label="Emojis">
            <Smile className="h-4 w-4" />
          </button>
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Enviar"
            className="rounded-full bg-primary p-2.5 text-primary-foreground transition-opacity disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
