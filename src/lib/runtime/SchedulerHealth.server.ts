// ============================================================================
// SchedulerHealth — Snapshot de saúde do Scheduler. Somente leitura.
// ============================================================================

import type { RegisteredSchedule, SchedulerRegistry } from "./SchedulerRegistry.server";
import { SchedulerClock } from "./SchedulerClock.server";

export interface ScheduleHealthEntry {
  id: string;
  agentId: string;
  enabled: boolean;
  perTenant: boolean;
  nextEvaluationAt: string | null;
  lastEvaluationAt: string | null;
  lastEnqueueAt: string | null;
  lastReason: string | null;
  duplicatesPrevented: number;
  blockedCount: number;
  enqueuedCount: number;
}

export interface SchedulerHealthSnapshot {
  ts: string;
  registered: number;
  enabled: number;
  disabled: number;
  totalDuplicatesPrevented: number;
  totalBlocked: number;
  totalEnqueued: number;
  nextExecutionAt: string | null;
  schedules: ScheduleHealthEntry[];
}

function toEntry(s: RegisteredSchedule): ScheduleHealthEntry {
  return {
    id: s.descriptor.id,
    agentId: s.descriptor.agentId,
    enabled: s.descriptor.enabled,
    perTenant: s.descriptor.perTenant,
    nextEvaluationAt: s.state.nextEvaluationAt,
    lastEvaluationAt: s.state.lastEvaluationAt,
    lastEnqueueAt: s.state.lastEnqueueAt,
    lastReason: s.state.lastReason,
    duplicatesPrevented: s.state.duplicatesPrevented,
    blockedCount: s.state.blockedCount,
    enqueuedCount: s.state.enqueuedCount,
  };
}

export class SchedulerHealth {
  constructor(private readonly registry: SchedulerRegistry) {}

  snapshot(): SchedulerHealthSnapshot {
    const list = this.registry.list();
    const entries = list.map(toEntry);
    const nextTimestamps = entries
      .filter((e) => e.enabled && e.nextEvaluationAt)
      .map((e) => new Date(e.nextEvaluationAt as string).getTime())
      .sort((a, b) => a - b);
    return {
      ts: SchedulerClock.nowIso(),
      registered: list.length,
      enabled: this.registry.enabledCount(),
      disabled: this.registry.disabledCount(),
      totalDuplicatesPrevented: entries.reduce((a, e) => a + e.duplicatesPrevented, 0),
      totalBlocked: entries.reduce((a, e) => a + e.blockedCount, 0),
      totalEnqueued: entries.reduce((a, e) => a + e.enqueuedCount, 0),
      nextExecutionAt: nextTimestamps.length ? new Date(nextTimestamps[0]).toISOString() : null,
      schedules: entries,
    };
  }
}
