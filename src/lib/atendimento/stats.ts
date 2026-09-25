// Métricas do carrossel da tela de atendimento.
//
// Cada métrica é um cartão escuro que (a) mostra um número e (b) sabe
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

/** Base quase preta dos cartões. */
const NIGHT = "#07070b";

/**
 * Compõe focos de luz coloridos sobre a base preta.
 *
 * A cor entra sempre por último: no atalho `background` só a camada final
 * pode carregar cor, e uma cor no começo invalida a declaração inteira —
 * o cartão fica transparente, sem erro nenhum no console.
 */
function night(...glows: string[]): string {
  return [...glows, NIGHT].join(", ");
}

export const STAT_DEFINITIONS: StatDefinition[] = [
  {
    key: "aguardando",
    label: "Aguardando",
    caption: "Cliente falou e ninguém respondeu",
    gradient: night(
      "radial-gradient(120% 95% at 50% 122%, rgba(255,146,54,0.50), rgba(214,84,26,0.18) 38%, transparent 68%)",
      "radial-gradient(70% 60% at 10% 2%, rgba(255,178,104,0.10), transparent 58%)",
    ),
    match: ({ conversation }) => conversation.awaitingReply,
  },
  {
    key: "orcamentos",
    label: "Orçamentos",
    caption: "Propostas em aberto na mesa",
    gradient: night(
      "radial-gradient(95% 130% at 108% 50%, rgba(78,96,255,0.55), rgba(44,52,186,0.20) 40%, transparent 72%)",
      "radial-gradient(72% 92% at -10% 94%, rgba(150,88,255,0.26), transparent 62%)",
    ),
    match: ({ lead }) =>
      !!lead.estimatedValue && lead.status !== "perdido" && lead.status !== "fechado",
  },
  {
    key: "quentes",
    label: "Quentes",
    caption: "Prontos para receber o contrato",
    gradient: night(
      "radial-gradient(110% 100% at 50% 124%, rgba(255,28,112,0.56), rgba(176,14,78,0.22) 40%, transparent 70%)",
    ),
    match: ({ lead, conversation }) =>
      conversation.leadTemperature === "quente" ||
      conversation.leadReadyToClose === true ||
      lead.status === "quente",
  },
  {
    key: "inativos",
    label: "Inativos",
    caption: "Sem troca de mensagem há mais de 48h",
    gradient: night(
      "radial-gradient(115% 95% at 50% 122%, rgba(122,138,174,0.34), rgba(72,84,112,0.12) 42%, transparent 70%)",
    ),
    match: ({ conversation }, now) =>
      hoursSince(conversation.lastMessageAt, now) >= 48 && conversation.awaitingReply,
  },
  {
    key: "online",
    label: "Online",
    caption: "Janela de 24h ainda aberta",
    gradient: night(
      "radial-gradient(100% 125% at 106% 76%, rgba(38,214,190,0.42), rgba(18,132,150,0.16) 42%, transparent 72%)",
      "radial-gradient(70% 80% at -8% 6%, rgba(66,112,255,0.20), transparent 60%)",
    ),
    match: ({ conversation }, now) => hoursSince(conversation.lastMessageAt, now) < 24,
  },
  {
    key: "visitantes",
    label: "Visitantes",
    caption: "Primeiro contato nas últimas 24h",
    gradient: night(
      "radial-gradient(88% 118% at -8% 20%, rgba(160,96,255,0.58), rgba(92,38,206,0.22) 38%, transparent 70%)",
      "radial-gradient(62% 72% at 110% 104%, rgba(124,62,224,0.20), transparent 64%)",
    ),
    match: ({ lead }, now) => now - new Date(lead.createdAt).getTime() < DAY,
  },
  {
    key: "fieis",
    label: "Fiéis",
    caption: "Já compraram e voltaram",
    gradient: night(
      "radial-gradient(98% 112% at 6% 110%, rgba(255,192,96,0.42), rgba(186,118,38,0.16) 40%, transparent 70%)",
      "radial-gradient(70% 72% at 106% 2%, rgba(255,118,158,0.16), transparent 62%)",
    ),
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
