// Recovery Score — 0 a 100, composto e explicável.
//
// Decisões de projeto:
//  · NUNCA um único critério decide. O score é uma soma de fatores com pesos
//    limitados; nenhum fator isolado passa de 22 pontos.
//  · Todo fator que entra na conta produz um `RecoveryFactor` com texto em
//    pt-BR. A explicação não é gerada depois — ela É o cálculo.
//  · Função pura: mesmos sinais + mesmo `now` ⇒ mesmo resultado.

import { classifyRecoveryState, stalledDays, stalledHoursOf } from "./classify";
import {
  DAY_MS,
  type RecoveryFactor,
  type RecoverySnapshot,
  type RecoveryState,
  type RecoveryTier,
} from "./types";

export interface ScoreResult {
  score: number;
  tier: RecoveryTier;
  factors: RecoveryFactor[];
  explanation: string;
}

const BASE_BY_STATE: Record<RecoveryState, number> = {
  aguardando_retorno_orcamento: 34,
  aguardando_orcamento: 30,
  aguardando_retorno_visita: 28,
  aguardando_vendedor: 26,
  aguardando_cliente: 18,
  aguardando_visita: 12,
  lead_parado: 16,
  abandonado: 10,
  ativo: 6,
  perdido: 4,
  encerrado: 0,
};

const STATE_REASON: Record<RecoveryState, string> = {
  aguardando_retorno_orcamento: "orçamento enviado e ainda sem retorno",
  aguardando_orcamento: "cliente aguarda o orçamento da equipe",
  aguardando_retorno_visita: "visita já ocorreu e falta desfecho",
  aguardando_vendedor: "cliente falou por último e ninguém respondeu",
  aguardando_cliente: "cliente não respondeu o último contato",
  aguardando_visita: "visita agendada, negociação em espera",
  lead_parado: "negociação parada sem etapa definida",
  abandonado: "silêncio prolongado do cliente",
  ativo: "conversa ainda ativa",
  perdido: "lead marcado como perdido",
  encerrado: "atendimento encerrado",
};

/** Faixa de tempo parado — janela ideal de recuperação é 1 a 7 dias. */
function stalledFactor(hours: number): RecoveryFactor {
  const days = stalledDays(hours);
  if (hours < 24) {
    return { key: "tempo_parado", label: "Parado há menos de 1 dia", points: 2 };
  }
  if (days <= 3) {
    return { key: "tempo_parado", label: `Parado há ${days}d — janela ideal de retomada`, points: 18 };
  }
  if (days <= 7) {
    return { key: "tempo_parado", label: `Parado há ${days}d — ainda recente`, points: 14 };
  }
  if (days <= 21) {
    return { key: "tempo_parado", label: `Parado há ${days}d — esfriando`, points: 8 };
  }
  return { key: "tempo_parado", label: `Parado há ${days}d — muito frio`, points: 2 };
}

function valueFactor(value: number | null): RecoveryFactor | null {
  if (!value || value <= 0) return null;
  if (value >= 30000) {
    return { key: "valor", label: `Ticket alto (R$ ${Math.round(value).toLocaleString("pt-BR")})`, points: 16 };
  }
  if (value >= 10000) {
    return { key: "valor", label: `Ticket relevante (R$ ${Math.round(value).toLocaleString("pt-BR")})`, points: 10 };
  }
  return { key: "valor", label: `Ticket estimado R$ ${Math.round(value).toLocaleString("pt-BR")}`, points: 5 };
}

function temperatureFactor(temp: string | null, status: string): RecoveryFactor | null {
  const t = (temp ?? "").toLowerCase();
  if (t === "quente" || status === "quente") {
    return { key: "temperatura", label: "Lead quente no último contato", points: 14 };
  }
  if (t === "morno") return { key: "temperatura", label: "Lead morno", points: 7 };
  if (t === "frio" || status === "frio") {
    return { key: "temperatura", label: "Lead frio", points: -6 };
  }
  return null;
}

function engagementFactor(snap: RecoverySnapshot): RecoveryFactor | null {
  if (snap.messageCount >= 20) {
    return { key: "engajamento", label: `Conversa longa (${snap.messageCount} mensagens)`, points: 12 };
  }
  if (snap.messageCount >= 8) {
    return { key: "engajamento", label: `Bom engajamento (${snap.messageCount} mensagens)`, points: 8 };
  }
  if (snap.messageCount <= 2) {
    return { key: "engajamento", label: "Contato raso (poucas mensagens)", points: -5 };
  }
  return null;
}

function quoteFactor(snap: RecoverySnapshot): RecoveryFactor | null {
  if (!snap.quote?.sentAt) return null;
  if (snap.quote.viewedAt) {
    return { key: "orcamento", label: "Cliente visualizou o orçamento", points: 15 };
  }
  return { key: "orcamento", label: "Orçamento enviado, sem visualização registrada", points: 8 };
}

