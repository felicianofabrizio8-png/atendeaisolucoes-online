// ============================================================================
// SalesIntelligenceScoring — heurísticas determinísticas (0-100).
// Puro: recebe dados agregados do lead/quote/followup e devolve score + motivo.
// Não usa PII nem conteúdo de mensagens.
// ============================================================================

import type {
  SalesConfidence,
  SalesOpportunity,
  SalesOpportunityKind,
  SalesPriority,
} from "./SalesIntelligenceTypes";

export interface LeadFacts {
  id: string;
  name: string;
  status: string;                       // enum lead_status
  temperature: string | null;           // quente|morno|frio|null
  leadScore: number;                    // CRM score já calculado
  estimatedValue: number | null;
  createdAt: string;
  updatedAt: string;
  nextActionDueAt: string | null;
  nextActionLabel: string | null;
  lastActivityAt: string | null;        // max(updated_at, conversation.last_message_at)
  conversationAwaitingReply: boolean;
  conversationLastMessageAt: string | null;
  hasQuote: boolean;
  lastQuoteStatus: string | null;
  lastQuoteSentAt: string | null;
  lastQuoteValidUntil: string | null;
  pendingFollowups: number;
  lastFollowupSentAt: string | null;
}

const DAY = 86_400_000;
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const daysBetween = (iso: string | null, now: number): number | null =>
  iso ? Math.max(0, (now - new Date(iso).getTime()) / DAY) : null;

