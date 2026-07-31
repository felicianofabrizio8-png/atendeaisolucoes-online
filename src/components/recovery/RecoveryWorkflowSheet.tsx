// ============================================================================
// Workflow de Execução Assistida da Recuperação (SPRINT 6 · FASE 6.3).
//
// Orquestra os 5 passos: Estratégia → Mensagem → Canal/Template →
// Confirmação → Resultado. O envio ocorre em UM único ponto, sempre após
// confirmação explícita, e sempre pelos endpoints oficiais de WhatsApp.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import type { RecoveryQueueItem } from "@/lib/recovery";
import type { RecoveryAssistResponse } from "@/lib/recovery-ai/types";
import {
  listApprovedTemplates,
  recoveryExec,
  type ExecResponse,
  type WhatsappTemplateOption,
} from "@/lib/recovery-exec/client";
import type { RecoveryAttempt, TimelineEntry } from "@/lib/recovery-exec";
import {
  ChannelStep,
  ConfirmStep,
  MessageStep,
  ResultStep,
  StepHeader,
  type StepIndex,
} from "./RecoveryWorkflowSteps";

export interface RecoveryWorkflowSheetProps {
  item: RecoveryQueueItem | null;
  onOpenChange: (open: boolean) => void;
  onOpenConversation: (item: RecoveryQueueItem) => void;
  /** Recarrega a fila após um envio bem-sucedido. */
  onSent?: () => void;
}

