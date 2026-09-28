import { useCallback, useEffect, useRef, useState } from "react";
import {
  hasMoreOlderMessages,
  loadConversationOlder,
  loadConversationRecent,
  resetConversationRecentLoaded,
} from "@/data/leadRepo";
import type { Message } from "@/data/mock";

export type ThreadStatus = "idle" | "loading" | "ready" | "error";

/**
 * Histórico da conversa aberta.
 *
 * O snapshot inicial do leadRepo traz só a última mensagem de cada conversa
 * (`latest_messages_per_conversation`); o resto precisa ser buscado ao abrir.
 * Mesma sequência da Caixa de atendimento: recentes ao abrir (com retry) e
 * anteriores sob demanda. As mensagens entram no leadRepo, então quem lê
 * `getMessagesFor` passa a ver o histórico sem estado paralelo.
 *
 * `enabled: false` (clientes de exemplo) não toca o banco.
 */
export function useConversationThread(
  conversationId: string,
  messages: Message[],
  { enabled = true }: { enabled?: boolean } = {},
) {
  const [status, setStatus] = useState<ThreadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Descarta respostas de uma conversa que já não está aberta.
  const tokenRef = useRef(0);

  const load = useCallback(async () => {
    const token = ++tokenRef.current;
    setStatus("loading");
    setError(null);
    try {
      const res = await loadConversationRecent(conversationId, 100);
      if (tokenRef.current !== token) return;
      if (res.ok) {
        setStatus("ready");
        setHasMoreOlder(hasMoreOlderMessages(conversationId));
      } else {
        setStatus("error");
        setError(res.error ?? "Falha ao carregar mensagens");
      }
    } catch (e) {
      if (tokenRef.current !== token) return;
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [conversationId]);

  useEffect(() => {
    if (!enabled) {
      tokenRef.current += 1;
      setStatus("ready");
      setHasMoreOlder(false);
      return;
    }
    void load();
  }, [enabled, load]);

  const retry = useCallback(() => {
    resetConversationRecentLoaded(conversationId);
    void load();
  }, [conversationId, load]);

  const loadOlder = useCallback(async () => {
    if (!enabled || loadingOlder || !hasMoreOlderMessages(conversationId)) {
      setHasMoreOlder(false);
      return;
    }
    const oldest = messages.find((m) => m.role !== "system");
    if (!oldest) return;
    const token = tokenRef.current;
    setLoadingOlder(true);
    try {
      const res = await loadConversationOlder(conversationId, oldest.at, oldest.id, 50);
      if (tokenRef.current === token) setHasMoreOlder(res.hasMore);
    } finally {
      if (tokenRef.current === token) setLoadingOlder(false);
    }
  }, [conversationId, enabled, loadingOlder, messages]);

  return { status, error, retry, hasMoreOlder, loadingOlder, loadOlder };
}
