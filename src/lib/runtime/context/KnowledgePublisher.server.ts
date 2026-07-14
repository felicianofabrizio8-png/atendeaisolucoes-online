// ============================================================================
// KnowledgePublisher — Interface de publicação no Knowledge Bus.
// Persiste metadados de envelope (sem PII) via RuntimePersistence.
// ============================================================================

import type { KnowledgeBus } from "./KnowledgeBus.server";
import { createEnvelope, type CreateEnvelopeInput } from "./KnowledgeEnvelope.server";
import type { KnowledgeEnvelope } from "./KnowledgeContextTypes";
import { RuntimePersistence } from "../RuntimePersistence.server";

export class KnowledgePublisher {
  constructor(private readonly bus: KnowledgeBus) {}

  publish(input: CreateEnvelopeInput): KnowledgeEnvelope {
    const env = createEnvelope(input);
    this.bus.append(env);
    void RuntimePersistence.instance().recordEnvelope(env);
    return env;
  }

  replace(input: CreateEnvelopeInput): KnowledgeEnvelope {
    const env = createEnvelope(input);
    this.bus.replace(env);
    void RuntimePersistence.instance().recordEnvelope(env);
    return env;
  }

  expire(envelopeId: string, tenantId: string): boolean {
    return this.bus.expire(envelopeId, tenantId);
  }

  remove(envelopeId: string, tenantId: string): boolean {
    return this.bus.remove(envelopeId, tenantId);
  }
}
