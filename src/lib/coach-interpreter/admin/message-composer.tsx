// Composer com idempotência visual via client_request_id estável.
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send } from "lucide-react";
import { sendCoachMessageFn } from "@/lib/coach-interpreter/coach-interpreter.functions";
import { getSafeInterpreterError } from "@/lib/coach-interpreter/errors";
import { ErrorBanner } from "./error-banner";

export function MessageComposer({
  conversationId,
  onSent,
}: {
  conversationId: string;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  // Idempotência visual: um único client_request_id por "tentativa lógica".
  // Só reciclamos após uma resposta bem-sucedida do servidor. Se der erro,
  // mantemos o mesmo UUID para que reenviar caia no caminho idempotente
  // do backend (duplicate_*).
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
    onSuccess: () => {
      setText("");
      requestIdRef.current = crypto.randomUUID();
      onSent();
    },
    // NÃO limpar texto em erro — preservação exigida pela Fase 3.1a.
  });

  const safeErr = m.error ? getSafeInterpreterError(m.error) : null;

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || m.isPending) return;
    m.mutate(trimmed);
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
      <form
        className="p-3 flex gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          aria-label="Mensagem para o Interpreter"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Descreva uma regra ou instrução para o Coach interpretar… (Enter envia, Shift+Enter quebra linha)"
          rows={2}
          data-testid="composer-textarea"
          data-request-id={requestIdRef.current}
          className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={m.isPending || text.trim().length === 0}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
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