function priorityFrom(score: number): SalesPriority {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function confidenceFrom(f: LeadFacts): SalesConfidence {
  const signals =
    (f.hasQuote ? 1 : 0) +
    (f.temperature ? 1 : 0) +
    (f.leadScore > 0 ? 1 : 0) +
    (f.lastActivityAt ? 1 : 0);
  if (signals >= 3) return "high";
  if (signals === 2) return "medium";
  return "low";
}

interface ScoreResult {
  score: number;
  kind: SalesOpportunityKind;
  reason: string;
  nextAction: string;
}

export function classifyLead(f: LeadFacts, now: number): ScoreResult | null {
  // Descarta o que não é oportunidade ativa.
  if (f.status === "fechado" || f.status === "perdido") return null;

  const daysSinceActivity = daysBetween(f.lastActivityAt, now);
  const daysSinceQuote = daysBetween(f.lastQuoteSentAt, now);
  const daysToQuoteExpiry = daysBetween(f.lastQuoteValidUntil, now);

  // ---- Regra 1: orçamento próximo de expirar --------------------------------
  const validUntilTs = f.lastQuoteValidUntil ? new Date(f.lastQuoteValidUntil).getTime() : null;
  const daysUntilExpiry = validUntilTs !== null ? (validUntilTs - now) / DAY : null;

  if (
    f.hasQuote &&
    (f.lastQuoteStatus === "enviado" || f.lastQuoteStatus === "visualizado") &&
    daysUntilExpiry !== null &&
    daysUntilExpiry >= 0 &&
    daysUntilExpiry <= 3
  ) {
    const score = clamp(75 + (3 - daysUntilExpiry) * 5);
    return {
      score,
      kind: "quote_at_risk",
      reason: `Orçamento ${f.lastQuoteStatus} expira em ${Math.ceil(daysUntilExpiry)} dia(s) e ainda não foi aceito.`,
      nextAction: "Ligar hoje para reforçar a proposta antes do vencimento.",
    };
  }

  // ---- Regra 2: orçamento enviado sem resposta ------------------------------
  if (
    f.hasQuote &&
    (f.lastQuoteStatus === "enviado" || f.lastQuoteStatus === "visualizado") &&
    daysSinceQuote !== null
  ) {
    if (daysSinceQuote >= 2 && daysSinceQuote <= 14) {
      const base = f.lastQuoteStatus === "visualizado" ? 68 : 55;
      const score = clamp(base + Math.min(daysSinceQuote * 2, 20));
      return {
        score,
        kind: "quote_pending",
        reason: `Orçamento ${f.lastQuoteStatus} há ${Math.round(daysSinceQuote)} dia(s) sem retorno do cliente.`,
        nextAction:
          f.lastQuoteStatus === "visualizado"
            ? "Enviar follow-up personalizado — cliente já abriu o orçamento."
            : "Enviar follow-up confirmando o recebimento do orçamento.",
      };
    }
    if (daysSinceQuote > 14) {
      return {
        score: 35,
        kind: "quote_pending",
        reason: `Orçamento parado há ${Math.round(daysSinceQuote)} dias sem interação.`,
        nextAction: "Tentar contato final ou marcar como perdido.",
      };
    }
  }

  // ---- Regra 3: lead quente / pronto para fechar ----------------------------
  if (f.temperature === "quente" || f.status === "quente") {
    const score = clamp(70 + Math.min(f.leadScore / 10, 20));
    return {
      score,
      kind: "hot_lead",
      reason: f.hasQuote
        ? "Lead marcado como QUENTE com orçamento em andamento."
        : "Lead marcado como QUENTE — indicativo de intenção real de compra.",
      nextAction: f.hasQuote ? "Ligar hoje para fechar." : "Enviar proposta agora.",
    };
  }

  // ---- Regra 4: aguardando resposta da equipe --------------------------------
  if (f.conversationAwaitingReply && f.conversationLastMessageAt) {
    const waitingDays = daysBetween(f.conversationLastMessageAt, now) ?? 0;
    if (waitingDays >= 0.5) {
      const score = clamp(50 + Math.min(waitingDays * 8, 30));
      return {
        score,
        kind: "no_response",
        reason: `Cliente aguarda resposta da equipe há ${waitingDays < 1 ? "menos de 1 dia" : `${Math.round(waitingDays)} dia(s)`}.`,
        nextAction: "Responder ainda hoje — cliente aguardando.",
      };
    }
  }

  // ---- Regra 5: follow-up agendado / esquecido -------------------------------
  if (f.nextActionDueAt) {
    const overdueDays = (now - new Date(f.nextActionDueAt).getTime()) / DAY;
    if (overdueDays >= 0) {
      const score = clamp(55 + Math.min(overdueDays * 6, 25));
      return {
        score,
        kind: "awaiting_followup",
        reason: `Ação agendada${f.nextActionLabel ? ` ("${f.nextActionLabel}")` : ""} está atrasada há ${Math.max(1, Math.round(overdueDays))} dia(s).`,
        nextAction: "Executar a ação agendada hoje.",
      };
    }
    if (overdueDays > -1) {
      return {
        score: 45,
        kind: "awaiting_followup",
        reason: "Ação agendada vence nas próximas 24h.",
        nextAction: "Programar contato para hoje.",
      };
    }
  }

  // ---- Regra 6: reengajamento após inatividade -------------------------------
  if (
    (f.temperature === "morno" || f.status === "morno") &&
    daysSinceActivity !== null &&
    daysSinceActivity < 3
  ) {
    return {
      score: 55,
      kind: "reengagement",
      reason: "Lead morno voltou a interagir nos últimos dias.",
      nextAction: "Aproveitar o momento e enviar oferta específica.",
    };
  }

  // ---- Regra 7: lead esquecido -----------------------------------------------
  if (daysSinceActivity !== null && daysSinceActivity >= 7 && daysSinceActivity <= 30) {
    const score = clamp(25 + Math.min((daysSinceActivity - 7) * 1.5, 20));
    return {
      score,
      kind: "forgotten_lead",
      reason: `Sem contato há ${Math.round(daysSinceActivity)} dias — risco de esfriar de vez.`,
      nextAction: "Enviar follow-up ou aguardar retorno programado.",
    };
  }

  return null;
}

export function buildOpportunity(f: LeadFacts, now: number): SalesOpportunity | null {
  const c = classifyLead(f, now);
  if (!c) return null;
  const priority = priorityFrom(c.score);
  const confidence = confidenceFrom(f);
  const daysSinceLastActivity = daysBetween(f.lastActivityAt, now);
  const daysSinceQuote = daysBetween(f.lastQuoteSentAt, now);
  return {
    id: f.id,
    leadRef: f.id.slice(0, 8),
    leadName: f.name,
    kind: c.kind,
    priority,
    score: c.score,
    confidence,
    reason: c.reason,
    nextAction: c.nextAction,
    meta: {
      status: f.status,
      temperature: f.temperature,
      estimatedValue: f.estimatedValue,
      daysSinceLastActivity:
        daysSinceLastActivity !== null ? Math.round(daysSinceLastActivity) : null,
      hasQuote: f.hasQuote,
      lastQuoteStatus: f.lastQuoteStatus,
      daysSinceQuote: daysSinceQuote !== null ? Math.round(daysSinceQuote) : null,
    },
  };
}

export const PRIORITY_ORDER: Record<SalesPriority, number> = { high: 0, medium: 1, low: 2 };
