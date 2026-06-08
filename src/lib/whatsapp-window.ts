// Cálculo da janela de 24 horas da WhatsApp Cloud API.
// A janela "abre" quando o cliente envia uma mensagem (role === 'lead')
// e permanece aberta por 24 horas a partir desse momento. Após esse período,
// só é possível responder ao cliente utilizando um template aprovado.
//
// Este utilitário é puramente derivado (não altera webhook, follow-up,
// templates ou qualquer fluxo existente). Serve apenas para apoio visual
// ao atendente.

import type { Message, Conversation, Lead } from "@/data/mock";

export type WindowState = "open" | "closing_soon" | "closed" | "never_opened" | "not_applicable";

export const WINDOW_MS = 24 * 60 * 60 * 1000;
export const CLOSING_SOON_MS = 3 * 60 * 60 * 1000; // alerta quando faltar < 3h

export interface WindowInfo {
  state: WindowState;
  /** Timestamp ISO da última mensagem recebida do cliente, se houver. */
  openedAt: string | null;
  /** Timestamp ISO em que a janela fechará (ou fechou), se aplicável. */
  closesAt: string | null;
  /** Milissegundos restantes até fechar (negativo se já fechada). */
  remainingMs: number;
  /** Milissegundos desde a abertura (positivo enquanto aberta). */
  elapsedMs: number;
}

/** Retorna a última mensagem com role 'lead' (recebida do cliente). */
function lastInboundAt(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "lead") return messages[i].at;
  }
  return null;
}

/**
 * Calcula o estado da janela de 24h para a conversa.
 * Apenas WhatsApp aplica esta regra — outros canais retornam 'not_applicable'.
 */
export function computeWindow(
  conversation: Pick<Conversation, "channel"> | undefined,
  lead: Pick<Lead, "channel"> | undefined,
  messages: Message[] | undefined,
  now: number = Date.now(),
): WindowInfo {
  const channel = conversation?.channel ?? lead?.channel;
  if (channel !== "whatsapp") {
    return { state: "not_applicable", openedAt: null, closesAt: null, remainingMs: 0, elapsedMs: 0 };
  }

  const openedAt = messages ? lastInboundAt(messages) : null;
  if (!openedAt) {
    return { state: "never_opened", openedAt: null, closesAt: null, remainingMs: 0, elapsedMs: 0 };
  }

  const openedMs = new Date(openedAt).getTime();
  const elapsedMs = now - openedMs;
  const remainingMs = WINDOW_MS - elapsedMs;
  const closesAt = new Date(openedMs + WINDOW_MS).toISOString();

  let state: WindowState;
  if (remainingMs <= 0) state = "closed";
  else if (remainingMs <= CLOSING_SOON_MS) state = "closing_soon";
  else state = "open";

  return { state, openedAt, closesAt, remainingMs, elapsedMs };
}

/** Formata duração de ms em "Xd Yh Zm" / "Yh Zm" / "Zm". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Retorna true se o deadline (openedAt + 24h) for entre agora e o fim do dia local. */
export function closesToday(info: WindowInfo, now: number = Date.now()): boolean {
  if (info.state !== "open" && info.state !== "closing_soon") return false;
  if (!info.closesAt) return false;
  const closes = new Date(info.closesAt).getTime();
  if (closes < now) return false;
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  return closes <= endOfToday.getTime();
}

export const WINDOW_LABEL: Record<WindowState, string> = {
  open: "Janela aberta",
  closing_soon: "Fecha em breve",
  closed: "Janela fechada",
  never_opened: "Sem mensagem do cliente",
  not_applicable: "",
};
