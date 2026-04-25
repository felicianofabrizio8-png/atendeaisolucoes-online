import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChannelBadge, StatusBadge, UrgentDot } from "@/components/Badges";
import { sortedConversations, getLead, getMessages, timeAgo } from "@/data/mock";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

export const Route = createFileRoute("/inbox/")({
  component: InboxPage,
});

function InboxPage() {
  const navigate = useNavigate();
  const items = sortedConversations();

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <div>
          <h1 className="text-base font-semibold leading-none">Caixa de atendimento</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {items.filter((c) => c.awaitingReply).length} aguardando resposta · ordenado por urgência
          </p>
        </div>
        <div className="relative w-72 hidden md:block">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            placeholder="Buscar por nome, telefone, tag…"
            className="w-full h-9 rounded-md bg-input pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <ul className="divide-y divide-border">
          {items.map((c) => {
            const lead = getLead(c.leadId)!;
            const msgs = getMessages(c.id);
            const last = msgs[msgs.length - 1];
            const urgent = c.awaitingReply && c.slaBreached;

            return (
              <li key={c.id}>
                <button
                  onClick={() => navigate({ to: "/inbox/$conversationId", params: { conversationId: c.id } })}
                  className={cn(
                    "w-full text-left px-6 py-3.5 hover:bg-accent/50 transition-colors flex gap-3 items-start",
                    urgent && "bg-[var(--status-urgent)]/5",
                  )}
                >
                  <div className="flex flex-col items-center pt-1 gap-1.5 w-6">
                    {urgent ? (
                      <UrgentDot />
                    ) : c.awaitingReply ? (
                      <span className="h-2 w-2 rounded-full bg-primary" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-transparent" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{lead.name}</span>
                      <ChannelBadge channel={c.channel} />
                      <StatusBadge status={lead.status} />
                      {!lead.nextAction && (
                        <span className="text-[10px] uppercase tracking-wide text-[var(--status-warm)]">
                          ⚠ sem próxima ação
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground truncate">
                      {last?.role === "agent" && <span className="text-foreground/60">Você: </span>}
                      {last?.text ?? "—"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {lead.tags.map((t) => (
                        <span key={t} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={cn("text-xs tabular-nums", urgent ? "text-[var(--status-urgent)] font-semibold" : "text-muted-foreground")}>
                      {timeAgo(c.lastMessageAt)}
                    </span>
                    {c.unread > 0 && (
                      <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1.5 min-w-[18px] text-center">
                        {c.unread}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="p-6 text-center">
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
            Ver no dashboard →
          </Link>
        </div>
      </div>
    </div>
  );
}
