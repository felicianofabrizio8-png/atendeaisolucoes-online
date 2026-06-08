import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  computeWindow,
  formatDuration,
  WINDOW_LABEL,
  type WindowInfo,
} from "@/lib/whatsapp-window";
import type { Conversation, Lead, Message } from "@/data/mock";

interface BadgeProps {
  conversation?: Pick<Conversation, "channel">;
  lead?: Pick<Lead, "channel">;
  messages?: Message[];
  /** Em vez de calcular, recebe info já calculada (otimização para listas). */
  info?: WindowInfo;
  className?: string;
  /** Atualiza o contador a cada minuto. */
  live?: boolean;
}

/**
 * Indicador visual da janela de 24h do WhatsApp (status + contagem regressiva).
 * 🟢 Aberta · 🟡 Fecha em breve · 🔴 Fechada
 */
export function WhatsappWindowBadge({
  conversation,
  lead,
  messages,
  info: providedInfo,
  className,
  live = true,
}: BadgeProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setTick((v) => v + 1), 60_000);
    return () => window.clearInterval(id);
  }, [live]);

  const info = providedInfo ?? computeWindow(conversation, lead, messages, Date.now() + tick * 0);
  if (info.state === "not_applicable") return null;

  let dot = "bg-emerald-500";
  let toneCls = "border-emerald-500/40 text-emerald-500 bg-emerald-500/10";
  let label = WINDOW_LABEL[info.state];
  let timeText = "";

  if (info.state === "open") {
    timeText = `aberta há ${formatDuration(info.elapsedMs)}`;
  } else if (info.state === "closing_soon") {
    dot = "bg-amber-500";
    toneCls = "border-amber-500/40 text-amber-500 bg-amber-500/10";
    timeText = `fecha em ${formatDuration(info.remainingMs)}`;
  } else if (info.state === "closed") {
    dot = "bg-[var(--status-urgent)]";
    toneCls =
      "border-[var(--status-urgent)]/40 text-[var(--status-urgent)] bg-[var(--status-urgent)]/10";
    timeText = `fechada há ${formatDuration(-info.remainingMs)}`;
  } else if (info.state === "never_opened") {
    dot = "bg-muted-foreground";
    toneCls = "border-border text-muted-foreground bg-secondary";
    label = "Sem mensagem do cliente";
    timeText = "";
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap",
        toneCls,
        className,
      )}
      title={`Janela 24h WhatsApp · ${label}`}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      <span>{label}</span>
      {timeText && <span className="opacity-80 font-normal">· {timeText}</span>}
    </span>
  );
}
