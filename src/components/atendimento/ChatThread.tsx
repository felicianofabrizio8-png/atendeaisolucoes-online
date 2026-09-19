import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { timeAgo, type Message } from "@/data/mock";
import { ContactAvatar } from "./ContactAvatar";
import { CustomerTierBadge } from "./CustomerTierBadge";
import { RichText } from "./RichText";
import type { AtendimentoContact } from "@/hooks/useAtendimentoData";

export function ChatThread({ contact }: { contact: AtendimentoContact }) {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [contact.conversation.id, contact.messages.length]);
  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex items-center gap-3 border-b border-border px-5 py-4"><ContactAvatar name={contact.lead.name} hue={contact.hue} size={48} /><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate text-base font-bold">{contact.lead.name}</h2><CustomerTierBadge history={contact.history} size="sm" /></div><p className="truncate text-xs text-muted-foreground">{contact.lead.channel} · {timeAgo(contact.conversation.lastMessageAt)} atrás</p></div></header>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4"><div className="mx-auto flex max-w-[680px] flex-col gap-2">{contact.messages.map((message: Message) => <div key={message.id} className={cn("max-w-[78%] rounded-3xl px-4 py-2.5 text-sm leading-relaxed", message.role === "agent" ? "self-end rounded-br-lg bg-secondary" : message.role === "system" ? "self-center rounded-full bg-secondary/70 text-xs text-muted-foreground" : "self-start rounded-bl-lg border border-border")}><RichText text={message.text} /></div>)}<div ref={bottom} /></div></div>
    <div className="border-t border-border px-5 py-3 text-center text-xs text-muted-foreground">Visualização somente leitura nesta etapa.</div>
  </div>;
}
