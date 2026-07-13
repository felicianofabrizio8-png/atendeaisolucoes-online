// ============================================================================
// LearningPolicy — Regras determinísticas de aceitação de aprendizado.
// Não executa agentes. Não gera jobs. Não escreve em banco.
// ============================================================================

import type { ExecutionResult } from "./ExecutionResult.server";

export interface LearningEligibility {
  eligible: boolean;
  reason: string;
}

const INELIGIBLE_OUTCOMES = new Set(["stub", "failure", "timeout", "cancelled", "blocked"]);

export class LearningPolicy {
  /** Só aprende com execuções concluídas com sucesso real. */
  static evaluate(result: ExecutionResult): LearningEligibility {
    if (result.stub) return { eligible: false, reason: "stub" };
    if (result.outcome !== "success") {
      return { eligible: false, reason: `outcome:${result.outcome}` };
    }
    if (INELIGIBLE_OUTCOMES.has(result.outcome)) {
      return { eligible: false, reason: `outcome_blocked:${result.outcome}` };
    }
    if (result.knowledgeBus?.knowledgeBusFallback) {
      return { eligible: false, reason: "knowledge_bus_fallback" };
    }
    return { eligible: true, reason: "ok" };
  }

  /** Confiança inicial da hipótese, derivada dos sinais do resultado. */
  static confidence(result: ExecutionResult): number {
    const kb = result.knowledgeBus;
    if (!kb) return 0.5;
    const reads = kb.reads ?? 0;
    const hits = kb.hits ?? 0;
    const hitRate = reads > 0 ? hits / reads : 0;
    const published = (kb.publishedTopics?.length ?? 0) > 0 ? 0.2 : 0;
    const base = 0.5 + hitRate * 0.3 + published;
    return Math.max(0, Math.min(1, Number(base.toFixed(3))));
  }

  /** Detecta mudança relevante entre a nova assinatura e a última conhecida. */
  static significantChange(previousSig: string | null, nextSig: string): boolean {
    if (!previousSig) return true;
    return previousSig !== nextSig;
  }
}
