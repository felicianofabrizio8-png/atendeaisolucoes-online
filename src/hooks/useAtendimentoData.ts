// Fonte de dados da tela de atendimento.
//
// Regra: se a empresa logada já tem conversas, a tela mostra as conversas
// REAIS do leadRepo. Só quando não há nenhuma (caso desta branch de design)
// é que entram os contatos simulados de `demo-inbox`. Assim o mesmo componente
// serve para desenhar hoje e para produção amanhã, sem `if (demo)` espalhado
// pela UI — e sem nunca gravar dado falso no Supabase.

import { useMemo, useSyncExternalStore } from "react";
import {
  getConversations,
  getLeadById,
  getLeads,
  getMessagesFor,
  getRepoVersion,
  subscribeRepo,
} from "@/data/leadRepo";
import { buildDemoInbox, DEMO_SUMMARIES } from "@/data/demo-inbox";
import type { Conversation, Lead, Message } from "@/data/mock";
import type { CustomerHistory } from "@/lib/customer-loyalty";

export interface AtendimentoContact {
  lead: Lead;
  conversation: Conversation;
  messages: Message[];
  history: CustomerHistory;
  hue: number;
  summary?: string;
}

export interface AtendimentoData {
  contacts: AtendimentoContact[];
  /** true quando a fila veio dos clientes simulados. */
  isSimulated: boolean;
}

/** Matiz estável derivada do id — dois contatos diferentes nunca colidem feio. */
function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/**
 * Histórico de entrada a partir do que já existe no repo: quantas conversas
 * o mesmo lead abriu e quantas viraram venda. Telefone é a chave de
 * identidade quando existe, porque o mesmo cliente pode ter leads duplicados.
 */
export function deriveHistory(
  lead: Lead,
  allLeads: Lead[],
  allConversations: Conversation[],
  messages: Message[],
): CustomerHistory {
  const sameCustomer = allLeads.filter((l) =>
    lead.phone ? l.phone === lead.phone : l.id === lead.id,
  );
  const ids = new Set(sameCustomer.map((l) => l.id));
  const conversations = allConversations.filter((c) => ids.has(c.leadId));
  const closed = sameCustomer.filter((l) => l.status === "fechado");

  const firstMessageAt = messages[0]?.at;
  const firstContactAt = [lead.createdAt, firstMessageAt]
    .filter(Boolean)
    .sort()[0] as string;

  const lastPurchase = closed
    .map((l) => l.closedAt)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);

  return {
    firstContactAt: firstContactAt ?? new Date().toISOString(),
    totalConversations: Math.max(1, conversations.length),
    closedDeals: closed.length,
    lastPurchaseAt: lastPurchase ?? null,
    totalSpent: closed.reduce((s, l) => s + (l.closedValue ?? 0), 0),
  };
}

function useRepoVersion(): number {
  return useSyncExternalStore(subscribeRepo, getRepoVersion, getRepoVersion);
}

export interface AtendimentoDataOptions {
  /**
   * Força os clientes simulados mesmo quando a empresa tem conversas reais.
   * Serve para trabalhar no visual sem abrir dados de cliente na tela — e
   * para conferir estados que a base real não tem no momento (lead perdido,
   * cliente fiel, conversa inativa há dias).
   */
  forceSimulated?: boolean;
}

export function useAtendimentoData({
  forceSimulated = false,
}: AtendimentoDataOptions = {}): AtendimentoData {
  const repoVersion = useRepoVersion();

  return useMemo(() => {
    const conversations = getConversations();

    if (forceSimulated || conversations.length === 0) {
      return {
        isSimulated: true,
        contacts: buildDemoInbox().map((c) => ({
          ...c,
          summary: DEMO_SUMMARIES[c.conversation.id],
        })),
      };
    }

    const leads = getLeads();
    const contacts: AtendimentoContact[] = [];

    for (const conversation of conversations) {
      const lead = getLeadById(conversation.leadId);
      if (!lead) continue;
      const messages = getMessagesFor(conversation.id);
      contacts.push({
        lead,
        conversation,
        messages,
        history: deriveHistory(lead, leads, conversations, messages),
        hue: hueFromId(lead.id),
      });
    }

    contacts.sort(
      (a, b) =>
        new Date(b.conversation.lastMessageAt).getTime() -
        new Date(a.conversation.lastMessageAt).getTime(),
    );

    return { contacts, isSimulated: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoVersion, forceSimulated]);
}
