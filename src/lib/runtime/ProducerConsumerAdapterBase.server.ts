// ============================================================================
// ProducerConsumerAdapterBase — Base compartilhada Etapa 11.
// Estende IntelligenceAdapterBase para:
//   1. Consumir topics do Knowledge Bus antes do probe (telemetria HIT/MISS/
//      PARTIAL/FALLBACK). NÃO substitui a lógica de domínio — o probe atual
//      permanece autoritativo. Zero regressão.
//   2. Publicar via replace um envelope agregado no producedTopic após o
//      probe bem-sucedido (cleanup best-effort).
// Nenhuma automação criada. Adapter apenas responde a jobs manuais.
// ============================================================================

import type { ExecutionContext } from "./ExecutionContext.server";
import type { ExecutionResult, ExecutionResultKnowledgeBus } from "./ExecutionResult.server";
import { IntelligenceAdapterBase } from "./IntelligenceAdapterBase.server";
import { RuntimeClock } from "./RuntimeClock.server";
import type { KnowledgePriority, KnowledgeTopicId } from "./context/KnowledgeContextTypes";

export interface ConsumedTopicSpec {
  topic: KnowledgeTopicId;
  agentId: string;
}

export interface ProducedTopicSpec {
  topic: KnowledgeTopicId;
  priority?: KnowledgePriority;
  ttlMs?: number;
  confidence?: number;
  scientificScore?: number;
  knowledgeScore?: number;
}

export interface PublishPlan {
  producedTopic: ProducedTopicSpec;
  metadata: Record<string, string | number | boolean | null>;
}

export interface ConsumerTelemetry {
  totalReads: number;
  hits: number;
  misses: number;
  partialHits: number;
  fallbacks: number;
  lastReadAt: string | null;
  lastError: string | null;
  hitRate: number;
  topics: string[];
}

export interface ProducerTelemetry {
  connected: boolean;
  publishCount: number;
  publishErrors: number;
  lastPublishedAt: string | null;
  lastError: string | null;
  lastEnvelopeId: string | null;
  lastExpiresAt: string | null;
  lastTopic: string | null;
  lastTenantId: string | null;
}

