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
