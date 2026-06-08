// Cálculo de "score de oportunidade" (0-100) e classificação comercial
// derivada do estado atual da conversa. Camada puramente derivada — não altera
// WhatsApp, follow-up, templates ou qualquer dado persistido. Serve apenas
// para priorização visual na Central de Oportunidades do Inbox.

import type { Conversation, Lead, Message } from "@/data/mock";
import { computeQuoteStatus, type Quote } from "@/data/quotes";
import { computeWindow } from "@/lib/whatsapp-window";

export type OpportunityTier = "quente" | "morno" | "frio";

export interface OpportunityScore {
  score: number;
  tier: OpportunityTier;
  /** Curtas razões textuais para o badge / tooltip. */
  reasons: string[];
}

const HOT_KEYWORDS = [
  "quero",
  "fechar",
  "comprar",
  "preço",
  "preco",
  "orçamento",
  "orcamento",
  "valor",
  "pagamento",
  "parcel",
  "pix",
];

function recencyPoints(lastAtIso: string, now: number): { pts: number; reason?: string } {
  const ageH = (now - new Date(lastAtIso).getTime()) / 3_600_000;
  if (ageH < 1) return { pts: 25, reason: "interação na última hora" };
  if (ageH < 6) return { pts: 22 };
  if (ageH < 24) return { pts: 18 };
  if (ageH < 72) return { pts: 10 };
  if (ageH < 168) return { pts: 4 };
  return { pts: 0, reason: "sem contato há mais de 1 semana" };
}

export interface ScoreInput {
  conv: Conversation;
  lead?: Lead;
  messages?: Message[];
  quotes?: Quote[];
  now?: number;
}

/**
 * Score 0-100 considerando: recência, volume de mensagens, pedido de
 * orçamento, interesse demonstrado, tempo sem resposta e interação recente.
 */
export function computeOpportunityScore({
  conv,
  lead,
  messages = [],
  quotes = [],
  now = Date.now(),
}: ScoreInput): OpportunityScore {
  const reasons: string[] = [];
  let score = 0;

  // 1) Recência (0-25)
  const rec = recencyPoints(conv.lastMessageAt, now);
  score += rec.pts;
  if (rec.reason) reasons.push(rec.reason);

  // 2) Volume de mensagens (0-15) — engajamento bilateral
  const total = messages.length;
  const leadMsgs = messages.filter((m) => m.role === "lead").length;
  const agentMsgs = messages.filter((m) => m.role === "agent").length;
  const engagement = Math.min(total, 30); // até 30 msgs
  score += Math.round((engagement / 30) * 15);
  if (leadMsgs >= 3 && agentMsgs >= 1) reasons.push("conversa engajada");

  // 3) Pedido de orçamento (0-25) — texto OU quote existente
  const hasQuote = quotes.length > 0;
  const askedQuote = messages.some((m) =>
    m.role === "lead" && /(or[çc]amento|valor|pre[çc]o|quanto custa)/i.test(m.text),
  );
  if (hasQuote) {
    const pendingQuote = quotes.some(
      (q) => q.status === "enviado" || q.status === "visualizado" || q.status === "pendente",
    );
    score += pendingQuote ? 25 : 18;
    reasons.push(pendingQuote ? "orçamento aguardando resposta" : "orçamento já enviado");
  } else if (askedQuote) {
    score += 15;
    reasons.push("cliente pediu orçamento");
  }

  // 4) Interesse demonstrado (0-15) — keywords + temperatura IA + readyToClose
  const lastLeadTexts = messages
    .filter((m) => m.role === "lead")
    .slice(-5)
    .map((m) => m.text.toLowerCase())
    .join(" ");
  const intentHits = HOT_KEYWORDS.filter((k) => lastLeadTexts.includes(k)).length;
  score += Math.min(intentHits * 3, 10);
  if (conv.leadReadyToClose) {
    score += 5;
    reasons.push("pronto para fechar (IA)");
  }
  const temp = conv.leadTemperature ?? (lead?.status === "quente" ? "quente" : null);
  if (temp === "quente") {
    score += 5;
    reasons.push("lead quente");
  } else if (temp === "morno") {
    score += 2;
  }

  // 5) Tempo sem resposta da equipe (0-10) — quanto mais tempo aguardando, mais urgente
  if (conv.awaitingReply) {
    const waitH = (now - new Date(conv.lastMessageAt).getTime()) / 3_600_000;
    if (waitH < 1) score += 10;
    else if (waitH < 6) score += 8;
    else if (waitH < 24) score += 5;
    else score += 2;
    if (conv.slaBreached) reasons.push("SLA estourado");
    else if (waitH >= 1) reasons.push("aguardando resposta da equipe");
  }

  // 6) Interação recente do cliente (0-10)
  const lastLead = [...messages].reverse().find((m) => m.role === "lead");
  if (lastLead) {
    const ageH = (now - new Date(lastLead.at).getTime()) / 3_600_000;
    if (ageH < 1) score += 10;
    else if (ageH < 6) score += 7;
    else if (ageH < 24) score += 4;
    else if (ageH < 72) score += 1;
  }

  // 7) Janela 24h fechando em breve impulsiona (urgência comercial)
  const windowInfo = computeWindow(conv, lead, messages, now);
  if (windowInfo.state === "closing_soon") {
    score += 5;
    reasons.push("janela fecha em breve");
  } else if (windowInfo.state === "closed") {
    score -= 5;
  }

  // 8) Penalidades
  if (lead?.status === "perdido") score -= 50;
  if (lead?.status === "fechado") score -= 30;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let tier: OpportunityTier;
  if (score >= 70) tier = "quente";
  else if (score >= 40) tier = "morno";
  else tier = "frio";

  return { score, tier, reasons };
}

export const TIER_META: Record<OpportunityTier, { emoji: string; label: string; cls: string }> = {
  quente: {
    emoji: "🟢",
    label: "Quente",
    cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
  },
  morno: {
    emoji: "🟡",
    label: "Morno",
    cls: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  },
  frio: {
    emoji: "🔴",
    label: "Frio",
    cls: "bg-[var(--status-urgent)]/10 text-[var(--status-urgent)] border-[var(--status-urgent)]/30",
  },
};
