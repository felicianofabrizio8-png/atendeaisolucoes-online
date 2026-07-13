// ============================================================================
// KnowledgeBus — Coração do Shared Intelligence Context.
// Coordena cache + topics + métricas de saúde. Sem side-effects externos.
// ============================================================================

import { RuntimeClock } from "../RuntimeClock.server";
import { KnowledgeCache } from "./KnowledgeCache.server";
import { KnowledgeTopics } from "./KnowledgeTopics.server";
import type {
  KnowledgeBusHealth,
  KnowledgeCacheSnapshot,
  KnowledgeEnvelope,
  KnowledgeTopicDescriptor,
  KnowledgeTopicId,
} from "./KnowledgeContextTypes";

export class KnowledgeBus {
  readonly cache = new KnowledgeCache();
  readonly topics = new KnowledgeTopics();

  private lastActivityMs: number | null = null;
  private publishCount = 0;
  private readCount = 0;
  private errors = 0;

  append(envelope: KnowledgeEnvelope): void {
    this.assertTopic(envelope.topic);
    try {
      this.cache.put(envelope);
      this.publishCount += 1;
      this.lastActivityMs = RuntimeClock.now();
    } catch (e) {
      this.errors += 1;
      throw e;
    }
  }

  replace(envelope: KnowledgeEnvelope): void {
    this.assertTopic(envelope.topic);
    try {
      this.cache.replace(envelope);
      this.publishCount += 1;
      this.lastActivityMs = RuntimeClock.now();
    } catch (e) {
      this.errors += 1;
      throw e;
    }
  }

  expire(envelopeId: string, tenantId: string): boolean {
    return this.cache.expire(envelopeId, tenantId);
  }

  remove(envelopeId: string, tenantId: string): boolean {
    return this.cache.remove(envelopeId, tenantId);
  }

  find(envelopeId: string, tenantId: string): KnowledgeEnvelope | null {
    this.readCount += 1;
    return this.cache.find(envelopeId, tenantId);
  }

  latest(
    tenantId: string,
    topic: KnowledgeTopicId,
    agentId?: string,
  ): KnowledgeEnvelope | null {
    this.assertTopic(topic);
    this.readCount += 1;
    return this.cache.latest(tenantId, topic, agentId);
  }

  history(
    tenantId: string,
    topic: KnowledgeTopicId,
    agentId?: string,
    limit?: number,
  ): KnowledgeEnvelope[] {
    this.assertTopic(topic);
    this.readCount += 1;
    return this.cache.history(tenantId, topic, agentId, limit);
  }

  purgeExpired(): number {
    return this.cache.purgeExpired();
  }

  clearTenant(tenantId: string): void {
    this.cache.clearTenant(tenantId);
  }

  topicList(): KnowledgeTopicDescriptor[] {
    return this.topics.list();
  }

  cacheSnapshot(): KnowledgeCacheSnapshot {
    return this.cache.snapshot();
  }

  health(): KnowledgeBusHealth {
    let level: KnowledgeBusHealth["level"] = "unknown";
    if (this.publishCount === 0 && this.readCount === 0) level = "unknown";
    else if (this.errors === 0) level = "healthy";
    else if (this.errors < 3) level = "degraded";
    else level = "down";
    return {
      level,
      lastActivityAt: this.lastActivityMs ? new Date(this.lastActivityMs).toISOString() : null,
      publishCount: this.publishCount,
      readCount: this.readCount,
      errors: this.errors,
    };
  }

  private assertTopic(topic: string): void {
    if (!this.topics.has(topic)) {
      this.errors += 1;
      throw new Error(`unknown_topic:${topic}`);
    }
  }
}
