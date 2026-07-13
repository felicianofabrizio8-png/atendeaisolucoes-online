// ============================================================================
// KnowledgePublisher — Interface de publicação no Knowledge Bus.
// Nenhum agente publica automaticamente nesta etapa.
// ============================================================================

import type { KnowledgeBus } from "./KnowledgeBus.server";
import { createEnvelope, type CreateEnvelopeInput } from "./KnowledgeEnvelope.server";
import type { KnowledgeEnvelope } from "./KnowledgeContextTypes";

export class KnowledgePublisher {
  constructor(private readonly bus: KnowledgeBus) {}

  publish(input: CreateEnvelopeInput): KnowledgeEnvelope {
    const env = createEnvelope(input);
    this.bus.append(env);
    return env;
  }

  replace(input: CreateEnvelopeInput): KnowledgeEnvelope {
    const env = createEnvelope(input);
    this.bus.replace(env);
    return env;
  }

  expire(envelopeId: string, tenantId: string): boolean {
    return this.bus.expire(envelopeId, tenantId);
  }

  remove(envelopeId: string, tenantId: string): boolean {
    return this.bus.remove(envelopeId, tenantId);
  }
}
