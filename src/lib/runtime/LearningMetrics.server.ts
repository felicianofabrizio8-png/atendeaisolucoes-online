// ============================================================================
// LearningMetrics — Contadores em memória do Learning Loop.
// Zero PII. Zero persistência.
// ============================================================================

export interface LearningMetricsSnapshot {
  learningCycles: number;
  hypothesesCreated: number;
  hypothesesAccepted: number;
  hypothesesRejected: number;
  knowledgeConsolidated: number;
  ignoredExecutions: number;
  averageConfidence: number;
  lastLearningAt: string | null;
  lastAgentId: string | null;
  perAgent: Record<
    string,
    {
      cycles: number;
      created: number;
      accepted: number;
      rejected: number;
      consolidated: number;
      lastAt: string | null;
    }
  >;
}

export class LearningMetrics {
  private cycles = 0;
  private created = 0;
  private accepted = 0;
  private rejected = 0;
  private consolidated = 0;
  private ignored = 0;
  private confidenceSum = 0;
  private confidenceCount = 0;
  private lastAt: string | null = null;
  private lastAgent: string | null = null;
  private perAgent = new Map<
    string,
    { cycles: number; created: number; accepted: number; rejected: number; consolidated: number; lastAt: string | null }
  >();

  private agent(id: string) {
    let a = this.perAgent.get(id);
    if (!a) {
      a = { cycles: 0, created: 0, accepted: 0, rejected: 0, consolidated: 0, lastAt: null };
      this.perAgent.set(id, a);
    }
    return a;
  }

  recordIgnored(): void {
    this.ignored += 1;
  }

  recordCycle(input: {
    agentId: string;
    at: string;
    created: boolean;
    accepted: boolean;
    rejected: boolean;
    consolidated: boolean;
    confidence: number | null;
  }): void {
    this.cycles += 1;
    this.lastAt = input.at;
    this.lastAgent = input.agentId;
    const a = this.agent(input.agentId);
    a.cycles += 1;
    a.lastAt = input.at;
    if (input.created) {
      this.created += 1;
      a.created += 1;
    }
    if (input.accepted) {
      this.accepted += 1;
      a.accepted += 1;
    }
    if (input.rejected) {
      this.rejected += 1;
      a.rejected += 1;
    }
    if (input.consolidated) {
      this.consolidated += 1;
      a.consolidated += 1;
    }
    if (typeof input.confidence === "number") {
      this.confidenceSum += input.confidence;
      this.confidenceCount += 1;
    }
  }

  snapshot(): LearningMetricsSnapshot {
    const perAgent: LearningMetricsSnapshot["perAgent"] = {};
    for (const [id, v] of this.perAgent) perAgent[id] = { ...v };
    return {
      learningCycles: this.cycles,
      hypothesesCreated: this.created,
      hypothesesAccepted: this.accepted,
      hypothesesRejected: this.rejected,
      knowledgeConsolidated: this.consolidated,
      ignoredExecutions: this.ignored,
      averageConfidence:
        this.confidenceCount > 0
          ? Number((this.confidenceSum / this.confidenceCount).toFixed(3))
          : 0,
      lastLearningAt: this.lastAt,
      lastAgentId: this.lastAgent,
      perAgent,
    };
  }
}
