// Atenção da fila do Chat: o que cada conversa está pedindo agora e em que
// ordem atender. Puro e só de leitura — não muda status, SLA, follow-up nem
// envio. Os pesos seguem a regra de prioridade que o app já usa
// (`sortedConversations` em data/mock: SLA estourado > aguardando > quente >
// próxima ação vencida > novo), somando a janela de 24h do WhatsApp e o
// follow-up vencido, que a tela do Chat conhece.

import type { Conversation, Lead, Message } from "@/data/mock";
import { computeWindow, formatDuration, type WindowState } from "@/lib/whatsapp-window";
import type { FollowupCycleView } from "./followup-view";

export type SignalTone = "urgent" | "warn" | "hot" | "info";

export interface AttentionSignal {
  key: "waiting" | "window" | "followup" | "hot";
  label: string;
  tone: SignalTone;
}

export interface Attention {
  score: number;
  /** Desde quando o cliente espera resposta (ms), quando está aguardando. */
  waitingMs: number | null;
  window: WindowState;
  windowRemainingMs: number;
  signals: AttentionSignal[];
}

export interface AttentionSubject {
  lead: Lead;
  conversation: Conversation;
  messages: Message[];
  followup?: FollowupCycleView;
}

const HOUR = 3_600_000;

function lastInboundMs(messages: Message[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "lead") return new Date(messages[i].at).getTime();
  }
  return null;
}

export function isHot(lead: Lead, conversation: Conversation): boolean {
  return (
    conversation.leadTemperature === "quente" ||
    conversation.leadReadyToClose === true ||
    lead.status === "quente"
  );
}

export function computeAttention(subject: AttentionSubject, now = Date.now()): Attention {
  const { lead, conversation, messages, followup } = subject;
  const closed = lead.status === "perdido" || lead.status === "fechado";
  const win = computeWindow(conversation, lead, messages, now);
  const inbound = lastInboundMs(messages) ?? new Date(conversation.lastMessageAt).getTime();
  const waitingMs = conversation.awaitingReply && !closed ? Math.max(0, now - inbound) : null;
  const hot = isHot(lead, conversation);
  const followupOverdue = followup?.bucket === "overdue";
  const nextActionOverdue = !!lead.nextAction && new Date(lead.nextAction.dueAt).getTime() < now;

  const signals: AttentionSignal[] = [];
  if (waitingMs !== null) {
    signals.push({
      key: "waiting",
      label: `aguarda ${formatDuration(waitingMs)}`,
      tone: conversation.slaBreached ? "urgent" : "warn",
    });
  }
  if (!closed && win.state === "closing_soon") {
    signals.push({
      key: "window",
      label: `janela fecha em ${formatDuration(win.remainingMs)}`,
      tone: "warn",
    });
  } else if (!closed && win.state === "closed") {
    signals.push({ key: "window", label: "fora da janela", tone: "info" });
  }
  if (followupOverdue)
    signals.push({ key: "followup", label: "follow-up vencido", tone: "urgent" });
  if (hot && !closed) signals.push({ key: "hot", label: "quente", tone: "hot" });

  let score = 0;
  if (!closed) {
    if (waitingMs !== null && conversation.slaBreached) score += 1000;
    if (waitingMs !== null) score += 500;
    // Fechando com o cliente esperando: depois disso só template.
    if (win.state === "closing_soon") score += waitingMs !== null ? 450 : 150;
    if (followupOverdue) score += 350;
    if (hot) score += 300;
    if (nextActionOverdue) score += 200;
    if (lead.status === "novo") score += 100;
  }
  // Desempate: quem espera há mais tempo; sem espera, a mais recente.
  score +=
    waitingMs !== null
      ? Math.min(waitingMs / HOUR, 99) / 100
      : -((now - new Date(conversation.lastMessageAt).getTime()) / HOUR) / 10_000;

  return {
    score,
    waitingMs,
    window: win.state,
    windowRemainingMs: win.remainingMs,
    signals,
  };
}

/** Ordena por atenção (maior primeiro), estável para empates exatos. */
export function sortByAttention<T extends AttentionSubject>(subjects: T[], now = Date.now()): T[] {
  return subjects
    .map((subject, index) => ({ subject, index, score: computeAttention(subject, now).score }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.subject);
}
