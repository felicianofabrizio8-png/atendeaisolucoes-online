import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/data/mock";
import { ContactAvatar } from "./ContactAvatar";
import { CustomerTierBadge } from "./CustomerTierBadge";
import type { AtendimentoContact } from "@/hooks/useAtendimentoData";

export function ConversationRail({
  contacts,
  selectedId,
  onSelect,
  query,
  onQueryChange,
  activeFilterLabel,
  onClearFilter,
}: {
  contacts: AtendimentoContact[];
  selectedId: string | null;
  onSelect: (conversationId: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  activeFilterLabel: string | null;
  onClearFilter: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Buscar cliente, cidade ou produto…"
          className="h-10 w-full rounded-full bg-secondary/60 pl-9 pr-3 text-sm outline-none ring-0 placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
        />
      </div>

      {activeFilterLabel && (
        <button
          type="button"
          onClick={onClearFilter}
          className="inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-secondary"
        >
          {activeFilterLabel}
          <X className="h-3 w-3" />
        </button>
      )}

      <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
        {contacts.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            Nenhuma conversa com esse filtro.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {contacts.map(({ lead, conversation, messages, history, hue }) => {
              const last = messages[messages.length - 1];
              const selected = conversation.id === selectedId;
              const openWindow =
                Date.now() - new Date(conversation.lastMessageAt).getTime() < 24 * 3_600_000;

              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(conversation.id)}
                    aria-current={selected}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors",
                      selected ? "bg-secondary" : "hover:bg-secondary/50",
                    )}
                  >
                    <ContactAvatar name={lead.name} hue={hue} online={openWindow} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold">{lead.name}</span>
                        <CustomerTierBadge history={history} size="sm" className="shrink-0" />
                        <span className="ml-auto shrink-0 text-[10px] font-medium text-muted-foreground">
                          {timeAgo(conversation.lastMessageAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span className="truncate text-xs text-muted-foreground">
                          {last?.role === "agent" ? "Você: " : ""}
                          {last?.text ?? "—"}
                        </span>
                        {conversation.unread ? (
                          <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground tabular-nums">
                            {conversation.unread}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
