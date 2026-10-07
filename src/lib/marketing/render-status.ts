export type MarketingRenderStatus = "queued" | "processing" | "completed" | "failed" | "cancelled" | "missing" | "not_started";

export interface MarketingRenderState {
  status: MarketingRenderStatus;
  progress: number | null;
  errorCode: string | null;
  jobId: string | null;
  videoId: string | null;
}

type RolePayload = {
  job_id?: string | null;
  job?: { status?: string | null; progress?: number | null; error_code?: string | null } | null;
  video_id?: string | null;
};

export function resolveMarketingRenderState(input: {
  jobId?: string | null;
  videoId?: string | null;
  role?: RolePayload | null;
}): MarketingRenderState {
  const videoId = input.videoId ?? input.role?.video_id ?? null;
  const jobId = input.jobId ?? input.role?.job_id ?? null;
  if (videoId) return { status: "completed", progress: 100, errorCode: null, jobId, videoId };
  if (!jobId) return { status: "not_started", progress: null, errorCode: null, jobId: null, videoId: null };
  const job = input.role?.job;
  if (!job) return { status: "missing", progress: null, errorCode: "job_not_found", jobId, videoId: null };
  const raw = job.status;
  const status: MarketingRenderStatus = raw === "queued" || raw === "processing" || raw === "completed" || raw === "failed" || raw === "cancelled" ? raw : "missing";
  return { status, progress: job.progress ?? null, errorCode: job.error_code ?? null, jobId, videoId: null };
}

export function isActiveMarketingRenderStatus(status: MarketingRenderStatus): boolean {
  return status === "queued" || status === "processing";
}
