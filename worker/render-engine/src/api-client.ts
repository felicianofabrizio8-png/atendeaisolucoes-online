// ============================================================================
// Render API Client — ponte HTTP autenticada com o Atende Aí.
// Nunca toca no Supabase diretamente. Nunca loga secrets ou signed URLs.
// ============================================================================

import type { WorkerConfig } from "./config.js";

export interface ClaimedJob {
  job: {
    id: string;
    companyId: string;
    workerId: string;
    attemptCount: number;
    videoFormat: "story" | "reels" | "feed_square" | "feed_4_5";
    audioStartSecond: number;
    durationSeconds: number;
    width: number;
    height: number;
  };
  source: { imageDownloadUrl: string; audioDownloadUrl: string };
  output: { videoId: string; uploadUrl: string; filePath: string };
  expiresAt: string;
}

export class RenderApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function jsonRequest<T>(
  cfg: WorkerConfig,
  path: string,
  body: unknown,
): Promise<{ status: number; data: T | null }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), cfg.httpTimeoutMs);
  try {
    const res = await fetch(`${cfg.renderApiUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-render-worker-secret": cfg.renderWorkerSecret,
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: ac.signal,
    });
    if (res.status === 204) return { status: 204, data: null };
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* mantém null */
    }
    if (!res.ok) {
      const p = (parsed ?? {}) as { error?: string; reason?: string };
      throw new RenderApiError(res.status, p.error ?? `http_${res.status}`, p.reason ?? p.error ?? `http_${res.status}`);
    }
    return { status: res.status, data: (parsed as T) ?? null };
  } finally {
    clearTimeout(t);
  }
}

export async function claimJob(cfg: WorkerConfig): Promise<ClaimedJob | null> {
  const { status, data } = await jsonRequest<ClaimedJob>(cfg, "/api/public/render/claim", {
    worker_id: cfg.workerId,
  });
  if (status === 204 || !data) return null;
  return data;
}

export type ProgressStage =
  | "downloading_sources"
  | "rendering"
  | "validating"
  | "uploading"
  | "finalizing";

export async function reportProgress(
  cfg: WorkerConfig,
  jobId: string,
  stage: ProgressStage,
  progress: number,
): Promise<void> {
  try {
    await jsonRequest(cfg, "/api/public/render/progress", {
      jobId, workerId: cfg.workerId, stage, progress,
    });
  } catch {
    // Progresso é best-effort — nunca falha o job por causa dele.
  }
}

export interface CompletePayload {
  videoId: string;
  filePath: string;
  width: number;
  height: number;
  durationSeconds: number;
  fileSizeBytes: number;
  videoCodec: string;
  audioCodec: string;
  pixelFormat: string;
  mimeType: string;
  renderElapsedMs?: number;
}

export async function reportComplete(
  cfg: WorkerConfig,
  jobId: string,
  payload: CompletePayload,
): Promise<{ videoId: string | null; idempotent?: boolean }> {
  const { data } = await jsonRequest<{ videoId: string | null; idempotent?: boolean }>(
    cfg,
    "/api/public/render/complete",
    { jobId, workerId: cfg.workerId, ...payload },
  );
  return data ?? { videoId: null };
}

export async function reportFail(
  cfg: WorkerConfig,
  jobId: string,
  stage: string,
  errorCode: string,
  errorMessageSanitized: string,
  permanent = false,
): Promise<void> {
  try {
    await jsonRequest(cfg, "/api/public/render/fail", {
      jobId,
      workerId: cfg.workerId,
      stage,
      errorCode,
      errorMessageSanitized,
      permanent,
    });
  } catch {
    // Falha ao reportar falha não pode escalar; o lock expira e a fila reagenda.
  }
}

// ---------------------------------------------------------------------------
// Downloads e uploads via Signed URLs. Não são logadas.
// ---------------------------------------------------------------------------
export async function downloadSignedUrl(url: string, timeoutMs: number): Promise<ArrayBuffer> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: ac.signal });
    if (!res.ok) throw new Error(`download_http_${res.status}`);
    return await res.arrayBuffer();
  } finally {
    clearTimeout(t);
  }
}

export async function uploadSignedUrl(
  url: string,
  bytes: Buffer,
  contentType: string,
  timeoutMs: number,
): Promise<void> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    // Supabase Storage createSignedUploadUrl usa método PUT com o token embutido na URL.
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "content-type": contentType,
        "x-upsert": "false",
      },
      body: new Uint8Array(bytes),
      redirect: "error",
      signal: ac.signal,
    });
    if (!res.ok) {
      const status = res.status;
      throw new Error(`upload_http_${status}`);
    }
  } finally {
    clearTimeout(t);
  }
}
