// Métricas do carrossel da tela de atendimento.
//
// Cada métrica é um cartão escuro com uma arte de luz própria que (a) mostra
// um número e (b) sabe filtrar a fila. Elas trocam sozinhas a cada 7s, mas
// também são clicáveis: o número vira um filtro da lista à esquerda. Um KPI
// que não leva a lugar nenhum é decoração; este leva.

import type { Conversation, Lead } from "@/data/mock";
import { classifyCustomer, type CustomerHistory } from "@/lib/customer-loyalty";
import type { FollowupCycleView } from "./followup-view";

export interface StatSubject {
  lead: Lead;
  conversation: Conversation;
  history: CustomerHistory;
  followup?: FollowupCycleView;
}

export interface StatDefinition {
  key: string;
  /** Rótulo no cartão, como nos mockups: "Orçamentos:", "Inativos:". */
  label: string;
  /** Linha de apoio, aparece abaixo do número. */
  caption: string;
  /** Arte de fundo do cartão: focos de luz desfocados sobre o preto. */
  art: ArtLayer[];
  /** Cor de destaque da métrica (ponto da pílula no celular). */
  accent: string;
  /** Predicado que define se a conversa entra nessa métrica. */
  match: (s: StatSubject, now: number) => boolean;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function hoursSince(iso: string, now: number): number {
  return (now - new Date(iso).getTime()) / HOUR;
}

/**
 * Um foco de luz da arte. Posição pelo centro, em % do cartão; tamanho em
 * qualquer unidade CSS. `ring` desenha um anel (borda) em vez de um disco —
 * é o que dá os arcos e anéis das referências da marca.
 */
export interface ArtLayer {
  x: number;
  y: number;
  w: string;
  h: string;
  color: string;
  blur: number;
  opacity: number;
  ring?: number;
  rotate?: number;
}

const L = (
  x: number,
  y: number,
  w: string,
  h: string,
  color: string,
  blur: number,
  opacity: number,
  extra: Pick<ArtLayer, "ring" | "rotate"> = {},
): ArtLayer => ({ x, y, w, h, color, blur, opacity, ...extra });

// Paleta da Lume: violeta, orquídea, lilás e o índigo dos gráficos.
const VIOLET = "#7731e7";
const ORCHID = "#c352ff";
const LILAC = "#b594ff";
const INDIGO = "#4652f2";
const ROSE = "#ff5fc8";

export const STAT_DEFINITIONS: StatDefinition[] = [
  {
    key: "followup_overdue",
    label: "Follow-ups vencidos",
    caption: "Precisam de atenção agora",
    accent: ROSE,
    art: [
      L(62, 118, "150%", "110%", ORCHID, 34, 0.85),
      L(70, 112, "95%", "70%", ROSE, 28, 0.7),
      L(72, 104, "48%", "34%", "#ffe4f6", 20, 0.9),
      L(96, 0, "60%", "70%", VIOLET, 40, 0.45),
    ],
    match: ({ followup }) => followup?.bucket === "overdue",
  },
  {
    key: "followup_upcoming",
    label: "Próximos",
    caption: "Contato futuro programado",
    accent: INDIGO,
    art: [
      L(60, 120, "150%", "110%", INDIGO, 34, 0.9),
      L(66, 112, "90%", "66%", "#7d8cff", 26, 0.7),
      L(68, 104, "44%", "30%", "#e6ecff", 20, 0.85),
      L(0, 10, "55%", "70%", VIOLET, 44, 0.4),
    ],
    match: ({ followup }) => followup?.bucket === "upcoming",
  },
  {
    key: "aguardando",
    label: "Aguardando",
    caption: "Cliente falou e ninguém respondeu",
    accent: ORCHID,
    art: [
      L(100, 104, "110%", "150%", VIOLET, 36, 0.9),
      L(96, 100, "70%", "96%", ORCHID, 28, 0.85),
      L(98, 98, "28%", "40%", "#f4e8ff", 18, 0.8),
      L(8, 0, "40%", "50%", LILAC, 40, 0.22),
    ],
    match: ({ conversation }) => conversation.awaitingReply,
  },
  {
    key: "orcamentos",
    label: "Orçamentos",
    caption: "Propostas em aberto na mesa",
    accent: LILAC,
    art: [
      L(80, 78, "190px", "190px", LILAC, 10, 0.95, { ring: 16 }),
      L(80, 78, "150px", "150px", VIOLET, 30, 0.55),
      L(78, 60, "60px", "40px", "#ffffff", 22, 0.35),
      L(30, 110, "90%", "60%", INDIGO, 40, 0.35),
    ],
    match: ({ lead }) =>
      !!lead.estimatedValue && lead.status !== "perdido" && lead.status !== "fechado",
  },
  {
    key: "quentes",
    label: "Quentes",
    caption: "Prontos para receber o contrato",
    accent: ROSE,
    art: [
      L(18, 150, "340px", "340px", ORCHID, 14, 0.95, { ring: 26 }),
      L(18, 150, "300px", "300px", "#ff8ae0", 8, 0.6, { ring: 8 }),
      L(98, 6, "60%", "80%", ORCHID, 40, 0.4),
      L(62, 34, "30%", "40%", VIOLET, 36, 0.4),
    ],
    match: ({ lead, conversation }) =>
      conversation.leadTemperature === "quente" ||
      conversation.leadReadyToClose === true ||
      lead.status === "quente",
  },
  {
    key: "inativos",
    label: "Inativos",
    caption: "Sem troca de mensagem há mais de 48h",
    accent: "#8f86c8",
    art: [
      L(50, -10, "140%", "80%", LILAC, 44, 0.26),
      L(70, 120, "130%", "90%", "#4a3a9a", 36, 0.8),
      L(78, 112, "56%", "44%", "#a49ae0", 28, 0.45),
    ],
    match: ({ conversation }, now) =>
      hoursSince(conversation.lastMessageAt, now) >= 48 && conversation.awaitingReply,
  },
  {
    key: "online",
    label: "Online",
    caption: "Janela de 24h ainda aberta",
    accent: INDIGO,
    art: [
      L(104, 48, "210px", "210px", "#8c9bff", 12, 0.95, { ring: 18 }),
      L(104, 48, "170px", "170px", INDIGO, 34, 0.6),
      L(86, 40, "40px", "60px", "#e6ecff", 20, 0.4),
      L(10, 0, "50%", "60%", VIOLET, 44, 0.35),
    ],
    match: ({ conversation }, now) => hoursSince(conversation.lastMessageAt, now) < 24,
  },
  {
    key: "visitantes",
    label: "Visitantes",
    caption: "Primeiro contato nas últimas 24h",
    accent: VIOLET,
    art: [
      L(42, 100, "16%", "150%", VIOLET, 18, 0.9, { rotate: -8 }),
      L(58, 96, "14%", "140%", LILAC, 16, 0.85, { rotate: 6 }),
      L(74, 102, "16%", "150%", ORCHID, 18, 0.8, { rotate: 14 }),
      L(58, 112, "80%", "40%", "#f1e9ff", 22, 0.85),
      L(58, 120, "140%", "80%", VIOLET, 34, 0.7),
    ],
    match: ({ lead }, now) => now - new Date(lead.createdAt).getTime() < DAY,
  },
  {
    key: "fieis",
    label: "Fiéis",
    caption: "Já compraram e voltaram",
    accent: LILAC,
    art: [
      L(78, 44, "6px", "90px", "#ffffff", 3, 0.95),
      L(78, 44, "90px", "6px", "#ffffff", 3, 0.95),
      L(78, 44, "40px", "40px", "#e9dcff", 12, 0.8),
      L(78, 44, "150px", "150px", LILAC, 36, 0.45),
      L(40, 124, "150%", "80%", VIOLET, 36, 0.75),
      L(90, 120, "70%", "60%", ORCHID, 32, 0.6),
    ],
    match: ({ history }, now) => {
      const tier = classifyCustomer(history, now).tier;
      return tier === "fiel" || tier === "cliente";
    },
  },
];

export interface StatSnapshot extends StatDefinition {
  count: number;
}

export function computeStats(
  subjects: StatSubject[],
  now = Date.now(),
  followupByConversation?: ReadonlyMap<string, FollowupCycleView>,
): StatSnapshot[] {
  return STAT_DEFINITIONS.map((def) => ({
    ...def,
    count: subjects.reduce((n, subject) => {
      const s = followupByConversation
        ? { ...subject, followup: followupByConversation.get(subject.conversation.id) }
        : subject;
      return def.match(s, now) ? n + 1 : n;
    }, 0),
  }));
}
