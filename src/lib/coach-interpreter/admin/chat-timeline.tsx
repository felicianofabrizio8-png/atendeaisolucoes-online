// Timeline de chat + bubbles + botão "Reinterpretar".
// Fase 3.1b · Sub-rodada (d):
//   · Retry por-mensagem com useMutation local — permite paralelismo
//     e isola loading/erro por message_id.
//   · aria-live para anúncios de retry.
//   · Botão retry com min-h suficiente para tap-target.
// Fase 3.1c — Scroll inteligente preservado (auto-scroll, ir-para-o-fim).
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

const NEAR_BOTTOM_THRESHOLD_PX = 80;
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
  scrollBumpToken = 0,
}: {
  messages: MessageRow[];
  conversationId: string;
  onChanged: () => void;
  scrollBumpToken?: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const forceScrollNextRef = useRef<boolean>(true);
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

  const forceScrollAndBump = useCallback(() => {
    forceScrollNextRef.current = true;
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJumpButton(distance > SHOW_JUMP_BUTTON_THRESHOLD_PX);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [conversationId]);

  useEffect(() => {
    if (lastConversationIdRef.current !== conversationId) {
      lastConversationIdRef.current = conversationId;
      forceScrollNextRef.current = true;
    }
  }, [conversationId]);

  useEffect(() => {
    if (scrollBumpToken > 0) {
      forceScrollNextRef.current = true;
    }
  }, [scrollBumpToken]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prevCount = lastMessageCountRef.current;
    const nextCount = messages.length;
    const messageAdded = nextCount > prevCount;
    const lastKind = messages[nextCount - 1]?.kind;
    const forced = forceScrollNextRef.current;
    const nearBottom = isNearBottomLocal(el);

    if (forced) {
      scrollToBottom("auto");
    } else if (messageAdded && lastKind === "user_message") {
      scrollToBottom("smooth");
    } else if (messageAdded && nearBottom) {
      scrollToBottom("smooth");
    }

    forceScrollNextRef.current = false;
    lastMessageCountRef.current = nextCount;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJumpButton(distance > SHOW_JUMP_BUTTON_THRESHOLD_PX);
  }, [messages, scrollToBottom]);

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
          messages.map((m) =>
            m.kind === "user_message" ? (
              <UserMessageWithRetry
                key={m.id}
                message={m}
                conversationId={conversationId}
                onRetried={() => {
                  forceScrollAndBump();
                  onChanged();
                }}
              />
            ) : (
              <MessageBubble key={m.id} message={m} />
            ),
          )
        )}
      </div>
      {showJumpButton && (
        <button
          type="button"
          onClick={forceScrollAndBump}
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

/**
 * Wrapper para mensagens do usuário: instancia uma mutation LOCAL de retry
 * por-mensagem. Isso garante:
 *   · loading independente por message_id (paralelismo de reinterpretações);
 *   · erro isolado — falha em u1 não afeta u2;
 *   · aria-live announce por mensagem.
 */
function UserMessageWithRetry({
  message,
  conversationId,
  onRetried,
}: {
  message: MessageRow;
  conversationId: string;
  onRetried: () => void;
}) {
  const retryFn = useServerFn(retryCoachInterpretationFn);
  const m = useMutation({
    mutationFn: () =>
      retryFn({ data: { conversation_id: conversationId, user_message_id: message.id } }),
    onSuccess: () => {
      onRetried();
    },
  });
  const safe = m.error ? getSafeInterpreterError(m.error) : null;
  return (
    <div>
      <MessageBubble
        message={message}
        onRetry={() => {
          if (m.isPending) return;
          m.mutate();
        }}
        retrying={m.isPending}
      />
      <div className="sr-only" role="status" aria-live="polite">
        {m.isPending
          ? `Reinterpretando mensagem ${message.id.slice(0, 8)}…`
          : m.isSuccess
            ? `Reinterpretação concluída para ${message.id.slice(0, 8)}.`
            : safe
              ? `Falha ao reinterpretar ${message.id.slice(0, 8)}: ${safe.message}`
              : ""}
      </div>
      {safe && (
        <div className="mt-2 flex justify-end">
          <div className="max-w-[85%]">
            <ErrorBanner
              title="Falha ao reinterpretar"
              error={safe}
              onRetry={() => {
                if (m.isPending) return;
                m.mutate();
              }}
              testId={`retry-error-${message.id}`}
            />
          </div>
        </div>
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
              aria-label={`Reinterpretar mensagem ${message.id.slice(0, 8)}`}
              aria-busy={retrying || undefined}
              className="inline-flex items-center gap-1 min-h-8 px-2 rounded text-[11px] text-primary hover:underline disabled:opacity-50"
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
