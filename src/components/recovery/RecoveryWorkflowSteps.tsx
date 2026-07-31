// ============================================================================
// Passos visuais do workflow de recuperação (Fase 6.3).
//
// Componentes puramente apresentacionais: recebem dados e callbacks, não
// conhecem rede nem estado global. Todo o texto é em linguagem de vendedor —
// nenhum código técnico, status cru ou detalhe de provedor aparece aqui.
// ============================================================================

import { AlertTriangle, Check, Loader2, Lock, Send, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_RECOVERY_MESSAGE_CHARS, STATUS_LABEL, maskRecipient } from "@/lib/recovery-exec";
import type { RecoveryAttempt, TimelineEntry } from "@/lib/recovery-exec";
import type { WhatsappTemplateOption } from "@/lib/recovery-exec/client";

export const STEPS = ["Estratégia", "Mensagem", "Canal", "Confirmação", "Resultado"] as const;
export type StepIndex = 0 | 1 | 2 | 3 | 4;

export function StepHeader({ current }: { current: StepIndex }) {
  return (
    <ol className="flex items-center gap-1 px-4 py-2 border-b border-border overflow-x-auto">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-1 shrink-0">
          <span
            aria-current={i === current ? "step" : undefined}
            className={cn(
              "text-[10px] px-2 py-1 rounded-full border whitespace-nowrap",
              i === current
                ? "border-primary bg-primary/10 text-primary font-semibold"
                : i < current
                  ? "border-border bg-muted text-muted-foreground"
                  : "border-border text-muted-foreground",
            )}
          >
            {i + 1}. {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function MessageStep({
  options,
  value,
  onChange,
  onPick,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  onPick: (v: string) => void;
}) {
  const over = value.length > MAX_RECOVERY_MESSAGE_CHARS;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Escolha uma sugestão e ajuste o que quiser. Nada é enviado nesta etapa.
      </p>
      <div className="space-y-2">
        {options.map((opt, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPick(opt)}
            className="w-full text-left rounded-md border border-border p-2.5 text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            {opt}
          </button>
        ))}
      </div>
      <label className="block text-xs font-medium" htmlFor="recovery-message">
        Mensagem final
      </label>
      <textarea
        id="recovery-message"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        className="w-full rounded-md bg-input p-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <p className={cn("text-[11px]", over ? "text-destructive" : "text-muted-foreground")}>
        {value.length}/{MAX_RECOVERY_MESSAGE_CHARS} caracteres
      </p>
    </div>
  );
}

export function ChannelStep({
  requiresTemplate,
  templates,
  templateId,
  onSelectTemplate,
  variables,
  onVariableChange,
}: {
  requiresTemplate: boolean;
  templates: WhatsappTemplateOption[];
  templateId: string | null;
  onSelectTemplate: (id: string | null) => void;
  variables: Record<string, string>;
  onVariableChange: (name: string, value: string) => void;
}) {
  const selected = templates.find((t) => t.id === templateId) ?? null;
  return (
    <div className="space-y-3">
      {requiresTemplate ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400 flex gap-2">
          <Lock className="h-4 w-4 shrink-0" />
          <p>
            A janela de 24h está fechada. Só um template aprovado reabre a conversa — a
            mensagem livre fica guardada para o próximo passo do atendimento.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          A janela está aberta: dá para enviar a mensagem livre que você acabou de revisar.
        </p>
      )}

      {requiresTemplate && templates.length === 0 && (
        <p className="text-xs text-destructive">
          Nenhum template aprovado cadastrado. Cadastre e sincronize um template antes de
          recuperar este lead.
        </p>
      )}

      {templates.length > 0 && (
        <div className="space-y-2">
          <label className="block text-xs font-medium" htmlFor="recovery-template">
            Template aprovado
          </label>
          <select
            id="recovery-template"
            value={templateId ?? ""}
            onChange={(e) => onSelectTemplate(e.target.value || null)}
            className="w-full h-11 rounded-md bg-input px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">{requiresTemplate ? "Selecione…" : "Sem template (texto livre)"}</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.language})
              </option>
            ))}
          </select>
        </div>
      )}

      {(selected?.variables ?? []).map((name) => (
        <div key={name} className="space-y-1">
          <label className="block text-xs font-medium" htmlFor={`var-${name}`}>
            {name}
          </label>
          <input
            id={`var-${name}`}
            value={variables[name] ?? ""}
            onChange={(e) => onVariableChange(name, e.target.value)}
            className="w-full h-11 rounded-md bg-input px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      ))}
    </div>
  );
}

export function ConfirmStep({
  recipient,
  recipientName,
  channelLabel,
  preview,
  sending,
  onSend,
  onBack,
}: {
  recipient: string | null;
  recipientName: string;
  channelLabel: string;
  preview: string;
  sending: boolean;
  onSend: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-3">
      <dl className="rounded-md border border-border divide-y divide-border text-xs">
        <div className="flex justify-between gap-2 p-2.5">
          <dt className="text-muted-foreground">Para</dt>
          <dd className="font-medium">
            {recipientName} · {maskRecipient(recipient)}
          </dd>
        </div>
        <div className="flex justify-between gap-2 p-2.5">
          <dt className="text-muted-foreground">Como</dt>
          <dd className="font-medium">{channelLabel}</dd>
        </div>
      </dl>
      <div className="rounded-md border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
        {preview}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Ao confirmar, a mensagem é enviada de verdade para o cliente. Esta é a única etapa
        que dispara envio.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={sending}
          className="h-11 flex-1 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
        >
          Voltar
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={sending}
          className="h-11 flex-1 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Confirmar e enviar
        </button>
      </div>
    </div>
  );
}

export function ResultStep({
  attempt,
  timeline,
  busy,
  onRetry,
  onOutcome,
  onOpenConversation,
}: {
  attempt: RecoveryAttempt;
  timeline: TimelineEntry[];
  busy: boolean;
  onRetry: () => void;
  onOutcome: (o: "recovered" | "not_recovered") => void;
  onOpenConversation: () => void;
}) {
  const failed = attempt.status === "failed";
  return (
    <div className="space-y-3">
      <div
        className={cn(
          "rounded-md border p-3 text-xs flex gap-2",
          failed
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : "border-primary/30 bg-primary/10 text-primary",
        )}
      >
        {failed ? (
          <AlertTriangle className="h-4 w-4 shrink-0" />
        ) : (
          <Check className="h-4 w-4 shrink-0" />
        )}
        <p>
          {failed
            ? (attempt.failureMessage ?? "O envio falhou. Você pode tentar novamente.")
            : "Recuperação enviada. O lead sai da fila por 24h enquanto aguardamos resposta."}
        </p>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Situação: <strong>{STATUS_LABEL[attempt.status]}</strong>
      </p>

      {failed ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="h-11 w-full rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60"
        >
          Tentar novamente
        </button>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={onOpenConversation}
            className="h-11 w-full rounded-md border border-border text-sm hover:bg-accent inline-flex items-center justify-center gap-1.5"
          >
            <Sparkles className="h-4 w-4" /> Abrir conversa
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOutcome("recovered")}
              disabled={busy}
              className="h-11 flex-1 rounded-md border border-border text-xs hover:bg-accent disabled:opacity-50"
            >
              Marcar recuperado
            </button>
            <button
              type="button"
              onClick={() => onOutcome("not_recovered")}
              disabled={busy}
              className="h-11 flex-1 rounded-md border border-border text-xs hover:bg-accent disabled:opacity-50"
            >
              Não recuperado
            </button>
          </div>
        </div>
      )}

      {timeline.length > 0 && (
        <ol className="space-y-1 pt-1">
          {timeline.map((entry) => (
            <li key={entry.id} className="text-[11px] text-muted-foreground">
              • {entry.label}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
