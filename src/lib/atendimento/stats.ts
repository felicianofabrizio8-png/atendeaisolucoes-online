import type { Conversation, Lead } from "@/data/mock";
import { classifyCustomer, type CustomerHistory } from "@/lib/customer-loyalty";

export interface StatSubject { lead: Lead; conversation: Conversation; history: CustomerHistory; }
export interface StatDefinition {
  key: string;
  label: string;
  caption: string;
  match: (subject: StatSubject, now: number) => boolean;
}

const DAY = 86_400_000;
const hoursSince = (iso: string, now: number) => (now - new Date(iso).getTime()) / 3_600_000;

export const STAT_DEFINITIONS: StatDefinition[] = [
  { key: "aguardando", label: "Aguardando", caption: "Cliente falou e ninguém respondeu", match: ({ conversation }) => conversation.awaitingReply },
  { key: "orcamentos", label: "Orçamentos", caption: "Propostas em aberto", match: ({ lead }) => !!lead.estimatedValue && !["perdido", "fechado"].includes(lead.status) },
  { key: "quentes", label: "Quentes", caption: "Prontos para atenção", match: ({ lead, conversation }) => conversation.leadTemperature === "quente" || conversation.leadReadyToClose === true || lead.status === "quente" },
  { key: "inativos", label: "Inativos", caption: "Sem troca há mais de 48h", match: ({ conversation }, now) => hoursSince(conversation.lastMessageAt, now) >= 48 && conversation.awaitingReply },
  { key: "online", label: "Online", caption: "Janela de 24h aberta", match: ({ conversation }, now) => hoursSince(conversation.lastMessageAt, now) < 24 },
  { key: "visitantes", label: "Visitantes", caption: "Primeiro contato recente", match: ({ lead }, now) => now - new Date(lead.createdAt).getTime() < DAY },
  { key: "fieis", label: "Fiéis", caption: "Já compraram e voltaram", match: ({ history }, now) => ["fiel", "cliente"].includes(classifyCustomer(history, now).tier) },
];

export interface StatSnapshot extends StatDefinition { count: number; }

export function computeStats(subjects: StatSubject[], now = Date.now()): StatSnapshot[] {
  return STAT_DEFINITIONS.map((definition) => ({ ...definition, count: subjects.reduce((count, subject) => count + (definition.match(subject, now) ? 1 : 0), 0) }));
}
