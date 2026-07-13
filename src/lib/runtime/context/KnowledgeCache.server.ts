// ============================================================================
// KnowledgeCache — Cache in-memory isolado por tenant/topic/agent.
// Sem banco. Sem Redis. Nenhuma comunicação externa. TTL + LRU por tenant.
// ============================================================================

import { RuntimeClock } from "../RuntimeClock.server";
import { isExpired } from "./KnowledgeEnvelope.server";
import {
  KNOWLEDGE_MAX_PER_TENANT,
  KNOWLEDGE_MAX_TOTAL,
  type KnowledgeCacheSnapshot,
  type KnowledgeEnvelope,
  type KnowledgeTopicId,
} from "./KnowledgeContextTypes";

interface StoredEntry {
  envelope: KnowledgeEnvelope;
  storedAtMs: number;
}

function tenantKey(tenantId: string): string {
  return `t:${tenantId}`;
}
function topicKey(topic: KnowledgeTopicId, agentId: string): string {
  return `${topic}::${agentId}`;
}

export class KnowledgeCache {
  // tenantId -> topicAgentKey -> StoredEntry[] (ordered oldest→newest)
  private readonly byTenant = new Map<string, Map<string, StoredEntry[]>>();
  private _totalCount = 0;
  private _evictions = 0;
  private _expired = 0;

  put(envelope: KnowledgeEnvelope): void {
    const tk = tenantKey(envelope.tenantId);
    let topics = this.byTenant.get(tk);
    if (!topics) {
      topics = new Map();
      this.byTenant.set(tk, topics);
    }
    const key = topicKey(envelope.topic, envelope.agentId);
    const list = topics.get(key) ?? [];
    list.push({ envelope, storedAtMs: RuntimeClock.now() });
    topics.set(key, list);
    this._totalCount += 1;
    this.enforceLimits(tk);
  }

  replace(envelope: KnowledgeEnvelope): void {
    const tk = tenantKey(envelope.tenantId);
    const topics = this.byTenant.get(tk);
    const key = topicKey(envelope.topic, envelope.agentId);
    if (topics?.has(key)) {
      const prev = topics.get(key)!;
      this._totalCount -= prev.length;
      topics.set(key, []);
    }
    this.put(envelope);
  }