function stableHash(input: unknown): string {
  const str = typeof input === "string" ? input : JSON.stringify(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export abstract class ProducerConsumerAdapterBase extends IntelligenceAdapterBase {
  protected consumedTopics: ConsumedTopicSpec[] = [];
  protected producedTopic: ProducedTopicSpec | null = null;
  /** Skip probe quando TODOS os consumedTopics tiverem HIT válido. */
  protected skipProbeOnFullHit = false;

  private consumer: ConsumerTelemetry = {
    totalReads: 0,
    hits: 0,
    misses: 0,
    partialHits: 0,
    fallbacks: 0,
    lastReadAt: null,
    lastError: null,
    hitRate: 0,
    topics: [],
  };

  private producer: ProducerTelemetry = {
    connected: false,
    publishCount: 0,
    publishErrors: 0,
    lastPublishedAt: null,
    lastError: null,
    lastEnvelopeId: null,
    lastExpiresAt: null,
    lastTopic: null,
    lastTenantId: null,
  };

  private lastKnowledgeBus: ExecutionResultKnowledgeBus | null = null;

  consumerTelemetry(): ConsumerTelemetry {
    this.consumer.topics = this.consumedTopics.map((t) => t.topic);
    this.consumer.hitRate =
      this.consumer.totalReads > 0
        ? Number((this.consumer.hits / this.consumer.totalReads).toFixed(4))
        : 0;
    return { ...this.consumer };
  }

  producerTelemetry(): ProducerTelemetry {
    return { ...this.producer };
  }

  /** Hook que a subclasse implementa para montar metadata do envelope. */
  protected buildPublishMetadata(
    _detail: Record<string, unknown> | null,
  ): Record<string, string | number | boolean | null> | null {
    return null;
  }

  /** Hook opcional para múltiplas publicações (ex: scientific-theories). */
  protected buildExtraPublishes(
    _detail: Record<string, unknown> | null,
  ): PublishPlan[] {
    return [];
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const shared = ctx.runtime.context ?? null;
    const bus: ExecutionResultKnowledgeBus = {
      knowledgeBusHit: false,
      knowledgeBusFallback: false,
      knowledgeTopic: null,
      knowledgeEnvelopeVersion: null,
      knowledgeEnvelopeAge: null,
      reads: 0,
      hits: 0,
      misses: 0,
      partialHits: 0,
      fallbacks: 0,
      topicsUsed: [],
      envelopeVersions: {},
      maxEnvelopeAgeSeconds: null,
      publishedTopics: [],
      publishErrors: 0,
    };

    let anyHit = false;
    let anyMiss = false;
    let fallback = false;

    if (shared && this.consumedTopics.length > 0) {
      for (const spec of this.consumedTopics) {
        bus.reads! += 1;
        this.consumer.totalReads += 1;
        try {
          const env = shared.subscriber.latest(ctx.tenantId, spec.topic, spec.agentId);
          if (env && env.tenantId === ctx.tenantId) {
            anyHit = true;
            bus.hits! += 1;
            this.consumer.hits += 1;
            bus.topicsUsed!.push(spec.topic);
            bus.envelopeVersions![spec.topic] = env.version;
            const ageSec = Math.max(
              0,
              Math.floor((RuntimeClock.now() - new Date(env.createdAt).getTime()) / 1000),
            );
            bus.maxEnvelopeAgeSeconds =
              bus.maxEnvelopeAgeSeconds === null
                ? ageSec
                : Math.max(bus.maxEnvelopeAgeSeconds, ageSec);
            // Backward-compat: primeira HIT preenche os campos singulares.
            if (!bus.knowledgeBusHit) {
              bus.knowledgeBusHit = true;
              bus.knowledgeTopic = spec.topic;
              bus.knowledgeEnvelopeVersion = env.version;
              bus.knowledgeEnvelopeAge = ageSec;
            }
          } else {
            anyMiss = true;
            bus.misses! += 1;
            this.consumer.misses += 1;
          }
        } catch (e) {
          fallback = true;
          bus.fallbacks! += 1;
          this.consumer.fallbacks += 1;
          this.consumer.lastError = (e instanceof Error ? e.message : "subscriber_error").slice(
            0,
            120,
          );
        }
      }
      if (anyHit && anyMiss) {
        bus.partialHits! += 1;
        this.consumer.partialHits += 1;
      }
      if (fallback) {
        bus.knowledgeBusFallback = true;
      }
      this.consumer.lastReadAt = RuntimeClock.nowIso();
    }

    // Skip do probe: apenas quando explicitamente habilitado E hit total.
    const fullHit =
      this.consumedTopics.length > 0 &&
      (bus.hits ?? 0) === this.consumedTopics.length &&
      !fallback;

    let result: ExecutionResult;
    if (this.skipProbeOnFullHit && fullHit) {
      const startedMs = RuntimeClock.now();
      result = {
        executionId: ctx.executionId,
        jobId: ctx.job.id,
        agentId: ctx.agentId,
        tenantId: ctx.tenantId,
        outcome: "success",
        reason: `${this.agentId}_from_bus`,
        attempt: ctx.attempt,
        startedAt: new Date(startedMs).toISOString(),
        finishedAt: new Date(startedMs).toISOString(),
        durationMs: 0,
        stub: false,
        error: null,
      };
    } else {
      result = await super.execute(ctx);
    }

    // Anexa knowledgeBus e guarda para cleanup.
    this.lastKnowledgeBus = bus;
    return { ...result, knowledgeBus: bus };
  }

  async cleanup(ctx: ExecutionContext): Promise<void> {
    const shared = ctx.runtime.context ?? null;
    const bus = this.lastKnowledgeBus;
    // Só publica quando probe rodou sem erro (lastDetail atualizado).
    if (!shared || !this.producedTopic) return;
    const detail = this.lastDetailSnapshot();
    if (detail === null) return;

    const plans: PublishPlan[] = [];
    const primary = this.buildPublishMetadata(detail);
    if (primary && this.producedTopic) {
      plans.push({ producedTopic: this.producedTopic, metadata: primary });
    }
    for (const extra of this.buildExtraPublishes(detail)) {
      plans.push(extra);
    }
    if (plans.length === 0) return;

    this.producer.connected = true;
    for (const plan of plans) {
      try {
        const spec = plan.producedTopic;
        const payloadHash = stableHash(plan.metadata);
        const envelope = shared.publisher.replace({
          id: `${spec.topic}::${this.agentId}::${ctx.tenantId}`,
          topic: spec.topic,
          agentId: this.agentId,
          tenantId: ctx.tenantId,
          version: this.producer.publishCount + 1,
          priority: spec.priority ?? "normal",
          ttlMs: spec.ttlMs,
          confidence: spec.confidence,
          scientificScore: spec.scientificScore,
          knowledgeScore: spec.knowledgeScore,
          payloadHash,
          metadata: plan.metadata,
        });
        this.producer.publishCount += 1;
        this.producer.lastPublishedAt = RuntimeClock.nowIso();
        this.producer.lastError = null;
        this.producer.lastEnvelopeId = envelope.id;
        this.producer.lastExpiresAt = envelope.expiresAt;
        this.producer.lastTopic = spec.topic;
        this.producer.lastTenantId = ctx.tenantId;
        if (bus) {
          bus.publishedTopics = bus.publishedTopics ?? [];
          bus.publishedTopics.push(spec.topic);
        }
      } catch (e) {
        const msg = (e instanceof Error ? e.message : "publish_error").slice(0, 120);
        this.producer.publishErrors += 1;
        this.producer.lastError = msg;
        if (bus) {
          bus.publishErrors = (bus.publishErrors ?? 0) + 1;
        }
      }
    }
  }
}
