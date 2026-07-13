// ============================================================================
// RuntimeScheduler — Camada temporal do Autonomous Runtime.
// Avalia agendas, valida janelas/bloqueios/duplicidade e (quando permitido)
// solicita ao AgentDispatcher a criação de um Job.
// NUNCA executa agentes. NUNCA inicia loops automaticamente.
// ============================================================================

import type { AgentDispatcher } from "./AgentDispatcher.server";
import { SchedulerClock } from "./SchedulerClock.server";
import { SchedulerHealth, type SchedulerHealthSnapshot } from "./SchedulerHealth.server";
import { SchedulerPolicy } from "./SchedulerPolicy.server";
import { SchedulerRegistry, type RegisteredSchedule } from "./SchedulerRegistry.server";
import type { DispatchResult, RuntimeJobPriority } from "./RuntimeTypes";

export interface SchedulerEvaluateOptions {
  tenantId: string;
  scheduleId?: string;
  /** Se true, apenas simula; nunca chama o dispatcher. */
  dryRun?: boolean;
}

export interface SchedulerEvaluationResult {
  scheduleId: string;
  agentId: string;
  tenantId: string;
  ok: boolean;
  reason: string;
  nextEvaluationAt: string;
  dispatched: boolean;
  dispatch: DispatchResult | null;
  dedupeKey: string;
}

/** dedupeKey estável: previne duplicidade para o mesmo tenant/agenda/janela. */
function buildDedupeKey(scheduleId: string, tenantId: string, intervalSeconds: number): string {
  const bucket = Math.floor(SchedulerClock.now() / (Math.max(60, intervalSeconds) * 1000));
  return `sched:${scheduleId}:${tenantId}:${bucket}`;
}

export class RuntimeScheduler {
  readonly registry: SchedulerRegistry;
  readonly health: SchedulerHealth;
  private readonly _lastDedupe = new Map<string, string>();

  constructor(
    registry: SchedulerRegistry,
    private readonly dispatcher: AgentDispatcher | null,
  ) {
    this.registry = registry;
    this.health = new SchedulerHealth(registry);
  }

  listRegistered(): RegisteredSchedule[] {
    return this.registry.list();
  }

  snapshot(): SchedulerHealthSnapshot {
    return this.health.snapshot();
  }

  /**
   * Avalia agendas para um tenant. Sob demanda apenas — nunca dispara sozinho.
   * Nesta etapa, todas as agendas nascem `disabled`, então nada é enfileirado.
   */
  async evaluate(opts: SchedulerEvaluateOptions): Promise<SchedulerEvaluationResult[]> {
    if (!opts.tenantId) throw new Error("[RuntimeScheduler] tenantId obrigatório");

    const schedules = opts.scheduleId
      ? [this.registry.get(opts.scheduleId)].filter(Boolean) as RegisteredSchedule[]
      : this.registry.list();

    const results: SchedulerEvaluationResult[] = [];

    for (const s of schedules) {
      const nowIso = SchedulerClock.nowIso();
      s.state.lastEvaluationAt = nowIso;

      if (!s.descriptor.enabled) {
        s.state.lastReason = "schedule_disabled";
        s.state.nextEvaluationAt = SchedulerClock.addSeconds(3600).toISOString();
        results.push({
          scheduleId: s.descriptor.id,
          agentId: s.descriptor.agentId,
          tenantId: opts.tenantId,
          ok: false,
          reason: "schedule_disabled",
          nextEvaluationAt: s.state.nextEvaluationAt,
          dispatched: false,
          dispatch: null,
          dedupeKey: "",
        });
        continue;
      }

      const evalResult = SchedulerPolicy.evaluate(s.descriptor.policy, {
        lastEnqueueAt: s.state.lastEnqueueAt,
      });
      s.state.nextEvaluationAt = evalResult.nextEvaluationAt;

      if (!evalResult.ok) {
        s.state.lastReason = evalResult.reason;
        s.state.blockedCount += 1;
        results.push({
          scheduleId: s.descriptor.id,
          agentId: s.descriptor.agentId,
          tenantId: opts.tenantId,
          ok: false,
          reason: evalResult.reason,
          nextEvaluationAt: evalResult.nextEvaluationAt,
          dispatched: false,
          dispatch: null,
          dedupeKey: "",
        });
        continue;
      }

      const dedupeKey = buildDedupeKey(
        s.descriptor.id,
        opts.tenantId,
        s.descriptor.policy.intervalSeconds ?? 60,
      );
      const dedupeMapKey = `${s.descriptor.id}:${opts.tenantId}`;
      if (this._lastDedupe.get(dedupeMapKey) === dedupeKey) {
        s.state.duplicatesPrevented += 1;
        s.state.lastReason = "duplicate_prevented";
        results.push({
          scheduleId: s.descriptor.id,
          agentId: s.descriptor.agentId,
          tenantId: opts.tenantId,
          ok: false,
          reason: "duplicate_prevented",
          nextEvaluationAt: evalResult.nextEvaluationAt,
          dispatched: false,
          dispatch: null,
          dedupeKey,
        });
        continue;
      }

      if (opts.dryRun || !this.dispatcher) {
        s.state.lastReason = opts.dryRun ? "dry_run_ok" : "dispatcher_unbound";
        results.push({
          scheduleId: s.descriptor.id,
          agentId: s.descriptor.agentId,
          tenantId: opts.tenantId,
          ok: true,
          reason: s.state.lastReason,
          nextEvaluationAt: evalResult.nextEvaluationAt,
          dispatched: false,
          dispatch: null,
          dedupeKey,
        });
        continue;
      }

      const priority: RuntimeJobPriority = s.descriptor.policy.priority;
      const dispatch = await this.dispatcher.dispatch({
        agentId: s.descriptor.agentId,
        tenantId: opts.tenantId,
        priority,
        executionMode: "scheduled",
        dedupeKey,
        reason: `scheduler:${s.descriptor.id}`,
      });

      if (dispatch.accepted) {
        s.state.lastEnqueueAt = nowIso;
        s.state.enqueuedCount += 1;
        s.state.lastReason = "enqueued";
        this._lastDedupe.set(dedupeMapKey, dedupeKey);
      } else if (dispatch.reason === "duplicate_dedupe_key") {
        s.state.duplicatesPrevented += 1;
        s.state.lastReason = "duplicate_prevented";
      } else {
        s.state.blockedCount += 1;
        s.state.lastReason = dispatch.reason;
      }

      results.push({
        scheduleId: s.descriptor.id,
        agentId: s.descriptor.agentId,
        tenantId: opts.tenantId,
        ok: dispatch.accepted,
        reason: dispatch.reason,
        nextEvaluationAt: evalResult.nextEvaluationAt,
        dispatched: dispatch.accepted,
        dispatch,
        dedupeKey,
      });
    }

    return results;
  }
}
