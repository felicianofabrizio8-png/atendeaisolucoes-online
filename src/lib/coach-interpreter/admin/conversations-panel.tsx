// Painel esquerdo: lista + busca + paginação client-side + botão "Nova conversa".
// Fase 3.1c — Sub-rodada (c):
//  · Ordenação por updated_at desc (fallback created_at desc).
//  · Busca client-side sobre o conjunto carregado, com aviso discreto.
//  · Estados distintos: loading | erro | vazio | sem resultado da busca.
//  · Paginação acessível (<nav>, aria-label, aria-current, live region).
//  · Preservação de seleção é responsabilidade do shell.
//  · Guarda contra criação duplicada de conversa via ref + isPending.
//
// Dívidas técnicas registradas:
//  · Paginação server-side (necessária para bases grandes).
//  · Busca server-side (idem).
import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MessageSquare, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { createCoachConversationFn } from "@/lib/coach-interpreter/coach-interpreter.functions";
import { getSafeInterpreterError, type SafeInterpreterError } from "@/lib/coach-interpreter/errors";
import { PAGE_SIZE } from "./constants";
import type { ConversationRow } from "./types";
import { ConversationStatusBadge } from "./status-badges";
import { ErrorBanner } from "./error-banner";
import { formatDateTime } from "./helpers";

/**
 * Ordena por `updated_at` desc. Quando ausente, cai em `created_at` desc.
 * Exportado para testes de contrato.
 */
export function sortConversations(list: ConversationRow[]): ConversationRow[] {
  return [...list].sort((a, b) => {
    const av = a.updated_at ?? a.created_at ?? "";
    const bv = b.updated_at ?? b.created_at ?? "";
    if (av === bv) return 0;
    return av < bv ? 1 : -1;
  });
}

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

  const sorted = useMemo(() => sortConversations(conversations), [conversations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((c) => {
      const title = (c.title ?? "").toLowerCase();
      return title.includes(q) || c.id.toLowerCase().includes(q);
    });
  }, [sorted, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  const isSearching = search.trim().length > 0;
  const hasAnyLoaded = sorted.length > 0;

  return (
    <aside
      className="border-r border-border overflow-hidden flex flex-col"
      aria-label="Lista de conversas"
    >
      <div className="p-2 border-b border-border flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              aria-label="Buscar conversa"
              aria-describedby="conversations-search-hint"
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
        <p
          id="conversations-search-hint"
          className="text-[10px] text-muted-foreground leading-tight"
          data-testid="search-scope-notice"
        >
          A busca considera apenas as conversas já carregadas.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div
            className="p-4 text-sm text-muted-foreground flex items-center gap-2"
            data-testid="conversations-loading"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando conversas…
          </div>
        ) : error ? (
          <ErrorBanner
            title="Falha ao carregar conversas"
            error={error}
            onRetry={onRefresh}
            testId="conversations-error"
          />
        ) : !hasAnyLoaded ? (
          <div
            className="p-6 text-center text-sm text-muted-foreground"
            data-testid="conversations-empty"
          >
            Nenhuma conversa encontrada. Crie a primeira no botão acima.
          </div>
        ) : pageRows.length === 0 ? (
          <div
            className="p-6 text-center text-sm text-muted-foreground"
            data-testid="conversations-no-search-result"
          >
            Nenhum resultado para “{search.trim()}”.
          </div>
        ) : (
          <ul className="space-y-1" data-testid="conversations-list">
            {pageRows.map((c) => {
              const isSelected = selectedId === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    aria-current={isSelected ? "true" : undefined}
                    data-testid={`conversation-item-${c.id}`}
                    className={cn(
                      "w-full text-left rounded-md px-3 py-2 hover:bg-accent",
                      isSelected && "bg-accent",
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
                      <span>
                        {formatDateTime(c.updated_at ?? c.last_message_at ?? c.created_at)}
                      </span>
                      <span>·</span>
                      <span className="font-mono truncate">
                        {c.owner_user_id ? c.owner_user_id.slice(0, 8) : "—"}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!loading && !error && filtered.length > PAGE_SIZE && (
        <nav
          aria-label="Paginação de conversas"
          className="border-t border-border p-2 flex items-center justify-between text-xs text-muted-foreground"
          data-testid="conversations-pagination"
        >
          <button
            type="button"
            disabled={clampedPage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label="Página anterior"
            className="h-7 px-2 rounded hover:bg-accent disabled:opacity-40"
          >
            Anterior
          </button>
          <span aria-live="polite" data-testid="conversations-page-indicator">
            Página {clampedPage + 1} / {totalPages}
            {isSearching ? " · busca ativa" : ""}
          </span>
          <button
            type="button"
            disabled={clampedPage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            aria-label="Próxima página"
            className="h-7 px-2 rounded hover:bg-accent disabled:opacity-40"
          >
            Próxima
          </button>
        </nav>
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
  // Guarda antirreentrância: bloqueia clique enquanto a mutation está em voo,
  // independente do delay do estado do react-query.
  const inFlightRef = useRef(false);
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
    onSettled: () => {
      inFlightRef.current = false;
    },
  });
  const safeErr = m.error ? getSafeInterpreterError(m.error) : null;
  const handleClick = () => {
    if (inFlightRef.current || m.isPending) return;
    inFlightRef.current = true;
    m.mutate();
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={m.isPending}
        data-testid="new-conversation-button"
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
