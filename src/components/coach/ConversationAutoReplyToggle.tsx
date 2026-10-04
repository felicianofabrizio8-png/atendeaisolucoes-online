import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type AutoReplyAction = "auto_reply_status" | "auto_reply_on" | "auto_reply_off";

async function callAutoReply(conversationId: string, action: AutoReplyAction) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Sessão expirada");
  const res = await fetch("/api/ai/agent-takeover", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ conversation_id: conversationId, action }),
  });
  const json = (await res.json()) as { ok?: boolean; available?: boolean; enabled?: boolean; error?: string };
  if (!res.ok || !json.ok) throw new Error(json.error ?? "Falha ao salvar");
  return { available: json.available === true, enabled: json.enabled === true };
}

/**
 * Liga a resposta automática da Vendedora só nesta conversa. A empresa continua no modo
 * assistido: nas outras conversas ela segue sugerindo. Não aparece quando a empresa não
 * está no modo assistido ou quando o recurso ainda não está disponível no banco.
 */
export function ConversationAutoReplyToggle({
  conversationId,
  onChange,
}: {
  conversationId: string;
  onChange?: (enabled: boolean) => void;
}) {
  const [state, setState] = useState<{ available: boolean; enabled: boolean }>({ available: false, enabled: false });
  const [saving, setSaving] = useState(false);
  const activeRef = useRef(conversationId);
  const notify = useRef(onChange);
  notify.current = onChange;

  const apply = useCallback((next: { available: boolean; enabled: boolean }) => {
    setState(next);
    notify.current?.(next.available && next.enabled);
  }, []);

  useEffect(() => {
    activeRef.current = conversationId;
    apply({ available: false, enabled: false });
    void (async () => {
      try {
        const next = await callAutoReply(conversationId, "auto_reply_status");
        if (activeRef.current === conversationId) apply(next);
      } catch {
        // Sem o estado, o botão não aparece e a conversa segue no modo da empresa.
      }
    })();
  }, [conversationId, apply]);

  if (!state.available) return null;

  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const next = await callAutoReply(conversationId, state.enabled ? "auto_reply_off" : "auto_reply_on");
      if (activeRef.current !== conversationId) return;
      apply(next);
      toast.success(
        next.enabled
          ? "A Vendedora responde sozinha nesta conversa a partir da próxima mensagem do cliente."
          : "A Vendedora voltou a só sugerir nesta conversa.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-testid="vendedora-auto-reply"
      className={cn(
        "flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
        state.enabled ? "border-primary/40 bg-primary/10" : "border-border bg-muted/40",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Deixar a Vendedora responder</div>
        <div className="text-[11px] text-muted-foreground">
          {state.enabled
            ? "Ela responde o cliente sozinha nesta conversa. Você acompanha e pode assumir."
            : "Hoje ela só sugere e você aprova."}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={state.enabled}
        aria-label="Deixar a Vendedora responder nesta conversa"
        onClick={() => void toggle()}
        disabled={saving}
        data-testid="vendedora-auto-reply-switch"
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-60",
          state.enabled ? "bg-primary" : "bg-muted-foreground/40",
        )}
      >
        {saving ? (
          <Loader2 className="mx-auto h-3 w-3 animate-spin text-background" />
        ) : (
          <span
            className={cn(
              "inline-block h-4 w-4 rounded-full bg-background transition",
              state.enabled ? "translate-x-4" : "translate-x-0.5",
            )}
          />
        )}
      </button>
    </div>
  );
}
