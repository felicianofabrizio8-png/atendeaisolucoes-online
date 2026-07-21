// FASE 3.1b · Sub-rodada (d) — Composer aprimorado.
//
// Mudanças:
//  · Enter cria nova linha; Ctrl/Cmd+Enter envia.
//  · Contador de caracteres com estado visual próximo do limite.
//  · maxLength alinhado ao contrato do servidor (COACH_INTERPRETER_MAX_INPUT_CHARS).
//  · Mensagens de status para duplicate_in_progress/completed/failed via aria-live.
//  · aria-busy no formulário enquanto pendente.
//  · Restaura foco no textarea após sucesso.
//  · Botão com min-h-11 para atender tap target mobile.
//  · Idempotência visual preservada (client_request_id só é reciclado após sucesso).
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { sendCoachMessageFn } from "@/lib/coach-interpreter/coach-interpreter.functions";
import { getSafeInterpreterError } from "@/lib/coach-interpreter/errors";
import { COACH_INTERPRETER_MAX_INPUT_CHARS } from "@/lib/coach-interpreter/types";
import { ErrorBanner } from "./error-banner";

const NEAR_LIMIT_RATIO = 0.9;

type SendResult = { status?: string; idempotent?: boolean } | undefined;

const DUPLICATE_MESSAGES: Record<string, string> = {
  duplicate_in_progress: "Mensagem já em processamento — aguarde o Interpreter responder.",
  duplicate_completed: "Esta mensagem já foi interpretada anteriormente.",
  duplicate_failed:
    "A tentativa anterior falhou. Use o botão Reinterpretar na timeline para tentar de novo.",
};

export function MessageComposer({
  conversationId,
  onSent,
}: {
  conversationId: string;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const requestIdRef = useRef<string>(crypto.randomUUID());
  const sendFn = useServerFn(sendCoachMessageFn);
  const m = useMutation({
    mutationFn: (payload: string) =>
      sendFn({
        data: {
          conversation_id: conversationId,
          text: payload,
          client_request_id: requestIdRef.current,
        },
      }),
    onSuccess: (result: SendResult) => {
      setText("");
      const status = result?.status ?? "";
      if (status && status !== "created" && DUPLICATE_MESSAGES[status]) {
        setDuplicateNotice(DUPLICATE_MESSAGES[status]);
      } else {
        setDuplicateNotice(null);
      }
      requestIdRef.current = crypto.randomUUID();
      onSent();
    },
    // NÃO limpar texto em erro — preservação exigida pela Fase 3.1a.
  });

  // Ao trocar de conversa, limpa aviso residual.
  useEffect(() => {
    setDuplicateNotice(null);
  }, [conversationId]);

  // Retorna foco ao textarea após sucesso para manter o fluxo de escrita.
  useEffect(() => {
    if (!m.isPending && m.isSuccess) {
      textareaRef.current?.focus();
    }
  }, [m.isPending, m.isSuccess]);

  const safeErr = m.error ? getSafeInterpreterError(m.error) : null;

  const trimmedLen = text.trim().length;
  const total = text.length;
  const nearLimit = total >= Math.floor(COACH_INTERPRETER_MAX_INPUT_CHARS * NEAR_LIMIT_RATIO);
  const overLimit = total > COACH_INTERPRETER_MAX_INPUT_CHARS;

  const submit = () => {
    if (m.isPending) return;
    if (trimmedLen === 0 || overLimit) return;
    setDuplicateNotice(null);
    m.mutate(text.trim());
  };

  return (
    <div className="border-t border-border">
      {safeErr && (
        <ErrorBanner
          title="Falha ao enviar mensagem"
          error={safeErr}
          onRetry={submit}
          testId="composer-error"
        />
      )}
      {duplicateNotice && (
        <div
          role="status"
          aria-live="polite"
          data-testid="composer-duplicate-notice"
          className="mx-3 mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground"
        >
          {duplicateNotice}
        </div>
      )}
      <form
        className="p-3 flex gap-2 items-end"
        aria-busy={m.isPending || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex-1 flex flex-col gap-1">
          <textarea
            ref={textareaRef}
            aria-label="Mensagem para o Interpreter"
            aria-describedby="composer-hint composer-counter"
            value={text}
            maxLength={COACH_INTERPRETER_MAX_INPUT_CHARS}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl/Cmd + Enter envia. Enter puro cria nova linha (default).
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Descreva uma regra para o Coach interpretar…"
            rows={2}
            data-testid="composer-textarea"
            data-request-id={requestIdRef.current}
            className="resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span id="composer-hint">Ctrl/Cmd + Enter para enviar.</span>
            <span
              id="composer-counter"
              data-testid="composer-counter"
              aria-live="polite"
              className={cn(
                "font-mono tabular-nums",
                overLimit
                  ? "text-destructive font-semibold"
                  : nearLimit
                    ? "text-amber-600 dark:text-amber-400"
                    : undefined,
              )}
            >
              {total}/{COACH_INTERPRETER_MAX_INPUT_CHARS}
            </span>
          </div>
        </div>
        <button
          type="submit"
          disabled={m.isPending || trimmedLen === 0 || overLimit}
          aria-label="Enviar mensagem"
          className="inline-flex items-center gap-1.5 min-h-11 h-11 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
        >
          {m.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Enviar
        </button>
      </form>
    </div>
  );
}