export function RecoveryWorkflowSheet({
  item,
  onOpenChange,
  onOpenConversation,
  onSent,
}: RecoveryWorkflowSheetProps) {
  const [step, setStep] = useState<StepIndex>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<RecoveryAssistResponse | null>(null);
  const [attempt, setAttempt] = useState<RecoveryAttempt | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [message, setMessage] = useState("");
  const [templates, setTemplates] = useState<WhatsappTemplateOption[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});

  const requiresTemplate = Boolean(item?.action.requiresTemplate);

  const apply = useCallback((res: ExecResponse) => {
    if (res.attempt) setAttempt(res.attempt);
    setTimeline(res.timeline ?? []);
  }, []);

  // Abre (ou reaproveita) a tentativa e carrega a estratégia da Fase 6.2.
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setStep(0);
    setError(null);
    setPlan(null);
    setAttempt(null);
    setMessage("");
    setTemplateId(null);
    setVariables({});
    setBusy(true);

    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) throw new Error("Sessão expirada. Entre novamente.");

        const assistRes = await fetch("/api/recovery/assist", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ conversation_id: item.conversationId }),
        });
        const assist = (await assistRes.json().catch(() => null)) as
          | (RecoveryAssistResponse & { error?: string })
          | null;
        if (!assistRes.ok || !assist?.plan) {
          throw new Error(assist?.error ?? "Não foi possível gerar a estratégia agora.");
        }
        if (cancelled) return;
        setPlan(assist);
        setMessage(assist.plan.primaryMessage);

        const opened = await recoveryExec("open", {
          conversationId: item.conversationId,
          score: item.score,
          chance: item.chance?.percent ?? null,
          tier: item.tier,
          windowState: item.window.state,
          strategyFingerprint: assist.fingerprint ?? null,
          plan: assist.plan as unknown as Record<string, unknown>,
        });
        if (cancelled) return;
        apply(opened);
        if (opened.attempt?.messageText) setMessage(opened.attempt.messageText);
        if (opened.attempt?.templateId) setTemplateId(opened.attempt.templateId);
        if (opened.attempt && opened.attempt.status === "sent") setStep(4);

        const list = await listApprovedTemplates();
        if (!cancelled) setTemplates(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Falha inesperada.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item, apply]);

  const run = useCallback(
    async (action: string, payload: Record<string, unknown>, next?: StepIndex) => {
      if (!attempt) return;
      setBusy(true);
      setError(null);
      try {
        const res = await recoveryExec(action, { attemptId: attempt.id, ...payload });
        apply(res);
        if (next !== undefined) setStep(next);
      } catch (e) {
        const err = e as { message?: string; payload?: ExecResponse };
        if (err.payload?.attempt) apply(err.payload as ExecResponse);
        setError(err.message ?? "Falha inesperada.");
      } finally {
        setBusy(false);
      }
    },
    [attempt, apply],
  );

  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null;

  const preview = useMemo(() => {
    if (!selectedTemplate) return message;
    return `Template “${selectedTemplate.name}” (${selectedTemplate.language})\n\n${(
      selectedTemplate.variables ?? []
    )
      .map((n) => `${n}: ${variables[n] ?? "—"}`)
      .join("\n")}`;
  }, [selectedTemplate, message, variables]);

  const canConfirmChannel = requiresTemplate
    ? Boolean(selectedTemplate) &&
      (selectedTemplate?.variables ?? []).every((n) => variables[n]?.trim())
    : Boolean(message.trim()) || Boolean(selectedTemplate);

  const send = useCallback(async () => {
    if (!attempt || !item) return;
    setBusy(true);
    setError(null);
    try {
      const res = await recoveryExec("send", { attemptId: attempt.id });
      apply(res);
      setStep(4);
      onSent?.();
    } catch (e) {
      const err = e as { message?: string; payload?: ExecResponse };
      if (err.payload?.attempt) apply(err.payload as ExecResponse);
      setError(err.message ?? "Falha ao enviar.");
      setStep(4);
    } finally {
      setBusy(false);
    }
  }, [attempt, item, apply, onSent]);

  return (
    <Sheet open={!!item} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 flex flex-col gap-0"
        aria-describedby={undefined}
      >
        <SheetHeader className="px-4 py-3 border-b border-border text-left shrink-0">
          <SheetTitle className="text-base truncate">
            Recuperar {item?.leadName ?? "lead"}
          </SheetTitle>
        </SheetHeader>
        <StepHeader current={step} />

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          {busy && !attempt && (
            <p className="text-xs text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Preparando a recuperação…
            </p>
          )}

          {step === 0 && plan && (
            <div className="space-y-2 text-xs">
              <p>
                <strong>Motivo provável:</strong> {plan.plan.hypothesis}
              </p>
              <p>
                <strong>Estratégia:</strong> {plan.plan.strategy}
              </p>
              <button
                type="button"
                disabled={!attempt || busy}
                onClick={() => setStep(1)}
                className="h-11 w-full rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60"
              >
                Escolher mensagem
              </button>
            </div>
          )}

          {step === 1 && plan && (
            <>
              <MessageStep
                options={[plan.plan.primaryMessage, ...(plan.plan.alternatives ?? [])]}
                value={message}
                onChange={setMessage}
                onPick={setMessage}
              />
              <button
                type="button"
                disabled={busy || !message.trim()}
                onClick={() =>
                  run("select_message", { messageText: message, messageStyle: "primary" }, 2)
                }
                className="h-11 w-full rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60"
              >
                Continuar
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <ChannelStep
                requiresTemplate={requiresTemplate}
                templates={templates}
                templateId={templateId}
                onSelectTemplate={setTemplateId}
                variables={variables}
                onVariableChange={(n, v) => setVariables((s) => ({ ...s, [n]: v }))}
              />
              <button
                type="button"
                disabled={busy || !canConfirmChannel}
                onClick={async () => {
                  await run("select_template", {
                    templateId,
                    templateName: selectedTemplate?.name ?? null,
                    templateVariables: variables,
                  });
                  await run("confirm", {}, 3);
                }}
                className="h-11 w-full rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60"
              >
                Revisar antes de enviar
              </button>
            </>
          )}

          {step === 3 && (
            <ConfirmStep
              recipient={item?.leadPhone ?? null}
              channelLabel={selectedTemplate ? "Template aprovado" : "Mensagem livre (janela aberta)"}
              preview={preview}
              sending={busy}
              onSend={send}
              onBack={() => setStep(2)}
            />
          )}

          {step === 4 && attempt && (
            <ResultStep
              attempt={attempt}
              timeline={timeline}
              busy={busy}
              onRetry={() => run("retry", {}, 3)}
              onOutcome={(o) => run("outcome", { outcome: o })}
              onOpenConversation={() => item && onOpenConversation(item)}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
