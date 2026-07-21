// Timeline de chat + bubbles + botão "Reinterpretar".
import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
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

export function ChatTimeline({
  messages,
  conversationId,
  onChanged,
}: {
  messages: MessageRow[];
  conversationId: string;
  onChanged: () => void;
}) {
  const retryFn = useServerFn(retryCoachInterpretationFn);
  const retryM = useMutation({
    mutationFn: (userMessageId: string) =>
      retryFn({ data: { conversation_id: conversationId, user_message_id: userMessageId } }),
    onSuccess: onChanged,
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const retryError =
    retryM.error && retryM.variables
      ? { messageId: retryM.variables, safe: getSafeInterpreterError(retryM.error) }
      : null;

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3"
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
