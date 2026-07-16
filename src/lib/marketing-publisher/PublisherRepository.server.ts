// PublisherRepository — acesso ao banco (service_role).
// Nunca chamado do client. Escrita exclusiva do worker.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type {
  AttemptEntry,
  PublicationChannel,
  PublicationFormat,
  PublicationRow,
  PublicationStatus,
  PublisherStats,
} from "./types";
import { MAX_RETRIES } from "./types";

type DbRow = {
  id: string;
  company_id: string;
  schedule_id: string;
  content_id: string;
  channel: string;
  format: string;
  status: string;
  platform_post_id: string | null;
  platform_response: unknown;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  attempt_log: unknown;
  locked_by: string | null;
  locked_at: string | null;
  available_at: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

function toRow(r: DbRow): PublicationRow {
  return {
    id: r.id,
    company_id: r.company_id,
    schedule_id: r.schedule_id,
    content_id: r.content_id,
    channel: r.channel as PublicationChannel,
    format: r.format as PublicationFormat,
    status: r.status as PublicationStatus,
    platform_post_id: r.platform_post_id,
    platform_response: (r.platform_response ?? null) as Record<string, unknown> | null,
    error_code: r.error_code,
    error_message: r.error_message,
    retry_count: r.retry_count,
    attempt_log: Array.isArray(r.attempt_log) ? (r.attempt_log as AttemptEntry[]) : [],
    locked_by: r.locked_by,
    locked_at: r.locked_at,
    available_at: r.available_at,
    published_at: r.published_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export class PublisherRepository {
  /**
   * Cria uma publicação para um agendamento (idempotente por unique(schedule_id)).
   * Retorna a linha existente ou a recém-criada.
   */
  async materialize(input: {
    companyId: string;
    scheduleId: string;
    contentId: string;
    channel: PublicationChannel;
    format: PublicationFormat;
    availableAt: Date;
    createdBy: string | null;
  }): Promise<PublicationRow | null> {
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        insert: (v: Record<string, unknown>) => {
          select: (c: string) => {
            maybeSingle: () => Promise<{ data: DbRow | null; error: unknown }>;
          };
        };
        select: (c: string) => {
          eq: (
            k: string,
            v: string,
          ) => { maybeSingle: () => Promise<{ data: DbRow | null; error: unknown }> };
        };
      };
    };

    const existing = await admin
      .from("marketing_publications")
      .select("*")
      .eq("schedule_id", input.scheduleId)
      .maybeSingle();
    if (existing.data) return toRow(existing.data);

    const ins = await admin
      .from("marketing_publications")
      .insert({
        company_id: input.companyId,
        schedule_id: input.scheduleId,
        content_id: input.contentId,
        channel: input.channel,
        format: input.format,
        status: "queued",
        available_at: input.availableAt.toISOString(),
        created_by: input.createdBy,
      })
      .select("*")
      .maybeSingle();
    if (ins.error) {
      // Race: outro worker inseriu simultaneamente. Recupera.
      const retry = await admin
        .from("marketing_publications")
        .select("*")
        .eq("schedule_id", input.scheduleId)
        .maybeSingle();
      return retry.data ? toRow(retry.data) : null;
    }
    return ins.data ? toRow(ins.data) : null;
  }

  /**
   * Claim atômico de UMA publicação vencida.
   * Usa UPDATE com WHERE status='queued' AND available_at<=now() AND locked_by IS NULL,
   * garantido por RETURNING; sem risco de dupla execução no mesmo isolate.
   *
   * Como o Supabase JS não expõe SKIP LOCKED, usamos update-where-select pattern.
   */
  async claimNext(workerId: string, lockSeconds: number): Promise<PublicationRow | null> {
    // 1) Pega um candidato (leitura simples).
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const nowIso = new Date().toISOString();
    const cand = await admin
      .from("marketing_publications")
      .select("id")
      .eq("status", "queued")
      .lte("available_at", nowIso)
      .is("locked_by", null)
      .order("available_at", { ascending: true })
      .limit(1);
    const candidateId = cand.data?.[0]?.id as string | undefined;
    if (!candidateId) return null;

    // 2) Update condicional para claim.
    const claimUntil = new Date(Date.now() + lockSeconds * 1000).toISOString();
    const upd = await admin
      .from("marketing_publications")
      .update({
        status: "publishing",
        locked_by: workerId,
        locked_at: nowIso,
        available_at: claimUntil,
      })
      .eq("id", candidateId)
      .eq("status", "queued")
      .is("locked_by", null)
      .select("*")
      .maybeSingle();
    return upd.data ? toRow(upd.data as DbRow) : null;
  }

  async markPublished(input: {
    id: string;
    platformPostId: string | null;
    platformResponse: unknown;
    simulated: boolean;
    attempt: AttemptEntry;
  }): Promise<void> {
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const current = await admin
      .from("marketing_publications")
      .select("attempt_log")
      .eq("id", input.id)
      .maybeSingle();
    const log = Array.isArray(current.data?.attempt_log)
      ? (current.data.attempt_log as AttemptEntry[])
      : [];
    await admin
      .from("marketing_publications")
      .update({
        status: "published",
        platform_post_id: input.platformPostId,
        platform_response: input.platformResponse,
        error_code: null,
        error_message: null,
        locked_by: null,
        locked_at: null,
        published_at: new Date().toISOString(),
        attempt_log: [...log, input.attempt],
      })
      .eq("id", input.id);
  }

  async markFailedOrRetry(input: {
    id: string;
    retryCount: number;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
    attempt: AttemptEntry;
  }): Promise<{ finalStatus: PublicationStatus }> {
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const current = await admin
      .from("marketing_publications")
      .select("attempt_log")
      .eq("id", input.id)
      .maybeSingle();
    const log = Array.isArray(current.data?.attempt_log)
      ? (current.data.attempt_log as AttemptEntry[])
      : [];

    const nextRetry = input.retryCount + 1;
    const canRetry = input.retryable && nextRetry <= MAX_RETRIES;
    if (canRetry) {
      const backoffMs = Math.min(15 * 60_000, 60_000 * Math.pow(2, nextRetry - 1));
      await admin
        .from("marketing_publications")
        .update({
          status: "queued",
          retry_count: nextRetry,
          error_code: input.errorCode,
          error_message: input.errorMessage,
          locked_by: null,
          locked_at: null,
          available_at: new Date(Date.now() + backoffMs).toISOString(),
          attempt_log: [...log, input.attempt],
        })
        .eq("id", input.id);
      return { finalStatus: "queued" };
    }
    await admin
      .from("marketing_publications")
      .update({
        status: "failed",
        retry_count: nextRetry,
        error_code: input.errorCode,
        error_message: input.errorMessage,
        locked_by: null,
        locked_at: null,
        attempt_log: [...log, input.attempt],
      })
      .eq("id", input.id);
    return { finalStatus: "failed" };
  }

  async findById(id: string): Promise<PublicationRow | null> {
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const r = await admin
      .from("marketing_publications")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return r.data ? toRow(r.data as DbRow) : null;
  }

  async resetForRetry(id: string, companyId: string): Promise<PublicationRow | null> {
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const r = await admin
      .from("marketing_publications")
      .update({
        status: "queued",
        error_code: null,
        error_message: null,
        locked_by: null,
        locked_at: null,
        available_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("company_id", companyId)
      .eq("status", "failed")
      .select("*")
      .maybeSingle();
    return r.data ? toRow(r.data as DbRow) : null;
  }

  async stats(companyId: string): Promise<PublisherStats> {
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const r = await admin
      .from("marketing_publications")
      .select("status")
      .eq("company_id", companyId);
    const rows = (r.data ?? []) as { status: string }[];
    const acc: PublisherStats = {
      scheduled: 0,
      queued: 0,
      publishing: 0,
      published: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const row of rows) {
      const key = row.status as keyof PublisherStats;
      if (key in acc) acc[key] += 1;
    }
    // 'scheduled' vem do calendário; preenchido no Agent.
    return acc;
  }
}
