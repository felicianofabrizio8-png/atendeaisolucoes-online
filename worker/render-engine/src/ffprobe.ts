import { spawn } from "node:child_process";

export interface FfprobeStreams {
  width: number;
  height: number;
  duration: number;
  videoDuration: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioDuration: number | null;
  pixFmt: string | null;
  sampleRate: number | null;
  channels: number | null;
  channelLayout: string | null;
  audioBitRate: number | null;
  audioStartTime: number | null;
  audioDispositionDefault: number | null;
}

export interface VolumeAnalysis {
  meanVolumeDb: number | null;
  maxVolumeDb: number | null;
}

/**
 * Estrutura estendida para probing de arquivos de entrada (áudio).
 * Retorna informações de container + primeira stream de áudio + contagens.
 */
export interface FfprobeInputReport {
  formatName: string | null;
  formatLongName: string | null;
  duration: number | null;
  sizeBytes: number | null;
  overallBitRate: number | null;
  streamsTotal: number;
  audioStreams: number;
  videoStreams: number;
  audio: {
    codecName: string | null;
    codecLongName: string | null;
    codecType: string | null;
    sampleRate: number | null;
    channels: number | null;
    channelLayout: string | null;
    startTime: number | null;
    duration: number | null;
    bitRate: number | null;
    disposition: Record<string, number> | null;
    tags: Record<string, string> | null;
  } | null;
}

export async function ffprobe(filePath: string, timeoutMs: number): Promise<FfprobeStreams> {
  const args = [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ];
  const raw = await runCollect("ffprobe", args, timeoutMs);
  const parsed = JSON.parse(raw) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      pix_fmt?: string;
      sample_rate?: string;
      channels?: number;
      channel_layout?: string;
      bit_rate?: string;
      start_time?: string;
      duration?: string;
      disposition?: { default?: number };
    }>;
  };
  const v = parsed.streams?.find((s) => s.codec_type === "video");
  const a = parsed.streams?.find((s) => s.codec_type === "audio");
  const duration = Number(parsed.format?.duration ?? v?.duration ?? a?.duration ?? 0);
  return {
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    duration,
    videoDuration: v?.duration ? Number(v.duration) : duration || null,
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
    audioDuration: a?.duration ? Number(a.duration) : a ? duration || null : null,
    pixFmt: v?.pix_fmt ?? null,
    sampleRate: a?.sample_rate ? Number(a.sample_rate) : null,
    channels: a?.channels ?? null,
    channelLayout: a?.channel_layout ?? null,
    audioBitRate: a?.bit_rate ? Number(a.bit_rate) : null,
    audioStartTime: a?.start_time ? Number(a.start_time) : null,
    audioDispositionDefault: a?.disposition?.default ?? null,
  };
}

/**
 * Faz probing detalhado do arquivo de entrada. Retorna nulo em `audio` quando
 * não existe stream de áudio. Lança erro com prefixo `ffprobe_input_failed:`
 * quando o ffprobe termina com erro (arquivo corrompido, formato desconhecido).
 */
export async function ffprobeInput(filePath: string, timeoutMs: number): Promise<FfprobeInputReport> {
  const args = [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ];
  let raw: string;
  try {
    raw = await runCollect("ffprobe", args, timeoutMs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`ffprobe_input_failed:${msg.slice(0, 300)}`);
  }
  let parsed: {
    format?: { format_name?: string; format_long_name?: string; duration?: string; size?: string; bit_rate?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      codec_long_name?: string;
      sample_rate?: string;
      channels?: number;
      channel_layout?: string;
      start_time?: string;
      duration?: string;
      bit_rate?: string;
      disposition?: Record<string, number>;
      tags?: Record<string, string>;
    }>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`ffprobe_input_parse_failed:${String(err).slice(0, 200)}`);
  }
  const streams = parsed.streams ?? [];
  const audioStreams = streams.filter((s) => s.codec_type === "audio");
  const videoStreams = streams.filter((s) => s.codec_type === "video");
  const a = audioStreams[0] ?? null;
  return {
    formatName: parsed.format?.format_name ?? null,
    formatLongName: parsed.format?.format_long_name ?? null,
    duration: parsed.format?.duration ? Number(parsed.format.duration) : null,
    sizeBytes: parsed.format?.size ? Number(parsed.format.size) : null,
    overallBitRate: parsed.format?.bit_rate ? Number(parsed.format.bit_rate) : null,
    streamsTotal: streams.length,
    audioStreams: audioStreams.length,
    videoStreams: videoStreams.length,
    audio: a
      ? {
          codecName: a.codec_name ?? null,
          codecLongName: a.codec_long_name ?? null,
          codecType: a.codec_type ?? null,
          sampleRate: a.sample_rate ? Number(a.sample_rate) : null,
          channels: a.channels ?? null,
          channelLayout: a.channel_layout ?? null,
          startTime: a.start_time ? Number(a.start_time) : null,
          duration: a.duration ? Number(a.duration) : null,
          bitRate: a.bit_rate ? Number(a.bit_rate) : null,
          disposition: a.disposition ?? null,
          tags: sanitizeTags(a.tags ?? null),
        }
      : null,
  };
}

/**
 * Filtra tags do ffprobe para evitar registrar campos pessoais (comment/lyrics).
 * Mantém somente chaves conhecidas e seguras.
 */
function sanitizeTags(tags: Record<string, string> | null): Record<string, string> | null {
  if (!tags) return null;
  const allow = new Set([
    "title", "artist", "album", "genre", "date", "track", "encoder",
    "handler_name", "major_brand", "minor_version", "compatible_brands",
    "language", "vendor_id",
  ]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) {
    const key = k.toLowerCase();
    if (allow.has(key) && typeof v === "string") out[key] = v.slice(0, 120);
  }
  return Object.keys(out).length ? out : null;
}

export async function analyzeVolume(filePath: string, timeoutMs: number): Promise<VolumeAnalysis> {
  const args = [
    "-hide_banner",
    "-i", filePath,
    "-vn",
    "-af", "volumedetect",
    "-f", "null",
    "-",
  ];
  let raw = "";
  try {
    raw = await runCollect("ffmpeg", args, timeoutMs, true);
  } catch (error) {
    return { meanVolumeDb: null, maxVolumeDb: null };
  }
  const mean = raw.match(/mean_volume:\s*(-?[0-9.]+) dB/);
  const max = raw.match(/max_volume:\s*(-?[0-9.]+) dB/);
  return {
    meanVolumeDb: mean?.[1] ? Number(mean[1]) : null,
    maxVolumeDb: max?.[1] ? Number(max[1]) : null,
  };
}

function runCollect(cmd: string, args: string[], timeoutMs: number, includeStderr = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d.toString(); });
    p.stderr.on("data", (d) => { err += d.toString(); });
    const to = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("ffprobe_timeout")); }, timeoutMs);
    p.on("error", (e) => { clearTimeout(to); reject(e); });
    p.on("close", (code) => {
      clearTimeout(to);
      if (code !== 0) reject(new Error(`${cmd}_exit_${code}:${err.slice(0, 300)}`));
      else resolve(includeStderr ? out + err : out);
    });
  });
}
