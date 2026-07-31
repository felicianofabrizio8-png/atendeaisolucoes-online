// ============================================================================
// Recovery Panel — "Como recuperar este lead?" (SPRINT 6 · FASE 6.2)
//
// Superfície do Recovery AI Assistant dentro da fila inteligente. Mostra o
// motivo provável (hipótese), a estratégia, a mensagem principal, até duas
// alternativas, o template real exigido e a explicação.
//
// NADA aqui envia mensagem: "Usar no campo" apenas deixa o texto pronto no
// composer da conversa, preservando o rascunho existente.
// ============================================================================

import { useCallback, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Loader2,
  Pencil,
  RefreshCw,
  Send,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { stageComposerText } from "@/lib/inbox/mobile-session";
import type { RecoveryAssistResponse, RecoveryPlan } from "@/lib/recovery-ai/types";
import { cn } from "@/lib/utils";

export interface RecoveryAssistPanelProps {
  conversationId: string;
  /** Chamado após preparar o texto no composer — a rota navega para a conversa. */
  onUseInComposer: (conversationId: string) => void;
  className?: string;
}

const INSISTENCE_LABEL: Record<string, string> = {
  baixa: "Insistência baixa",
  media: "Insistência moderada",
  alta: "Insistência alta",
};

interface PanelState {
  loading: boolean;
  error: string | null;
  data: RecoveryAssistResponse | null;
}

export function RecoveryAssistPanel({
  conversationId,
  onUseInComposer,
  className,
}: RecoveryAssistPanelProps) {
  const [state, setState] = useState<PanelState>({ loading: false, error: null, data: null });
  const [editing, setEditing] = useState(false);
  const [messageDraft, setMessageDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);

  const plan: RecoveryPlan | null = state.data?.plan ?? null;

  const generate = useCallback(
    async (force: boolean) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      setEditing(false);
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) throw new Error("Sessão expirada. Entre novamente.");

        const res = await fetch("/api/recovery/assist", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ conversation_id: conversationId, force }),
        });
        const json = (await res.json().catch(() => null)) as
          | (RecoveryAssistResponse & { error?: string })
          | null;
        if (!res.ok) {
          throw new Error(json?.error ?? "Não foi possível gerar a estratégia agora.");
        }
        if (!json?.plan) throw new Error("Resposta inválida da IA. Tente novamente.");
        setState({ loading: false, error: null, data: json });
        setMessageDraft(json.plan.primaryMessage);
      } catch (err) {
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : "Falha inesperada.",
        }));
      }
    },
    [conversationId],
  );

  const finalMessage = useMemo(
    () => (editing ? messageDraft : (plan?.primaryMessage ?? "")),
    [editing, messageDraft, plan],
  );

  const copy = useCallback(async () => {
    if (!finalMessage) return;
    try {
      await navigator.clipboard.writeText(finalMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard bloqueado — o texto continua visível para seleção manual */
    }
  }, [finalMessage]);

  const useInComposer = useCallback(() => {
    if (!finalMessage) return;
    stageComposerText(conversationId, finalMessage);
    onUseInComposer(conversationId);
  }, [conversationId, finalMessage, onUseInComposer]);

  const useAlternative = useCallback((text: string) => {
    setEditing(true);
    setMessageDraft(text);
  }, []);

  return (
    <section className={cn("rounded-lg border border-border", className)}>
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Como recuperar este lead
        </h4>
        {plan && (
          <button
            type="button"
            onClick={() => generate(true)}
            disabled={state.loading}
            className="h-8 px-2 text-[11px] rounded-md border border-border hover:bg-accent inline-flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw className={cn("h-3 w-3", state.loading && "animate-spin")} />
            Gerar novamente
          </button>
        )}
      </header>

      <div className="p-3 space-y-3">
        {!plan && (
          <>
            <p className="text-xs text-muted-foreground">
              A IA analisa score, chance, tempo parado e histórico resumido para propor uma
              abordagem. Nenhuma mensagem é enviada automaticamente.
            </p>
            <button
              type="button"
              onClick={() => generate(false)}
              disabled={state.loading}
              className="w-full h-11 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60 inline-flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {state.loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Gerando estratégia...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> Gerar estratégia
                </>
              )}
            </button>
          </>
        )}

        {state.error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive flex gap-2"
          >
            <TriangleAlert className="h-4 w-4 shrink-0" />
            <span>{state.error}</span>
          </div>
        )}

        {plan && (
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Motivo provável (hipótese)
              </p>
              <p className="text-sm">{plan.probableReason}</p>
            </div>

            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Estratégia
              </p>
              <p className="text-sm">{plan.strategy}</p>
              <p className="text-[11px] text-muted-foreground">
                {[plan.tone, INSISTENCE_LABEL[plan.insistence] ?? plan.insistence, plan.bestMoment]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="text-[11px] text-muted-foreground">CTA: {plan.cta}</p>
            </div>

            {plan.requiresTemplate && (
              <div
                className={cn(
                  "rounded-md border p-2 text-xs",
                  plan.templateName
                    ? "border-primary/30 bg-primary/5"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                )}
              >
                {plan.templateName ? (
                  <>
                    Janela de 24h fechada — envie pelo template aprovado{" "}
                    <span className="font-mono text-primary">{plan.templateName}</span>.
                  </>
                ) : (
                  <>
                    Janela de 24h fechada e nenhum template aprovado cadastrado. Cadastre um
                    template antes de contatar este cliente.
                  </>
                )}
              </div>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Mensagem principal
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setEditing((e) => !e);
                    setMessageDraft(finalMessage || plan.primaryMessage);
                  }}
                  className="h-7 px-2 text-[11px] rounded-md border border-border hover:bg-accent inline-flex items-center gap-1"
                >
                  <Pencil className="h-3 w-3" />
                  {editing ? "Concluir edição" : "Editar"}
                </button>
              </div>
              {editing ? (
                <textarea
                  value={messageDraft}
                  onChange={(e) => setMessageDraft(e.target.value)}
                  aria-label="Editar mensagem sugerida"
                  rows={5}
                  className="w-full rounded-md bg-input p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap rounded-md bg-muted/50 p-2">
                  {plan.primaryMessage}
                </p>
              )}
            </div>

            {plan.alternatives.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Alternativas
                </p>
                {plan.alternatives.map((alt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => useAlternative(alt)}
                    className="w-full text-left text-xs rounded-md border border-border p-2 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {alt}
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setShowExplanation((v) => !v)}
                aria-expanded={showExplanation}
                className="text-[11px] text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"
              >
                <ChevronDown
                  className={cn("h-3 w-3 transition-transform", showExplanation && "rotate-180")}
                />
                Ver explicação
              </button>
              {showExplanation && (
                <div className="rounded-md border border-border p-2 space-y-1.5 text-[11px] text-muted-foreground">
                  <p>{plan.explanation}</p>
                  {state.data && (
                    <>
                      <p>
                        Score {state.data.context.score}/100 · chance{" "}
                        {state.data.context.chancePercent}% · parado há{" "}
                        {state.data.context.stalledLabel} · último a falar:{" "}
                        {state.data.context.lastSpeaker}.
                      </p>
                      <p>{state.data.context.window.label}</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {state.data.context.factors.slice(0, 6).map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                      {state.data.cached && <p>Resultado reaproveitado do cache desta análise.</p>}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={copy}
                className="h-11 rounded-md border border-border text-xs font-medium hover:bg-accent inline-flex items-center justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copiado" : "Copiar"}
              </button>
              <button
                type="button"
                onClick={useInComposer}
                className="h-11 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 inline-flex items-center justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Send className="h-3.5 w-3.5" />
                Usar no campo
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              Nada é enviado automaticamente — o texto vai para o campo de mensagem da conversa.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
