// Store reativo para mutações de leads e eventos de conversa.
// Mantém estado em memória — substituir por backend depois.
// Os relatórios e a inbox se inscrevem para reagir em tempo real.

import { conversations, leads, messages, type Lead, type Message } from "./mock";

const listeners = new Set<() => void>();

let leadsSnapshot: Lead[] = [...leads];
let messagesSnapshot: Message[] = [...messages];

function rebuild() {
  leadsSnapshot = [...leads];
  messagesSnapshot = [...messages];
}

function notify() {
  rebuild();
  for (const l of listeners) l();
}

export function subscribeLeadStore(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getLeadsSnapshot(): Lead[] {
  return leadsSnapshot;
}

export function getMessagesSnapshot(): Message[] {
  return messagesSnapshot;
}

function patchLead(id: string, patch: Partial<Lead>) {
  const idx = leads.findIndex((l) => l.id === id);
  if (idx === -1) return;
  leads[idx] = { ...leads[idx], ...patch };
}

export function markLeadWon(leadId: string, value: number) {
  patchLead(leadId, {
    status: "fechado",
    closedValue: value,
    closedAt: new Date().toISOString(),
  });
  notify();
}

export function markLeadLost(leadId: string, reason: string) {
  patchLead(leadId, {
    status: "perdido",
    lossReason: reason,
    lostAt: new Date().toISOString(),
  });
  notify();
}

export function appendMessage(message: Message) {
  messages.push(message);
  // mantém marca de "última mensagem" coerente
  const conv = conversations.find((c) => c.id === message.conversationId);
  if (conv) {
    conv.lastMessageAt = message.at;
    if (message.role === "agent") {
      conv.awaitingReply = false;
      conv.unread = 0;
    } else if (message.role === "lead") {
      conv.awaitingReply = true;
      conv.unread = (conv.unread ?? 0) + 1;
    }
  }
  notify();
}
