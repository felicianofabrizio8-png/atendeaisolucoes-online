import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/data/mock";
import { ContactAvatar } from "./ContactAvatar";
import { CustomerTierBadge } from "./CustomerTierBadge";
import type { AtendimentoContact } from "@/hooks/useAtendimentoData";

export function ConversationRail({ contacts, selectedId, onSelect, query, onQueryChange }: { contacts: AtendimentoContact[]; selectedId: string | null; onSelect: (id: string) => void; query: string; onQueryChange: (query: string) => void }) {
  return <div className="flex h-full min-h-0 flex-col gap-3">
    <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><span className="sr-only">Buscar conversas</span><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Buscar cliente ou conversa…" className="h-10 w-full rounded-full bg-secondary/60 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" /></label>
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {contacts.length === 0 ? <p className="px-2 py-8 text-center text-xs text-muted-foreground">Nenhuma conversa encontrada.</p> : <ul className="space-y-1">{contacts.map(({ lead, conversation, messages, history, hue }) => {
        const last = messages.at(-1);
        const selected = conversation.id === selectedId;
        return <li key={conversation.id}><button type="button" onClick={() => onSelect(conversation.id)} aria-current={selected} className={cn("flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left", selected ? "bg-secondary" : "hover:bg-secondary/50")}>
          <ContactAvatar name={lead.name} hue={hue} online={Date.now() - new Date(conversation.lastMessageAt).getTime() < 86_400_000} />
          <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold">{lead.name}</span><CustomerTierBadge history={history} size="sm" /><span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{timeAgo(conversation.lastMessageAt)}</span></span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{last?.role === "agent" ? "Você: " : ""}{last?.text ?? "—"}</span></span>
          {conversation.unread > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">{conversation.unread}</span>}
        </button></li>;
      })}</ul>}
    </div>
  </div>;
}
