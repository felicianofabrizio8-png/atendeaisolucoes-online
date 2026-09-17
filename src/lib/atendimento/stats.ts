// Métricas do carrossel da tela de atendimento.
//
// Cada métrica é um cartão colorido que (a) mostra um número e (b) sabe
// filtrar a fila. Elas trocam sozinhas a cada 7s, mas também são clicáveis:
// o número vira um filtro da lista à esquerda. Um KPI que não leva a lugar
// nenhum é decoração; este leva.

import type { Conversation, Lead } from "@/data/mock";
import { classifyCustomer, type CustomerHistory } from "@/lib/customer-loyalty";

export interface StatSubject {
  lead: Lead;
  conversation: Conversation;
  history: CustomerHistory;
}

export interface StatDefinition {
  key: string;
  /** Rótulo no cartão, como nos mockups: "Orçamentos:", "Inativos:". */
  label: string;
  /** Linha de apoio, aparece abaixo do número. */
  caption: string;
  /** Gradiente do cartão (CSS `background`). */
  gradient: string;
  /** Predicado que define se a conversa entra nessa métrica. */
  match: (s: StatSubject, now: number) => boolean;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function hoursSince(iso: string, now: number): number {
  return (now - new Date(iso).getTime()) / HOUR;
}

export const STAT_DEFINITIONS: StatDefinition[] = [
  {
    key: "aguardando",
    label: "Aguardando",
    caption: "Cliente falou e ninguém respondeu",
    gradient: "linear-gradient(135deg, oklch(0.62 0.21 25) 0%, oklch(0.72 0.19 55) 100%)",
    match: ({ conversation }) => conversation.awaitingReply,
  },
  {
    key: "orcamentos",
    label: "Orçamentos",
    caption: "Propostas em aberto na mesa",
    gradient: "linear-gradient(120deg, oklch(0.58 0.20 265) 0%, oklch(0.72 0.15 215) 100%)",
    match: ({ lead }) =>
      !!lead.estimatedValue &&
      lead.status !== "perdido" &&
      lead.status !== "fechado",
  },
  {
    key: "quentes",
    label: "Quentes",
    caption: "Prontos para receber o contrato",
    gradient: "linear-gradient(135deg, oklch(0.66 0.23 20) 0%, oklch(0.80 0.18 75) 100%)",
    match: ({ lead, conversation }) =>
      conversation.leadTemperature === "quente" ||
      conversation.leadReadyToClose === true ||
      lead.status === "quente",
  },
  {
    key: "inativos",
    label: "Inativos",
    caption: "Sem troca de mensagem há mais de 48h",
    gradient: "linear-gradient(120deg, oklch(0.62 0.25 5) 0%, oklch(0.78 0.19 65) 100%)",
    match: ({ conversation }, now) =>
      hoursSince(conversation.lastMessageAt, now) >= 48 &&
      conversation.awaitingReply,
  },
  {
    key: "online",
    label: "Online",
    caption: "Janela de 24h ainda aberta",
    gradient: "linear-gradient(120deg, oklch(0.74 0.17 155) 0%, oklch(0.55 0.22 270) 100%)",
    match: ({ conversation }, now) => hoursSince(conversation.lastMessageAt, now) < 24,
  },
  {
    key: "visitantes",
    label: "Visitantes",
    caption: "Primeiro contato nas últimas 24h",
    gradient: "linear-gradient(135deg, oklch(0.60 0.22 300) 0%, oklch(0.75 0.17 340) 100%)",
    match: ({ lead }, now) => now - new Date(lead.createdAt).getTime() < DAY,
  },
  {
    key: "fieis",
    label: "Fiéis",
    caption: "Já compraram e voltaram",
    gradient: "linear-gradient(120deg, oklch(0.70 0.19 145) 0%, oklch(0.78 0.16 195) 100%)",
    match: ({ history }, now) => {
      const tier = classifyCustomer(history, now).tier;
      return tier === "fiel" || tier === "cliente";
    },
  },
];

export interface StatSnapshot extends StatDefinition {
  count: number;
}

export function computeStats(subjects: StatSubject[], now = Date.now()): StatSnapshot[] {
  return STAT_DEFINITIONS.map((def) => ({
    ...def,
    count: subjects.reduce((n, s) => (def.match(s, now) ? n + 1 : n), 0),
  }));
}
