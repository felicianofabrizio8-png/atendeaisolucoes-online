// ============================================================================
// Telemetry helpers — funções puras utilitárias para observabilidade.
// Não altera comportamento do pipeline. Nunca loga tokens ou signed URLs.
// ============================================================================

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";

export interface RedactedUrl {
  host: string;
  pathname: string;
  hasQuery: boolean;
}

/**
 * Extrai apenas host + pathname da URL. Query string, token e assinatura
 * são descartados. Retorna `{host: "invalid"}` quando parse falha.
 */
export function redactUrl(url: string): RedactedUrl {
  try {
    const u = new URL(url);
    return { host: u.host, pathname: u.pathname, hasQuery: !!u.search };
  } catch {
    return { host: "invalid", pathname: "", hasQuery: false };
  }
}

export interface FileFingerprint {
  sizeBytes: number;
  sha256: string;
  headHex: string; // primeiros 16 bytes em hex
  likelyFormat: string; // "mp3" | "wav" | "ogg" | "m4a" | "flac" | "webm" | "aac" | "unknown"
}

/**
 * Lê o arquivo por inteiro para gerar SHA-256 e assinatura de cabeçalho.
 * O conteúdo não é logado — apenas hashes e primeiros bytes em hex.
 */
export async function fingerprintFile(filePath: string): Promise<FileFingerprint> {
  const buf = await readFile(filePath);
  const sha = createHash("sha256").update(buf).digest("hex");
  const head = buf.subarray(0, 16);
  return {
    sizeBytes: buf.byteLength,
    sha256: sha,
    headHex: head.toString("hex"),
    likelyFormat: sniffFormat(head),
  };
}

/**
 * Detecção rápida de container por magic bytes. Não substitui o ffprobe.
 */
export function sniffFormat(head: Buffer): string {
  if (head.length < 4) return "unknown";
  const b = head;
  // ID3v2 tag ou frame MPEG (mp3)
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return "mp3"; // "ID3"
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) {
    // MPEG frame sync: MP3 (layer III) ou AAC ADTS (layer = 00)
    const layer = (b[1] >> 1) & 0x03;
    if (layer === 0x00) return "aac";
    return "mp3";
  }
  // RIFF....WAVE
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return "wav";
  // OggS
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return "ogg";
  // fLaC
  if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) return "flac";
  // ISO BMFF (mp4/m4a): "....ftyp"
  if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "m4a";
  // Matroska/WebM: 1A 45 DF A3
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  return "unknown";
}

export interface MemorySnapshot {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  uptimeSeconds: number;
  systemFreeBytes: number;
  systemTotalBytes: number;
}

export function memorySnapshot(): MemorySnapshot {
  const m = process.memoryUsage();
  return {
    rss: m.rss,
    heapUsed: m.heapUsed,
    heapTotal: m.heapTotal,
    external: m.external,
    arrayBuffers: m.arrayBuffers,
    uptimeSeconds: Math.round(process.uptime()),
    systemFreeBytes: os.freemem(),
    systemTotalBytes: os.totalmem(),
  };
}

export interface AudioRangeCheck {
  ok: boolean;
  code: "audio_range_out_of_bounds" | "audio_duration_invalid" | null;
  requestedStart: number;
  requestedDuration: number;
  requestedEnd: number;
  actualDuration: number | null;
  marginSeconds: number | null;
}

/**
 * Valida a janela [start, start+duration] contra a duração real do áudio.
 * Tolerância: 0.25s (mesma usada no guard antigo). Não modifica os valores.
 */
export function validateAudioRange(
  startSec: number,
  durationSec: number,
  actualDurationSec: number | null,
): AudioRangeCheck {
  const requestedEnd = startSec + durationSec;
  if (actualDurationSec === null || !Number.isFinite(actualDurationSec) || actualDurationSec <= 0) {
    return {
      ok: false,
      code: "audio_duration_invalid",
      requestedStart: startSec,
      requestedDuration: durationSec,
      requestedEnd,
      actualDuration: actualDurationSec,
      marginSeconds: null,
    };
  }
  const margin = actualDurationSec - requestedEnd;
  if (margin < -0.25) {
    return {
      ok: false,
      code: "audio_range_out_of_bounds",
      requestedStart: startSec,
      requestedDuration: durationSec,
      requestedEnd,
      actualDuration: actualDurationSec,
      marginSeconds: margin,
    };
  }
  return {
    ok: true,
    code: null,
    requestedStart: startSec,
    requestedDuration: durationSec,
    requestedEnd,
    actualDuration: actualDurationSec,
    marginSeconds: margin,
  };
}

/**
 * Trunca stderr/stdout guardando head (primeiros N bytes) + tail (últimos M bytes).
 * Nunca inclui URLs de query — chamador deve garantir que ffmpeg não recebeu
 * signed URL como argumento. Retorna metadados de truncamento.
 */
export interface TruncatedStream {
  head: string;
  tail: string;
  truncated: boolean;
  totalBytes: number;
}

export function truncateStream(
  full: string,
  headBytes = 4096,
  tailBytes = 8192,
): TruncatedStream {
  const totalBytes = Buffer.byteLength(full, "utf8");
  if (totalBytes <= headBytes + tailBytes) {
    return { head: full, tail: "", truncated: false, totalBytes };
  }
  const buf = Buffer.from(full, "utf8");
  const head = buf.subarray(0, headBytes).toString("utf8");
  const tail = buf.subarray(buf.byteLength - tailBytes).toString("utf8");
  return { head, tail, truncated: true, totalBytes };
}
