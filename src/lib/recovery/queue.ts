// Fila inteligente de recuperação.
//
// Ordenação multi-critério com desempate explícito — nunca por um campo só:
//   1. Recovery Score (quem tem mais a ganhar primeiro)
//   2. Valor estimado (empate no score → dinheiro em jogo)
//   3. Urgência da janela (fechando em breve exige ação hoje)
//   4. Tempo parado (mais antigo primeiro, para não envelhecer na fila)
//
// A posição de CADA item é justificada em texto, para que o vendedor entenda
// por que o lead X está acima do lead Y.

import { TIER_LABEL } from "./score";
import { formatSpan } from "./window";
import type { RecoveryAssessment, RecoveryQueueItem } from "./types";

/** Peso de urgência derivado da janela: fechando em breve = agir hoje. */
function urgencyRank(a: RecoveryAssessment): number {
  if (a.window.state === "closing_soon") return 2;
  if (a.window.state === "open") return 1;
  return 0;
}

export function compareRecovery(a: RecoveryAssessment, b: RecoveryAssessment): number {
  if (b.score !== a.score) return b.score - a.score;
  const av = a.estimatedValue ?? 0;
  const bv = b.estimatedValue ?? 0;
  if (bv !== av) return bv - av;
  const au = urgencyRank(a);
  const bu = urgencyRank(b);
  if (bu !== au) return bu - au;
  return b.stalledHours - a.stalledHours;
}

/**
 * Ordena e anota a posição. Estados terminais (venda concluída) são
 * removidos: não há o que recuperar e poluiriam a fila.
 */
export function buildRecoveryQueue(items: RecoveryAssessment[]): RecoveryQueueItem[] {
  const sorted = items.filter((i) => i.state !== "encerrado").slice().sort(compareRecovery);

  return sorted.map((item, index) => {
    const prev = index > 0 ? sorted[index - 1] : null;
    let positionReason: string;

    if (index === 0) {
      positionReason = `1º da fila: maior Recovery Score (${item.score}) — prioridade ${TIER_LABEL[item.tier].toLowerCase()}.`;
    } else if (prev && prev.score !== item.score) {
      positionReason = `Score ${item.score} contra ${prev.score} do anterior.`;
    } else if (prev && (prev.estimatedValue ?? 0) !== (item.estimatedValue ?? 0)) {
      positionReason = `Mesmo score do anterior; desempate pelo valor estimado.`;
    } else if (prev && urgencyRank(prev) !== urgencyRank(item)) {
      positionReason = `Mesmo score e valor; desempate pela urgência da janela.`;
    } else {
      positionReason = `Mesmo score e valor; desempate pelo tempo parado (${formatSpan(item.stalledHours * 3_600_000)}).`;
    }

    return { ...item, position: index + 1, positionReason };
  });
}
