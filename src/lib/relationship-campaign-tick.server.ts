// ============================================================================
// relationship-campaign-tick.server.ts
// Passo das Campanhas de Relacionamento dentro do runtime-tick (sem cron
// próprio). Só entram campanhas com dispatch_mode = automatic +
// automatic_enabled = true + status = ready; o kill switch global
// RELATIONSHIP_CAMPAIGN_ENABLE_REAL_SEND desligado = nada roda.
// Por empresa: dedupe distribuído por janela + lock distribuído, campanhas em
// sequência (limites diário/por hora são da empresa). Cada campanha passa por
// runAutomaticRelationshipBatch (horário, limites, elegibilidade, opt-out,
// preparação do var1, envio só do salvo, idempotência, retry/backoff).
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  realSendIsEnabled,
  runAutomaticRelationshipBatch,
} from "@/lib/relationship-campaign-dispatcher.server";
import {
  auditRuntimeEvent,
  releaseLock,
  tryAcquireLock,
  tryDedupe,
} from "@/lib/runtime/RuntimeStateStore.server";

/** Uma rodada por empresa a cada 5 min, por mais frequente que seja o tick. */
export const RELATIONSHIP_TICK_INTERVAL_SECONDS = 300;
/** Tempo máximo do passo dentro de um tick; o resto fica para o próximo. */
const DEFAULT_BUDGET_MS = 25_000;

type Db = { from: (table: string) => any };
const db = supabaseAdmin as unknown as Db;

export async function runRelationshipCampaignTick(opts: { now?: Date; budgetMs?: number } = {}) {
  const now = opts.now ?? new Date();
  if (!realSendIsEnabled()) return { status: "real_send_disabled" as const, companies: [] };

  const { data, error } = await db
    .from("relationship_campaigns")
    .select("id,company_id,status,dispatch_mode,automatic_enabled")
    .eq("dispatch_mode", "automatic")
    .eq("automatic_enabled", true)
    .eq("status", "ready");
  // Sem a migration (colunas ausentes) ou qualquer falha: não roda nada.
  if (error)
    return { status: "error" as const, error: error.message ?? String(error), companies: [] };

  const byCompany = new Map<string, string[]>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    // Filtro repetido em memória: nada fora do contrato entra no envio.
    if (
      row.dispatch_mode !== "automatic" ||
      row.automatic_enabled !== true ||
      row.status !== "ready"
    )
      continue;
    const companyId = String(row.company_id ?? "");
    if (!companyId) continue;
    byCompany.set(companyId, [...(byCompany.get(companyId) ?? []), String(row.id)]);
  }

  const deadlineAt = Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const bucket = Math.floor(now.getTime() / (RELATIONSHIP_TICK_INTERVAL_SECONDS * 1000));
  const companies: Array<Record<string, unknown>> = [];

  for (const [companyId, campaignIds] of byCompany) {
    if (Date.now() > deadlineAt) {
      companies.push({ companyId, status: "deferred", reason: "prazo do tick" });
      continue;
    }
    const fresh = await tryDedupe({
      operation: "relationship-campaign-tick",
      resourceKey: companyId,
      bucket,
      ttlSeconds: RELATIONSHIP_TICK_INTERVAL_SECONDS + 60,
      companyId,
    });
    if (!fresh) {
      companies.push({ companyId, status: "duplicate_prevented" });
      continue;
    }
    const lockKey = `relationship-campaigns:${companyId}`;
    const ownerId = `relationship-tick:${bucket}:${Math.random().toString(36).slice(2, 10)}`;
    if (!(await tryAcquireLock({ lockKey, ownerId, ttlSeconds: 240, companyId }))) {
      companies.push({ companyId, status: "lock_denied" });
      continue;
    }

    const campaigns: Array<Record<string, unknown>> = [];
    try {
      for (const campaignId of campaignIds) {
        if (Date.now() > deadlineAt) {
          campaigns.push({ campaignId, status: "deferred", reason: "prazo do tick" });
          continue;
        }
        try {
          const run = await runAutomaticRelationshipBatch({
            companyId,
            relationshipCampaignId: campaignId,
            now,
            deadlineAt,
          });
          const counts: Record<string, number> = {};
          for (const r of run.results) {
            const key = String(r.status ?? "unknown");
            counts[key] = (counts[key] ?? 0) + 1;
          }
          campaigns.push({
            campaignId,
            status: run.status,
            reason: "reason" in run ? run.reason : undefined,
            counts,
          });
        } catch (e) {
          campaigns.push({
            campaignId,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } finally {
      await releaseLock(lockKey, ownerId);
    }
    await auditRuntimeEvent({
      companyId,
      action: "relationship_campaign_tick",
      after: { bucket, campaigns },
    });
    companies.push({ companyId, status: "processed", campaigns });
  }

  return { status: "ran" as const, bucket, companies };
}
