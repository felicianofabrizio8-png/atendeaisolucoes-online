// ============================================================================
// SHADOW RANKING (Fase 6.4) — puro.
//
// Reordena uma cópia da fila usando o shadow score e mede a divergência
// contra a ordem real. A fila de produção NÃO é tocada: a função recebe um
// array e devolve um relatório.
// ============================================================================

import { spearman, round2 } from "./stats";
import { shadowScore, type ShadowModel } from "./shadow-score";
import type { ShadowRankingMove, ShadowRankingResult } from "./types";

export interface RankingItem {
  conversationId: string;
  leadName: string;
  score: number;
  position: number;
  features: Array<{ key: string; value: string }>;
}

export function buildShadowRanking(
  model: ShadowModel,
  items: RankingItem[],
  topN = 5,
): ShadowRankingResult {
  if (items.length === 0) {
    return {
      totalItems: 0,
      changedItems: 0,
      changeRatio: 0,
      spearman: 1,
      wouldRiseTop: [],
      wouldFallTop: [],
    };
  }

  const scored = items.map((item) => ({
    item,
    shadow: shadowScore(model, {
      conversationId: item.conversationId,
      score: item.score,
      features: item.features,
    }),
  }));

  const current = [...scored].sort(
    (a, b) => b.item.score - a.item.score || a.item.conversationId.localeCompare(b.item.conversationId),
  );
  const shadowOrder = [...scored].sort(
    (a, b) =>
      b.shadow.learnedScore - a.shadow.learnedScore ||
      a.item.conversationId.localeCompare(b.item.conversationId),
  );

  const currentPos = new Map(current.map((s, i) => [s.item.conversationId, i + 1]));
  const shadowPos = new Map(shadowOrder.map((s, i) => [s.item.conversationId, i + 1]));

  const moves: ShadowRankingMove[] = scored.map(({ item, shadow }) => {
    const cp = currentPos.get(item.conversationId) ?? item.position;
    const sp = shadowPos.get(item.conversationId) ?? item.position;
    return {
      conversationId: item.conversationId,
      leadName: item.leadName,
      currentPosition: cp,
      shadowPosition: sp,
      // Delta positivo = subiria na fila (posição menor).
      delta: cp - sp,
      currentScore: shadow.currentScore,
      learnedScore: shadow.learnedScore,
    };
  });

  const changed = moves.filter((m) => m.delta !== 0);
  const a = current.map((s) => currentPos.get(s.item.conversationId) ?? 0);
  const b = current.map((s) => shadowPos.get(s.item.conversationId) ?? 0);

  return {
    totalItems: items.length,
    changedItems: changed.length,
    changeRatio: round2(changed.length / items.length),
    spearman: spearman(a, b),
    wouldRiseTop: moves
      .filter((m) => m.delta > 0)
      .sort((x, y) => y.delta - x.delta)
      .slice(0, topN),
    wouldFallTop: moves
      .filter((m) => m.delta < 0)
      .sort((x, y) => x.delta - y.delta)
      .slice(0, topN),
  };
}
