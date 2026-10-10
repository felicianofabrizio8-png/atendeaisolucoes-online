export type MarketingRenderStatus = "queued" | "processing" | "completed" | "failed" | "cancelled" | "missing" | "not_started";

/**
 * Job que parou de andar:
 *  - `queue_stalled`: está liberado na fila há tempo demais e nenhum worker o
 *    pegou — o serviço que gera os vídeos não está consumindo a fila.
 *  - `processing_stalled`: um worker pegou, mas não dá sinal há mais tempo do
 *    que qualquer render leva — ele caiu no meio do trabalho.
 */
export type RenderStall = "queue_stalled" | "processing_stalled";

/** O worker consulta a fila a cada poucos segundos; 5 min parado não é espera normal. */
export const QUEUE_STALL_MS = 5 * 60_000;
/** Trava do job (10 min) + folga. O FFmpeg do worker é interrompido aos 5 min. */
export const PROCESSING_STALL_MS = 15 * 60_000;

export const RENDER_STALL_MESSAGE: Record<RenderStall, string> = {
  queue_stalled:
    "O serviço que gera os vídeos não está respondendo. O vídeo continua na fila e será gerado quando o serviço voltar.",
  processing_stalled: "A geração do vídeo parou no meio e não foi concluída.",
};

export interface RenderJobTiming {
  status?: string | null;
  created_at?: string | null;
  /** Quando o job fica disponível para o worker (no futuro durante o intervalo entre tentativas). */
  available_at?: string | null;
  /** Último sinal de vida (o progresso do worker atualiza esta coluna). */
  updated_at?: string | null;
  locked_at?: string | null;
}

function ms(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** Diz se o job está parado. Datas ausentes ou inválidas nunca acusam parada. */
export function detectRenderStall(job: RenderJobTiming | null | undefined, nowMs: number): RenderStall | null {
  if (!job) return null;
  if (job.status === "queued") {
    // Durante o intervalo entre tentativas `available_at` está no futuro: é espera legítima.
    const since = Math.max(ms(job.available_at) ?? -Infinity, ms(job.created_at) ?? -Infinity);
    return Number.isFinite(since) && nowMs - since > QUEUE_STALL_MS ? "queue_stalled" : null;
  }
  if (job.status === "processing") {
    const since = Math.max(ms(job.updated_at) ?? -Infinity, ms(job.locked_at) ?? -Infinity);
    return Number.isFinite(since) && nowMs - since > PROCESSING_STALL_MS ? "processing_stalled" : null;
  }
  return null;
}

export interface MarketingRenderState {
  status: MarketingRenderStatus;
  progress: number | null;
  errorCode: string | null;
  jobId: string | null;
  videoId: string | null;
  /** Preenchido quando o job está ativo mas parado (ver `RenderStall`). */
  stall: RenderStall | null;
}

type RolePayload = {
  job_id?: string | null;
  job?: { status?: string | null; progress?: number | null; error_code?: string | null; stall?: string | null } | null;
  video_id?: string | null;
};

export function resolveMarketingRenderState(input: {
  jobId?: string | null;
  videoId?: string | null;
  role?: RolePayload | null;
}): MarketingRenderState {
  const videoId = input.videoId ?? input.role?.video_id ?? null;
  const jobId = input.jobId ?? input.role?.job_id ?? null;
  if (videoId) return { status: "completed", progress: 100, errorCode: null, jobId, videoId, stall: null };
  if (!jobId) return { status: "not_started", progress: null, errorCode: null, jobId: null, videoId: null, stall: null };
  const job = input.role?.job;
  if (!job) return { status: "missing", progress: null, errorCode: "job_not_found", jobId, videoId: null, stall: null };
  const raw = job.status;
  const status: MarketingRenderStatus = raw === "queued" || raw === "processing" || raw === "completed" || raw === "failed" || raw === "cancelled" ? raw : "missing";
  const stall =
    (status === "queued" && job.stall === "queue_stalled") || (status === "processing" && job.stall === "processing_stalled")
      ? (job.stall as RenderStall)
      : null;
  return { status, progress: job.progress ?? null, errorCode: job.error_code ?? null, jobId, videoId: null, stall };
}

export function isActiveMarketingRenderStatus(status: MarketingRenderStatus): boolean {
  return status === "queued" || status === "processing";
}
