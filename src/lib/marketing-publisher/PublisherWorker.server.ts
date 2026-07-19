// PublisherWorker — orquestra planner + claim + MetaPublisher.
// Idempotência: unique(schedule_id) impede dupla publicação.
// Retry com backoff exponencial curto (1/2/4 min, cap 15 min).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { MetaPublisher } from "./MetaPublisher.server";
import { PublisherPlanner } from "./PublisherPlanner.server";
import { PublisherRepository } from "./PublisherRepository.server";
import type { AttemptEntry } from "./types";

export interface WorkerTickInput {
  workerId: string;
  maxJobs?: number;
  lockSeconds?: number;
}

export interface WorkerTickResult {
  materialized: number;
  claimed: number;
  succeeded: number;
  failed: number;
  retriedLater: number;
  simulated: number;
  recovered: number;
  ms: number;
}

export class PublisherWorker {
  constructor(
    private readonly repo = new PublisherRepository(),
    private readonly planner = new PublisherPlanner(),
    private readonly publisher = new MetaPublisher(),
  ) {}

  async tick(input: WorkerTickInput): Promise<WorkerTickResult> {
    const start = Date.now();
    const maxJobs = Math.max(1, Math.min(10, input.maxJobs ?? 5));
    const lockSeconds = input.lockSeconds ?? 300;

    // 1) Watchdog: devolve publicações órfãs à fila antes de qualquer claim.
    //    Preserva pending/platform_post_id para permitir retomada idempotente
    //    (container_resume, reconciliation_skip) já implementada no MetaPublisher.
    const recovered = await this.repo.recoverOrphans();

    const materialized = await this.planner.materializeDue();


    let claimed = 0;
    let succeeded = 0;
    let failed = 0;
    let retriedLater = 0;
    let simulated = 0;

    for (let i = 0; i < maxJobs; i += 1) {
      const pub = await this.repo.claimNext(input.workerId, lockSeconds);
      if (!pub) break;
      claimed += 1;

      // Reconciliação/idempotência: se já existe platform_post_id ou estado
      // pendente de tentativa anterior, informamos o publisher para evitar
      // recriar container/reenviar binário/duplicar publicação na Meta.
      const pending =
        pub.platform_response && typeof pub.platform_response === "object"
          ? ((pub.platform_response as { pending?: Record<string, unknown> }).pending ?? null)
          : null;
      const pendingContainerId =
        pending && typeof pending.container_id === "string" && pending.container_id.length > 0
          ? (pending.container_id as string)
          : null;

      const outcome = await this.publisher.publish({
        companyId: pub.company_id,
        contentId: pub.content_id,
        channel: pub.channel,
        format: pub.format,
        existingPlatformPostId: pub.platform_post_id,
        pendingContainerId,
        pendingState: pending,
        onContainerCreated: async (containerId: string) => {
          await this.repo.savePendingContainer(pub.id, containerId);
        },
        onPendingUpdate: async (patch: Record<string, unknown>) => {
          await this.repo.savePending(pub.id, patch);
        },
      });

      const attempt: AttemptEntry = {
        at: new Date().toISOString(),
        outcome: outcome.success
          ? outcome.simulated
            ? "simulated"
            : "success"
          : "error",
        error_code: outcome.errorCode,
        error_message: outcome.errorMessage,
        platform_post_id: outcome.platformPostId ?? undefined,
        simulated: outcome.simulated,
      };

      if (outcome.success) {
        await this.repo.markPublished({
          id: pub.id,
          platformPostId: outcome.platformPostId,
          platformResponse: outcome.platformResponse,
          simulated: outcome.simulated,
          attempt,
        });
        await this.advanceScheduleStatus(pub.schedule_id, "published");
        if (outcome.simulated) simulated += 1;
        else succeeded += 1;
      } else {
        const res = await this.repo.markFailedOrRetry({
          id: pub.id,
          retryCount: pub.retry_count,
          errorCode: outcome.errorCode ?? "unknown",
          errorMessage: outcome.errorMessage ?? "Falha desconhecida",
          retryable: Boolean(outcome.retryable),
          attempt,
        });
        if (res.finalStatus === "failed") {
          failed += 1;
          await this.advanceScheduleStatus(pub.schedule_id, "failed");
        } else {
          retriedLater += 1;
          // Schedule permanece em 'queued' (visualização no calendário).
        }
      }
    }

    return {
      materialized,
      claimed,
      succeeded,
      failed,
      retriedLater,
      simulated,
      recovered,
      ms: Date.now() - start,
    };
  }


  private async advanceScheduleStatus(scheduleId: string, status: "published" | "failed"): Promise<void> {
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    await admin
      .from("marketing_schedule")
      .update({ status })
      .eq("id", scheduleId);
  }
}
