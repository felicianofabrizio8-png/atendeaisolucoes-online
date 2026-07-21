// Painel esquerdo: lista + busca + paginação + botão "Nova conversa".
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MessageSquare, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { createCoachConversationFn } from "@/lib/coach-interpreter/coach-interpreter.functions";
import {
  getSafeInterpreterError,
  type SafeInterpreterError,
} from "@/lib/coach-interpreter/errors";
import { PAGE_SIZE } from "./constants";
import type { ConversationRow } from "./types";
import { ConversationStatusBadge } from "./status-badges";
import { ErrorBanner } from "./error-banner";
import { formatDateTime } from "./helpers";

export function ConversationsPanel({
  conversations,
  loading,
  error,
  selectedId,
  onSelect,
  onRefresh,
}: {
  conversations: ConversationRow[];
  loading: boolean;
  error: SafeInterpreterError | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const title = (c.title ?? "").toLowerCase();
      return title.includes(q) || c.id.toLowerCase().includes(q);
    });
  }, [conversations, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  return (
    <aside className="border-r border-border overflow-hidden flex flex-col">
      <div className="p-2 border-b border-border flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="search"
            aria-label="Buscar conversa"
            placeholder="Buscar por título ou ID…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="w-full h-8 pl-7 pr-2 rounded-md bg-background border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Recarregar conversas"
          className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando conversas…
          </div>
        ) : error ? (
          <ErrorBanner
            title="Falha ao carregar conversas"
            error={error}
            onRetry={onRefresh}
            testId="conversations-error"
          />
        ) : pageRows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma conversa encontrada.
          </div>
        ) : (
          <ul className="space-y-1" data-testid="conversations-list">
            {pageRows.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onSelect(c.id)}
                  className={cn(
                    "w-full text-left rounded-md px-3 py-2 hover:bg-accent",
                    selectedId === c.id && "bg-accent",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate flex-1">
                      {c.title?.trim() || "(sem título)"}
                    </span>
                    <ConversationStatusBadge status={c.status} />
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex gap-2 flex-wrap">
                    <span>{formatDateTime(c.last_message_at ?? c.created_at)}</span>
                    <span>·</span>
                    <span className="font-mono truncate">
                      {c.owner_user_id ? c.owner_user_id.slice(0, 8) : "—"}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {filtered.length > PAGE_SIZE && (
        <div className="border-t border-border p-2 flex items-center justify-between text-xs text-muted-foreground">
          <button
            type="button"
            disabled={clampedPage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="h-7 px-2 rounded hover:bg-accent disabled:opacity-40"
          >
            Anterior
          </button>
          <span>
            Página {clampedPage + 1} / {totalPages}
          </span>
          <button
            type="button"
            disabled={clampedPage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="h-7 px-2 rounded hover:bg-accent disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      )}
    </aside>
  );
}

export function NewConversationButton({
  onCreated,
  onDisabled,
}: {
  onCreated: (id: string) => void;
  /** Disparado quando o backend retorna feature flag desligada / kill-switch. */
  onDisabled: () => void;
}) {
  const qc = useQueryClient();
  const createFn = useServerFn(createCoachConversationFn);
  const m = useMutation({
    mutationFn: () => createFn({ data: { title: `Console — ${new Date().toLocaleString()}` } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["coach-interpreter", "conversations"] });
      if (res?.conversation?.id) onCreated(res.conversation.id);
    },
    onError: (err) => {
      const safe = getSafeInterpreterError(err);
      if (safe.disabled || safe.killed) onDisabled();
    },
  });
  const safeErr = m.error ? getSafeInterpreterError(m.error) : null;
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => m.mutate()}
        disabled={m.isPending}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
      >
        {m.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MessageSquare className="h-4 w-4" />
        )}
        Nova conversa
      </button>
      {safeErr && !safeErr.disabled && !safeErr.killed && (
        <span className="text-[11px] text-destructive" data-testid="new-conversation-error">
          {safeErr.message}
        </span>
      )}
    </div>
  );
}
