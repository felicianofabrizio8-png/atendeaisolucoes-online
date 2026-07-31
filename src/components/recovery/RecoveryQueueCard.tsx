// Cartão de um lead na fila inteligente.
// Mobile-first: tudo empilha em coluna única e as ações têm alvo de toque
// mínimo de 40px. Nenhuma cor hard-coded fora dos tokens semânticos.

import { cn } from "@/lib/utils";
import { Clock, Lock, MessageCircle, Sparkles } from "lucide-react";
import {
  ACTION_LABEL,
  STATE_LABEL,
  TIER_LABEL,
  formatSpan,
  type RecoveryQueueItem,
} from "@/lib/recovery";

export interface RecoveryQueueCardProps {
  item: RecoveryQueueItem;
  onOpenDetails: (item: RecoveryQueueItem) => void;
  onOpenConversation: (item: RecoveryQueueItem) => void;
}

const TIER_TONE: Record<RecoveryQueueItem["tier"], string> = {
  muito_alta: "bg-destructive/15 text-destructive border-destructive/30",
  alta: "bg-amber-500/15 text-amber-600 dark:text-amber-500 border-amber-500/30",
  media: "bg-primary/10 text-primary border-primary/30",
  baixa: "bg-muted text-muted-foreground border-border",
  muito_baixa: "bg-muted text-muted-foreground border-border",
};

export function RecoveryQueueCard({
  item,
  onOpenDetails,
  onOpenConversation,
}: RecoveryQueueCardProps) {
  const windowOpen = item.window.state === "open" || item.window.state === "closing_soon";

  return (
    <article className="rounded-lg border border-border bg-card p-3 space-y-2.5">
      <div className="flex items-start gap-2">
        <span
          aria-label={`Posição ${item.position} na fila`}
          className="shrink-0 h-7 w-7 rounded-md bg-muted text-muted-foreground text-xs font-semibold inline-flex items-center justify-center tabular-nums"
        >
          {item.position}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold truncate">{item.leadName}</h3>
          <p className="text-[11px] text-muted-foreground truncate">
            {[item.product, STATE_LABEL[item.state]].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold leading-none tabular-nums">{item.score}</div>
          <div className="text-[10px] text-muted-foreground">score</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border",
            TIER_TONE[item.tier],
          )}
        >
          {TIER_LABEL[item.tier]}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground inline-flex items-center gap-1">
          <Sparkles className="h-3 w-3" />
          {item.chancePercent}% de chance
        </span>
        {windowOpen ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-500 inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Janela {formatSpan(item.window.remainingMs)}
          </span>
        ) : item.window.requiresTemplate ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-500 inline-flex items-center gap-1">
            <Lock className="h-3 w-3" />
            Só com template
          </span>
        ) : null}
        <span className="text-[10px] text-muted-foreground">
          parado {formatSpan(item.stalledHours * 3_600_000)}
        </span>
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2">{item.explanation}</p>

      <div className="rounded-md border border-border bg-muted/40 p-2">
        <p className="text-[11px] font-semibold">
          Próxima ação: {ACTION_LABEL[item.action.kind]}
        </p>
        <p className="text-[11px] text-muted-foreground line-clamp-2">{item.action.reason}</p>
      </div>

      <div className="flex flex-wrap gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => onOpenDetails(item)}
          className="h-10 sm:h-9 px-3 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
        >
          Ver detalhes
        </button>
        <button
          type="button"
          onClick={() => onOpenConversation(item)}
          className="h-10 sm:h-9 px-3 text-xs rounded-md border border-border hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring inline-flex items-center gap-1.5"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          Abrir conversa
        </button>
      </div>
    </article>
  );
}
