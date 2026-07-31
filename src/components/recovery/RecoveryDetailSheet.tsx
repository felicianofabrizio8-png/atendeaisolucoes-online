// Detalhamento de um lead da fila: por que está nesta posição, quais fatores
// pesaram, qual a chance e o que fazer agora. É a superfície de
// explainability — o vendedor precisa confiar no número que vê.
//
// Nada aqui dispara mensagem: os botões apenas navegam para a conversa.

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RecoveryAssistPanel } from "@/components/recovery/RecoveryAssistPanel";
import { cn } from "@/lib/utils";
import {
  ACTION_LABEL,
  STATE_LABEL,
  TIER_LABEL,
  formatSpan,
  type RecoveryQueueItem,
} from "@/lib/recovery";

export interface RecoveryDetailSheetProps {
  item: RecoveryQueueItem | null;
  onOpenChange: (open: boolean) => void;
  onOpenConversation: (item: RecoveryQueueItem) => void;
  /**
   * SPRINT 6 · FASE 6.2 — "Usar no campo": o texto já foi deixado no rascunho
   * da conversa; aqui a rota apenas fecha o painel e navega. Nunca envia.
   */
  onUseInComposer?: (item: RecoveryQueueItem) => void;
  /**
   * SPRINT 6 · FASE 6.3 — abre o workflow de execução assistida. Continua
   * valendo a regra: nada é enviado sem confirmação explícita do vendedor.
   */
  onStartRecovery?: (item: RecoveryQueueItem) => void;
}

function WindowLine({ item }: { item: RecoveryQueueItem }) {
  const w = item.window;
  if (w.state === "not_applicable") {
    return <>Canal sem janela de 24h — contato livre pelas regras do canal.</>;
  }
  if (w.state === "open" || w.state === "closing_soon") {
    return (
      <>
        Janela aberta, restam <strong>{formatSpan(w.remainingMs)}</strong>. Pode enviar
        mensagem livre.
      </>
    );
  }
  if (w.state === "never_opened") {
    return <>O cliente nunca escreveu — só é possível iniciar com template aprovado.</>;
  }
  return (
    <>
      Janela fechada há <strong>{formatSpan(w.sinceClosedMs)}</strong> — só template
      aprovado reabre a conversa.
    </>
  );
}

export function RecoveryDetailSheet({
  item,
  onOpenChange,
  onOpenConversation,
  onUseInComposer,
  onStartRecovery,
}: RecoveryDetailSheetProps) {
  return (
    <Sheet open={!!item} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md overflow-y-auto p-0"
        aria-describedby={undefined}
      >
        {item && (
          <>
            <SheetHeader className="px-4 py-3 border-b border-border text-left">
              <SheetTitle className="text-base truncate">{item.leadName}</SheetTitle>
              <p className="text-[11px] text-muted-foreground">
                {[item.product, STATE_LABEL[item.state]].filter(Boolean).join(" · ")}
              </p>
            </SheetHeader>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border border-border p-2">
                  <div className="text-lg font-semibold tabular-nums">{item.score}</div>
                  <div className="text-[10px] text-muted-foreground">Score</div>
                </div>
                <div className="rounded-md border border-border p-2">
                  <div className="text-lg font-semibold tabular-nums">
                    {item.chancePercent}%
                  </div>
                  <div className="text-[10px] text-muted-foreground">Chance</div>
                </div>
                <div className="rounded-md border border-border p-2">
                  <div className="text-lg font-semibold tabular-nums">#{item.position}</div>
                  <div className="text-[10px] text-muted-foreground">Na fila</div>
                </div>
              </div>

              <section className="space-y-1">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Por que esta prioridade
                </h4>
                <p className="text-sm">{item.explanation}</p>
                <p className="text-xs text-muted-foreground">{item.positionReason}</p>
              </section>

              <section className="space-y-1">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Janela de contato
                </h4>
                <p className="text-sm">
                  <WindowLine item={item} />
                </p>
              </section>

              <section className="space-y-1">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Ação sugerida
                </h4>
                <p className="text-sm font-medium">{ACTION_LABEL[item.action.kind]}</p>
                <p className="text-xs text-muted-foreground">{item.action.reason}</p>
                {item.action.suggestedTemplate && (
                  <p className="text-xs">
                    Template:{" "}
                    <span className="font-mono text-primary">
                      {item.action.suggestedTemplate}
                    </span>
                  </p>
                )}
              </section>

              <section className="space-y-1.5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Fatores considerados
                </h4>
                <ul className="space-y-1">
                  {item.factors.map((f, i) => (
                    <li
                      key={`${f.key}-${i}`}
                      className="flex items-start justify-between gap-2 text-xs"
                    >
                      <span className="text-muted-foreground">{f.label}</span>
                      {f.points !== 0 && (
                        <span
                          className={cn(
                            "tabular-nums font-medium shrink-0",
                            f.points > 0
                              ? "text-emerald-600 dark:text-emerald-500"
                              : "text-destructive",
                          )}
                        >
                          {f.points > 0 ? `+${f.points}` : f.points}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <p className="text-[11px] text-muted-foreground">
                Prioridade {TIER_LABEL[item.tier].toLowerCase()} · parado há{" "}
                {formatSpan(item.stalledHours * 3_600_000)}
              </p>

              <RecoveryAssistPanel
                conversationId={item.conversationId}
                onUseInComposer={() => (onUseInComposer ?? onOpenConversation)(item)}
              />

              {onStartRecovery && (
                <button
                  type="button"
                  onClick={() => onStartRecovery(item)}
                  className="w-full h-11 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Recuperar este lead
                </button>
              )}

              <button
                type="button"
                onClick={() => onOpenConversation(item)}
                className="w-full h-11 rounded-md border border-border text-sm font-semibold hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                Abrir conversa
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
