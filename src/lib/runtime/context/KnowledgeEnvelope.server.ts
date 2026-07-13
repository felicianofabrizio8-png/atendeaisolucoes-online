// ============================================================================
// KnowledgeEnvelope — Fábrica + validação de envelopes.
// PII GUARD: rejeita chaves proibidas em metadata.
// ============================================================================

import { RuntimeClock } from "../RuntimeClock.server";
import {
  KNOWLEDGE_DEFAULT_TTL_MS,
  KNOWLEDGE_ENVELOPE_MAX_METADATA_KEYS,
  type KnowledgeEnvelope,
  type KnowledgePriority,
  type KnowledgeTopicId,
} from "./KnowledgeContextTypes";

/** Chaves/valores proibidos: PII e payload operacional. */
export const PII_METADATA_KEYS: ReadonlySet<string> = new Set([
  "phone", "telefone", "email", "message", "text", "texto",
  "conversation_id", "conversationId", "lead_id", "leadId",
  "quote_id", "quoteId", "contact_id", "contactId",
  "cpf", "cnpj", "rg", "address", "endereco", "password", "token",
]);

const PII_VALUE_PATTERNS: RegExp[] = [
  /\b\d{2}9?\d{8}\b/, // telefone BR
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // email
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, // CPF
];

export interface CreateEnvelopeInput {
  topic: KnowledgeTopicId;
  agentId: string;
  tenantId: string;
  version?: number;
  priority?: KnowledgePriority;
  ttlMs?: number | null;
  confidence?: number;
  scientificScore?: number;
  knowledgeScore?: number;
  payloadHash?: string | null;
  metadata?: Record<string, unknown>;
}

function randomId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `kb_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function clamp01(n: number | undefined, fallback = 0): number {
  if (typeof n !== "number" || Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function sanitizeMetadata(
  input: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> {
  if (!input) return {};
  const out: Record<string, string | number | boolean | null> = {};
  let count = 0;
  for (const [rawKey, rawVal] of Object.entries(input)) {
    if (count >= KNOWLEDGE_ENVELOPE_MAX_METADATA_KEYS) break;
    const key = String(rawKey);
    if (PII_METADATA_KEYS.has(key) || PII_METADATA_KEYS.has(key.toLowerCase())) {
      throw new Error(`envelope_pii_key:${key}`);
    }
    let value: string | number | boolean | null;
    if (rawVal === null || rawVal === undefined) value = null;
    else if (typeof rawVal === "number" || typeof rawVal === "boolean") value = rawVal;
    else if (typeof rawVal === "string") {
      for (const re of PII_VALUE_PATTERNS) {
        if (re.test(rawVal)) throw new Error("envelope_pii_value");
      }
      // limita string a 256 chars para evitar payloads operacionais
      value = rawVal.slice(0, 256);
    } else {
      // objetos/arrays não são permitidos no metadata
      throw new Error(`envelope_metadata_type:${key}`);
    }
    out[key] = value;
    count += 1;
  }
  return out;
}

export function createEnvelope(input: CreateEnvelopeInput): KnowledgeEnvelope {
  if (!input.tenantId) throw new Error("envelope_missing_tenant");
  if (!input.agentId) throw new Error("envelope_missing_agent");
  if (!input.topic) throw new Error("envelope_missing_topic");
  const nowMs = RuntimeClock.now();
  const ttlMs = input.ttlMs === null ? null : (input.ttlMs ?? KNOWLEDGE_DEFAULT_TTL_MS);
  const expiresAt = ttlMs === null ? null : new Date(nowMs + Math.max(1000, ttlMs)).toISOString();
  return {
    id: randomId(),
    topic: input.topic,
    agentId: input.agentId,
    tenantId: input.tenantId,
    version: Math.max(1, Math.floor(input.version ?? 1)),
    createdAt: new Date(nowMs).toISOString(),
    expiresAt,
    priority: input.priority ?? "normal",
    confidence: clamp01(input.confidence, 0.5),
    scientificScore: clamp01(input.scientificScore, 0),
    knowledgeScore: clamp01(input.knowledgeScore, 0),
    payloadHash: input.payloadHash ?? null,
    metadata: sanitizeMetadata(input.metadata),
  };
}

export function isExpired(envelope: KnowledgeEnvelope, nowMs = RuntimeClock.now()): boolean {
  if (!envelope.expiresAt) return false;
  return new Date(envelope.expiresAt).getTime() <= nowMs;
}
