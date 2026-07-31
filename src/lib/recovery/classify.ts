// Classificação COMPLEMENTAR do estado de recuperação.
//
// Princípio inegociável: nada aqui grava ou altera `leads.status` /
// `conversations.*`. É uma leitura derivada, calculada sob demanda, que
// convive com os estados existentes sem competir com eles.

import { DAY_MS, HOUR_MS, type RecoverySnapshot, type RecoveryState } from "./types";

/** Silêncio a partir do qual consideramos o lead "parado". */
export const STALLED_HOURS = 24;
/** Silêncio a partir do qual consideramos abandono. */
export const ABANDONED_DAYS = 14;

/** Horas desde a última mensagem de qualquer origem. */
export function stalledHoursOf(snap: RecoverySnapshot, now: number): number {
  const ref = snap.lastMessageAt ?? snap.lastInboundAt ?? snap.lastOutboundAt;
  if (!ref) return 0;
  const t = new Date(ref).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (now - t) / HOUR_MS);
}

function isInboundLast(snap: RecoverySnapshot): boolean {
  if (!snap.lastInboundAt) return false;
  if (!snap.lastOutboundAt) return true;
  return new Date(snap.lastInboundAt).getTime() > new Date(snap.lastOutboundAt).getTime();
}

/**
 * Deriva o estado de recuperação a partir do snapshot.
 *
 * A ordem das checagens importa: desfechos terminais primeiro (perdido,
 * fechado), depois compromissos concretos (visita, orçamento), e só então
 * as leituras genéricas de silêncio.
 */
export function classifyRecoveryState(
  snap: RecoverySnapshot,
  now: number,
): RecoveryState {
  if (snap.leadStatus === "perdido" || snap.lostAt) return "perdido";
  if (snap.leadStatus === "fechado" || snap.closedAt) return "encerrado";

  const stalled = stalledHoursOf(snap, now);
  const inboundLast = isInboundLast(snap);

  // Visita agendada no futuro: não é abandono, é espera legítima.
  const visitAt = snap.visit?.scheduledAt ? new Date(snap.visit.scheduledAt).getTime() : null;
  const visitPending =
    visitAt !== null &&
    Number.isFinite(visitAt) &&
    snap.visit?.status !== "cancelada" &&
    snap.visit?.status !== "concluida";
  if (visitPending && visitAt! > now) return "aguardando_visita";
  if (visitPending && visitAt! <= now && stalled >= STALLED_HOURS) {
    return "aguardando_retorno_visita";
  }

  // Orçamento enviado e sem resposta do cliente.
  if (snap.quote?.sentAt && !inboundLast && stalled >= STALLED_HOURS) {
    return "aguardando_retorno_orcamento";
  }
  // Cliente pediu e o orçamento nunca saiu — a bola está com a equipe.
  if (!snap.quote?.sentAt && inboundLast && snap.leadStatus !== "novo" && stalled >= 4) {
    return "aguardando_orcamento";
  }

  if (stalled >= ABANDONED_DAYS * 24) return "abandonado";

  if (stalled >= STALLED_HOURS) {
    return inboundLast ? "aguardando_vendedor" : "aguardando_cliente";
  }

  if (inboundLast && stalled >= 4) return "aguardando_vendedor";

  return "ativo";
}

/** Rótulo em pt-BR para exibição. */
export const STATE_LABEL: Record<RecoveryState, string> = {
  ativo: "Conversa ativa",
  aguardando_cliente: "Cliente sem resposta",
  aguardando_vendedor: "Aguardando o vendedor",
  aguardando_orcamento: "Aguardando orçamento",
  aguardando_retorno_orcamento: "Aguardando retorno do orçamento",
  aguardando_visita: "Aguardando visita",
  aguardando_retorno_visita: "Aguardando retorno pós-visita",
  lead_parado: "Lead parado",
  abandonado: "Cliente abandonado",
  encerrado: "Atendimento encerrado",
  perdido: "Cliente perdido",
};

/** Estados que não devem entrar na fila de recuperação ativa. */
export function isTerminalState(state: RecoveryState): boolean {
  return state === "encerrado";
}

/** Dias inteiros parados — usado em textos e faixas do score. */
export function stalledDays(stalledHours: number): number {
  return Math.floor((stalledHours * HOUR_MS) / DAY_MS);
}
