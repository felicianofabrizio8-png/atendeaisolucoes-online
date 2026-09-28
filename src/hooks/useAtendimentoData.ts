// Fonte de dados da tela de atendimento.
//
// União das duas implementações que existiam em paralelo:
//
// - da `main` vêm os estados de carregamento (`loading`/`error`/`empty`/
//   `ready`), que evitam a tela em branco silenciosa quando o Supabase falha;
// - da `isaque` vem o modo demo com clientes simulados, usado para desenhar a
//   interface sem depender de dado real, e o `summary` da conversa.
//
// A regra que concilia as duas: **o demo é opt-in, nunca fallback.** Só entra
// quando alguém pede via `forceSimulated` (o botão "Ver exemplos" da tela).
//
// Cheguei a fazer o demo preencher automaticamente a fila vazia, e o teste
// `atendimento-visual` derrubou — o nome dele é "sem inventar fila". É um
// contrato deliberado: empresa sem conversas tem que ver o estado vazio de
// verdade, não uma fila fabricada que parece real.

import { useMemo, useSyncExternalStore } from "react";
import {
  getConversations,
  getLeadById,
  getLeads,
  getMessagesFor,
  getRemoteLoadError,
  getRepoMode,
  getRepoVersion,
  isRemoteLoaded,
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
  /** Resumo da conversa, quando houver. Hoje só o modo demo preenche. */
  summary?: string;
}

export type AtendimentoStatus = "loading" | "error" | "empty" | "ready";

export interface AtendimentoData {
  contacts: AtendimentoContact[];
  status: AtendimentoStatus;
  error: string | null;
  remote: boolean;
  loading: boolean;
  /** true quando a fila veio dos clientes simulados. */
  isSimulated: boolean;
}

export interface AtendimentoDataOptions {
  /** Força os clientes de exemplo mesmo havendo conversas reais. */
  forceSimulated?: boolean;
}

export function resolveAtendimentoStatus({
  remote,
  loaded,
  error,
  hasContacts,
}: {
  remote: boolean;
  loaded: boolean;
  error: string | null;
  hasContacts: boolean;
}): AtendimentoStatus {
  if (error) return "error";
  if (remote && !loaded) return "loading";
  return hasContacts ? "ready" : "empty";
}

/** Matiz estável derivada do id — dois contatos diferentes nunca colidem feio. */
function hueFromId(id: string): number {
  return [...id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) % 360, 0);
}

export function deriveHistory(
  lead: Lead,
  leads: Lead[],
  conversations: Conversation[],
  messages: Message[],
): CustomerHistory {
  const sameCustomer = leads.filter((item) =>
    lead.phone ? item.phone === lead.phone : item.id === lead.id,
  );
  const ids = new Set(sameCustomer.map((item) => item.id));
  const closed = sameCustomer.filter((item) => item.status === "fechado");
  const firstContactAt =
    [lead.createdAt, messages[0]?.at].filter(Boolean).sort()[0] ?? new Date().toISOString();
  return {
    firstContactAt,
    totalConversations: Math.max(1, conversations.filter((item) => ids.has(item.leadId)).length),
    closedDeals: closed.length,
    lastPurchaseAt:
      closed
        .map((item) => item.closedAt)
        .filter((value): value is string => !!value)
        .sort()
        .at(-1) ?? null,
    totalSpent: closed.reduce((sum, item) => sum + (item.closedValue ?? 0), 0),
  };
}

function demoContacts(): AtendimentoContact[] {
  return buildDemoInbox().map((c) => ({
    ...c,
    summary: DEMO_SUMMARIES[c.conversation.id],
  }));
}

export function useAtendimentoData({
  forceSimulated = false,
}: AtendimentoDataOptions = {}): AtendimentoData {
  const version = useSyncExternalStore(subscribeRepo, getRepoVersion, getRepoVersion);

  return useMemo(() => {
    if (forceSimulated) {
      return {
        contacts: demoContacts(),
        status: "ready" as const,
        error: null,
        remote: false,
        loading: false,
        isSimulated: true,
      };
    }

    const remote = getRepoMode() === "remote";
    const error = getRemoteLoadError();
    const conversations = getConversations();
    const leads = getLeads();

    const contacts = conversations
      .flatMap((conversation) => {
        const lead = getLeadById(conversation.leadId);
        if (!lead) return [];
        const messages = getMessagesFor(conversation.id);
        return [
          {
            lead,
            conversation,
            messages,
            history: deriveHistory(lead, leads, conversations, messages),
            hue: hueFromId(lead.id),
          },
        ];
      })
      .sort(
        (a, b) =>
          new Date(b.conversation.lastMessageAt).getTime() -
          new Date(a.conversation.lastMessageAt).getTime(),
      );

    const status = resolveAtendimentoStatus({
      remote: remote || !!error,
      loaded: isRemoteLoaded(),
      error,
      hasContacts: contacts.length > 0,
    });

    return { contacts, status, error, remote, loading: status === "loading", isSimulated: false };
    // `version` parece dependência inútil para o lint porque não aparece no
    // corpo — mas é justamente o tique do store externo, e é ele que manda
    // recalcular quando o leadRepo muda. Sem ele a tela congela no primeiro
    // resultado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, forceSimulated]);
}
