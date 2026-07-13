// ============================================================================
// ExecutiveKnowledgeAdapter — Adapter real do agente Executive Knowledge.
// Etapa 10: PRIMEIRO CONSUMIDOR do Knowledge Bus. Antes de rodar o probe
// tradicional, consulta o Shared Intelligence Context via KnowledgeSubscriber
// buscando o topic `system-health`. Se houver envelope válido para o tenant
// atual → HIT (usa contexto, não consulta fonte redundante). Se não → MISS
// e mantém comportamento READ-ONLY tradicional. Falha do Bus → FALLBACK.
// Zero regressão para o Executive Knowledge existente.
// ============================================================================

import type { ExecutionContext } from "./ExecutionContext.server";
import type { ExecutionResult, ExecutionResultKnowledgeBus } from "./ExecutionResult.server";
import { RuntimeClock } from "./RuntimeClock.server";
import { IntelligenceAdapterBase, type IntelligenceProbeContext, type IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

const CONSUMED_TOPIC = "system-health" as const;
const PRODUCER_AGENT = "system-health" as const;

export interface ExecutiveKnowledgeConsumerTelemetry {
  totalReads: number;
  hits: number;
  misses: number;
  fallbacks: number;
  lastReadAt: string | null;
  lastHitAt: string | null;
  lastMissAt: string | null;
  lastFallbackAt: string | null;
  lastError: string | null;
  lastEnvelopeVersion: number | null;
  lastEnvelopeAgeSeconds: number | null;
  lastTenantId: string | null;
}

export class ExecutiveKnowledgeAdapter extends IntelligenceAdapterBase {
  readonly agentId = "executive-knowledge";
  readonly version = "real-1.1.0";

  private telemetry: ExecutiveKnowledgeConsumerTelemetry = {
    totalReads: 0,
    hits: 0,
    misses: 0,
    fallbacks: 0,
    lastReadAt: null,
    lastHitAt: null,
    lastMissAt: null,
    lastFallbackAt: null,
    lastError: null,
    lastEnvelopeVersion: null,
    lastEnvelopeAgeSeconds: null,
    lastTenantId: null,
  };

  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:executive-knowledge"];
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const { ExecutiveKnowledgeService } = await import("@/lib/executive-knowledge/ExecutiveKnowledgeService.server");
    const latest = await ExecutiveKnowledgeService.latest(supabase, companyId, "30d");
    return {
      reason: "executive_knowledge_latest_ok",
      detail: {
        period: "30d",
        hasRecord: Boolean(latest),
      },
    };
  }

  /**
   * Override: consulta o Knowledge Bus antes do probe tradicional.
   * - Hit: skipa probe, retorna success com knowledgeBus.hit=true.
   * - Miss: delega ao comportamento tradicional (super.execute).
   * - Erro no Bus: fallback=true e delega ao comportamento tradicional.
   */
  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const startedMs = RuntimeClock.now();
    const startedIso = new Date(startedMs).toISOString();
    const shared = ctx.runtime.context ?? null;

    // Somente KnowledgeSubscriber é permitido (interface pública).
    let hit = false;
    let fallback = false;
    let envelopeVersion: number | null = null;
    let envelopeAgeSec: number | null = null;
    let envelopeExists = false;

    if (shared) {
      try {
        const env = shared.subscriber.latest(ctx.tenantId, CONSUMED_TOPIC, PRODUCER_AGENT);
        if (env && env.tenantId === ctx.tenantId) {
          envelopeExists = true;
          envelopeVersion = env.version;
          envelopeAgeSec = Math.max(
            0,
            Math.floor((RuntimeClock.now() - new Date(env.createdAt).getTime()) / 1000),
          );
        }
      } catch (e) {
        fallback = true;
        this.telemetry.lastError = (e instanceof Error ? e.message : "subscriber_error").slice(0, 120);
      }
    }

    this.telemetry.totalReads += 1;
    this.telemetry.lastReadAt = RuntimeClock.nowIso();
    this.telemetry.lastTenantId = ctx.tenantId;

    const bus: ExecutionResultKnowledgeBus = {
      knowledgeBusHit: false,
      knowledgeBusFallback: fallback,
      knowledgeTopic: CONSUMED_TOPIC,
      knowledgeEnvelopeVersion: null,
      knowledgeEnvelopeAge: null,
    };

    if (envelopeExists && !fallback) {
      hit = true;
      bus.knowledgeBusHit = true;
      bus.knowledgeEnvelopeVersion = envelopeVersion;
      bus.knowledgeEnvelopeAge = envelopeAgeSec;
      this.telemetry.hits += 1;
      this.telemetry.lastHitAt = this.telemetry.lastReadAt;
      this.telemetry.lastEnvelopeVersion = envelopeVersion;
      this.telemetry.lastEnvelopeAgeSeconds = envelopeAgeSec;
      const finishedMs = RuntimeClock.now();
      return {
        executionId: ctx.executionId,
        jobId: ctx.job.id,
        agentId: ctx.agentId,
        tenantId: ctx.tenantId,
        outcome: "success",
        reason: "executive_knowledge_from_bus",
        attempt: ctx.attempt,
        startedAt: startedIso,
        finishedAt: new Date(finishedMs).toISOString(),
        durationMs: finishedMs - startedMs,
        stub: false,
        error: null,
        knowledgeBus: bus,
      };
    }

    if (fallback) {
      this.telemetry.fallbacks += 1;
      this.telemetry.lastFallbackAt = this.telemetry.lastReadAt;
    } else {
      this.telemetry.misses += 1;
      this.telemetry.lastMissAt = this.telemetry.lastReadAt;
    }

    // Miss ou fallback → delega ao comportamento tradicional. Nunca altera
    // a lógica de leitura existente do Executive Knowledge.
    const traditional = await super.execute(ctx);
    void hit; // hit=false neste ramo
    return { ...traditional, knowledgeBus: bus };
  }

  consumerTelemetry(): ExecutiveKnowledgeConsumerTelemetry {
    return { ...this.telemetry };
  }
}
