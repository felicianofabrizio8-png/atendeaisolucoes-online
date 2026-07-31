// ============================================================================
// SHADOW MODE SOBRE A FILA VIVA (Fase 6.4) — puro.
//
// A fila de produção continua sendo a da Fase 6.1. Aqui apenas derivamos as
// mesmas features usadas no aprendizado a partir de um item já calculado,
// para conseguir comparar as duas ordens lado a lado.
// ============================================================================

import { hourBandOf, scoreBandOf, stalledBandOf, valueBandOf } from "./dataset";

/** Subconjunto de `RecoveryQueueItem` de que o shadow mode precisa. */
export interface LiveQueueLike {
  conversationId: string;
  leadName: string;
  product: string | null;
  channel: string;
  score: number;
  estimatedValue: number | null;
  stalledHours: number;
  position: number;
  window: { state: string };
  action: { requiresTemplate: boolean };
}

export function featuresOfQueueItem(
  item: LiveQueueLike,
  now: number,
): Array<{ key: string; value: string }> {
  const windowOpen = item.window.state === "open" || item.window.state === "closing_soon";
  const hour = new Date(now).getUTCHours();
  const feats: Array<{ key: string; value: string } | null> = [
    item.product ? { key: "produto", value: item.product } : null,
    { key: "faixa_score", value: scoreBandOf(item.score) },
    { key: "janela", value: windowOpen ? "aberta" : "fechada" },
    { key: "tempo_parado", value: stalledBandOf(item.stalledHours) },
    { key: "valor", value: valueBandOf(item.estimatedValue) },
    { key: "horario", value: hourBandOf(hour) },
    {
      key: "tipo_mensagem",
      value: item.action.requiresTemplate ? "template" : "livre",
    },
  ];
  return feats.filter((f): f is { key: string; value: string } => f !== null);
}
