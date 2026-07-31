// Chance de recuperação — estimativa heurística (0–100%).
//
// Por que heurística e não IA: nesta fase a decisão precisa ser auditável,
// barata e determinística. O score diz "quem merece atenção primeiro"; a
// chance diz "qual a probabilidade realista de trazer de volta". São eixos
// diferentes — um lead de altíssimo valor pode ser prioritário mesmo com
// chance média, e o vendedor precisa ver os dois números.

import { stalledDays, stalledHoursOf } from "./classify";
import { DAY_MS, type RecoverySnapshot, type RecoveryState } from "./types";

export interface ChanceResult {
  percent: number;
  drivers: string[];
}

/** Ponto de partida por estado — probabilidade base observada no funil. */
const BASE_BY_STATE: Record<RecoveryState, number> = {
  aguardando_vendedor: 62,
  aguardando_orcamento: 58,
  aguardando_retorno_orcamento: 45,
  aguardando_retorno_visita: 48,
  aguardando_visita: 55,
  aguardando_cliente: 34,
  lead_parado: 30,
  abandonado: 15,
  ativo: 70,
  perdido: 10,
  encerrado: 5,
};

/** Decaimento pelo tempo parado — meia-vida de ~21 dias. */
function decay(hours: number): number {
  const days = stalledDays(hours);
  if (days <= 1) return 1;
  if (days <= 3) return 0.95;
  if (days <= 7) return 0.85;
  if (days <= 14) return 0.7;
  if (days <= 30) return 0.5;
  if (days <= 60) return 0.35;
  return 0.2;
}

/**
 * Estima a chance de recuperação combinando estado, tempo, histórico,
 * temperatura, engajamento e feedback de follow-ups anteriores.
 */
export function estimateRecoveryChance(
  snap: RecoverySnapshot,
  state: RecoveryState,
  now: number,
): ChanceResult {
  const hours = stalledHoursOf(snap, now);
  const drivers: string[] = [];

  let value = BASE_BY_STATE[state];
  const d = decay(hours);
  if (d < 1) drivers.push(`tempo parado reduz a chance (${stalledDays(hours)}d)`);
  value *= d;

  const temp = (snap.temperature ?? "").toLowerCase();
  if (temp === "quente" || snap.leadStatus === "quente") {
    value += 12;
    drivers.push("lead estava quente");
  } else if (temp === "frio" || snap.leadStatus === "frio") {
    value -= 10;
    drivers.push("lead estava frio");
  }

  if (snap.quote?.viewedAt) {
    value += 8;
    drivers.push("orçamento foi visualizado");
  }

  if (snap.messageCount >= 8) {
    value += 6;
    drivers.push("houve conversa consistente");
  } else if (snap.messageCount <= 2) {
    value -= 8;
    drivers.push("contato muito raso");
  }

  if (snap.reactivatedAt) {
    value += 7;
    drivers.push("já voltou depois de sumir uma vez");
  }

  if (snap.lastFollowUpAt && !snap.followUpResponded) {
    value -= 12;
    drivers.push("não respondeu ao follow-up anterior");
  } else if (snap.followUpResponded) {
    value += 6;
    drivers.push("respondeu a follow-up anterior");
  }

  const src = (snap.source ?? "").toLowerCase();
  if (src.includes("indica")) {
    value += 6;
    drivers.push("veio por indicação");
  }

  if (snap.firstMessageAt) {
    const t = new Date(snap.firstMessageAt).getTime();
    if (Number.isFinite(t) && now - t >= 90 * DAY_MS) {
      value -= 6;
      drivers.push("ciclo de negociação muito longo");
    }
  }

  const percent = Math.max(1, Math.min(95, Math.round(value)));
  if (drivers.length === 0) drivers.push("sinais neutros");
  return { percent, drivers };
}
