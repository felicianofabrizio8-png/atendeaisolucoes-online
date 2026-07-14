// ============================================================================
// LearningLoop — Primeiro ciclo de aprendizagem contínua do Runtime.
// Executa APÓS um job concluído com sucesso. Nunca dispara agentes,
// nunca gera jobs. Persiste apenas metadados (sem PII) via RuntimePersistence.
// ============================================================================

import type { ExecutionResult } from "./ExecutionResult.server";
import { LearningMetrics, type LearningMetricsSnapshot } from "./LearningMetrics.server";
import { LearningPolicy } from "./LearningPolicy.server";
import {
  LearningSnapshotStore,
  type ConsolidatedSnapshot,
  type LearningHypothesis,
  type LearningRecord,
} from "./LearningSnapshot.server";
import type { SharedIntelligenceContext } from "./context/SharedIntelligenceContext.server";
import { RuntimePersistence } from "./RuntimePersistence.server";

const CHAIN_DOWNSTREAM: Readonly<Record<string, string[]>> = {
  "business-brain": ["business-learning", "scientific-memory", "executive-knowledge"],
  "business-learning": ["scientific-memory", "business-brain", "executive-intelligence"],
  "scientific-knowledge": ["scientific-memory", "business-brain"],
  "scientific-memory": ["business-brain", "executive-intelligence"],
  "professor": ["business-learning"],
  "executive-intelligence": ["executive-knowledge", "executive-narrative"],
  "executive-knowledge": ["executive-narrative"],
  "executive-narrative": [],
  "system-health": [],
};

export interface LearningCycleReport {
  processed: boolean;
  ignored: boolean;
  reason: string;
  hypothesis: LearningHypothesis | null;
  decision: "accepted" | "rejected" | "consolidated" | null;
  downstream: string[];
  consolidated: ConsolidatedSnapshot | null;
  publishedEnvelopeId: string | null;
  publishError: string | null;
}

export interface LearningLoopSnapshot {
  metrics: LearningMetricsSnapshot;
  store: {
    tenants: number;
    totalCycles: number;
    totalHistory: number;
    tenantsWithConsolidated: number;
    ttlMs: number;
  };
  lastCycle: LearningCycleReport | null;
  chain: Record<string, string[]>;
}

function computeSignature(result: ExecutionResult): string {
  const kb = result.knowledgeBus;
  const parts: string[] = [
    result.agentId,
    String(kb?.reads ?? 0),
    String(kb?.hits ?? 0),
    String(kb?.misses ?? 0),
    String(kb?.partialHits ?? 0),
    String(kb?.fallbacks ?? 0),
    (kb?.publishedTopics ?? []).slice().sort().join("|"),
    (kb?.topicsUsed ?? []).slice().sort().join("|"),
  ];
  return parts.join(":");
}

function randomId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `hyp_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export class LearningLoop {
  readonly metrics = new LearningMetrics();
  readonly store = new LearningSnapshotStore();

  private lastCycle: LearningCycleReport | null = null;
  private context: SharedIntelligenceContext | null = null;

  bindContext(ctx: SharedIntelligenceContext | null): void {
    this.context = ctx;
  }

  /**
   * Consome um ExecutionResult e produz (ou descarta) uma hipótese.
   * Não executa nenhum agente. Não gera nenhum job.
   */
  async onExecutionCompleted(result: ExecutionResult): Promise<LearningCycleReport> {
    const eligibility = LearningPolicy.evaluate(result);
    if (!eligibility.eligible) {
      this.metrics.recordIgnored();
      const report: LearningCycleReport = {
        processed: false,
        ignored: true,
        reason: eligibility.reason,
        hypothesis: null,
        decision: null,
        downstream: [],
        consolidated: null,
        publishedEnvelopeId: null,
        publishError: null,
      };
      this.lastCycle = report;
      return report;
    }

    const signature = computeSignature(result);
    const previous = this.store.lastSignature(result.tenantId, result.agentId);
    const significant = LearningPolicy.significantChange(previous, signature);

    const confidence = LearningPolicy.confidence(result);
    const now = new Date().toISOString();
    const hypothesis: LearningHypothesis = {
      hypothesisId: randomId(),
      tenantId: result.tenantId,
      sourceAgent: result.agentId,
      reason: significant ? "signature_changed" : "signature_stable",
      signature,
      confidence,
      createdAt: now,
      correlationId: null,
      jobId: result.jobId,
      executionId: result.executionId,
      topicsUsed: result.knowledgeBus?.topicsUsed ?? [],
      publishedTopics: result.knowledgeBus?.publishedTopics ?? [],
    };

    let decision: "accepted" | "rejected" | "consolidated";
    let note: string;
    if (!significant) {
      decision = "rejected";
      note = "no_significant_change";
    } else if (confidence < 0.55) {
      decision = "accepted";
      note = "accepted_low_confidence";
    } else {
      decision = "consolidated";
      note = "consolidated";
    }

    const record: LearningRecord = { hypothesis, decision, decidedAt: now, note };
    this.store.record(record);

    // Publica no Knowledge Bus quando disponível (best-effort, sem PII).
    let publishedEnvelopeId: string | null = null;
    let publishError: string | null = null;
    if (this.context) {
      try {
        const envelope = this.context.publisher.publish({
          topic: "business-learning",
          agentId: "learning-loop",
          tenantId: result.tenantId,
          priority: "normal",
          confidence,
          ttlMs: 30 * 60 * 1000,
          metadata: {
            hypothesisId: hypothesis.hypothesisId,
            sourceAgent: hypothesis.sourceAgent,
            decision,
            reason: hypothesis.reason,
          },
        });
        publishedEnvelopeId = envelope.id;
      } catch (e) {
        publishError = e instanceof Error ? e.message : "publish_error";
      }
    }

    const downstream = CHAIN_DOWNSTREAM[result.agentId] ?? [];

    this.metrics.recordCycle({
      agentId: result.agentId,
      at: now,
      created: true,
      accepted: decision === "accepted",
      rejected: decision === "rejected",
      consolidated: decision === "consolidated",
      confidence,
    });

    const consolidated = this.store.consolidated(result.tenantId);
    const report: LearningCycleReport = {
      processed: true,
      ignored: false,
      reason: note,
      hypothesis,
      decision,
      downstream,
      consolidated,
      publishedEnvelopeId,
      publishError,
    };
    this.lastCycle = report;

    // Persistência sem PII (fail-soft). Não bloqueia o resultado do worker.
    try {
      await RuntimePersistence.instance().recordLearningCycle(record, result.durationMs);
    } catch {
      /* fail-soft */
    }

    return report;
  }

  snapshotFor(tenantId?: string): LearningLoopSnapshot & {
    tenant?: {
      consolidated: ConsolidatedSnapshot | null;
      history: LearningRecord[];
    };
  } {
    const base: LearningLoopSnapshot = {
      metrics: this.metrics.snapshot(),
      store: this.store.globalSnapshot(),
      lastCycle: this.lastCycle,
      chain: { ...CHAIN_DOWNSTREAM },
    };
    if (!tenantId) return base;
    return {
      ...base,
      tenant: {
        consolidated: this.store.consolidated(tenantId),
        history: this.store.history(tenantId, 20),
      },
    };
  }
}
