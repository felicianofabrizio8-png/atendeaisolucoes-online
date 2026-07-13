// ============================================================================
// AgentDispatcher — Enfileira jobs no Runtime Job Queue.
// Etapa 2: dispatch() cria o job em public.agent_jobs. NÃO executa o agente.
// Requer um RuntimeJobQueue (writer) bindado no AutonomousRuntime.
// Multi-tenant: `tenantId` OBRIGATÓRIO em toda operação.
// ============================================================================

import { AgentOrchestrator, type OrchestratorContext } from "./AgentOrchestrator.server";
import type { AgentRegistry } from "./AgentRegistry.server";
import type { RuntimeJobQueue } from "./RuntimeJobQueue.server";
import { RuntimeClock } from "./RuntimeClock.server";
import type {
  DispatchRequest,
  DispatchResult,
  RuntimeJobRecord,
  RuntimeJobStatus,
} from "./RuntimeTypes";

export interface DispatcherDeps {
  registry: AgentRegistry;
  orchestrator: AgentOrchestrator;
  /** Nulo até que o Runtime seja bindado a um writer (Supabase admin). */
  queue: RuntimeJobQueue | null;
}

export class AgentDispatcher {
  constructor(private readonly deps: DispatcherDeps) {}

  private nowIso(): string {
    return RuntimeClock.nowIso();
  }

  private notReady(agentId: string, reason: string): DispatchResult {
    return {
      accepted: false,
      reason,
      agentId,
      jobId: null,
      status: null,
      dispatchedAt: this.nowIso(),
    };
  }

  async dispatch(req: DispatchRequest, ctx: OrchestratorContext = {}): Promise<DispatchResult> {
    if (!req.tenantId) return this.notReady(req.agentId, "missing_tenant");

    const validation = this.deps.orchestrator.validate(req, ctx);
    if (!validation.ok) {
      // Casos estruturais bloqueiam sem chegar à fila.
      const status: RuntimeJobStatus = validation.reason?.startsWith("agent_")
        ? "cancelled"
        : "blocked";
      return {
        accepted: false,
        reason: validation.reason ?? "invalid",
        agentId: req.agentId,
        jobId: null,
        status,
        dispatchedAt: this.nowIso(),
      };
    }

    if (!this.deps.queue) return this.notReady(req.agentId, "queue_not_bound");

    const agent = this.deps.registry.get(req.agentId)!;
    const d = agent.descriptor;
    const record = await this.deps.queue.enqueue({
      agentId: req.agentId,
      tenantId: req.tenantId,
      priority: req.priority ?? "normal",
      executionMode: req.executionMode ?? d.executionMode,
      timeoutMs: d.timeoutPolicy.hardTimeoutMs,
      maxAttempts: d.retryPolicy.maxAttempts,
      scheduledAt: req.scheduledAt,
      dedupeKey: req.dedupeKey ?? null,
      correlationId: req.correlationId ?? null,
      payloadHash: req.payloadHash ?? null,
    });

    if (!record) {
      // Idempotência (dedupeKey duplicada): não é erro.
      return {
        accepted: false,
        reason: "duplicate_dedupe_key",
        agentId: req.agentId,
        jobId: null,
        status: null,
        dispatchedAt: this.nowIso(),
      };
    }

    return {
      accepted: true,
      reason: "enqueued_no_worker",
      agentId: req.agentId,
      jobId: record.id,
      status: record.status,
      dispatchedAt: this.nowIso(),
    };
  }

  async cancel(jobId: string): Promise<{ cancelled: boolean; reason: string }> {
    if (!this.deps.queue) return { cancelled: false, reason: "queue_not_bound" };
    const ok = await this.deps.queue.cancel(jobId);
    return { cancelled: ok, reason: ok ? "cancelled" : "not_cancellable" };
  }

  async retry(jobId: string): Promise<{ requeued: boolean; reason: string }> {
    if (!this.deps.queue) return { requeued: false, reason: "queue_not_bound" };
    const ok = await this.deps.queue.retry(jobId);
    return { requeued: ok, reason: ok ? "requeued" : "not_retryable" };
  }

  async status(jobId: string): Promise<RuntimeJobRecord | null> {
    if (!this.deps.queue) return null;
    return this.deps.queue.find(jobId);
  }

  async find(jobId: string): Promise<RuntimeJobRecord | null> {
    return this.status(jobId);
  }

  async list(opts: {
    tenantId?: string;
    agentId?: string;
    limit?: number;
  } = {}): Promise<RuntimeJobRecord[]> {
    if (!this.deps.queue) return [];
    return this.deps.queue.list(opts);
  }

  /** Reservado para etapas futuras (scheduler). */
  async schedule(req: DispatchRequest, whenIso: string): Promise<DispatchResult> {
    return this.dispatch({ ...req, scheduledAt: whenIso });
  }
}
