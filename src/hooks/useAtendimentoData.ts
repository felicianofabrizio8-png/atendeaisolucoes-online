import { useMemo, useSyncExternalStore } from "react";
import {
  getConversations,
  getLeadById,
  getLeads,
  getMessagesFor,
  getRepoMode,
  getRemoteLoadError,
  getRepoVersion,
  isRemoteLoaded,
  subscribeRepo,
} from "@/data/leadRepo";
import type { Conversation, Lead, Message } from "@/data/mock";
import type { CustomerHistory } from "@/lib/customer-loyalty";

export interface AtendimentoContact { lead: Lead; conversation: Conversation; messages: Message[]; history: CustomerHistory; hue: number; }
export type AtendimentoStatus = "loading" | "error" | "empty" | "ready";
export interface AtendimentoData { contacts: AtendimentoContact[]; status: AtendimentoStatus; error: string | null; remote: boolean; loading: boolean; }

export function resolveAtendimentoStatus({ remote, loaded, error, hasContacts }: { remote: boolean; loaded: boolean; error: string | null; hasContacts: boolean }): AtendimentoStatus {
  if (error) return "error";
  if (remote && !loaded) return "loading";
  return hasContacts ? "ready" : "empty";
}

function hueFromId(id: string): number {
  return [...id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) % 360, 0);
}

export function deriveHistory(lead: Lead, leads: Lead[], conversations: Conversation[], messages: Message[]): CustomerHistory {
  const sameCustomer = leads.filter((item) => lead.phone ? item.phone === lead.phone : item.id === lead.id);
  const ids = new Set(sameCustomer.map((item) => item.id));
  const closed = sameCustomer.filter((item) => item.status === "fechado");
  const firstContactAt = [lead.createdAt, messages[0]?.at].filter(Boolean).sort()[0] ?? new Date().toISOString();
  return {
    firstContactAt,
    totalConversations: Math.max(1, conversations.filter((item) => ids.has(item.leadId)).length),
    closedDeals: closed.length,
    lastPurchaseAt: closed.map((item) => item.closedAt).filter((value): value is string => !!value).sort().at(-1) ?? null,
    totalSpent: closed.reduce((sum, item) => sum + (item.closedValue ?? 0), 0),
  };
}

export function useAtendimentoData(): AtendimentoData {
  const version = useSyncExternalStore(subscribeRepo, getRepoVersion, getRepoVersion);
  return useMemo(() => {
    const remote = getRepoMode() === "remote";
    const error = getRemoteLoadError();
    const conversations = getConversations();
    const leads = getLeads();
    const contacts = conversations.flatMap((conversation) => {
      const lead = getLeadById(conversation.leadId);
      if (!lead) return [];
      const messages = getMessagesFor(conversation.id);
      return [{ lead, conversation, messages, history: deriveHistory(lead, leads, conversations, messages), hue: hueFromId(lead.id) }];
    }).sort((a, b) => new Date(b.conversation.lastMessageAt).getTime() - new Date(a.conversation.lastMessageAt).getTime());
    const status = resolveAtendimentoStatus({ remote: remote || !!error, loaded: isRemoteLoaded(), error, hasContacts: contacts.length > 0 });
    return { contacts, status, error, remote, loading: status === "loading" };
  }, [version]);
}
