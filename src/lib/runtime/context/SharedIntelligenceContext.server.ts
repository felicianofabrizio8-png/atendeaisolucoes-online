// ============================================================================
// SharedIntelligenceContext — Fachada única do Knowledge Bus para o Runtime.
// Isola bus + publisher + subscriber e expõe snapshot completo.
// Nenhum agente publica ou consome automaticamente nesta etapa.
// ============================================================================

import { KnowledgeBus } from "./KnowledgeBus.server";
import { KnowledgePublisher } from "./KnowledgePublisher.server";
import { KnowledgeSubscriber } from "./KnowledgeSubscriber.server";
import type {
  KnowledgeBusHealth,
  KnowledgeCacheSnapshot,
  KnowledgeTopicDescriptor,
  SubscriberEntry,
} from "./KnowledgeContextTypes";

export interface SharedContextSnapshot {
  online: true;
  memoryOnly: true;
  autonomous: false;
  topics: KnowledgeTopicDescriptor[];
  cache: KnowledgeCacheSnapshot;
  health: KnowledgeBusHealth;
  publisher: { available: true; usage: { publishCount: number } };
  subscriber: { available: true; subscriptions: SubscriberEntry[]; count: number };
}

export class SharedIntelligenceContext {
  readonly bus = new KnowledgeBus();
  readonly publisher = new KnowledgePublisher(this.bus);
  readonly subscriber = new KnowledgeSubscriber(this.bus);

  snapshot(): SharedContextSnapshot {
    const health = this.bus.health();
    return {
      online: true,
      memoryOnly: true,
      autonomous: false,
      topics: this.bus.topicList(),
      cache: this.bus.cacheSnapshot(),
      health,
      publisher: {
        available: true,
        usage: { publishCount: health.publishCount },
      },
      subscriber: {
        available: true,
        subscriptions: this.subscriber.list(),
        count: this.subscriber.count(),
      },
    };
  }
}
