// ============================================================================
// LearningSnapshot — Estruturas e store em memória do Learning Loop.
// Guarda hipóteses, decisões e snapshots consolidados por tenant.
// Zero persistência, TTL próprio, isolamento multi-tenant.
// ============================================================================

export type LearningDecision = "accepted" | "rejected" | "consolidated";

export interface LearningHypothesis {
  hypothesisId: string;
  tenantId: string;
  sourceAgent: string;
  reason: string;
  signature: string;
  confidence: number;
  createdAt: string;
  correlationId: string | null;
  jobId: string;
  executionId: string;
  topicsUsed: string[];
  publishedTopics: string[];
}

export interface LearningRecord {
  hypothesis: LearningHypothesis;
  decision: LearningDecision;
  decidedAt: string;
  note: string;
}

export interface ConsolidatedSnapshot {
  tenantId: string;
  updatedAt: string;
  cycles: number;
  lastAgent: string;
  lastHypothesisId: string;
  averageConfidence: number;
  agents: Record<string, { cycles: number; lastAt: string; averageConfidence: number }>;
}

interface TenantState {
  history: LearningRecord[];
  signatureByAgent: Map<string, string>;
  consolidated: ConsolidatedSnapshot | null;
  cycleCount: number;
  confidenceSum: number;
  confidenceCount: number;
  agentAggregate: Map<string, { cycles: number; lastAt: string; sum: number; count: number }>;
}

const MAX_HISTORY_PER_TENANT = 50;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h

export class LearningSnapshotStore {
  private tenants = new Map<string, TenantState>();
  private hypothesisTtlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.hypothesisTtlMs = ttlMs;
  }

  private state(tenantId: string): TenantState {
    let s = this.tenants.get(tenantId);
    if (!s) {
      s = {
        history: [],
        signatureByAgent: new Map(),
        consolidated: null,
        cycleCount: 0,
        confidenceSum: 0,
        confidenceCount: 0,
        agentAggregate: new Map(),
      };
      this.tenants.set(tenantId, s);
    }
    return s;
  }

  lastSignature(tenantId: string, agentId: string): string | null {
    return this.state(tenantId).signatureByAgent.get(agentId) ?? null;
  }

  record(record: LearningRecord): void {
    const s = this.state(record.hypothesis.tenantId);
    s.history.unshift(record);
    if (s.history.length > MAX_HISTORY_PER_TENANT) {
      s.history.length = MAX_HISTORY_PER_TENANT;
    }
    s.signatureByAgent.set(record.hypothesis.sourceAgent, record.hypothesis.signature);

    if (record.decision === "consolidated") {
      s.cycleCount += 1;
      s.confidenceSum += record.hypothesis.confidence;
      s.confidenceCount += 1;
      const agg = s.agentAggregate.get(record.hypothesis.sourceAgent) ?? {
        cycles: 0,
        lastAt: record.decidedAt,
        sum: 0,
        count: 0,
      };
      agg.cycles += 1;
      agg.lastAt = record.decidedAt;
      agg.sum += record.hypothesis.confidence;
      agg.count += 1;
      s.agentAggregate.set(record.hypothesis.sourceAgent, agg);

      const agents: ConsolidatedSnapshot["agents"] = {};
      for (const [id, v] of s.agentAggregate) {
        agents[id] = {
          cycles: v.cycles,
          lastAt: v.lastAt,
          averageConfidence: v.count > 0 ? Number((v.sum / v.count).toFixed(3)) : 0,
        };
      }
      s.consolidated = {
        tenantId: record.hypothesis.tenantId,
        updatedAt: record.decidedAt,
        cycles: s.cycleCount,
        lastAgent: record.hypothesis.sourceAgent,
        lastHypothesisId: record.hypothesis.hypothesisId,
        averageConfidence:
          s.confidenceCount > 0 ? Number((s.confidenceSum / s.confidenceCount).toFixed(3)) : 0,
        agents,
      };
    }
  }

  purgeExpired(nowMs: number = Date.now()): number {
    let removed = 0;
    for (const s of this.tenants.values()) {
      const before = s.history.length;
      s.history = s.history.filter(
        (h) => nowMs - new Date(h.decidedAt).getTime() <= this.hypothesisTtlMs,
      );
      removed += before - s.history.length;
    }
    return removed;
  }

  history(tenantId: string, limit = 20): LearningRecord[] {
    return this.state(tenantId).history.slice(0, limit);
  }

  consolidated(tenantId: string): ConsolidatedSnapshot | null {
    return this.state(tenantId).consolidated;
  }

  globalSnapshot() {
    let totalCycles = 0;
    let totalHistory = 0;
    let tenantsWithConsolidated = 0;
    for (const s of this.tenants.values()) {
      totalCycles += s.cycleCount;
      totalHistory += s.history.length;
      if (s.consolidated) tenantsWithConsolidated += 1;
    }
    return {
      tenants: this.tenants.size,
      totalCycles,
      totalHistory,
      tenantsWithConsolidated,
      ttlMs: this.hypothesisTtlMs,
    };
  }
}
