// ============================================================================
// PriorityEngine — Serviço puramente determinístico.
// NÃO é um agente. NÃO usa LLM. NÃO gera conhecimento. NÃO chama endpoint.
// Reutiliza exclusivamente o snapshot já em memória (leadRepo, quotes,
// coach alerts) para ordenar conversas na Caixa de Atendimento.
// ============================================================================

import type { Conversation, Lead, Message, NextAction } from "@/data/mock";
import { getConversations, getLeadById, getMessagesFor } from "@/data/leadRepo";
import { quotesForLead, computeQuoteStatus, type Quote } from "@/data/quotes";
import { computePriority } from "@/lib/inbox-priority";
import { computeOpportunityScore } from "@/lib/opportunity-score";
import { computeWindow, closesToday, type WindowInfo } from "@/lib/whatsapp-window";
import type { CoachAlertLite } from "@/hooks/useCoachAlerts";

export type ActionKind =
  | "responder"
  | "enviar_orcamento"
  | "agendar_visita"
  | "cobrar_retorno"
  | "confirmar_instalacao"
  | "fechar_venda"
  | "marcar_perdido"
  | "sem_acao";

export interface PriorityFactor {
  key: string;
  label: string;
  weight: number;
}

export interface PrioritizedConversation {
  conv: Conversation;
  lead: Lead;
  last?: Message;
  messages: Message[];
  quotes: Quote[];
  window: WindowInfo;
  score: number;               // 0..1000+ (determinístico)
  reasons: string[];
  factors: PriorityFactor[];
  action: { kind: ActionKind; label: string };
  timeLeftMinutes: number | null;
  coach?: CoachAlertLite | null;
  isFavorite: boolean;
}

export interface PriorityEngineInput {
  now?: number;
  slaMinutes: number;
  coachByConv?: Map<string, CoachAlertLite[]>;
  favorites?: Set<string>;
  includeClosed?: boolean;
}

const MINUTE = 60_000;

function inferAction(lead: Lead, conv: Conversation, quotes: Quote[]): { kind: ActionKind; label: string } {
  const next = lead.nextAction?.label?.toLowerCase() ?? "";
  const hasPendingQuote = quotes.some((q) => {
    const s = computeQuoteStatus(q);
    return s === "enviado" || s === "visualizado" || s === "pendente";
  });

  if (conv.leadReadyToClose) return { kind: "fechar_venda", label: "Fechar venda" };
  if (lead.status === "perdido") return { kind: "marcar_perdido", label: "Marcado como perdido" };
  if (next.includes("visita") || next.includes("agendar")) return { kind: "agendar_visita", label: "Agendar visita" };
  if (next.includes("instalacao") || next.includes("instalação")) return { kind: "confirmar_instalacao", label: "Confirmar instalação" };
  if (next.includes("orçamento") || next.includes("orcamento")) return { kind: "enviar_orcamento", label: "Enviar orçamento" };
  if (next.includes("retorno") || next.includes("cobrar")) return { kind: "cobrar_retorno", label: "Cobrar retorno" };
  if (hasPendingQuote) return { kind: "cobrar_retorno", label: "Cobrar retorno do orçamento" };
  if (conv.awaitingReply) return { kind: "responder", label: "Responder cliente" };
  if (lead.nextAction) return { kind: "sem_acao", label: lead.nextAction.label };
  return { kind: "sem_acao", label: "Definir próxima ação" };
}

function timeLeftFromNextAction(action: NextAction | undefined, now: number): number | null {
  if (!action?.dueAt) return null;
  return Math.round((new Date(action.dueAt).getTime() - now) / MINUTE);
}

