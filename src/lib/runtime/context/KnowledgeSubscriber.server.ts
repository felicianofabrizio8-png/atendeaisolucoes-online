// ============================================================================
// KnowledgeSubscriber — Interface de consumo do Knowledge Bus.
// Subscrições são apenas registradas; nenhum agente consome automaticamente.
// ============================================================================

import type { KnowledgeBus } from "./KnowledgeBus.server";
import { RuntimeClock } from "../RuntimeClock.server";
import type {
  KnowledgeEnvelope,
  KnowledgeTopicId,
  SubscriberEntry,
} from "./KnowledgeContextTypes";

export interface SubscribeInput {
  topic: KnowledgeTopicId;
  tenantId: string;
  agentId?: string | null;
}

export class KnowledgeSubscriber {
  private readonly subs = new Map<string, SubscriberEntry>();

  constructor(private readonly bus: KnowledgeBus) {}

  subscribe(input: SubscribeInput): SubscriberEntry {
    const id = `sub_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const entry: SubscriberEntry = {
      id,
      topic: input.topic,
      tenantId: input.tenantId,
      agentId: input.agentId ?? null,
      createdAt: RuntimeClock.nowIso(),
    };
    this.subs.set(id, entry);
    return entry;
  }

  unsubscribe(subscriptionId: string): boolean {
    return this.subs.delete(subscriptionId);
  }

  list(): SubscriberEntry[] {
    return Array.from(this.subs.values());
  }

  find(envelopeId: string, tenantId: string): KnowledgeEnvelope | null {
    return this.bus.find(envelopeId, tenantId);
  }

  latest(
    tenantId: string,
    topic: KnowledgeTopicId,
    agentId?: string,
  ): KnowledgeEnvelope | null {
    return this.bus.latest(tenantId, topic, agentId);
  }

  history(
    tenantId: string,
    topic: KnowledgeTopicId,
    agentId?: string,
    limit?: number,
  ): KnowledgeEnvelope[] {
    return this.bus.history(tenantId, topic, agentId, limit);
  }

  count(): number {
    return this.subs.size;
  }
}