function negotiationFactor(snap: RecoverySnapshot, now: number): RecoveryFactor | null {
  if (!snap.firstMessageAt) return null;
  const t = new Date(snap.firstMessageAt).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((now - t) / DAY_MS);
  if (days >= 90) {
    return { key: "ciclo", label: `Negociação arrastada (${days}d desde o 1º contato)`, points: -8 };
  }
  if (days >= 7) {
    return { key: "ciclo", label: `Relacionamento construído (${days}d de negociação)`, points: 6 };
  }
  return null;
}

function sourceFactor(source: string | null): RecoveryFactor | null {
  const s = (source ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("indica")) return { key: "origem", label: "Origem: indicação", points: 10 };
  if (s.includes("ads") || s.includes("meta") || s.includes("anuncio")) {
    return { key: "origem", label: "Origem: anúncio pago (custo já investido)", points: 7 };
  }
  if (s.includes("organic") || s.includes("site")) {
    return { key: "origem", label: "Origem: busca/site", points: 4 };
  }
  return null;
}

function followUpFactor(snap: RecoverySnapshot): RecoveryFactor | null {
  if (!snap.lastFollowUpAt) return null;
  if (snap.followUpResponded) {
    return { key: "followup", label: "Já respondeu a um follow-up anterior", points: 9 };
  }
  return { key: "followup", label: "Follow-up anterior sem resposta", points: -7 };
}

function coachFactor(snap: RecoverySnapshot): RecoveryFactor | null {
  if (snap.coachUrgency === "critical") {
    return { key: "coach", label: "Coach classificou como urgência crítica", points: 12 };
  }
  if (snap.coachUrgency === "high") {
    return { key: "coach", label: "Coach classificou como urgência alta", points: 8 };
  }
  if (typeof snap.coachRiskScore === "number" && snap.coachRiskScore >= 70) {
    return { key: "coach", label: `Coach aponta risco alto de perda (${snap.coachRiskScore})`, points: 7 };
  }
  return null;
}

function reactivationFactor(snap: RecoverySnapshot): RecoveryFactor | null {
  if (!snap.reactivatedAt) return null;
  return { key: "historico", label: "Já foi reativado antes com sucesso", points: 6 };
}

export function scoreToTier(score: number): RecoveryTier {
  if (score >= 80) return "muito_alta";
  if (score >= 60) return "alta";
  if (score >= 40) return "media";
  if (score >= 20) return "baixa";
  return "muito_baixa";
}

export const TIER_LABEL: Record<RecoveryTier, string> = {
  muito_alta: "Muito alta",
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
  muito_baixa: "Muito baixa",
};

/**
 * Calcula o Recovery Score composto.
 *
 * @param snap  snapshot de UM lead (já isolado por empresa na leitura)
 * @param now   instante de referência, injetado para reprodutibilidade
 */
export function computeRecoveryScore(snap: RecoverySnapshot, now: number): ScoreResult {
  const state = classifyRecoveryState(snap, now);
  const hours = stalledHoursOf(snap, now);

  const factors: RecoveryFactor[] = [
    { key: "estado", label: `Situação: ${STATE_REASON[state]}`, points: BASE_BY_STATE[state] },
    stalledFactor(hours),
  ];

  for (const f of [
    valueFactor(snap.estimatedValue),
    temperatureFactor(snap.temperature, snap.leadStatus),
    engagementFactor(snap),
    quoteFactor(snap),
    negotiationFactor(snap, now),
    sourceFactor(snap.source),
    followUpFactor(snap),
    coachFactor(snap),
    reactivationFactor(snap),
  ]) {
    if (f) factors.push(f);
  }

  if (state === "perdido") {
    factors.push({ key: "perdido", label: "Lead marcado como perdido pela equipe", points: -25 });
  }
  // Venda concluída não é recuperação: nenhum sinal positivo (ticket alto,
  // lead quente, conversa longa) deve reerguer a nota. Por isso o teto duro,
  // e não apenas um fator negativo somado.
  const ENCERRADO_CAP = 10;
  if (state === "encerrado") {
    factors.push({ key: "encerrado", label: "Venda já concluída — nada a recuperar", points: -40 });
  }

  const raw = factors.reduce((sum, f) => sum + f.points, 0);
  const ceiling = state === "encerrado" ? ENCERRADO_CAP : 100;
  const score = Math.max(0, Math.min(ceiling, Math.round(raw)));

  // Explicação = os 3 fatores positivos de maior peso, em linguagem de vendas.
  const top = factors
    .filter((f) => f.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((f) => f.label.toLowerCase());
  const explanation =
    top.length > 0
      ? `Prioridade ${TIER_LABEL[scoreToTier(score)].toLowerCase()} porque ${top.join("; ")}.`
      : `Prioridade ${TIER_LABEL[scoreToTier(score)].toLowerCase()}: nenhum sinal relevante de recuperação.`;

  return { score, tier: scoreToTier(score), factors, explanation };
}
