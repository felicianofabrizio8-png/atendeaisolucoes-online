// ============================================================================
// Cache do plano de recuperação, por fingerprint.
//
// Motivação: gerar estratégia custa crédito de IA e latência. Enquanto nada
// mudou no lead, a resposta é a mesma — então guardamos por
// (empresa, conversa) e validamos pelo fingerprint.
//
// Invalidação (automática, por construção do fingerprint):
//  · nova mensagem      → muda `lastMessageAt`/contagem
//  · mudança de status  → muda `leadStatus`
//  · mudança de score   → muda `score`/`tier`
//  · mudança da janela  → muda o estado da janela e o template obrigatório
//  · regeneração manual → `force` ignora e sobrescreve a entrada
//
// Estrutura pura e injetável (`now` sempre explícito) para teste determinístico.
// O isolamento por empresa é garantido pela chave, que sempre inclui companyId.
// ============================================================================

import type { RecoveryContext, RecoveryPlan } from "./types";

export const RECOVERY_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 500;

export interface CachedPlan {
  plan: RecoveryPlan;
  fingerprint: string;
  storedAt: number;
}

/** Deriva o fingerprint a partir de tudo que legitimamente muda o plano. */
export function assistFingerprint(ctx: RecoveryContext): string {
  return [
    ctx.conversationId,
    ctx.leadStatus,
    ctx.state,
    ctx.score,
    ctx.tier,
    ctx.chancePercent,
    ctx.window.state,
    ctx.window.requiresTemplate ? "tpl" : "livre",
    ctx.requiredTemplate ?? "-",
    ctx.lastInteractionAt ?? "-",
    ctx.lastSpeaker,
    // O resumo cobre "nova mensagem" mesmo quando a data não muda de hora.
    hash(ctx.summary),
  ].join("|");
}

/** Hash estável e curto (FNV-1a) — só para compor a chave, nunca segurança. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function cacheKey(companyId: string, conversationId: string): string {
  return `${companyId}::${conversationId}`;
}

export class RecoveryPlanCache {
  private readonly entries = new Map<string, CachedPlan>();

  constructor(private readonly ttlMs: number = RECOVERY_CACHE_TTL_MS) {}

  get(key: string, fingerprint: string, now: number): RecoveryPlan | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (hit.fingerprint !== fingerprint) {
      this.entries.delete(key);
      return null;
    }
    if (now - hit.storedAt > this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    return hit.plan;
  }

  set(key: string, fingerprint: string, plan: RecoveryPlan, now: number): void {
    if (this.entries.size >= MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest) this.entries.delete(oldest);
    }
    this.entries.set(key, { plan, fingerprint, storedAt: now });
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Instância de processo usada pelo endpoint. */
export const recoveryPlanCache = new RecoveryPlanCache();
