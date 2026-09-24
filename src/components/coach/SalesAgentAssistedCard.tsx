import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface AssistedSuggestion {
  id: string;
  conversation_id: string;
  generated_text: string;
  created_at: string;
}

type AssistedAction = "approve" | "reject";

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Entre novamente.");
  return token;
}

export function SalesAgentAssistedCard({
  conversationId,
  onInsertSuggestion,
  composerHasDraft = false,
  onPendingChange,
}: {
  conversationId: string;
  onInsertSuggestion?: (text: string) => void;
  composerHasDraft?: boolean;
  onPendingChange?: (hasPending: boolean) => void;
}) {
  const [suggestion, setSuggestion] = useState<AssistedSuggestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<AssistedAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const loadPendingSuggestion = useCallback(
    async (showLoading = false) => {
      const sequence = ++requestSequence.current;
      if (showLoading) setLoading(true);

      try {
        const token = await getAccessToken();
        const params = new URLSearchParams({ conversationId });
        const response = await fetch(`/api/ai/v2-suggestion?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = (await response.json()) as {
          suggestion?: AssistedSuggestion | null;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Falha ao consultar sugestão assistida.");
        }
        if (sequence !== requestSequence.current) return;

        const next =
          payload.suggestion &&
          typeof payload.suggestion.id === "string" &&
          typeof payload.suggestion.generated_text === "string"
            ? payload.suggestion
            : null;

        setSuggestion(next);
        setError(null);
      } catch (caught) {
        if (sequence !== requestSequence.current) return;
        setError(
          caught instanceof Error ? caught.message : "Falha ao consultar sugestão assistida.",
        );
      } finally {
        if (sequence === requestSequence.current && showLoading) {
          setLoading(false);
        }
      }
    },
    [conversationId],
  );

  useEffect(() => {
    setSuggestion(null);
    setError(null);
    setBusy(null);
    void loadPendingSuggestion(true);

    const timer = window.setInterval(() => {
      if (!document.hidden) void loadPendingSuggestion(false);
    }, 7500);

    return () => {
      window.clearInterval(timer);
      requestSequence.current += 1;
    };
  }, [conversationId, loadPendingSuggestion]);

  useEffect(() => {
    onPendingChange?.(Boolean(suggestion));
  }, [suggestion, onPendingChange]);

  async function transition(action: AssistedAction) {
    if (!suggestion || busy) return;
    if (action === "approve" && composerHasDraft) return;

    setBusy(action);
    setError(null);

    try {
      const token = await getAccessToken();
      const response = await fetch("/api/ai/v2-suggestion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          suggestionId: suggestion.id,
          action,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        sendAllowed?: boolean;
      };

      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error ?? "Falha ao atualizar sugestão.");
      }
      if (payload.sendAllowed !== false) {
        throw new Error("A resposta do servidor não confirmou o bloqueio de envio.");
      }

      if (action === "approve") {
        onInsertSuggestion?.(suggestion.generated_text);
      }
      setSuggestion(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao atualizar sugestão.");
    } finally {
      setBusy(null);
    }
  }

  if (loading && !suggestion) {
    return (
      <div
        data-testid="v2-assisted-loading"
        className="flex items-center gap-2 rounded-md border border-border bg-card/60 px-2 py-2 text-sm text-muted-foreground lg:text-xs"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Verificando sugestão da Vendedora 2.0…
      </div>
    );
  }

  if (!suggestion) {
    if (!error) return null;

    return (
      <div
        data-testid="v2-assisted-error"
        className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-700 dark:text-red-300 lg:text-xs"
      >
        <div className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
        <button
          type="button"
          onClick={() => void loadPendingSuggestion(true)}
          className="mt-1.5 underline"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="v2-assisted-card"
      className="space-y-2 rounded-md border border-cyan-500/40 bg-cyan-500/10 p-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300 lg:text-[11px]">
          Vendedora 2.0 · aprovação necessária
        </div>
        <span className="rounded border border-cyan-500/30 px-1.5 py-0.5 text-xs text-cyan-700 dark:text-cyan-300 lg:text-[10px]">
          Não enviada
        </span>
      </div>

      <div className="whitespace-pre-wrap rounded bg-background/70 p-2 text-base leading-relaxed lg:text-xs">
        {suggestion.generated_text}
      </div>

      {composerHasDraft && (
        <div
          data-testid="v2-assisted-draft-warning"
          className="text-xs text-amber-700 dark:text-amber-300 lg:text-[10px]"
        >
          Envie ou apague o texto atual antes de usar esta sugestão.
        </div>
      )}

      {error && <div className="text-xs text-red-700 dark:text-red-300 lg:text-[10px]">{error}</div>}

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => void transition("approve")}
          disabled={Boolean(busy) || composerHasDraft || !onInsertSuggestion}
          data-testid="v2-assisted-approve"
          className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-primary px-2 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 lg:py-1.5 lg:text-[11px]"
        >
          {busy === "approve" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          Aprovar e usar no campo
        </button>

        <button
          type="button"
          onClick={() => void transition("reject")}
          disabled={Boolean(busy)}
          data-testid="v2-assisted-reject"
          className="inline-flex items-center justify-center gap-1 rounded border border-border bg-background px-2 py-2 text-sm hover:bg-muted disabled:opacity-50 lg:py-1.5 lg:text-[11px]"
        >
          {busy === "reject" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <X className="h-3 w-3" />
          )}
          Rejeitar
        </button>
      </div>

      <div className="text-xs text-muted-foreground lg:text-[10px]">
        Aprovar apenas coloca o texto no campo. O envio continua sendo manual.
      </div>
    </div>
  );
}
