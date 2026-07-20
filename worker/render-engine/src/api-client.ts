// ============================================================================
// Render API Client — ponte HTTP autenticada com o Atende Aí.
// Nunca toca no Supabase diretamente. Nunca loga secrets ou signed URLs.
// ============================================================================

import type { WorkerConfig } from "./config.js";

export interface FocalPointDto {
  x: number;
  y: number;
  zoom: number;
}

export interface SequenceItemDto {
  position: number;
  primary: boolean;
  imageDownloadUrl: string;
  focalPoint?: FocalPointDto | null;
  durationHint?: number;
}

export type LogoPositionDto =
  | "top-left"
  | "top-right"
  | "top-center"
  | "bottom-left"
  | "bottom-right"
  | "bottom-center"
  | "center";

/** Conteúdo textual determinístico (schemaVersion:2). Todos os campos opcionais. */
export interface VideoBrandContentDto {
  headline: string | null;
  supportingText: string | null;
  ctaText: string | null;
  companyName: string | null;
  /** Fase M4-render — template escolhido no editor visual (nome da cena). */
  template?: string | null;
  /** Fase M4-render — layout completo aprovado (posições/escalas). */
  overlayLayout?: Record<string, unknown> | null;
}

export interface VideoBrandDto {
  /** 1 = Fase 5.A (só watermark). 2 = Fase 5.B1 (com content). */
  schemaVersion: 1 | 2;
  brandVersionId: string;
  enabled: boolean;
  logo: {
    assetId: string;
    mimeType: string;
    width: number | null;
    height: number | null;
  } | null;
  /** Assinada pela bridge a cada claim. TTL curto. Nunca persistir. */
  logoDownloadUrl?: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    text: string;
    textInverse: string;
    background: string;
  };
  tokens: {
    logoPosition: LogoPositionDto;
    logoSafeMargin: number;
    overlayOpacity: number;
    gradientStyle: "none" | "subtle" | "vibrant";
  };
  watermark: { enabled: boolean; opacity: number; maxWidthRatio: number };
  intro: { enabled: boolean; durationSeconds: number };
  outro: {
    enabled: boolean;
    durationSeconds: number;
    headline: string | null;
    callToAction: string | null;
  };
  /** Somente v2. Ausente em snapshots v1 legados. */
  content?: VideoBrandContentDto;
}

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
  source: {
    imageDownloadUrl: string;
    audioDownloadUrl: string;
    focalPoint?: FocalPointDto | null;
    imageSequence?: SequenceItemDto[] | null;
  };
  /** Fase 5.A/5.B1 — contrato opcional. Ausente = renderiza sem marca. */
  videoBrand?: VideoBrandDto | null;
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

export interface SignedDownloadMeta {
  status: number;
  contentType: string | null;
  contentLength: number | null;
  downloadedBytes: number;
  elapsedMs: number;
  redirected: boolean;
  finalHost: string;
  finalPathname: string;
}

export async function downloadSignedUrlWithMeta(
  url: string,
  timeoutMs: number,
): Promise<{ bytes: ArrayBuffer; meta: SignedDownloadMeta }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: ac.signal });
    if (!res.ok) throw new Error(`download_http_${res.status}`);
    const bytes = await res.arrayBuffer();
    let finalHost = "invalid";
    let finalPathname = "";
    try {
      const u = new URL(res.url || url);
      finalHost = u.host;
      finalPathname = u.pathname;
    } catch { /* noop */ }
    const cl = res.headers.get("content-length");
    return {
      bytes,
      meta: {
        status: res.status,
        contentType: res.headers.get("content-type"),
        contentLength: cl ? Number(cl) : null,
        downloadedBytes: bytes.byteLength,
        elapsedMs: Date.now() - started,
        redirected: !!res.redirected,
        finalHost,
        finalPathname,
      },
    };
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
