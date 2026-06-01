// Tipos compartilhados do app. Sem dados mockados — todos os dados reais vêm
// do Supabase via leadRepo. Os arrays vazios existem apenas para compatibilidade
// com imports antigos do projeto.

export type Channel = "whatsapp" | "instagram" | "facebook";
export type LeadStatus = "novo" | "aguardando" | "quente" | "morno" | "frio" | "fechado" | "perdido";
export type MessageRole = "lead" | "agent" | "system";

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  text: string;
  at: string; // ISO
  sourceSubtype?: string;
  sourceMetadata?: Record<string, unknown>;
}

export interface NextAction {
  label: string;
  dueAt: string; // ISO
}

export interface Lead {
  id: string;
  name: string;
  phone?: string;
  handle?: string;
  channel: Channel;
  status: LeadStatus;
  tags: string[];
  estimatedValue?: number; // BRL
  product?: string;
  nextAction?: NextAction;
  assignedTo?: string;
  createdAt: string;
  closedAt?: string;
  closedValue?: number;
  lostAt?: string;
  lossReason?: string;
}

export interface Conversation {
  id: string;
  leadId: string;
  channel: Channel;
  lastMessageAt: string;
  unread: number;
  awaitingReply: boolean;
  slaBreached: boolean;
  interactionType?: "direct_message" | "comment";
  // Qualificação IA (Fase 2)
  aiStatus?: string | null;
  aiHandling?: boolean;
  detectedCity?: string | null;
  detectedState?: string | null;
  detectedPoolSize?: string | null;
  detectedIntent?: string | null;
  detectedInterest?: string | null;
  detectedBudget?: string | null;
  purchaseTiming?: string | null;
  customerStage?: string | null;
  leadTemperature?: "frio" | "morno" | "quente" | null;
  leadScore?: number;
  leadReadyToClose?: boolean;
  detectedObjections?: string[];
}

export const leads: Lead[] = [];
export const conversations: Conversation[] = [];
export const messages: Message[] = [];

export function getLead(id: string) {
  return leads.find((l) => l.id === id);
}
export function getConversation(id: string) {
  return conversations.find((c) => c.id === id);
}
export function getMessages(conversationId: string) {
  return messages
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => +new Date(a.at) - +new Date(b.at));
}

export function sortedConversations(): Conversation[] {
  const now = Date.now();
  const score = (c: Conversation) => {
    const lead = getLead(c.leadId);
    let s = 0;
    if (c.awaitingReply && c.slaBreached) s += 1000;
    if (c.awaitingReply) s += 500;
    if (lead?.status === "quente") s += 300;
    if (lead?.nextAction && new Date(lead.nextAction.dueAt).getTime() < now) s += 200;
    if (lead?.status === "novo") s += 100;
    s += -(now - new Date(c.lastMessageAt).getTime()) / 60_000 / 1000;
    return s;
  };
  return [...conversations].sort((a, b) => score(b) - score(a));
}

export function dashboardSummary() {
  const noResponse = conversations.filter((c) => c.awaitingReply).length;
  const hot = leads.filter((l) => l.status === "quente").length;
  const followUpsToday = leads.filter(
    (l) => l.nextAction && new Date(l.nextAction.dueAt).toDateString() === new Date().toDateString()
  ).length;
  const negotiating = leads
    .filter((l) => ["quente", "morno", "aguardando", "novo"].includes(l.status))
    .reduce((sum, l) => sum + (l.estimatedValue ?? 0), 0);
  return { noResponse, hot, followUpsToday, negotiating };
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