  latest(
    tenantId: string,
    topic: KnowledgeTopicId,
    agentId?: string,
  ): KnowledgeEnvelope | null {
    const topics = this.byTenant.get(tenantKey(tenantId));
    if (!topics) return null;
    let best: StoredEntry | null = null;
    for (const [key, list] of topics.entries()) {
      if (!key.startsWith(`${topic}::`)) continue;
      if (agentId && key !== topicKey(topic, agentId)) continue;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const entry = list[i];
        if (isExpired(entry.envelope)) continue;
        if (!best || entry.storedAtMs > best.storedAtMs) best = entry;
        break;
      }
    }
    return best?.envelope ?? null;
  }

  history(
    tenantId: string,
    topic: KnowledgeTopicId,
    agentId?: string,
    limit = 20,
  ): KnowledgeEnvelope[] {
    const topics = this.byTenant.get(tenantKey(tenantId));
    if (!topics) return [];
    const collected: StoredEntry[] = [];
    for (const [key, list] of topics.entries()) {
      if (!key.startsWith(`${topic}::`)) continue;
      if (agentId && key !== topicKey(topic, agentId)) continue;
      for (const entry of list) {
        if (isExpired(entry.envelope)) continue;
        collected.push(entry);
      }
    }
    collected.sort((a, b) => b.storedAtMs - a.storedAtMs);
    return collected.slice(0, Math.max(1, Math.min(limit, 200))).map((e) => e.envelope);
  }

  find(envelopeId: string, tenantId: string): KnowledgeEnvelope | null {
    const topics = this.byTenant.get(tenantKey(tenantId));
    if (!topics) return null;
    for (const list of topics.values()) {
      for (const entry of list) {
        if (entry.envelope.id === envelopeId) return entry.envelope;
      }
    }
    return null;
  }

  remove(envelopeId: string, tenantId: string): boolean {
    const topics = this.byTenant.get(tenantKey(tenantId));
    if (!topics) return false;
    for (const [key, list] of topics.entries()) {
      const idx = list.findIndex((e) => e.envelope.id === envelopeId);
      if (idx >= 0) {
        list.splice(idx, 1);
        topics.set(key, list);
        this._totalCount -= 1;
        return true;
      }
    }
    return false;
  }

  expire(envelopeId: string, tenantId: string): boolean {
    const env = this.find(envelopeId, tenantId);
    if (!env) return false;
    env.expiresAt = RuntimeClock.nowIso();
    this._expired += 1;
    return true;
  }

  purgeExpired(): number {
    let removed = 0;
    for (const topics of this.byTenant.values()) {
      for (const [key, list] of topics.entries()) {
        const kept = list.filter((e) => !isExpired(e.envelope));
        removed += list.length - kept.length;
        topics.set(key, kept);
      }
    }
    this._totalCount -= removed;
    this._expired += removed;
    return removed;
  }

  clearTenant(tenantId: string): void {
    const topics = this.byTenant.get(tenantKey(tenantId));
    if (!topics) return;
    let count = 0;
    for (const list of topics.values()) count += list.length;
    this._totalCount -= count;
    this.byTenant.delete(tenantKey(tenantId));
  }

  snapshot(): KnowledgeCacheSnapshot {
    const perTopicMap = new Map<KnowledgeTopicId, { count: number; tenants: Set<string> }>();
    const perTenantArr: Array<{ tenantId: string; count: number; topics: number }> = [];
    for (const [tk, topics] of this.byTenant.entries()) {
      const tenantId = tk.startsWith("t:") ? tk.slice(2) : tk;
      let tenantCount = 0;
      const topicSet = new Set<KnowledgeTopicId>();
      for (const [key, list] of topics.entries()) {
        const topic = key.split("::")[0] as KnowledgeTopicId;
        topicSet.add(topic);
        const active = list.filter((e) => !isExpired(e.envelope)).length;
        tenantCount += active;
        const bucket = perTopicMap.get(topic) ?? { count: 0, tenants: new Set<string>() };
        bucket.count += active;
        if (active > 0) bucket.tenants.add(tenantId);
        perTopicMap.set(topic, bucket);
      }
      if (tenantCount > 0) {
        perTenantArr.push({ tenantId, count: tenantCount, topics: topicSet.size });
      }
    }
    return {
      totalEnvelopes: this._totalCount,
      perTopic: Array.from(perTopicMap.entries()).map(([topic, b]) => ({
        topic,
        count: b.count,
        tenants: b.tenants.size,
      })),
      perTenant: perTenantArr,
      evictions: this._evictions,
      expired: this._expired,
      memoryOnly: true,
    };
  }

  private enforceLimits(tk: string): void {
    const topics = this.byTenant.get(tk);
    if (!topics) return;
    // Limite por tenant
    let tenantCount = 0;
    for (const list of topics.values()) tenantCount += list.length;
    while (tenantCount > KNOWLEDGE_MAX_PER_TENANT) {
      const oldestKey = this.oldestKey(topics);
      if (!oldestKey) break;
      const list = topics.get(oldestKey)!;
      list.shift();
      topics.set(oldestKey, list);
      tenantCount -= 1;
      this._totalCount -= 1;
      this._evictions += 1;
    }
    // Limite global
    while (this._totalCount > KNOWLEDGE_MAX_TOTAL) {
      const [victimTk, victimTopics] = this.findLargestTenant();
      if (!victimTopics) break;
      const key = this.oldestKey(victimTopics);
      if (!key) break;
      const list = victimTopics.get(key)!;
      list.shift();
      victimTopics.set(key, list);
      this._totalCount -= 1;
      this._evictions += 1;
      if (this._totalCount <= KNOWLEDGE_MAX_TOTAL) break;
      // evita loop infinito
      if (victimTk === "") break;
    }
  }

  private oldestKey(topics: Map<string, StoredEntry[]>): string | null {
    let oldestAt = Infinity;
    let oldestKey: string | null = null;
    for (const [key, list] of topics.entries()) {
      const entry = list[0];
      if (!entry) continue;
      if (entry.storedAtMs < oldestAt) {
        oldestAt = entry.storedAtMs;
        oldestKey = key;
      }
    }
    return oldestKey;
  }

  private findLargestTenant(): [string, Map<string, StoredEntry[]> | null] {
    let best: [string, Map<string, StoredEntry[]> | null] = ["", null];
    let bestCount = 0;
    for (const [tk, topics] of this.byTenant.entries()) {
      let c = 0;
      for (const l of topics.values()) c += l.length;
      if (c > bestCount) {
        bestCount = c;
        best = [tk, topics];
      }
    }
    return best;
  }
}
