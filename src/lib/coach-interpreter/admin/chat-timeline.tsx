// Timeline de chat + bubbles + botão "Reinterpretar".
// Fase 3.1c — Scroll inteligente:
//  · Ao abrir uma conversa (mudança de conversationId) → posiciona no fim.
//  · Nova mensagem do usuário (último kind = user_message) → fim.
//  · Retry bem-sucedido → fim.
//  · Nova mensagem qualquer → auto-scroll SÓ se o usuário estiver próximo do fim.
//  · Botão "Ir para o final" aparece quando o usuário está distante.
//  · Refs estáveis + cleanup de listener; sem loop de render/scroll.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowDown,
  CheckCircle2,
  Info,
  Loader2,
  MessageSquare,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { retryCoachInterpretationFn } from "@/lib/coach-interpreter/coach-interpreter.functions";
import { getSafeInterpreterError } from "@/lib/coach-interpreter/errors";
import type { MessageRow } from "./types";
import { ErrorBanner } from "./error-banner";
import { formatDateTime } from "./helpers";

type KindMeta = {
  label: string;
  Icon: typeof MessageSquare;
  bubble: string;
};

export const KIND_META: Record<string, KindMeta> = {
  user_message: {
    label: "Usuário",
    Icon: MessageSquare,
    bubble: "bg-primary text-primary-foreground border-primary/40",
  },
  assistant_message: {
    label: "Interpreter",
    Icon: Sparkles,
    bubble: "bg-muted border-border",
  },
  clarification_request: {
    label: "Clarification",
    Icon: Info,
    bubble: "bg-blue-500/10 border-blue-500/30 text-foreground",
  },
  confirmation_ack: {
    label: "Confirmação",
    Icon: CheckCircle2,
    bubble: "bg-emerald-500/10 border-emerald-500/30 text-foreground",
  },
  error: {
    label: "Erro",
    Icon: AlertTriangle,
    bubble: "bg-destructive/10 border-destructive/30 text-foreground",
  },
};

const DEFAULT_KIND_META: KindMeta = {
  label: "Mensagem",
  Icon: MessageSquare,
  bubble: "bg-muted border-border",
};

/** Distância (px) até o fim para considerar "próximo do fim". */
const NEAR_BOTTOM_THRESHOLD_PX = 80;
/** Distância (px) para exibir o botão "Ir para o final". */
const SHOW_JUMP_BUTTON_THRESHOLD_PX = 200;

function isNearBottomLocal(
  el: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
  thresholdPx = NEAR_BOTTOM_THRESHOLD_PX,
): boolean {
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  return distance <= thresholdPx;
}

export function ChatTimeline({
  messages,
  conversationId,
  onChanged,
  /** Incrementado externamente após envios do composer bem-sucedidos → força scroll ao fim. */
  scrollBumpToken = 0,
}: {
  messages: MessageRow[];
  conversationId: string;
  onChanged: () => void;
  scrollBumpToken?: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const forceScrollNextRef = useRef<boolean>(true); // primeira renderização
  const lastMessageCountRef = useRef<number>(messages.length);
  const lastConversationIdRef = useRef<string>(conversationId);
  const [showJumpButton, setShowJumpButton] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const retryFn = useServerFn(retryCoachInterpretationFn);
  const retryM = useMutation({
    mutationFn: (userMessageId: string) =>
      retryFn({ data: { conversation_id: conversationId, user_message_id: userMessageId } }),
    onSuccess: () => {
      // Retry bem-sucedido → força posicionamento ao fim.
      forceScrollNextRef.current = true;
      scrollToBottom("smooth");
      onChanged();
    },
  });

  // Detecção de scroll do usuário → atualiza visibilidade do botão de salto.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJumpButton(distance > SHOW_JUMP_BUTTON_THRESHOLD_PX);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Estado inicial coerente após primeiro layout.
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [conversationId]);

  // Mudança de conversa → sempre posiciona no fim.
  useEffect(() => {
    if (lastConversationIdRef.current !== conversationId) {
      lastConversationIdRef.current = conversationId;
      forceScrollNextRef.current = true;
    }
  }, [conversationId]);

  // Bump externo (envio de mensagem do composer) → força scroll ao fim.
  useEffect(() => {
    if (scrollBumpToken > 0) {
      forceScrollNextRef.current = true;
    }
  }, [scrollBumpToken]);

  // Decisão de scroll pós-render — useLayoutEffect evita "flash" de posição.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prevCount = lastMessageCountRef.current;
    const nextCount = messages.length;
    const messageAdded = nextCount > prevCount;
    const lastKind = messages[nextCount - 1]?.kind;
    const forced = forceScrollNextRef.current;
    const nearBottom = isNearBottomLocal(el);

    // Regras (avaliadas em ordem):
    //  1) Se marcado como "forçar" (abrir conversa, envio, retry, bump) → ao fim.
    //  2) Se mensagem nova é do próprio usuário → ao fim (envio local).
    //  3) Se nova mensagem chegou e o usuário está próximo do fim → ao fim.
    //  4) Caso contrário (usuário lendo histórico) → NÃO interrompe.
    if (forced) {
      scrollToBottom("auto");
    } else if (messageAdded && lastKind === "user_message") {
      scrollToBottom("smooth");
    } else if (messageAdded && nearBottom) {
      scrollToBottom("smooth");
    }

    forceScrollNextRef.current = false;
    lastMessageCountRef.current = nextCount;
    // Atualiza visibilidade do botão coerente com o novo conteúdo.
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJumpButton(distance > SHOW_JUMP_BUTTON_THRESHOLD_PX);
  }, [messages, scrollToBottom]);

  const retryError =
    retryM.error && retryM.variables
      ? { messageId: retryM.variables, safe: getSafeInterpreterError(retryM.error) }
      : null;

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto p-4 space-y-3"
        data-testid="chat-timeline"
      >
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Nenhuma mensagem ainda. Envie a primeira abaixo.
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id}>
              <MessageBubble
                message={m}
                onRetry={m.kind === "user_message" ? () => retryM.mutate(m.id) : undefined}
                retrying={retryM.isPending && retryM.variables === m.id}
              />
              {retryError && retryError.messageId === m.id && (
                <div className="mt-2 flex justify-end">
                  <div className="max-w-[85%]">
                    <ErrorBanner
                      title="Falha ao reinterpretar"
                      error={retryError.safe}
                      onRetry={() => retryM.mutate(m.id)}
                      testId={`retry-error-${m.id}`}
                    />
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      {showJumpButton && (
        <button
          type="button"
          onClick={() => {
            forceScrollNextRef.current = true;
            scrollToBottom("smooth");
          }}
          data-testid="chat-jump-to-end"
          aria-label="Ir para o final"
          className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs shadow-sm hover:bg-accent"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          Ir para o final
        </button>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  onRetry,
  retrying,
}: {
  message: MessageRow;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const meta = KIND_META[message.kind] ?? DEFAULT_KIND_META;
  const isUser = message.kind === "user_message";
  return (
    <div
      className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}
      data-message-kind={message.kind}
    >
      <div className={cn("max-w-[85%] rounded-lg border px-3 py-2 text-sm", meta.bubble)}>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-80 mb-1">
          <meta.Icon className="h-3 w-3" />
          {meta.label}
          <span className="opacity-60 font-normal ml-1">
            · {formatDateTime(message.created_at)}
          </span>
        </div>
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        {onRetry && (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="text-[11px] inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50"
            >
              {retrying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Reinterpretar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
