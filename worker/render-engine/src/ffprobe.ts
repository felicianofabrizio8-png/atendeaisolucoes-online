import { spawn } from "node:child_process";

export interface FfprobeStreams {
  width: number;
  height: number;
  duration: number;
  videoCodec: string | null;
  audioCodec: string | null;
  pixFmt: string | null;
  sampleRate: number | null;
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
      duration?: string;
    }>;
  };
  const v = parsed.streams?.find((s) => s.codec_type === "video");
  const a = parsed.streams?.find((s) => s.codec_type === "audio");
  const duration = Number(parsed.format?.duration ?? v?.duration ?? a?.duration ?? 0);
  return {
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    duration,
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
    pixFmt: v?.pix_fmt ?? null,
    sampleRate: a?.sample_rate ? Number(a.sample_rate) : null,
  };
}

function runCollect(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d.toString(); });
    p.stderr.on("data", (d) => { err += d.toString(); });
    const to = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("ffprobe_timeout")); }, timeoutMs);
    p.on("error", (e) => { clearTimeout(to); reject(e); });
    p.on("close", (code) => {
      clearTimeout(to);
      if (code !== 0) reject(new Error(`ffprobe_exit_${code}:${err.slice(0, 300)}`));
      else resolve(out);
    });
  });
}