export function rankConversations(input: PriorityEngineInput): PrioritizedConversation[] {
  const now = input.now ?? Date.now();
  const slaMinutes = input.slaMinutes;
  const coachByConv = input.coachByConv ?? new Map();
  const favorites = input.favorites ?? new Set<string>();
  const out: PrioritizedConversation[] = [];

  for (const conv of getConversations()) {
    const lead = getLeadById(conv.leadId);
    if (!lead) continue;
    if (!input.includeClosed && lead.status === "fechado") continue;

    const messages = getMessagesFor(conv.id);
    const last = messages[messages.length - 1];
    const quotes = quotesForLead(lead.id);
    const window = computeWindow(conv, lead, messages, now);
    const coach = coachByConv.get(conv.id)?.[0] ?? null;

    // Reuso puro de scorers existentes — nenhum novo cálculo de IA.
    const pri = computePriority(conv, lead, slaMinutes, now);
    const opp = computeOpportunityScore({ conv, lead, messages, quotes, now });

    const factors: PriorityFactor[] = [];
    let score = pri.score + opp.score;

    if (favorites.has(conv.id)) { score += 5000; factors.push({ key: "fav", label: "Favorito", weight: 5000 }); }
    if (coach?.severity === "critical") { score += 900; factors.push({ key: "coach-crit", label: "Coach crítico", weight: 900 }); }
    else if (coach?.severity === "high") { score += 500; factors.push({ key: "coach-high", label: "Coach alerta", weight: 500 }); }
    else if (coach) { score += 200; factors.push({ key: "coach", label: "Coach", weight: 200 }); }

    const overdue = lead.nextAction && new Date(lead.nextAction.dueAt).getTime() < now;
    if (overdue) { score += 400; factors.push({ key: "overdue", label: "Follow-up vencido", weight: 400 }); }
    if (closesToday(window, now)) { score += 250; factors.push({ key: "wclose", label: "Janela fecha hoje", weight: 250 }); }
    if (window.state === "closed") { score -= 200; factors.push({ key: "wclosed", label: "Janela fechada", weight: -200 }); }

    factors.push({ key: "prio", label: "Prioridade base", weight: pri.score });
    factors.push({ key: "opp", label: "Oportunidade", weight: opp.score });

    const reasons = [...pri.alert ? [pri.alert.text] : [], ...opp.reasons];

    out.push({
      conv,
      lead,
      last,
      messages,
      quotes,
      window,
      score: Math.round(score),
      reasons,
      factors,
      action: inferAction(lead, conv, quotes),
      timeLeftMinutes: timeLeftFromNextAction(lead.nextAction, now),
      coach,
      isFavorite: favorites.has(conv.id),
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

// -------- Agregações auxiliares -------------------------------------------

export interface DayPanelStats {
  atendidosHoje: number;
  pendentes: number;
  emNegociacao: number;
  orcamentosEnviados: number;
  visitasAgendadas: number;
  vendasFechadas: number;
  perdidos: number;
}

export function computeDayPanel(items: PrioritizedConversation[], now = Date.now()): DayPanelStats {
  const today = new Date(now).toDateString();
  const stats: DayPanelStats = {
    atendidosHoje: 0, pendentes: 0, emNegociacao: 0,
    orcamentosEnviados: 0, visitasAgendadas: 0, vendasFechadas: 0, perdidos: 0,
  };
  for (const it of items) {
    const { lead, conv, quotes } = it;
    if (conv.awaitingReply) stats.pendentes += 1;
    if (["quente", "morno", "aguardando", "novo"].includes(lead.status)) stats.emNegociacao += 1;
    if (lead.status === "fechado" && lead.closedAt && new Date(lead.closedAt).toDateString() === today) stats.vendasFechadas += 1;
    if (lead.status === "perdido") stats.perdidos += 1;
    if (lead.nextAction?.label?.toLowerCase().includes("visita")) stats.visitasAgendadas += 1;
    for (const q of quotes) {
      if (q.sentAt && new Date(q.sentAt).toDateString() === today) stats.orcamentosEnviados += 1;
    }
    // "atendidos hoje" — última mensagem do agente hoje
    const lastAgent = [...it.messages].reverse().find((m) => m.role === "agent");
    if (lastAgent && new Date(lastAgent.at).toDateString() === today) stats.atendidosHoje += 1;
  }
  return stats;
}

// Grupos por tempo para a "Fila Geral"
export type TimeBucket = "hoje" | "ontem" | "7d" | "30d" | "antigos" | "perdidos" | "arquivados";

export function groupByTime(items: PrioritizedConversation[], now = Date.now()): Record<TimeBucket, PrioritizedConversation[]> {
  const out: Record<TimeBucket, PrioritizedConversation[]> = {
    hoje: [], ontem: [], "7d": [], "30d": [], antigos: [], perdidos: [], arquivados: [],
  };
  const day = 86_400_000;
  const todayStr = new Date(now).toDateString();
  const yStr = new Date(now - day).toDateString();
  for (const it of items) {
    if (it.lead.status === "perdido") { out.perdidos.push(it); continue; }
    const t = new Date(it.conv.lastMessageAt).getTime();
    const ageDays = (now - t) / day;
    const s = new Date(t).toDateString();
    if (s === todayStr) out.hoje.push(it);
    else if (s === yStr) out.ontem.push(it);
    else if (ageDays <= 7) out["7d"].push(it);
    else if (ageDays <= 30) out["30d"].push(it);
    else out.antigos.push(it);
  }
  return out;
}

// Meu Dia — tarefas a executar hoje
export function computeMyDay(items: PrioritizedConversation[], now = Date.now()) {
  const groups: Record<ActionKind, PrioritizedConversation[]> = {
    responder: [], enviar_orcamento: [], agendar_visita: [],
    cobrar_retorno: [], confirmar_instalacao: [],
    fechar_venda: [], marcar_perdido: [], sem_acao: [],
  };
  const today = new Date(now).toDateString();
  for (const it of items) {
    const due = it.lead.nextAction?.dueAt;
    const dueToday = due && new Date(due).toDateString() === today;
    const overdue = due && new Date(due).getTime() < now;
    const relevant = it.conv.awaitingReply || dueToday || overdue || it.action.kind === "fechar_venda";
    if (!relevant) continue;
    groups[it.action.kind].push(it);
  }
  return groups;
}
