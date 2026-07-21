// Shell master do console admin: header + layout de duas colunas +
// detecção de feature flag desligada.
// Fase 3.1c: reconcilia a conversa selecionada após refetch — se a
// selecionada desaparecer, cai para a primeira disponível ou volta ao
// empty state.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Sparkles } from "lucide-react";
import { listCoachConversationsFn } from "@/lib/coach-interpreter/coach-interpreter.functions";
import { getSafeInterpreterError, type SafeInterpreterError } from "@/lib/coach-interpreter/errors";
import type { ConversationRow } from "./types";
import {
  ConversationsPanel,
  NewConversationButton,
  sortConversations,
} from "./conversations-panel";
import { ConversationView } from "./conversation-view";
import { FeatureDisabledScreen } from "./feature-disabled-screen";

export function InterpreterShell() {
  const listFn = useServerFn(listCoachConversationsFn);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["coach-interpreter", "conversations"],
    queryFn: () => listFn(),
    retry: false,
  });

  const conversations = useMemo<ConversationRow[]>(
    () => (listQ.data?.conversations ?? []) as ConversationRow[],
    [listQ.data],
  );
  const sorted = useMemo(() => sortConversations(conversations), [conversations]);

  // Reconcilia a seleção após refetch:
  //  · Se a conversa selecionada ainda existir → preserva.
  //  · Se sumir e houver outra disponível → seleciona a primeira ordenada.
  //  · Se não houver nenhuma → volta ao empty state (null).
  useEffect(() => {
    if (listQ.isLoading || listQ.isError) return;
    if (selectedId && sorted.some((c) => c.id === selectedId)) return;
    if (sorted.length > 0) {
      // Só troca automaticamente quando havia seleção antiga (que sumiu).
      if (selectedId) setSelectedId(sorted[0].id);
    } else if (selectedId) {
      setSelectedId(null);
    }
  }, [sorted, selectedId, listQ.isLoading, listQ.isError]);

  const listSafe: SafeInterpreterError | null = listQ.error
    ? getSafeInterpreterError(listQ.error)
    : null;

  if (listSafe?.disabled || listSafe?.killed) {
    return <FeatureDisabledScreen reason={listSafe.message} />;
  }

  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/configuracoes" className="p-1.5 rounded hover:bg-accent">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Coach Interpreter — Console Admin
            <span className="text-[10px] uppercase font-bold tracking-wide bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded">
              Beta • Fase 2
            </span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Inspeção read/write de conversas, mensagens e proposals. Isolado do agente em produção.
          </p>
        </div>
        <NewConversationButton
          onCreated={(id) => setSelectedId(id)}
          onDisabled={() => listQ.refetch()}
        />
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(300px,380px)_1fr] overflow-hidden">
        <ConversationsPanel
          conversations={conversations}
          loading={listQ.isLoading}
          error={listSafe}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRefresh={() => listQ.refetch()}
        />
        <section className="overflow-y-auto">
          {selectedId ? (
            <ConversationView conversationId={selectedId} />
          ) : (
            <div
              className="h-full flex items-center justify-center text-sm text-muted-foreground p-8 text-center"
              data-testid="conversation-empty-state"
            >
              Selecione uma conversa à esquerda ou crie uma nova para inspecionar mensagens,
              timeline e proposals.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
