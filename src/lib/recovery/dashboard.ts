// Cards do Dashboard Recovery — agregação pura sobre a fila já calculada.
// Nenhuma consulta adicional: o painel é derivado dos mesmos itens da lista,
// então número do card e linha da lista nunca divergem.

import type { RecoveryAssessment, RecoveryQueueItem } from "./types";
import { DAY_MS } from "./types";

export interface RecoveryDashboardCards {
  /** Leads que voltaram a interagir nas últimas 24h. */
  recoveredToday: number;
  windowOpen: number;
  windowClosed: number;
  highPriority: number;
  recovered: number;
  pending: number;
  lost: number;
  /** Soma do valor estimado em jogo na fila. */
  pipelineValue: number;
}

export function buildDashboardCards(
  queue: RecoveryQueueItem[],
  all: RecoveryAssessment[],
  now: number,
): RecoveryDashboardCards {
  let recoveredToday = 0;
  let windowOpen = 0;
  let windowClosed = 0;
  let highPriority = 0;
  let recovered = 0;
  let pending = 0;
  let lost = 0;
  let pipelineValue = 0;

  for (const item of queue) {
    if (item.window.state === "open" || item.window.state === "closing_soon") windowOpen += 1;
    else if (item.window.state === "closed" || item.window.state === "never_opened") windowClosed += 1;

    if (item.tier === "muito_alta" || item.tier === "alta") highPriority += 1;
    if (item.state === "perdido") lost += 1;
    else pending += 1;

    pipelineValue += item.estimatedValue ?? 0;
  }

  for (const a of all) {
    if (a.state === "encerrado") recovered += 1;
    const last = a.lastInteractionAt ? new Date(a.lastInteractionAt).getTime() : NaN;
    if (Number.isFinite(last) && now - last <= DAY_MS) recoveredToday += 1;
  }

  return {
    recoveredToday,
    windowOpen,
    windowClosed,
    highPriority,
    recovered,
    pending,
    lost,
    pipelineValue,
  };
}
